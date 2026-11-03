#!/usr/bin/env bash
# Rebuilds wasm/kernels.wasm from rust/ and regenerates src/kernels.wasm.ts.
# Needs: rustup target add wasm32-unknown-unknown. wasm-opt is used only if it is already installed.
set -euo pipefail
cd "$(dirname "$0")/.."
(cd rust && cargo build --release --target wasm32-unknown-unknown)
mkdir -p wasm
cp rust/target/wasm32-unknown-unknown/release/alphacharts_kernels.wasm wasm/kernels.wasm
if command -v wasm-opt >/dev/null 2>&1; then
  wasm-opt -O3 --enable-simd --enable-bulk-memory -o wasm/kernels.wasm wasm/kernels.wasm
fi
node scripts/embed.mjs
ls -l wasm/kernels.wasm
