// Tests for the release gate. Run with: node --test .github/scripts/select-packages.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { selectPackages } from "./select-packages.mjs";

const packages = [
  { name: "@eidosxr/spec", version: "0.12.0" },
  { name: "@eidosxr/api", version: "0.1.0" },
];
const published =
  (...ids) =>
  async (name, version) =>
    ids.includes(`${name}@${version}`);

test("a tag publishes the package at that version", async () => {
  assert.deepEqual(await selectPackages("v0.12.0", packages, published()), [
    "@eidosxr/spec",
  ]);
  assert.deepEqual(await selectPackages("v0.1.0", packages, published()), [
    "@eidosxr/api",
  ]);
});

test("packages at another version are left alone, published or not", async () => {
  const selected = await selectPackages("v0.12.0", packages, published());
  assert.ok(!selected.includes("@eidosxr/api"));
});

test("every package at the tagged version is published", async () => {
  const both = [
    { name: "@eidosxr/spec", version: "1.0.0" },
    { name: "@eidosxr/api", version: "1.0.0" },
  ];
  assert.deepEqual(await selectPackages("v1.0.0", both, published()), [
    "@eidosxr/spec",
    "@eidosxr/api",
  ]);
});

test("a re-run publishes only what is still missing", async () => {
  const both = [
    { name: "@eidosxr/spec", version: "1.0.0" },
    { name: "@eidosxr/api", version: "1.0.0" },
  ];
  assert.deepEqual(
    await selectPackages("v1.0.0", both, published("@eidosxr/spec@1.0.0")),
    ["@eidosxr/api"],
  );
});

test("a tag that matches no package version is an error", async () => {
  await assert.rejects(
    selectPackages("v0.12.1", packages, published()),
    /does not match the version of any package \(@eidosxr\/spec@0\.12\.0, @eidosxr\/api@0\.1\.0\)/,
  );
});

test("a version that is already on npm is an error", async () => {
  await assert.rejects(
    selectPackages("v0.1.0", packages, published("@eidosxr/api@0.1.0")),
    /Nothing to publish for v0\.1\.0: @eidosxr\/api@0\.1\.0 is already on npm/,
  );
});

test("a private package is never published", async () => {
  const withPrivate = [
    ...packages,
    { name: "internal", version: "2.0.0", private: true },
  ];
  await assert.rejects(
    selectPackages("v2.0.0", withPrivate, published()),
    /does not match the version of any package \(@eidosxr\/spec@0\.12\.0, @eidosxr\/api@0\.1\.0\)/,
  );
});

test("the tag must be the whole version", async () => {
  await assert.rejects(
    selectPackages("v0.12", packages, published()),
    /does not match/,
  );
  await assert.rejects(
    selectPackages("0.12.0-rc.1", packages, published()),
    /does not match/,
  );
});

test("the command line still runs, and fails, when reached through a symlink", () => {
  // It used to compare its own path textually, ran nothing and exited 0.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-gate-"));
  const link = path.join(dir, "scripts");
  fs.symlinkSync(path.dirname(fileURLToPath(import.meta.url)), link);
  const result = spawnSync(
    process.execPath,
    [path.join(link, "select-packages.mjs"), "v999.0.0"],
    { encoding: "utf8" },
  );
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /::error::Tag v999\.0\.0 does not match/);
});
