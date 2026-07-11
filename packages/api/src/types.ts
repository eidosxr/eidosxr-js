/**
 * Public types for `@eidosxr/api`.
 *
 * The spec-api shapes are re-exported straight from the generated OpenAPI types
 * (`./generated/spec-api`) so they never drift from the contract. The
 * zarr-ingestion service has no OpenAPI document, so its shapes are defined here
 * from the verified worker responses.
 */
import type { components } from './generated/spec-api';

/**
 * An EIDOS specification document. Structurally aligned with `EidosSpec` from
 * `@oceanum/eidos`; kept as an open record here so `@eidosxr/api` has no
 * dependency on the renderer package. Pass your typed `EidosSpec` through — it
 * is assignable to this.
 */
export type EidosSpec = Record<string, unknown>;

// -- spec-api (generated) --------------------------------------------------
type Schemas = components['schemas'];

export type Specification = Schemas['Specification'];
export type SpecificationSummary = Schemas['SpecificationSummary'];
export type SpecificationList = Schemas['SpecificationList'];
export type CreateSpecificationRequest = Schemas['CreateSpecificationRequest'];
export type SpecificationPatchResult = Schemas['SpecificationPatchResult'];
export type JsonPatchOperation = Schemas['JsonPatchOperation'];
export type JsonPatch = JsonPatchOperation[];
export type Template = Schemas['Template'];
export type CreateTemplateRequest = Schemas['CreateTemplateRequest'];
export type TemplateFromNodeRequest = Schemas['TemplateFromNodeRequest'];
export type PatchTemplateRequest = Schemas['PatchTemplateRequest'];

// -- zarr-ingestion (hand-defined from the worker) -------------------------
export type DatasetStatus = 'processing' | 'completed' | 'failed';

export interface Dataset {
  id: string;
  original_filename: string;
  name?: string | null;
  description?: string | null;
  coordkeys?: Record<string, string> | null;
  r2_zarr_uri?: string | null;
  size_bytes?: number | null;
  status: DatasetStatus;
  error_message?: string | null;
  created_at?: string;
  /** Only populated by `GET /api/datasets/:id` (omitted from the list). */
  is_public?: boolean;
  [key: string]: unknown;
}

export interface DatasetMetadata {
  levels: Array<{
    path: string;
    dx?: number;
    dy?: number;
    nx?: number;
    ny?: number;
    [key: string]: unknown;
  }>;
  zmetadata: Record<string, unknown>;
}

export interface CreateEmptyDatasetResult {
  dataset_id: string;
  status: DatasetStatus;
}

export interface FinalizeDatasetResult {
  id: string;
  status: DatasetStatus;
  r2_zarr_uri: string;
  size_bytes: number;
}

export interface AssetRef {
  type: string;
  id: string;
  r2_key: string;
  url: string;
}

/** Coordinate-key axes accepted by dataset endpoints. */
export type CoordKeys = Partial<Record<'x' | 'y' | 'z' | 't' | 'g', string>>;
