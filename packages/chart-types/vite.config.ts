import { defineConfig } from "vite";

export default defineConfig({
  // Tests and the playground import the core's source, like every package here.
  resolve: { conditions: ["development"] },
  build: {
    lib: { entry: "src/index.ts", formats: ["es"], fileName: "index" },
    target: "es2022",
    sourcemap: true,
    minify: true,
    // The core is the host's copy, never bundled in.
    rollupOptions: { external: [/^@alphacharts\/core/] },
  },
  test: { environment: "node" },
});
