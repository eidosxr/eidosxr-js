/**
 * Regression tests for the schema loader behind validateSchema().
 *
 * The old loader returned `res.body` (a ReadableStream) to ajv's
 * compileAsync, which silently compiled an accept-everything validator —
 * and checked `res.statusCode`, which does not exist on fetch Responses,
 * so HTTP errors were swallowed too.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MINOR_VERSION } from "../src/lib/version";

// The schemas are published per EIDOS version: the package's major.minor.
const ROOT = `https://schemas.oceanum.io/eidos/v${MINOR_VERSION}/root.json`;
const CHILD = `https://schemas.oceanum.io/eidos/v${MINOR_VERSION}/node/test-child.json`;

const schemas: Record<string, object> = {
  [ROOT]: {
    $id: ROOT,
    type: "object",
    required: ["id", "name"],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      root: { $ref: CHILD },
      // As common.json#/$defs/currentTime: a date-time or an ISO 8601 duration.
      currentTime: {
        oneOf: [
          { type: "string", format: "date-time" },
          { type: "string", pattern: "^-?P" },
        ],
      },
    },
  },
  [CHILD]: {
    $id: CHILD,
    type: "object",
    required: ["nodeType"],
    properties: { nodeType: { type: "string" } },
  },
};

const goodFetch = vi.fn(async (uri: string) => ({
  ok: true,
  status: 200,
  json: async () => schemas[uri],
}));

describe("validateSchema()", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("rejects when the schema fails to load (HTTP error)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
    );
    const { validateSchema } = await import("../src/lib/eidosmodel");
    await expect(validateSchema({ id: "x", name: "x" })).rejects.toThrow(
      "Loading error: 404",
    );
  });

  it("loads the root schema from this package's versioned path", async () => {
    const fetchSpy = vi.fn(async (uri: string) => ({
      ok: true,
      status: 200,
      json: async () => schemas[uri],
    }));
    vi.stubGlobal("fetch", fetchSpy);
    const { validateSchema } = await import("../src/lib/eidosmodel");
    await validateSchema({ id: "ok", name: "OK" });
    // The unversioned path is not kept in step with the versioned schemas.
    expect(fetchSpy.mock.calls[0][0]).toMatch(
      /^https:\/\/schemas\.oceanum\.io\/eidos\/v\d+\.\d+\/root\.json$/,
    );
    expect(fetchSpy.mock.calls[0][0]).toBe(ROOT);
  });

  it("accepts a spec that satisfies the schema (resolving $refs via the loader)", async () => {
    vi.stubGlobal("fetch", goodFetch);
    const { validateSchema } = await import("../src/lib/eidosmodel");
    await expect(
      validateSchema({ id: "ok", name: "OK", root: { nodeType: "world" } }),
    ).resolves.toBe(true);
    // The $ref child schema must have been fetched through the loader.
    expect(goodFetch).toHaveBeenCalledWith(CHILD);
  });

  it("checks formats, so a duration is not also taken for a date-time", async () => {
    // With `format` unchecked, "PT0H" satisfied both oneOf branches and a
    // valid spec was rejected ("must match exactly one schema in oneOf").
    vi.stubGlobal("fetch", goodFetch);
    const { validateSchema } = await import("../src/lib/eidosmodel");
    const spec = { id: "ok", name: "OK" };
    await expect(validateSchema({ ...spec, currentTime: "PT0H" })).resolves.toBe(true);
    await expect(
      validateSchema({ ...spec, currentTime: "2026-01-01T00:00:00Z" }),
    ).resolves.toBe(true);
    // The form most EIDOS specs use: a space for the T, with a time zone.
    await expect(
      validateSchema({ ...spec, currentTime: "2019-01-01 00:00:00Z" }),
    ).resolves.toBe(true);
    // As in the renderer's validator, a date-time needs a time zone.
    await expect(
      validateSchema({ ...spec, currentTime: "2026-01-01T00:00:00" }),
    ).rejects.toThrow(/EIDOS spec validation failed/);
    await expect(validateSchema({ ...spec, currentTime: "yesterday" })).rejects.toThrow(
      /EIDOS spec validation failed/,
    );
  });

  it("rejects a spec that violates the schema — validation is not a no-op", async () => {
    vi.stubGlobal("fetch", goodFetch);
    const { validateSchema } = await import("../src/lib/eidosmodel");
    await expect(
      validateSchema({ id: 123, root: { nodeType: 42 } }),
    ).rejects.toThrow(/EIDOS spec validation failed/);
  });
});
