// Opt in to the WASM batch kernels. Resolves once they are instantiated; rejects
// (and leaves the JS loops in place) when the runtime has no WASM SIMD.
import { loadKernels } from "@alphacharts/wasm";
import { setKernels } from "./engine/kernels.js";

export async function enableWasm(): Promise<void> {
  setKernels(await loadKernels());
}

export function disableWasm(): void {
  setKernels(null);
}
