import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [svelte()],
  // Always the source, so the browser tests exercise the code as written.
  resolve: { alias: { "@alphacharts/core": src("../../packages/core/src/index.ts"), "@alphacharts/svelte": src("../../packages/svelte/src/index.ts") } },
  server: { port: Number(process.env.AC_PORT_SVELTE ?? 5209), strictPort: true },
  preview: { port: Number(process.env.AC_PORT_SVELTE ?? 5209), strictPort: true },
  build: { target: "es2022" },
});
