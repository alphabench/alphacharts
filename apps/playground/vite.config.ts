import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    // Always the source, so the playground and the benches test the code as written.
    alias: {
      "@alphacharts/core/internal": fileURLToPath(new URL("../../packages/core/src/internal.ts", import.meta.url)),
      "@alphacharts/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
      "@alphacharts/drawings": fileURLToPath(new URL("../../packages/drawings/src/index.ts", import.meta.url)),
      "@alphacharts/alerts": fileURLToPath(new URL("../../packages/alerts/src/index.ts", import.meta.url)),
      "@alphacharts/plot": fileURLToPath(new URL("../../packages/plot/src/index.ts", import.meta.url)),
      "@alphacharts/chart-types": fileURLToPath(new URL("../../packages/chart-types/src/index.ts", import.meta.url)),
      "@alphacharts/indicators/all": fileURLToPath(new URL("../../packages/indicators/src/all.ts", import.meta.url)),
      "@alphacharts/indicators/studies": fileURLToPath(new URL("../../packages/indicators/src/studies/index.ts", import.meta.url)),
      "@alphacharts/indicators": fileURLToPath(new URL("../../packages/indicators/src/index.ts", import.meta.url)),
      "@alphacharts/script/editor": fileURLToPath(new URL("../../packages/script/src/editor/index.ts", import.meta.url)),
      "@alphacharts/script": fileURLToPath(new URL("../../packages/script/src/index.ts", import.meta.url)),
      "@alphacharts/i18n": fileURLToPath(new URL("../../packages/i18n/src/index.ts", import.meta.url)),
      "@alphacharts/ui": fileURLToPath(new URL("../../packages/ui/src/index.ts", import.meta.url)),
      "@alphacharts/orderflow": fileURLToPath(new URL("../../packages/orderflow/src/index.ts", import.meta.url)),
    },
  },
  // AC_PORT lets parallel worktrees each run their own playground and benches.
  server: { port: Number(process.env.AC_PORT ?? 5199), strictPort: true },
  preview: { port: Number(process.env.AC_PORT ?? 5199), strictPort: true },
  build: { target: "es2022" },
});
