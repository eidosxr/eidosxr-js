import Ajv, { ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { MINOR_VERSION } from "./version";

// The schemas are published per EIDOS version. The unversioned path is not
// kept in step with them, so validate against this package's own version.
const ROOT_SCHEMA = `https://schemas.oceanum.io/eidos/v${MINOR_VERSION}/root.json`;
let validator: ValidateFunction | null = null;

const loadSchema = async (uri: string) => {
  const res = await fetch(uri);
  // fetch Responses expose `status`/`ok`, not `statusCode` — the old check
  // never fired. Returning `res.body` (a ReadableStream) handed ajv a
  // non-schema, silently compiling an accept-everything validator.
  if (!res.ok) throw new Error("Loading error: " + res.status);
  return res.json();
};

const validateSchema = async (spec: any): Promise<boolean> => {
  if (!validator) {
    //Load the root schema from URL as JSON
    const schema = await loadSchema(ROOT_SCHEMA);

    // Create AJV instance with configuration
    const ajv = new Ajv({
      allErrors: true,
      verbose: true,
      strict: false, // Allow additional properties for flexibility
      loadSchema,
    });
    // Without this ajv ignores `format`, and the schemas rely on it to tell
    // values apart: currentTime is oneOf a date-time or a duration, so an
    // unchecked date-time let "PT0H" match both and the spec was rejected.
    addFormats(ajv);

    // Compile the validator
    validator = await ajv.compileAsync(schema);
  }

  const isValid = validator(spec);

  if (!isValid && validator.errors) {
    const errorMessages = validator.errors
      .map(
        (error: any) =>
          `${error.instancePath || "root"}: ${error.message} (${JSON.stringify(error.params || {})})`
      )
      .join("; ");

    throw new Error(`EIDOS spec validation failed: ${errorMessages}`);
  }

  return true;
};

export { validateSchema };
