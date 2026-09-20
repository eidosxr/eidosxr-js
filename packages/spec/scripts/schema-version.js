import fs from 'fs';

// The EIDOS schemas are published per version, at
// https://schemas.oceanum.io/eidos/v<major.minor>/. This package is generated
// from the version it is numbered for: the major.minor of its own version.
const { version } = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

export const SCHEMA_VERSION = `v${version.split('.').slice(0, 2).join('.')}`;
export const SCHEMAS_URL = `https://schemas.oceanum.io/eidos/${SCHEMA_VERSION}`;
export const ROOT_SCHEMA_URL = `${SCHEMAS_URL}/root.json`;
