import { describe, expect, it, vi } from 'vitest';

import { EidosClient } from '../src/client';
import {
  EidosApiError,
  InvalidPatch,
  NotFound,
  PatchConflict,
  PreconditionFailed,
  QuotaExceeded,
  RateLimited,
} from '../src/errors';

const SERVICE = 'https://api.eidosxr.com';
const INGEST = 'https://ingest.example';

type Handler = (
  input: string,
  init?: RequestInit,
) => Response | Promise<Response>;

function makeClient(handler: Handler, opts: { ingestion?: boolean } = {}) {
  const fetch = vi.fn(async (input: string, init?: RequestInit) =>
    handler(input, init),
  );
  const client = new EidosClient('ek_test', {
    service: SERVICE,
    ingestionService: opts.ingestion === false ? undefined : INGEST,
    fetch,
  });
  return { client, fetch };
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

const SPEC_BODY = {
  id: 's1',
  name: 'demo',
  description: null,
  account_id: null,
  is_public: false,
  spec: { id: 's1', name: 'demo', root: { id: 'root', content: 'hello' } },
  created_at: '2026-07-04T00:00:00Z',
  updated_at: '2026-07-04T00:00:00Z',
  version: 3,
};

describe('auth', () => {
  it('requires a token', () => {
    expect(() => new EidosClient('')).toThrow();
  });

  it('sends the bearer header', async () => {
    const { client, fetch } = makeClient(() =>
      json({ specifications: [], total: 0, limit: 50, offset: 0 }),
    );
    await client.listSpecifications();
    const init = fetch.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer ek_test',
    );
  });
});

describe('specifications', () => {
  it('lists with an envelope and query params', async () => {
    const { client, fetch } = makeClient(() =>
      json({
        specifications: [
          {
            id: 's1',
            name: 'demo',
            description: null,
            account_id: null,
            is_public: true,
            template: false,
            created_by_user_id: 'u1',
            created_at: '2026-07-04T00:00:00Z',
            updated_at: '2026-07-04T00:00:00Z',
          },
        ],
        total: 1,
        limit: 10,
        offset: 0,
      }),
    );
    const result = await client.listSpecifications({ limit: 10 });
    expect(result.total).toBe(1);
    expect(result.specifications[0]!.id).toBe('s1');
    expect(fetch.mock.calls[0]![0]).toBe(`${SERVICE}/specifications?limit=10`);
  });

  it('gets a full specification', async () => {
    const { client } = makeClient(() => json(SPEC_BODY));
    const spec = await client.getSpecification('s1');
    expect(spec.version).toBe(3);
    expect(spec.spec).toMatchObject({ root: { id: 'root' } });
  });

  it('creates a specification', async () => {
    const { client, fetch } = makeClient(() =>
      json(SPEC_BODY, { status: 201 }),
    );
    await client.createSpecification({ name: 'demo', spec: { root: {} } });
    const body = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
    expect(body).toEqual({ name: 'demo', spec: { root: {} } });
  });

  it('updateSpecification sends the fast-json-patch diff with If-Match', async () => {
    const { client, fetch } = makeClient(() =>
      json({ id: 's1', spec: {}, version: 4, updated_at: 'x' }),
    );
    const current = { name: 'demo', root: { id: 'root', content: 'hello' } };
    const next = { name: 'demo', root: { id: 'root', content: 'changed' } };
    const result = await client.updateSpecification('s1', current, next, {
      ifMatch: 3,
    });
    expect(result?.version).toBe(4);
    const init = fetch.mock.calls[0]![1]!;
    expect(JSON.parse(init.body as string)).toEqual([
      { op: 'replace', path: '/root/content', value: 'changed' },
    ]);
    expect((init.headers as Record<string, string>)['If-Match']).toBe('"3"');
  });

  it('updateSpecification is a no-op when unchanged', async () => {
    const { client, fetch } = makeClient(() => json({}));
    const doc = { name: 'demo', root: { id: 'root' } };
    const result = await client.updateSpecification('s1', doc, { ...doc });
    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('deletes a specification', async () => {
    const { client } = makeClient(() => new Response(null, { status: 204 }));
    await expect(client.deleteSpecification('s1')).resolves.toBeUndefined();
  });
});

describe('error mapping', () => {
  it('maps 412 to PreconditionFailed with currentVersion', async () => {
    const { client } = makeClient(() =>
      json(
        { error: 'precondition_failed', current_version: 7 },
        { status: 412 },
      ),
    );
    await expect(
      client.patchSpecification(
        's1',
        [{ op: 'replace', path: '/name', value: 'x' }],
        { ifMatch: 3 },
      ),
    ).rejects.toMatchObject({ status: 412 });
    try {
      await client.patchSpecification('s1', [], { ifMatch: 3 });
    } catch (e) {
      expect(e).toBeInstanceOf(PreconditionFailed);
      expect((e as PreconditionFailed).currentVersion).toBe(7);
    }
  });

  it('maps 409 patch_conflict', async () => {
    const { client } = makeClient(() =>
      json({ error: 'patch_conflict', message: 'no' }, { status: 409 }),
    );
    await expect(
      client.patchSpecification('s1', [{ op: 'remove', path: '/x' }]),
    ).rejects.toBeInstanceOf(PatchConflict);
  });

  it('maps 404 not_found', async () => {
    const { client } = makeClient(() =>
      json({ error: 'not_found' }, { status: 404 }),
    );
    await expect(client.getSpecification('missing')).rejects.toBeInstanceOf(
      NotFound,
    );
  });

  it('maps 400 invalid_patch with details', async () => {
    const { client } = makeClient(() =>
      json(
        { error: 'invalid_patch', details: [{ op: 'bad' }] },
        { status: 400 },
      ),
    );
    try {
      await client.patchSpecification('s1', [{ op: 'x', path: '/a' } as never]);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidPatch);
      expect((e as InvalidPatch).details).toEqual([{ op: 'bad' }]);
    }
  });

  it('maps 402 quota_exceeded with bytesRemaining', async () => {
    const { client } = makeClient(() =>
      json({ error: 'quota_exceeded', bytes_remaining: 42 }, { status: 402 }),
    );
    try {
      await client.finalizeDataset('d1', { sizeBytes: 1 });
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(QuotaExceeded);
      expect((e as QuotaExceeded).bytesRemaining).toBe(42);
    }
  });

  it('maps 429 rate_limited and reads Retry-After', async () => {
    const { client } = makeClient(() =>
      json(
        { error: 'rate_limited' },
        { status: 429, headers: { 'Retry-After': '5' } },
      ),
    );
    try {
      await client.listSpecifications();
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimited);
      expect((e as RateLimited).retryAfter).toBe('5');
    }
  });
});

