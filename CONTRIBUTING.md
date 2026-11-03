# Contributing

Thanks for helping. AlphaCharts is a pnpm workspace; a current Node LTS and pnpm 10.

```
pnpm install
pnpm typecheck
pnpm test            # vitest, every package
pnpm build
node scripts/check-deps.mjs
pnpm dev             # playground on http://127.0.0.1:5199
```

- Keep changes small and match the surrounding code. Add or update a test with every behaviour change.
- Sibling `@alphacharts/*` packages are peer dependencies, never dependencies (`scripts/check-deps.mjs` enforces
  it). The one exception is `@alphacharts/wasm`, used by `indicators`.
- Visual snapshots (`pnpm visual`) are Playwright renderings recorded on macOS; they are not reproducible on other
  platforms, so CI runs unit tests, typecheck and `check-deps` only. If you change pixels, say so in the pull
  request and a maintainer will regenerate the snapshots.
- `pnpm size` and `pnpm bench` need the playground installed and a quiet machine.
- Rebuilding `kernels.wasm` needs Rust (`pnpm -C packages/wasm build:wasm`); regenerating TA-Lib fixtures needs
  Python (see `packages/indicators/README.md`).
- By contributing you agree your work is released under the MIT licence.
