import { defineConfig } from "vite";

export default defineConfig({
  resolve: { conditions: ["development"] },
  build: {
    lib: { entry: "src/index.ts", formats: ["es"], fileName: "index" },
    target: "es2022",
    sourcemap: true,
    minify: true,
    rollupOptions: { external: ["@alphacharts/core", "@alphacharts/core/internal"] },
  },
  test: { environment: "node" },
});
