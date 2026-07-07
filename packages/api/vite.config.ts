/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
  },
  build: {
    outDir: "./dist",
    emptyOutDir: true,
    reportCompressedSize: true,
    lib: {
      entry: "src/index.ts",
      name: "eidosApi",
      fileName: "index",
      formats: ["es", "cjs"],
    },
    rollupOptions: {
      // Runtime dependency — the consumer installs it, so don't bundle it.
      external: ["fast-json-patch"],
    },
  },
});
