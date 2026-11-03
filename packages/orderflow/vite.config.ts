import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: { entry: "src/index.ts", formats: ["es"], fileName: "index" },
    target: "es2022",
    sourcemap: true,
    minify: true,
    // The core is a peer: the footprint registers its series type on the consumer's copy.
    rollupOptions: { external: [/^@alphacharts\/core/] },
  },
  test: {
    environment: "node",
    // Tests run the core from source, like the playground (the package has no dist in a fresh checkout).
    alias: {
      "@alphacharts/core/internal": fileURLToPath(new URL("../core/src/internal.ts", import.meta.url)),
      "@alphacharts/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
    },
  },
});
