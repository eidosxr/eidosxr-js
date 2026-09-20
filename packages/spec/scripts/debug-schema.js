#!/usr/bin/env node

import { bundle } from "./schema-bundler.js";
import { ROOT_SCHEMA_URL } from "./schema-version.js";

async function debugSchema() {
  try {
    const schema = await bundle(ROOT_SCHEMA_URL);
    
    // Log all $defs keys to check what's available
    console.log("All $defs keys:");
    console.log(Object.keys(schema.$defs));
    
    // Check for PlotSpec specifically
    console.log("\nPlotSpec exists:", schema.$defs.hasOwnProperty("PlotSpec"));
    if (schema.$defs.PlotSpec) {
      console.log("PlotSpec definition:");
      console.log(JSON.stringify(schema.$defs.PlotSpec, null, 2));
    }
    
    // Check for the root schema
    console.log("\nRoot schema properties:");
    const { $defs, ...rootSchema } = schema;
    console.log(Object.keys(rootSchema));
    console.log(JSON.stringify(rootSchema, null, 2));
  } catch (error) {
    console.error("Error:", error);
  }
}

debugSchema();
