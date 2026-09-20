#!/usr/bin/env node
// Decide which workspace packages a version tag publishes.
//
// The packages are versioned independently, so a tag names a version, not a
// package: v0.12.0 publishes every public workspace package whose version is
// 0.12.0 and that is not on npm yet. It is an error if there is none, which
// catches a tag pushed before the version bump, and a tag pushed twice.
//
// usage: select-packages.mjs <tag>
// Prints `packages=<name> <name>...` and, in GitHub Actions, sets it as the
// step's `packages` output.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @param {string} tag - the pushed tag, e.g. "v0.12.0"
 * @param {{name: string, version: string, private?: boolean}[]} packages
 * @param {(name: string, version: string) => Promise<boolean>} isPublished
 * @returns {Promise<string[]>} names of the packages to publish
 */
export async function selectPackages(tag, packages, isPublished) {
  const version = tag.replace(/^v/, "");
  const summary = packages.map((p) => `${p.name}@${p.version}`).join(", ");
  const matching = packages.filter((p) => !p.private && p.version === version);
  if (matching.length === 0) {
    throw new Error(
      `Tag ${tag} does not match the version of any package (${summary}). Bump the version in its package.json first.`,
    );
  }
  const selected = [];
  for (const p of matching) {
    if (!(await isPublished(p.name, p.version))) selected.push(p.name);
  }
  if (selected.length === 0) {
    throw new Error(
      `Nothing to publish for ${tag}: ${matching.map((p) => `${p.name}@${p.version}`).join(", ")} is already on npm.`,
    );
  }
  return selected;
}

/** The manifests of the workspace packages (`packages/*`). */
export function readWorkspacePackages(root) {
  const dir = path.join(root, "packages");
  return fs
    .readdirSync(dir)
    .map((name) => path.join(dir, name, "package.json"))
    .filter((file) => fs.existsSync(file))
    .map((file) => JSON.parse(fs.readFileSync(file, "utf8")));
}

/** Whether name@version is on the public npm registry. */
export async function isOnNpm(name, version) {
  const res = await fetch(
    `https://registry.npmjs.org/${name.replace("/", "%2F")}`,
  );
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`npm registry: HTTP ${res.status} for ${name}`);
  return version in ((await res.json()).versions ?? {});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  try {
    const selected = await selectPackages(
      process.argv[2] ?? "",
      readWorkspacePackages(root),
      isOnNpm,
    );
    const output = `packages=${selected.join(" ")}`;
    console.log(output);
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `${output}\n`);
    }
  } catch (error) {
    console.log(`::error::${error.message}`);
    process.exit(1);
  }
}
