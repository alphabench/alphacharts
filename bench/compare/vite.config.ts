import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The comparison page, built and previewed (not the dev server): every library is
// measured as a minified production bundle. alphacharts comes from source, as in the
// playground, so no package build is needed first. The page is cross-origin isolated
// so performance.measureUserAgentSpecificMemory() (typed arrays included) works.
const PORT = Number(process.env.AC_PORT_COMPARE ?? 5210);
const headers = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: { alias: { "@alphacharts/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)) } },
  // Each adapter is a dynamic import, so its library lands in its own chunk: the
  // manifest tells compare.spec.ts which files belong to which library.
  build: { target: "es2022", outDir: "dist", emptyOutDir: true, manifest: true },
  server: { port: PORT, strictPort: true, headers },
  preview: { port: PORT, strictPort: true, headers },
});
