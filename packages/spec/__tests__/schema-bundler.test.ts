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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { version } from "../package.json";
import { localizeSchemaPath } from "../scripts/schema-bundler.js";
import { ROOT_SCHEMA_URL, SCHEMAS_URL } from "../scripts/schema-version.js";

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

describe("schema version", () => {
  it("is the major.minor of the package version", () => {
    const minor = version.split(".").slice(0, 2).join(".");
    expect(SCHEMAS_URL).toBe(`${HOST}/eidos/v${minor}`);
    expect(ROOT_SCHEMA_URL).toBe(`${HOST}/eidos/v${minor}/root.json`);
  });
});
