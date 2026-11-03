import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Always the source, so the browser tests exercise the code as written.
  resolve: { alias: { "@alphacharts/core": src("../../packages/core/src/index.ts"), "@alphacharts/react": src("../../packages/react/src/index.ts") } },
  server: { port: Number(process.env.AC_PORT_REACT ?? 5207), strictPort: true },
  preview: { port: Number(process.env.AC_PORT_REACT ?? 5207), strictPort: true },
  build: { target: "es2022" },
});
