/**
 * Zarr consistency checks for dataset-cache writes.
 *
 * The EIDOS dataset cache stores zarr **v2** archives with `compressor: null`
 * (uncompressed) and a consolidated `.zmetadata` manifest. These helpers let a
 * client verify, before writing, that:
 *
 * - a store it is about to upload is internally consistent
 *   ({@link checkStoreConsistency});
 * - a store is *coordinate-consistent* with an existing dataset for the intended
 *   write verb ({@link EidosClient.checkPutConsistency}):
 *   - `replace` (PUT) — identical coordinate structure; every coordinate matches.
 *   - `append` (PATCH) — the append-axis coordinate extends the existing one,
 *     monotonic and non-overlapping; other coordinates match.
 *   - `clobber` (POST) — no check (complete replacement).
 *
 * A "store" is a `Map<string, Uint8Array>` of zarr key -> object bytes.
 */

export const ZMETADATA_KEY = '.zmetadata';

export type WriteMode = 'replace' | 'append' | 'clobber';
export type ZarrStore = Map<string, Uint8Array>;
export type Getter = (key: string) => Uint8Array | undefined;

export interface ZArray {
  shape: number[];
  chunks: number[];
  dtype: string;
  compressor: unknown;
  fill_value: unknown;
  filters: unknown;
  order?: string;
  zarr_format?: number;
  dimension_separator?: string;
}

export class ConsistencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConsistencyError';
    Object.setPrototypeOf(this, ConsistencyError.prototype);
  }
}

const decoder = new TextDecoder();

// -- consolidated metadata -------------------------------------------------
export function loadConsolidatedMetadata(get: Getter): Record<string, unknown> {
  const raw = get(ZMETADATA_KEY);
  if (raw === undefined) {
    throw new ConsistencyError(
      `${ZMETADATA_KEY} not found — not a consolidated zarr store`,
    );
  }
  let doc: unknown;
  try {
    doc = JSON.parse(decoder.decode(raw));
  } catch {
    throw new ConsistencyError(`${ZMETADATA_KEY} is not valid JSON`);
  }
  const meta =
    doc && typeof doc === 'object' && 'metadata' in doc
      ? (doc as { metadata: unknown }).metadata
      : doc;
  if (!meta || typeof meta !== 'object') {
    throw new ConsistencyError(`${ZMETADATA_KEY} has no metadata object`);
  }
  return meta as Record<string, unknown>;
}

export function arrayNames(meta: Record<string, unknown>): string[] {
  return Object.keys(meta)
    .filter((k) => k.endsWith('/.zarray'))
    .map((k) => k.slice(0, -'/.zarray'.length))
    .sort();
}

function zarray(meta: Record<string, unknown>, name: string): ZArray {
  return meta[`${name}/.zarray`] as ZArray;
}

function dims(meta: Record<string, unknown>, name: string): string[] | null {
  const attrs = meta[`${name}/.zattrs`] as
    { _ARRAY_DIMENSIONS?: string[] } | undefined;
  return attrs?._ARRAY_DIMENSIONS ? [...attrs._ARRAY_DIMENSIONS] : null;
}

function grid(za: ZArray): number[] {
  return za.shape.map((s, i) => {
    const c = za.chunks[i] ?? 0;
    return c ? Math.max(1, Math.ceil(s / c)) : 1;
  });
}

/** Names of the 1-D dimension-coordinate arrays declared in `meta`. */
export function coordinateArrays(meta: Record<string, unknown>): string[] {
  return arrayNames(meta).filter((n) => {
    const za = zarray(meta, n);
    const d = dims(meta, n);
    return (
      za.shape.length === 1 && (d === null || (d.length === 1 && d[0] === n))
    );
  });
}

/**
 * Object keys of every coordinate array's chunks — what a caller must fetch
 * from an existing archive so the (synchronous) coordinate comparison can run.
 */
export function coordinateKeys(meta: Record<string, unknown>): string[] {
  const keys: string[] = [];
  for (const name of coordinateArrays(meta)) {
    const n = grid(zarray(meta, name))[0] ?? 1;
    for (let i = 0; i < n; i++) keys.push(`${name}/${i}`);
  }
  return keys;
}

// -- dtype decoding --------------------------------------------------------
interface Dtype {
  kind: 'f' | 'i' | 'u';
  bytes: number;
  littleEndian: boolean;
}

function parseDtype(dtype: string): Dtype {
  const m = /^([<>|=])?([fiu])(\d+)$/.exec(dtype);
  if (!m) throw new ConsistencyError(`unsupported dtype '${dtype}'`);
  return {
    kind: m[2] as Dtype['kind'],
    bytes: Number(m[3]),
    littleEndian: m[1] !== '>',
  };
}

