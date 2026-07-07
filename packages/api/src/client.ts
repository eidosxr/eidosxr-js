/**
 * Client for the EIDOS platform API.
 *
 * {@link EidosClient} is a thin, typed transport over the two EIDOS platform
 * workers:
 *
 * - **spec-api** (`https://api.eidosxr.com`) — specification and template CRUD,
 *   and RFC-6902 JSON-Patch updates.
 * - **zarr-ingestion-service** — zarr dataset and asset storage.
 *
 * Both authenticate with a single bearer token, which may be a Supabase user JWT
 * **or** an `ek_` Oceanum API key.
 *
 * The intended edit loop mirrors the Python client — fetch, edit locally, then
 * `updateSpecification` diffs the old and new documents with `fast-json-patch`
 * (the same library the server applies with) and sends the patch with an
 * `If-Match` for optimistic concurrency:
 *
 * ```ts
 * const client = new EidosClient("ek_...");
 * const spec = await client.getSpecification(id);
 * const next = structuredClone(spec.spec);
 * next.name = "Updated";
 * await client.updateSpecification(id, spec.spec, next, { ifMatch: spec.version });
 * ```
 */
import { compare } from 'fast-json-patch';

import {
  ZMETADATA_KEY,
  compareStores,
  coordinateKeys,
  loadConsolidatedMetadata,
  type Getter,
  type WriteMode,
  type ZarrStore,
} from './consistency';
import { EidosApiError, errorFromResponse } from './errors';
import type {
  AssetRef,
  CoordKeys,
  CreateEmptyDatasetResult,
  Dataset,
  DatasetMetadata,
  DatasetStatus,
  EidosSpec,
  FinalizeDatasetResult,
  JsonPatch,
  Specification,
  SpecificationList,
  SpecificationPatchResult,
  Template,
} from './types';

export const DEFAULT_SERVICE = 'https://api.eidosxr.com';

/** Max body accepted by a single ingestion zarr PUT (server-enforced). */
export const ZARR_OBJECT_MAX_BYTES = 64 * 1024 * 1024;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface EidosClientOptions {
  /** Base URL of the spec-api. Default `https://api.eidosxr.com`. */
  service?: string;
  /**
   * Base URL of the zarr-ingestion service (the app's
   * `VITE_INGESTION_SERVICE_URL`). Required only for dataset/asset calls.
   */
  ingestionService?: string;
  /** Injected fetch (defaults to global `fetch`); useful for testing. */
  fetch?: FetchLike;
}

interface RequestOptions {
  headers?: Record<string, string>;
  body?: BodyInit | Uint8Array;
  json?: unknown;
  params?: Record<string, string | number | undefined>;
}

export class EidosClient {
  readonly service: string;
  readonly ingestionService?: string;
  private readonly token: string;
  private readonly _fetch: FetchLike;

  /**
   * @param token bearer token — a Supabase JWT or an `ek_` API key.
   * @param options service URLs and an optional injected fetch.
   */
  constructor(token: string, options: EidosClientOptions = {}) {
    if (!token) {
      throw new Error('An EIDOS API token is required.');
    }
    this.token = token;
    this.service = (options.service ?? DEFAULT_SERVICE).replace(/\/+$/, '');
    this.ingestionService = options.ingestionService?.replace(/\/+$/, '');
    const f = options.fetch ?? globalThis.fetch;
    if (!f) {
      throw new Error('No fetch implementation available; pass options.fetch.');
    }
    this._fetch = f.bind(globalThis) as FetchLike;
  }