describe('templates', () => {
  it('lists a bare array', async () => {
    const { client } = makeClient(() =>
      json([
        {
          id: 't1',
          name: 'tmpl',
          description: '',
          category: 'custom',
          node_type: 'world',
          icon: null,
          scope: 'user',
          account_id: null,
          created_by_user_id: 'u1',
          spec_json: { nodeType: 'world' },
          created_at: 'x',
          updated_at: 'x',
        },
      ]),
    );
    const templates = await client.listTemplates({ nodeType: 'world' });
    expect(templates).toHaveLength(1);
    expect(templates[0]!.node_type).toBe('world');
  });
});

describe('datasets / ingestion', () => {
  it('lists datasets', async () => {
    const { client } = makeClient(() =>
      json([
        {
          id: 'd1',
          original_filename: 'a.nc',
          status: 'completed',
        },
      ]),
    );
    const datasets = await client.listDatasets({ status: 'completed' });
    expect(datasets[0]!.status).toBe('completed');
  });

  it('putZarrObject sets Content-Length', async () => {
    const { client, fetch } = makeClient(
      () => new Response(null, { status: 204 }),
    );
    await client.putZarrObject('d1', '.zmetadata', new Uint8Array([123, 125]));
    const init = fetch.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)['Content-Length']).toBe(
      '2',
    );
  });

  it('putZarrObject rejects bodies over 64 MiB', async () => {
    const { client } = makeClient(() => new Response(null, { status: 204 }));
    await expect(
      client.putZarrObject('d1', 'x', new Uint8Array(64 * 1024 * 1024 + 1)),
    ).rejects.toThrow();
  });

  it('throws when the ingestion service is not configured', async () => {
    const { client } = makeClient(() => json([]), { ingestion: false });
    await expect(client.listDatasets()).rejects.toBeInstanceOf(EidosApiError);
  });
});
