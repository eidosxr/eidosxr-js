# @eidosxr/api

TypeScript client for the EIDOS platform API — a thin, typed transport over the
two platform workers:

- **spec-api** (`https://api.eidosxr.com`) — specification and template CRUD, and
  RFC-6902 JSON-Patch updates.
- **zarr-ingestion-service** — zarr dataset and asset storage.

Both authenticate with a single bearer token, which may be a Supabase user JWT
**or** an `ek_` Oceanum API key.

## Install

```sh
npm install @eidosxr/api
```

## Usage

```ts
import { EidosClient } from '@eidosxr/api';

const client = new EidosClient('ek_...', {
  // service defaults to https://api.eidosxr.com
  ingestionService: 'https://<your-ingestion-host>', // for dataset/asset calls
});

// List
const { specifications } = await client.listSpecifications({ limit: 20 });

// Read → edit → update (diffed to a JSON Patch, with optimistic concurrency)
const spec = await client.getSpecification(id);
const next = structuredClone(spec.spec);
next.name = 'Updated';
await client.updateSpecification(id, spec.spec, next, {
  ifMatch: spec.version,
});
```

`updateSpecification` computes the RFC-6902 patch by diffing the current and next
documents with [`fast-json-patch`](https://www.npmjs.com/package/fast-json-patch)
— the same library the server applies with — and sends it with an `If-Match`
header. It returns `null` when the documents are identical. For hand-built
patches use `patchSpecification(id, ops, { ifMatch })`.

## Errors

Failed requests throw a typed `EidosApiError` subclass carrying the HTTP `status`
and the machine-readable `code`:

```ts
import { PreconditionFailed, PatchConflict } from '@eidosxr/api';

try {
  await client.updateSpecification(id, current, next, {
    ifMatch: staleVersion,
  });
} catch (e) {
  if (e instanceof PreconditionFailed) {
    // stale version — refetch and retry
    console.log('server is at', e.currentVersion);
  }
}
```

Subclasses: `BadRequest` / `InvalidPatch`, `Unauthorized`, `QuotaExceeded`,
`Forbidden`, `NotFound`, `PatchConflict` (409), `Conflict` (409),
`LengthRequired` (411), `PreconditionFailed` (412), `PayloadTooLarge` (413),
`RateLimited` (429), `ServerError` (5xx).

## Types

The spec-api types are generated from its OpenAPI 3.1 document. Regenerate after
a spec-api change:

```sh
npm run gen   # openapi-typescript spec-api.openapi.json -> src/generated/spec-api.ts
```

`spec` payloads are typed as `EidosSpec` (an open record, structurally aligned
with `EidosSpec` from `@oceanum/eidos`) so this package stays free of a renderer
dependency.
