import { defineConfig } from "vite";

export default defineConfig({
  resolve: { conditions: ["development"] },
  build: {
    lib: { entry: { index: "src/index.ts", editor: "src/editor/index.ts", "sandbox-worker": "src/sandbox-worker.ts" }, formats: ["es"] },
    target: "es2022",
    sourcemap: true,
    minify: true,
    rollupOptions: { external: ["@alphacharts/core", "@alphacharts/indicators", /^@codemirror\//, /^@lezer\//] },
  },
  test: { environment: "node" },
});
