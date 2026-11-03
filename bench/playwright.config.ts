import { defineConfig } from "@playwright/test";

// Headed system Chrome: headless Chromium falls back to SwiftShader (CPU
// GL), which measures the wrong thing. The window is parked off-screen.
const chrome = {
  channel: "chrome",
  headless: false,
  launchOptions: { args: ["--window-position=-2400,0", "--enable-precise-memory-info", "--js-flags=--expose-gc", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"] },
};

// Same default as the playground; AC_PORT moves both (parallel worktrees).
const PORT = Number(process.env.AC_PORT ?? 5199);
// The framework example apps (wrappers.spec.ts); each moves with its own variable.
const EXAMPLES = [
  { name: "example-react", port: Number(process.env.AC_PORT_REACT ?? 5207), env: "AC_PORT_REACT" },
  { name: "example-vue", port: Number(process.env.AC_PORT_VUE ?? 5208), env: "AC_PORT_VUE" },
  { name: "example-svelte", port: Number(process.env.AC_PORT_SVELTE ?? 5209), env: "AC_PORT_SVELTE" },
];

export default defineConfig({
  testDir: "tests",
  timeout: 600_000,
  workers: 1,
  reporter: [["list"]],
  webServer: [
    {
      command: "pnpm -C ../apps/playground dev --host 127.0.0.1",
      url: `http://127.0.0.1:${PORT}/`,
      reuseExistingServer: true,
    },
    ...EXAMPLES.map((e) => ({
      command: `${e.env}=${e.port} pnpm -C ../apps/${e.name} dev --host 127.0.0.1`,
      url: `http://127.0.0.1:${e.port}/`,
      reuseExistingServer: true,
    })),
  ],
  use: { baseURL: `http://127.0.0.1:${PORT}/` },
  projects: [
    { name: "perf", testMatch: /perf\.spec\.ts/, use: { ...chrome, viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 } },
    // Every spec but the perf sweeps; each engine keeps its own snapshot baselines.
    // Headless for pictures: a headed window parked off-screen gets synthetic
    // pointer events while a screenshot is captured, which clears or moves the
    // crosshair at random. Headless Chrome still renders on the GPU (ANGLE/Metal).
    { name: "visual", testIgnore: /perf\.spec\.ts/, use: { ...chrome, headless: true } },
    { name: "visual-webkit", testIgnore: /perf\.spec\.ts/, use: { browserName: "webkit" } },
    { name: "visual-firefox", testIgnore: /perf\.spec\.ts/, use: { browserName: "firefox" } },
  ],
});