function itemSize(dtype: string): number {
  return parseDtype(dtype).bytes;
}

function fullChunkBytes(za: ZArray): number {
  return za.chunks.reduce((a, c) => a * c, itemSize(za.dtype));
}

// -- integrity -------------------------------------------------------------
export function checkStoreConsistency(store: ZarrStore): void {
  const meta = loadConsolidatedMetadata((k) => store.get(k));
  const names = arrayNames(meta);
  if (names.length === 0) {
    throw new ConsistencyError(`${ZMETADATA_KEY} declares no arrays`);
  }
  for (const name of names) {
    if (!(`${name}/.zarray` in meta)) {
      throw new ConsistencyError(
        `array '${name}' has no .zarray in ${ZMETADATA_KEY}`,
      );
    }
  }
  const byLen = [...names].sort((a, b) => b.length - a.length);

  for (const [key, value] of store) {
    const base = key.slice(key.lastIndexOf('/') + 1);
    if (base.startsWith('.')) continue; // metadata object
    const owner = byLen.find((n) => key === n || key.startsWith(`${n}/`));
    if (owner === undefined) {
      throw new ConsistencyError(
        `orphan object '${key}' belongs to no array declared in ${ZMETADATA_KEY}`,
      );
    }
    const za = zarray(meta, owner);
    const g = grid(za);
    const sep = za.dimension_separator ?? '.';
    const index = key
      .slice(owner.length + 1)
      .split(sep)
      .map((p) => Number(p));
    if (index.some((n) => !Number.isInteger(n))) {
      throw new ConsistencyError(`malformed chunk key '${key}'`);
    }
    if (index.length !== g.length) {
      throw new ConsistencyError(
        `chunk '${key}' has ${index.length} dims, array '${owner}' has ${g.length}`,
      );
    }
    index.forEach((i, d) => {
      const gd = g[d] ?? 1;
      if (i < 0 || i >= gd) {
        throw new ConsistencyError(
          `chunk '${key}' index ${i} out of range for dim ${d} (0..${gd - 1})`,
        );
      }
    });
    if (za.compressor === null) {
      const expected = fullChunkBytes(za);
      if (value.byteLength !== expected) {
        throw new ConsistencyError(
          `chunk '${key}' is ${value.byteLength} bytes, expected ${expected} ` +
            `(uncompressed ${za.dtype} chunks [${za.chunks}])`,
        );
      }
    }
  }
}

// -- coordinate decoding ---------------------------------------------------
export function decodeCoordinate(
  get: Getter,
  name: string,
  za: ZArray,
): number[] {
  if (za.shape.length !== 1) {
    throw new ConsistencyError(`coordinate '${name}' is not 1-D`);
  }
  if (
    za.compressor !== null ||
    (za.filters && (za.filters as unknown[]).length)
  ) {
    throw new ConsistencyError(
      `coordinate '${name}' is compressed/filtered — unsupported (EIDOS stores are uncompressed)`,
    );
  }
  const dt = parseDtype(za.dtype);
  const nChunks = grid(za)[0] ?? 1;
  const parts: Uint8Array[] = [];
  let total = 0;
  for (let i = 0; i < nChunks; i++) {
    const chunk = get(`${name}/${i}`);
    if (chunk === undefined) {
      throw new ConsistencyError(`coordinate '${name}' chunk ${i} missing`);
    }
    parts.push(chunk);
    total += chunk.byteLength;
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.byteLength;
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const n = (za.shape[0] ?? 0) as number;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const at = i * dt.bytes;
    out.push(readValue(view, at, dt));
  }
  return out;
}

function readValue(view: DataView, at: number, dt: Dtype): number {
  const le = dt.littleEndian;
  if (dt.kind === 'f') {
    if (dt.bytes === 8) return view.getFloat64(at, le);
    if (dt.bytes === 4) return view.getFloat32(at, le);
  } else if (dt.kind === 'i') {
    if (dt.bytes === 8) return Number(view.getBigInt64(at, le));
    if (dt.bytes === 4) return view.getInt32(at, le);
    if (dt.bytes === 2) return view.getInt16(at, le);
    if (dt.bytes === 1) return view.getInt8(at);
  } else if (dt.kind === 'u') {
    if (dt.bytes === 8) return Number(view.getBigUint64(at, le));
    if (dt.bytes === 4) return view.getUint32(at, le);
    if (dt.bytes === 2) return view.getUint16(at, le);
    if (dt.bytes === 1) return view.getUint8(at);
  }
  throw new ConsistencyError(`unsupported dtype width ${dt.kind}${dt.bytes}`);
}

