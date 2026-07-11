/**
 * `@eidosxr/api` — TypeScript client for the EIDOS platform API.
 *
 * @example
 * ```ts
 * import { EidosClient } from "@eidosxr/api";
 *
 * const client = new EidosClient("ek_...");
 * const spec = await client.getSpecification(id);
 * const next = structuredClone(spec.spec);
 * next.name = "Updated";
 * await client.updateSpecification(id, spec.spec, next, { ifMatch: spec.version });
 * ```
 */
export * from './client';
export * from './consistency';
export * from './errors';
export * from './types';
