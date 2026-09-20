#!/usr/bin/env node
// Run by prepublishOnly. The package loads the schemas and the renderer of its
// own EIDOS version at run time, so releasing it before they are published
// would make every render() fail for its users.
import { ROOT_SCHEMA_URL, SCHEMA_VERSION } from './schema-version.js';

const urls = [
  ROOT_SCHEMA_URL,
  `https://render.eidos.oceanum.io/${SCHEMA_VERSION}/index.html`,
];

let missing = 0;
for (const url of urls) {
  const res = await fetch(url);
  console.log(`${res.status} ${url}`);
  if (!res.ok) missing++;
}
if (missing > 0) {
  console.error(
    `EIDOS ${SCHEMA_VERSION} is not fully published; this package depends on it at run time.`,
  );
  process.exit(1);
}
