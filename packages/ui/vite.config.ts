import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const src = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));

export default defineConfig({
  // Tests read the sibling packages' source, like the playground; the build keeps them external.
  resolve: process.env.VITEST
    ? {
        alias: {
          "@alphacharts/core/internal": src("core/src/internal.ts"),
          "@alphacharts/core": src("core/src/index.ts"),
          "@alphacharts/drawings": src("drawings/src/index.ts"),
          "@alphacharts/alerts": src("alerts/src/index.ts"),
          "@alphacharts/chart-types": src("chart-types/src/index.ts"),
          "@alphacharts/indicators/all": src("indicators/src/all.ts"),
          "@alphacharts/indicators": src("indicators/src/index.ts"),
          "@alphacharts/i18n": src("i18n/src/index.ts"),
          "@alphacharts/orderflow": src("orderflow/src/index.ts"),
        },
      }
    : {},
  build: {
    lib: { entry: { index: "src/index.ts", element: "src/element.ts" }, formats: ["es"] },
    target: "es2022",
    sourcemap: true,
    minify: true,
    rolldownOptions: {
      // The sibling packages are the host app's; preact is ours and is bundled.
      external: [/^@alphacharts\//],
    },
  },
  test: { environment: "jsdom", globals: true },
});
