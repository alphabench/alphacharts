import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

// Tests read core's source, like the playground.
const alias = { "@alphacharts/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)), "@alphacharts/plot": fileURLToPath(new URL("../plot/src/index.ts", import.meta.url)) };

export default defineConfig({
  plugins: [svelte()],
  resolve: { alias },
  test: {
    globals: true,
    projects: [
      // Components mounted in jsdom: Svelte's client build ("browser" condition) and the mocked core.
      { extends: true, resolve: { conditions: ["browser"] }, test: { name: "dom", environment: "jsdom", include: ["test/**/*.svelte.test.ts"] } },
      // Server render in plain node with the real core.
      { extends: true, test: { name: "ssr", environment: "node", include: ["test/ssr.test.ts", "test/plot-ssr.test.ts"] } },
    ],
  },
});
