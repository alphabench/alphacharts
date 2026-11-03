# @alphacharts/wasm

Numeric kernels (rolling sum, mean, variance, EMA, linear regression, LOD levels, profiles, ...) in two
implementations with the same interface: WebAssembly (SIMD128, embedded in the package, no fetch) and plain
JavaScript. `@alphacharts/indicators` uses it; you rarely import it directly.

```
npm install @alphacharts/wasm
```

```ts
import { loadKernels, jsKernels } from "@alphacharts/wasm";

// loadKernels rejects (it never falls back silently) when WebAssembly or SIMD is missing.
const kernels = await loadKernels().catch(() => jsKernels);
const mean20 = kernels.mean(new Float64Array(closes), 20);
```

Inputs must be dense (no NaN). Rebuilding the module needs Rust with the `wasm32-unknown-unknown` target:
`pnpm -C packages/wasm build:wasm` rebuilds `wasm/kernels.wasm` from `rust/` and regenerates
`src/kernels.wasm.ts`. MIT licence.
