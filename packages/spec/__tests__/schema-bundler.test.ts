// @vitest-environment node
/**
 * Tests for the generator's local schema mapping.
 *
 * The published EIDOS schema paths carry the version (/eidos/v0.12/data.json);
 * a checkout has no version directory. Mapping the versioned URL as it stood
 * found no local file, so the generator silently read the published schemas
 * instead of the local edits it was pointed at.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { bundle, localizeSchemaPath } from "../scripts/schema-bundler.js";
import { ROOT_SCHEMA_URL, SCHEMAS_URL } from "../scripts/schema-version.js";
import { MINOR_VERSION } from "../src/lib/version";

const HOST = "https://schemas.oceanum.io";

let src: string;
let base: string;

beforeAll(() => {
  // <src>/eidos/... and the shared, unversioned <src>/geojson.json
  src = fs.mkdtempSync(path.join(os.tmpdir(), "eidos-schemas-"));
  base = path.join(src, "eidos");
  fs.mkdirSync(path.join(base, "node", "worldlayer"), { recursive: true });
  for (const file of [
    "geojson.json",
    "eidos/root.json",
    "eidos/data.json",
    "eidos/node/worldlayer/track.json",
  ]) {
    fs.writeFileSync(path.join(src, file), "{}");
  }
});

afterAll(() => {
  fs.rmSync(src, { recursive: true, force: true });
});

describe("localizeSchemaPath()", () => {
  it("maps a versioned EIDOS URL to the local file, which has no version directory", () => {
    expect(localizeSchemaPath(`${HOST}/eidos/v0.12/data.json`, base)).toBe(
      path.join(base, "data.json"),
    );
    expect(
      localizeSchemaPath(`${HOST}/eidos/v0.12/node/worldlayer/track.json`, base),
    ).toBe(path.join(base, "node", "worldlayer", "track.json"));
  });

  it("maps whatever version the reference carries", () => {
    expect(localizeSchemaPath(`${HOST}/eidos/v1.4/root.json`, base)).toBe(
      path.join(base, "root.json"),
    );
  });

  it("still maps an unversioned EIDOS URL", () => {
    expect(localizeSchemaPath(`${HOST}/eidos/data.json`, base)).toBe(
      path.join(base, "data.json"),
    );
  });

  it("drops the fragment and tolerates a trailing slash on the base", () => {
    expect(
      localizeSchemaPath(`${HOST}/eidos/v0.12/data.json#/$defs/x`, `${base}/`),
    ).toBe(path.join(base, "data.json"));
  });

  it("maps shared schemas, which are not versioned, beside the eidos directory", () => {
    expect(localizeSchemaPath(`${HOST}/geojson.json`, base)).toBe(
      path.join(src, "geojson.json"),
    );
  });

  it("leaves the reference alone when there is no local file", () => {
    const missing = `${HOST}/eidos/v0.12/node/absent.json`;
    expect(localizeSchemaPath(missing, base)).toBe(missing);
  });

  it("leaves the reference alone without a local base", () => {
    const ref = `${HOST}/eidos/v0.12/data.json`;
    expect(localizeSchemaPath(ref, undefined)).toBe(ref);
    expect(localizeSchemaPath(ref, `${HOST}/eidos/v0.12`)).toBe(ref);
    expect(localizeSchemaPath("https://example.com/eidos/v0.12/data.json", base)).toBe(
      "https://example.com/eidos/v0.12/data.json",
    );
  });
});

describe("bundle()", () => {
  const write = (name: string, schema: object) => {
    const file = path.join(src, name);
    fs.writeFileSync(file, JSON.stringify(schema));
    return file;
  };

  beforeAll(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("stops when the root schema is not the version asked for", async () => {
    const root = write("other-version.json", {
      $id: `${HOST}/eidos/v9.9/root.json`,
      type: "object",
    });
    await expect(bundle(root, `${HOST}/eidos/v0.12/root.json`)).rejects.toThrow(
      `Wrong schema version: expected $id ${HOST}/eidos/v0.12/root.json, found ${HOST}/eidos/v9.9/root.json`,
    );
  });

  it("stops when a referenced schema cannot be loaded", async () => {
    // Left as a warning, the reference would become `any` in the interfaces.
    const root = write("dangling.json", {
      type: "object",
      properties: { child: { $ref: "no-such-schema.json" } },
    });
    await expect(bundle(root)).rejects.toThrow(
      /Could not load 1 referenced schema\(s\):[\s\S]*no-such-schema\.json/,
    );
  });
});

describe("schema version", () => {
  it("is the same for the generator scripts and the package", () => {
    // The scripts read package.json; the package imports it. Both must agree.
    expect(SCHEMAS_URL).toBe(`${HOST}/eidos/v${MINOR_VERSION}`);
    expect(ROOT_SCHEMA_URL).toBe(`${SCHEMAS_URL}/root.json`);
    expect(SCHEMAS_URL).toMatch(/\/eidos\/v\d+\.\d+$/);
  });
});
