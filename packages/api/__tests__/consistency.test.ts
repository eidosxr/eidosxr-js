import { describe, expect, it, vi } from 'vitest';

import { EidosClient } from '../src/client';
import {
  ConsistencyError,
  ZMETADATA_KEY,
  checkStoreConsistency,
  compareStores,
  loadConsolidatedMetadata,
} from '../src/consistency';

const enc = new TextEncoder();

function int64LE(vals: number[]): Uint8Array {
  const b = new Uint8Array(vals.length * 8);
  const dv = new DataView(b.buffer);
  vals.forEach((v, i) => dv.setBigInt64(i * 8, BigInt(v), true));
  return b;
}

function zarray(shape: number[], chunks: number[], dtype: string) {
  return {
    shape,
    chunks,
    dtype,
    compressor: null,
    fill_value: null,
    filters: null,
    order: 'C',
    zarr_format: 2,
    dimension_separator: '.',
  };
}

function makeStore(
  timeVals: number[],
  xVals: number[] = [10, 20],
): Map<string, Uint8Array> {
  const nt = timeVals.length;
  const nx = xVals.length;
  const meta: Record<string, unknown> = {
    '.zgroup': { zarr_format: 2 },
    'time/.zarray': zarray([nt], [nt], '<i8'),
    'time/.zattrs': { _ARRAY_DIMENSIONS: ['time'] },
    'x/.zarray': zarray([nx], [nx], '<i8'),
    'x/.zattrs': { _ARRAY_DIMENSIONS: ['x'] },
    'hs/.zarray': zarray([nt, nx], [nt, nx], '<f4'),
    'hs/.zattrs': { _ARRAY_DIMENSIONS: ['time', 'x'] },
  };
  const store = new Map<string, Uint8Array>();
  store.set(
    ZMETADATA_KEY,
    enc.encode(JSON.stringify({ zarr_consolidated_format: 1, metadata: meta })),
  );
  store.set('time/0', int64LE(timeVals));
  store.set('x/0', int64LE(xVals));
  store.set('hs/0.0', new Uint8Array(nt * nx * 4)); // float32 zeros
  return store;
}

function compare(
  existing: Map<string, Uint8Array>,
  fresh: Map<string, Uint8Array>,
  opts: { mode: 'replace' | 'append'; appendDim?: string },
) {
  compareStores(
    loadConsolidatedMetadata((k) => existing.get(k)),
    loadConsolidatedMetadata((k) => fresh.get(k)),
    (k) => existing.get(k),
    (k) => fresh.get(k),
    opts,
  );
}

describe('integrity', () => {
  it('accepts a valid store', () => {
    expect(() => checkStoreConsistency(makeStore([0, 1, 2]))).not.toThrow();
  });

  it('rejects a wrong chunk byte size', () => {
    const store = makeStore([0, 1, 2]);
    store.set('hs/0.0', new Uint8Array(4)); // too small
    expect(() => checkStoreConsistency(store)).toThrow(/bytes/);
  });

  it('rejects a chunk outside the grid', () => {
    const store = makeStore([0, 1, 2]);
    store.set('hs/1.0', store.get('hs/0.0') as Uint8Array);
    expect(() => checkStoreConsistency(store)).toThrow(/out of range/);
  });

  it('rejects an orphan object', () => {
    const store = makeStore([0, 1, 2]);
    store.set('ghost/0', new Uint8Array(8));
    expect(() => checkStoreConsistency(store)).toThrow(/orphan/);
  });

  it('rejects a missing .zmetadata', () => {
    const store = makeStore([0, 1, 2]);
    store.delete(ZMETADATA_KEY);
    expect(() => checkStoreConsistency(store)).toThrow(ConsistencyError);
  });
});

describe('replace (PUT)', () => {
  it('accepts identical coordinates', () => {
    expect(() =>
      compare(makeStore([0, 1, 2]), makeStore([0, 1, 2]), { mode: 'replace' }),
    ).not.toThrow();
  });

  it('rejects a changed coordinate', () => {
    expect(() =>
      compare(makeStore([0, 1, 2]), makeStore([0, 1, 9]), { mode: 'replace' }),
    ).toThrow(/coordinate 'time'/);
  });

  it('rejects a changed non-time coordinate', () => {
    expect(() =>
      compare(makeStore([0, 1, 2], [10, 20]), makeStore([0, 1, 2], [10, 99]), {
        mode: 'replace',
      }),
    ).toThrow(/coordinate 'x'/);
  });
});

describe('append (PATCH)', () => {
  it('accepts non-overlapping monotonic coordinates', () => {
    expect(() =>
      compare(makeStore([0, 1, 2]), makeStore([3, 4, 5]), {
        mode: 'append',
        appendDim: 'time',
      }),
    ).not.toThrow();
  });

  it('rejects overlapping coordinates', () => {
    expect(() =>
      compare(makeStore([0, 1, 2]), makeStore([2, 3, 4]), {
        mode: 'append',
        appendDim: 'time',
      }),
    ).toThrow(/overlap/);
  });

  it('rejects a reversed append direction', () => {
    expect(() =>
      compare(makeStore([0, 1, 2]), makeStore([5, 4, 3]), {
        mode: 'append',
        appendDim: 'time',
      }),
    ).toThrow(/direction/);
  });

  it('requires the non-append coordinate to match', () => {
    expect(() =>
      compare(makeStore([0, 1, 2], [10, 20]), makeStore([3, 4, 5], [10, 99]), {
        mode: 'append',
        appendDim: 'time',
      }),
    ).toThrow(/coordinate 'x'/);
  });

  it('rejects a dtype mismatch', () => {
    const fresh = makeStore([3, 4, 5]);
    const meta = JSON.parse(
      new TextDecoder().decode(fresh.get(ZMETADATA_KEY)!),
    );
    meta.metadata['hs/.zarray'].dtype = '<f8';
    fresh.set(ZMETADATA_KEY, enc.encode(JSON.stringify(meta)));
    expect(() =>
      compare(makeStore([0, 1, 2]), fresh, {
        mode: 'append',
        appendDim: 'time',
      }),
    ).toThrow(/dtype differs/);
  });
});

describe('client.checkPutConsistency', () => {
  it('fetches the existing archive and validates an append', async () => {
    const existing = makeStore([0, 1, 2]);
    const fetch = vi.fn(async (input: string) => {
      // .../api/datasets/d1/zarr/<key>
      const key = input.split('/zarr/')[1]!;
      const body = existing.get(decodeURIComponent(key));
      if (!body) return new Response(null, { status: 404 });
      return new Response(body as BodyInit, { status: 200 });
    });
    const client = new EidosClient('ek_test', {
      ingestionService: 'https://ingest.example',
      fetch,
    });
    await expect(
      client.checkPutConsistency('d1', makeStore([3, 4, 5]), {
        mode: 'append',
        appendDim: 'time',
      }),
    ).resolves.toBeUndefined();
    await expect(
      client.checkPutConsistency('d1', makeStore([2, 3, 4]), {
        mode: 'append',
        appendDim: 'time',
      }),
    ).rejects.toThrow(/overlap/);
  });

  it('is a no-op for clobber', async () => {
    const fetch = vi.fn();
    const client = new EidosClient('ek_test', {
      ingestionService: 'https://ingest.example',
      fetch: fetch as never,
    });
    await client.checkPutConsistency('d1', makeStore([0, 1, 2]), {
      mode: 'clobber',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
