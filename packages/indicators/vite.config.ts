import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: { entry: { index: "src/index.ts", all: "src/all.ts", studies: "src/studies/index.ts", worker: "src/worker.ts" }, formats: ["es"] },
    target: "es2022",
    sourcemap: true,
    minify: true,
    rollupOptions: { external: ["@alphacharts/core", "@alphacharts/wasm"] },
  },
  resolve: { conditions: ["development"] },
  test: { environment: "node" },
});
