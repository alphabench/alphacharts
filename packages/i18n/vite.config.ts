import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    // Tests read the core's source, as the playground does.
    alias: { "@alphacharts/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)) },
  },
  build: {
    lib: { entry: "src/index.ts", formats: ["es"], fileName: "index" },
    target: "es2022",
    sourcemap: true,
    minify: true,
  },
  test: { environment: "node" },
});
