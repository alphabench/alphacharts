import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [vue()],
  // Always the source, so the browser tests exercise the code as written.
  resolve: { alias: { "@alphacharts/core": src("../../packages/core/src/index.ts"), "@alphacharts/vue": src("../../packages/vue/src/index.ts") } },
  server: { port: Number(process.env.AC_PORT_VUE ?? 5208), strictPort: true },
  preview: { port: Number(process.env.AC_PORT_VUE ?? 5208), strictPort: true },
  build: { target: "es2022" },
});
