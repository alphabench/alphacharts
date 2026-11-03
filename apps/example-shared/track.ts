// Test hooks shared by the three examples. Every chart a page makes is
// recorded here (never removed from the list), so a browser test can count
// created versus removed: a chart the wrapper forgot to remove stays live.

import type { Chart } from "@alphacharts/core";

declare global {
  interface Window {
    __charts: Chart[];
    /** Move the live stream forward by n ticks, rendering after each. */
    __tick: (n: number) => Promise<void>;
    __mount: () => void;
    __unmount: () => void;
  }
}

window.__charts ??= [];

export function track(chart: Chart | null | undefined): void {
  if (chart && !window.__charts.includes(chart)) window.__charts.push(chart);
}

/** ?auto=0 holds the stream still (screenshots, tests); otherwise 10 ticks a second. */
export const autoTicks = (): boolean => new URLSearchParams(location.search).get("auto") !== "0";
