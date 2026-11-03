/** The one dataset every library renders. Times are UTC ms on a fixed step. */
export interface Dataset {
  n: number;
  stepMs: number;
  time: Float64Array;
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
}

/**
 * What a library must do for the harness. Each adapter uses that library's documented
 * way of loading and moving a large candlestick series; `path` says which, and is
 * written to compare.json.
 */
export interface Adapter {
  id: string;
  /** The configuration used, in one sentence, for the report. */
  path: string;
  /** Create the (empty) chart in `el`. Not timed. */
  mount(el: HTMLElement): void;
  /** Put the data in the shape the library takes. Timed as prepareMs (zero when it takes typed arrays as they are). */
  prepare(d: Dataset): unknown;
  /** Hand the data over and show the last `initialBars` bars. Timed as setDataMs. */
  load(prepared: unknown, d: Dataset, initialBars: number): void;
  /** Resolves when the library reports its render is complete (only libraries that render progressively). */
  settled?(): Promise<void>;
  /** Show logical bars [from, to] (bar indices, 0 = first bar). Called once per frame by the sweep. */
  setRange(from: number, to: number): void;
  /** How many bars the view holds now, as the library clamped it. */
  visibleBars(): number;
  dispose(): void;
}

export interface Memory {
  /** performance.memory.usedJSHeapSize after a forced GC, MB. JS objects only: typed-array backing stores are not in it. */
  heapMB: number | null;
  /** performance.measureUserAgentSpecificMemory() bytes, MB: the page's JS plus ArrayBuffers. */
  pageMB: number | null;
}

export interface HandOver {
  prepareMs: number;
  setDataMs: number;
  /** From the start of prepare to the second animation frame after load: the first frame on which the chart is committed. */
  firstPaintMs: number;
  /** From the start of prepare to the library's own "render complete" event; null when it has none. */
  settledMs: number | null;
  settledNote?: string;
}

export interface Sweep {
  iv: number[];
  aborted: boolean;
  warmupAborted: boolean;
  heapGrowthKB: number | null;
  pageGrowthKB: number | null;
  /** Bars the view held at the widest zoom of the sweep. */
  fullZoomOutVisibleBars: number | null;
}

export interface Cmp {
  lib: string;
  path: string;
  crossOriginIsolated: boolean;
  generate(n: number, seed: number): { genMs: number; checksum: { sumClose: number; firstTime: number; lastTime: number } };
  memory(): Promise<Memory>;
  handOver(initialBars: number): Promise<HandOver>;
  refresh(): Promise<number>;
  sweep(frames: number, budgetMs: number): Promise<Sweep>;
}

declare global {
  interface Window {
    __cmp?: Cmp;
    gc?: () => void;
  }
}
