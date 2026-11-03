import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: { entry: { index: "src/index.ts", internal: "src/internal.ts" }, formats: ["es"] },
    target: "es2022",
    sourcemap: true,
    minify: true,
  },
  test: { environment: "node" },
});