// -- structural + coordinate compatibility ---------------------------------
const STRUCT_FIELDS: (keyof ZArray)[] = [
  'dtype',
  'chunks',
  'order',
  'fill_value',
  'compressor',
  'filters',
  'dimension_separator',
  'zarr_format',
];

function compareStructure(
  name: string,
  oldZa: ZArray,
  newZa: ZArray,
  appendAxis: number | null,
): void {
  for (const field of STRUCT_FIELDS) {
    if (JSON.stringify(oldZa[field]) !== JSON.stringify(newZa[field])) {
      throw new ConsistencyError(
        `array '${name}': ${field} differs (existing ${JSON.stringify(
          oldZa[field],
        )} vs new ${JSON.stringify(newZa[field])})`,
      );
    }
  }
  if (oldZa.shape.length !== newZa.shape.length) {
    throw new ConsistencyError(`array '${name}': rank differs`);
  }
  oldZa.shape.forEach((o, axis) => {
    if (axis === appendAxis) return;
    if (o !== newZa.shape[axis]) {
      throw new ConsistencyError(
        `array '${name}': non-append dim ${axis} differs (${o} vs ${newZa.shape[axis]})`,
      );
    }
  });
}

export function compareStores(
  existingMeta: Record<string, unknown>,
  newMeta: Record<string, unknown>,
  existingGet: Getter,
  newGet: Getter,
  options: { mode: 'replace' | 'append'; appendDim?: string },
): void {
  const { mode, appendDim } = options;
  if (mode === 'append' && !appendDim) {
    throw new Error("appendDim is required for mode='append'");
  }
  const existing = new Set(arrayNames(existingMeta));
  const fresh = new Set(arrayNames(newMeta));
  const shared = [...existing].filter((n) => fresh.has(n));
  if (shared.length === 0) {
    throw new ConsistencyError(
      'new store shares no arrays with the existing dataset',
    );
  }
  if (
    mode === 'replace' &&
    (existing.size !== fresh.size || shared.length !== existing.size)
  ) {
    throw new ConsistencyError('replace requires the same set of arrays');
  }

  for (const name of shared) {
    const oldZa = zarray(existingMeta, name);
    const newZa = zarray(newMeta, name);
    const d = dims(existingMeta, name);
    const axis =
      mode === 'append' && d && appendDim && d.includes(appendDim)
        ? d.indexOf(appendDim)
        : null;
    compareStructure(name, oldZa, newZa, axis);
  }

  const coordNames = shared.filter((n) => {
    const za = zarray(existingMeta, n);
    const d = dims(existingMeta, n);
    return (
      za.shape.length === 1 && (d === null || (d.length === 1 && d[0] === n))
    );
  });

  for (const name of coordNames) {
    const oldCoord = decodeCoordinate(
      existingGet,
      name,
      zarray(existingMeta, name),
    );
    const newCoord = decodeCoordinate(newGet, name, zarray(newMeta, name));
    if (mode === 'replace' || name !== appendDim) {
      if (
        oldCoord.length !== newCoord.length ||
        !oldCoord.every((v, i) => v === newCoord[i])
      ) {
        throw new ConsistencyError(
          `coordinate '${name}' differs — a ${mode} must preserve it`,
        );
      }
    } else {
      checkAppendAxis(name, oldCoord, newCoord);
    }
  }
}

function isMonotonic(a: number[], increasing: boolean): boolean {
  for (let i = 1; i < a.length; i++) {
    const prev = a[i - 1] as number;
    const cur = a[i] as number;
    if (increasing ? !(cur > prev) : !(cur < prev)) return false;
  }
  return true;
}

function checkAppendAxis(name: string, oldC: number[], newC: number[]): void {
  if (oldC.length === 0 || newC.length === 0) {
    throw new ConsistencyError(`coordinate '${name}': empty append axis`);
  }
  const oldInc = (oldC.at(-1) as number) >= (oldC[0] as number);
  const newInc = (newC.at(-1) as number) >= (newC[0] as number);
  if (!isMonotonic(oldC, oldInc)) {
    throw new ConsistencyError(
      `coordinate '${name}': existing axis is not monotonic`,
    );
  }
  if (!isMonotonic(newC, newInc)) {
    throw new ConsistencyError(
      `coordinate '${name}': appended axis is not monotonic`,
    );
  }
  if (oldInc !== newInc) {
    throw new ConsistencyError(
      `coordinate '${name}': append direction differs from existing`,
    );
  }
  const overlap = oldInc
    ? !((newC[0] as number) > (oldC.at(-1) as number))
    : !((newC[0] as number) < (oldC.at(-1) as number));
  if (overlap) {
    throw new ConsistencyError(
      `coordinate '${name}': appended values overlap existing ` +
        `(new starts ${newC[0]}, existing ends ${oldC.at(-1)})`,
    );
  }
}
