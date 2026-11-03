import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  // Tests read core's source, like the playground; the build keeps it external.
  resolve: process.env.VITEST ? { alias: { "@alphacharts/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)), "@alphacharts/plot": fileURLToPath(new URL("../plot/src/index.ts", import.meta.url)) } } : {},
  build: {
    lib: { entry: { index: "src/index.ts", plot: "src/plot/index.ts" }, formats: ["es"] },
    target: "es2022",
    sourcemap: true,
    minify: true,
    // The framework and core are the host app's; never bundled.
    rolldownOptions: { external: ["vue", "@alphacharts/core", "@alphacharts/plot"] },
  },
  test: { environment: "jsdom", globals: true },
});