  // -- internal --------------------------------------------------------
  private buildUrl(
    base: string,
    path: string,
    params?: RequestOptions['params'],
  ): string {
    let url = `${base}${path}`;
    if (params) {
      const search = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) search.set(k, String(v));
      }
      const qs = search.toString();
      if (qs) url += `?${qs}`;
    }
    return url;
  }

  private async request(
    method: string,
    url: string,
    options: RequestOptions = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      ...options.headers,
    };
    let body = options.body;
    if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.json);
    }
    const response = await this._fetch(url, {
      method,
      headers,
      body: body as BodyInit | undefined,
    });
    if (!response.ok) {
      throw await errorFromResponse(response);
    }
    return response;
  }

  private ingestionUrl(
    path: string,
    params?: RequestOptions['params'],
  ): string {
    if (!this.ingestionService) {
      throw new EidosApiError(
        'ingestionService is not configured — pass options.ingestionService to ' +
          'use dataset/asset endpoints.',
        { status: 0 },
      );
    }
    return this.buildUrl(this.ingestionService, path, params);
  }

  private static dropUndefined<T extends Record<string, unknown>>(
    obj: T,
  ): Partial<T> {
    const out: Partial<T> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined) out[k as keyof T] = v as T[keyof T];
    }
    return out;
  }

  // -- specifications --------------------------------------------------
  /** List the caller's specifications plus all public ones. */
  async listSpecifications(
    params: { limit?: number; offset?: number } = {},
  ): Promise<SpecificationList> {
    const url = this.buildUrl(this.service, '/specifications', {
      limit: params.limit,
      offset: params.offset,
    });
    const res = await this.request('GET', url);
    return (await res.json()) as SpecificationList;
  }

  /** Create a specification. */
  async createSpecification(input: {
    name: string;
    spec?: EidosSpec | null;
    description?: string | null;
    accountId?: string | null;
  }): Promise<Specification> {
    const json = EidosClient.dropUndefined({
      name: input.name,
      description: input.description ?? undefined,
      account_id: input.accountId ?? undefined,
      spec: input.spec ?? undefined,
    });
    const res = await this.request('POST', `${this.service}/specifications`, {
      json,
    });
    return (await res.json()) as Specification;
  }

  /** Fetch a full specification (including `spec` and `version`). */
  async getSpecification(id: string): Promise<Specification> {
    const res = await this.request(
      'GET',
      `${this.service}/specifications/${id}`,
    );
    return (await res.json()) as Specification;
  }

  /**
   * Apply a raw RFC-6902 JSON Patch to a specification. Pass `ifMatch` (the
   * version from a prior read) for optimistic concurrency — a mismatch throws
   * {@link PreconditionFailed} (412).
   */
  async patchSpecification(
    id: string,
    operations: JsonPatch,
    options: { ifMatch?: number | string } = {},
  ): Promise<SpecificationPatchResult> {
    const headers: Record<string, string> = {};
    if (options.ifMatch !== undefined)
      headers['If-Match'] = `"${options.ifMatch}"`;
    const res = await this.request(
      'PATCH',
      `${this.service}/specifications/${id}`,
      {
        json: operations,
        headers,
      },
    );
    return (await res.json()) as SpecificationPatchResult;
  }

  /**
   * Persist local edits by diffing `current` against `next` (with the same
   * `fast-json-patch` the server applies) and PATCHing the result. Returns
   * `null` when the documents are identical.
   */
  async updateSpecification(
    id: string,
    current: EidosSpec | null | undefined,
    next: EidosSpec,
    options: { ifMatch?: number | string } = {},
  ): Promise<SpecificationPatchResult | null> {
    const operations = compare(
      (current ?? {}) as Record<string, unknown>,
      next as Record<string, unknown>,
    ) as JsonPatch;
    if (operations.length === 0) return null;
    return this.patchSpecification(id, operations, options);
  }

  /** Delete a specification. */
  async deleteSpecification(id: string): Promise<void> {
    await this.request('DELETE', `${this.service}/specifications/${id}`);
  }

  // -- templates -------------------------------------------------------
  /** List templates visible to the caller (excludes archived). */
  async listTemplates(
    params: { nodeType?: string; owned?: boolean } = {},
  ): Promise<Template[]> {
    const url = this.buildUrl(this.service, '/templates', {
      node_type: params.nodeType,
      owned: params.owned === undefined ? undefined : String(params.owned),
    });
    const res = await this.request('GET', url);
    return (await res.json()) as Template[];
  }

  /** Create a template from an explicit `specJson` node subtree. */
  async createTemplate(input: {
    name: string;
    nodeType: string;
    specJson: EidosSpec;
    description?: string;
    category?: string;
    icon?: string;
    scope?: string;
    accountId?: string;
  }): Promise<Template> {
    const json = EidosClient.dropUndefined({
      name: input.name,
      node_type: input.nodeType,
      spec_json: input.specJson,
      description: input.description,
      category: input.category,
      icon: input.icon,
      scope: input.scope,
      account_id: input.accountId,
    });
    const res = await this.request('POST', `${this.service}/templates`, {
      json,
    });
    return (await res.json()) as Template;
  }

  /** Create a template from a live node; the server strips its `id`. */
  async createTemplateFromNode(input: {
    name: string;
    nodeType: string;
    nodeData: EidosSpec;
    description?: string;
    category?: string;
    icon?: string;
    scope?: string;
    accountId?: string;
  }): Promise<Template> {
    const json = EidosClient.dropUndefined({
      name: input.name,
      node_type: input.nodeType,
      node_data: input.nodeData,
      description: input.description,
      category: input.category,
      icon: input.icon,
      scope: input.scope,
      account_id: input.accountId,
    });
    const res = await this.request(
      'POST',
      `${this.service}/templates/from-node`,
      {
        json,
      },
    );
    return (await res.json()) as Template;
  }

  /** Update a template's `name`/`description` (the only mutable fields). */
  async updateTemplate(
    id: string,
    input: { name?: string; description?: string },
  ): Promise<Template> {
    const json = EidosClient.dropUndefined({
      name: input.name,
      description: input.description,
    });
    if (Object.keys(json).length === 0) {
      throw new Error('Provide at least one of name/description to update.');
    }
    const res = await this.request('PATCH', `${this.service}/templates/${id}`, {
      json,
    });
    return (await res.json()) as Template;
  }

  /** Soft-delete (archive) a template. */
  async archiveTemplate(id: string): Promise<void> {
    await this.request('POST', `${this.service}/templates/${id}/archive`);
  }

  /** Permanently delete a template. */
  async deleteTemplate(id: string): Promise<void> {
    await this.request('DELETE', `${this.service}/templates/${id}`);
  }

  // -- datasets (ingestion) --------------------------------------------
  /** List the caller's zarr datasets. */
  async listDatasets(
    params: { status?: DatasetStatus; limit?: number; offset?: number } = {},
  ): Promise<Dataset[]> {
    const url = this.ingestionUrl('/api/datasets', {
      status: params.status,
      limit: params.limit,
      offset: params.offset,
    });
    const res = await this.request('GET', url);
    return (await res.json()) as Dataset[];
  }

  /** Fetch a single dataset (public datasets are readable anonymously). */
  async getDataset(id: string): Promise<Dataset> {
    const res = await this.request(
      'GET',
      this.ingestionUrl(`/api/datasets/${id}`),
    );
    return (await res.json()) as Dataset;
  }

  /** Update a dataset's `name`/`description`/`coordkeys`. */
  async updateDataset(
    id: string,
    input: {
      name?: string | null;
      description?: string | null;
      coordkeys?: CoordKeys | null;
    },
  ): Promise<Dataset> {
    const json = EidosClient.dropUndefined({
      name: input.name,
      description: input.description,
      coordkeys: input.coordkeys,
    });
    if (Object.keys(json).length === 0) {
      throw new Error('Provide at least one field to update.');
    }
    const res = await this.request(
      'PATCH',
      this.ingestionUrl(`/api/datasets/${id}`),
      {
        json,
      },
    );
    return (await res.json()) as Dataset;
  }

  /** Allocate an empty dataset row (step 1 of client-direct ingestion). */
  async createEmptyDataset(input: {
    originalFilename: string;
    name?: string;
    description?: string;
  }): Promise<CreateEmptyDatasetResult> {
    const json = EidosClient.dropUndefined({
      original_filename: input.originalFilename,
      name: input.name,
      description: input.description,
    });
    const res = await this.request(
      'POST',
      this.ingestionUrl('/api/datasets/empty'),
      {
        json,
      },
    );
    return (await res.json()) as CreateEmptyDatasetResult;
  }

  /**
   * Write one object into a dataset's zarr store (step 2 of ingestion).
   * `objectPath` is a store-relative key such as `.zmetadata` or `0/hs/0.0`.
   * Bodies are capped at 64 MiB.
   */
  async putZarrObject(
    id: string,
    objectPath: string,
    data: Uint8Array | ArrayBuffer,
  ): Promise<void> {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    if (bytes.byteLength > ZARR_OBJECT_MAX_BYTES) {
      throw new Error(
        `zarr object exceeds the ${ZARR_OBJECT_MAX_BYTES}-byte limit; split it into smaller chunks.`,
      );
    }
    await this.request(
      'PUT',
      this.ingestionUrl(`/api/datasets/${id}/zarr/${objectPath}`),
      {
        body: bytes,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(bytes.byteLength),
        },
      },
    );
  }

  /** Finalize a client-direct dataset (step 3): quota check + mark completed. */
  async finalizeDataset(
    id: string,
    input: { sizeBytes: number; coordkeys?: CoordKeys },
  ): Promise<FinalizeDatasetResult> {
    const json = EidosClient.dropUndefined({
      size_bytes: input.sizeBytes,
      coordkeys: input.coordkeys,
    });
    const res = await this.request(
      'POST',
      this.ingestionUrl(`/api/datasets/${id}/finalize`),
      { json },
    );
    return (await res.json()) as FinalizeDatasetResult;
  }

  /** Fetch per-level grid metadata for a completed dataset. */
  async getDatasetMetadata(id: string): Promise<DatasetMetadata> {
    const res = await this.request(
      'GET',
      this.ingestionUrl(`/api/datasets/${id}/metadata`),
    );
    return (await res.json()) as DatasetMetadata;
  }

  /** Read one object from a completed dataset's zarr store. */
  async getZarrObject(id: string, objectPath: string): Promise<Uint8Array> {
    const res = await this.request(
      'GET',
      this.ingestionUrl(`/api/datasets/${id}/zarr/${objectPath}`),
    );
    return new Uint8Array(await res.arrayBuffer());
  }

  // -- assets ----------------------------------------------------------
  /** Upload an asset (multipart `file` field). Returns its reference. */
  async uploadAsset(file: Blob, filename = 'asset'): Promise<AssetRef> {
    const form = new FormData();
    form.append('file', file, filename);
    const res = await this.request('POST', this.ingestionUrl('/api/assets'), {
      body: form,
    });
    const json = (await res.json()) as { ref: AssetRef };
    return json.ref;
  }

  /** Download an asset's bytes. */
  async getAsset(assetId: string): Promise<Uint8Array> {
    const res = await this.request(
      'GET',
      this.ingestionUrl(`/api/assets/${assetId}`),
    );
    return new Uint8Array(await res.arrayBuffer());
  }

  // -- consistency -----------------------------------------------------
  /**
   * Verify a zarr `store` is consistent with an existing dataset for the
   * intended write verb, before uploading it.
   *
   * @param datasetId the existing (completed) dataset to check against.
   * @param store the zarr store to write, as a `Map<string, Uint8Array>`.
   * @param options.mode `"replace"` (PUT — coordinate structure must match
   *   exactly), `"append"` (PATCH — the `appendDim` coordinate extends the
   *   existing axis monotonically and without overlap; other coordinates match),
   *   or `"clobber"` (POST — no check).
   * @param options.appendDim the dimension being appended (required for append).
   * @throws {ConsistencyError} if the store is incompatible for `mode`.
   */
  async checkPutConsistency(
    datasetId: string,
    store: ZarrStore,
    options: { mode?: WriteMode; appendDim?: string } = {},
  ): Promise<void> {
    const mode = options.mode ?? 'replace';
    if (mode === 'clobber') return;

    // Fetch the existing archive's metadata + coordinate chunks up front, so the
    // (synchronous) comparison can read them from a local map.
    const existing = new Map<string, Uint8Array>();
    existing.set(
      ZMETADATA_KEY,
      await this.getZarrObject(datasetId, ZMETADATA_KEY),
    );
    const existingGet: Getter = (k) => existing.get(k);
    const existingMeta = loadConsolidatedMetadata(existingGet);
    const newMeta = loadConsolidatedMetadata((k) => store.get(k));

    for (const key of coordinateKeys(existingMeta)) {
      existing.set(key, await this.getZarrObject(datasetId, key));
    }

    compareStores(existingMeta, newMeta, existingGet, (k) => store.get(k), {
      mode,
      appendDim: options.appendDim,
    });
  }
}
