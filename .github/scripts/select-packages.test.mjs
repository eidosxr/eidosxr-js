// Tests for the release gate. Run with: node --test .github/scripts/select-packages.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
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
  const withPrivate = [{ name: "internal", version: "2.0.0", private: true }];
  await assert.rejects(
    selectPackages("v2.0.0", withPrivate, published()),
    /does not match/,
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
