// Public types of the UI shell.

import type { Chart, Datafeed, LayoutStore, OhlcBar, Series, Theme } from "@alphacharts/core";
import type { StudyDef } from "@alphacharts/indicators";
import type { ToolDef } from "@alphacharts/drawings";
import type { AlertTrigger } from "@alphacharts/alerts";

/** One search result. `symbol` is the id the datafeed understands; everything else is display data from the feed. */
export interface SymbolInfo {
  symbol: string;
  name?: string;
  exchange?: string;
  /** One of the `symbol.type.*` kinds (stock, index, futures, options, etf, fund, forex, crypto, bond) or any other text. */
  type?: string;
  /** The instrument's price step. Prices are shown to it (or finer when the bars need), and the footprint is built on it. */
  tickSize?: number;
}

/**
 * The core Datafeed plus what the shell needs for search. Without
 * `searchSymbols` the symbol button still shows the current symbol but the
 * search dialog is disabled (it never invents results).
 */
export interface UiDatafeed extends Datafeed {
  searchSymbols?(query: string, signal: AbortSignal): Promise<SymbolInfo[]>;
  /** The instrument behind `symbol`, asked before its bars are loaded. Optional: without it prices are shown to what the bars need, and the footprint is refused. */
  resolveSymbol?(symbol: string, signal: AbortSignal): Promise<SymbolInfo>;
}

/** A bar as the shell reads it: the core's OHLC plus the volume, when the feed has one. */
export type VolumeBar = OhlcBar & { volume?: number };

export interface ScriptDiagnostic {
  /** 1-based. */
  line: number;
  column: number;
  message: string;
  severity: "error" | "warning" | "info";
  /** Character offsets into the script, when the producer knows them (the script runner does). */
  from?: number;
  to?: number;
}

/** The seam for `@alphacharts/script`'s editor: the shell supplies the panel, the adapter the editor. */
export interface ScriptEditorAdapter {
  mount(
    el: HTMLElement,
    opts: { value: string; onChange(value: string): void; onRun(value: string): void; diagnostics: readonly ScriptDiagnostic[] },
  ): { setDiagnostics(d: readonly ScriptDiagnostic[]): void; destroy(): void };
}

/**
 * The seam for running a script: `@alphacharts/script`'s
 * `createScriptRunAdapter()` provides one. The shell stays free of the script
 * package; the host passes both adapters or neither.
 */
export interface ScriptRunAdapter {
  /**
   * Compile `code` and attach it to `source` on `chart`. Compile errors come
   * back as diagnostics with nothing attached; failures after it starts
   * (budgets, runtime errors) arrive through `onRuntimeError`.
   */
  run(
    target: { chart: Chart; source: Series<"candles">; volume: Series<"histogram"> | null },
    code: string,
    onRuntimeError: (d: ScriptDiagnostic) => void,
  ): { diagnostics: readonly ScriptDiagnostic[]; remove(): void };
}

export type ThemeName = "dark" | "light" | "high-contrast" | "auto" | "custom";
export type SyncKey = "symbol" | "interval" | "crosshair" | "time" | "drawings";

export interface Features {
  /** Each switch only hides UI; the engine behind it is unchanged. All default to true. */
  symbolSearch: boolean;
  compare: boolean;
  indicators: boolean;
  drawings: boolean;
  alerts: boolean;
  layouts: boolean;
  multiChart: boolean;
  snapshot: boolean;
  fullscreen: boolean;
  settings: boolean;
  themeSwitcher: boolean;
  localeSwitcher: boolean;
}

export interface ChartAppOptions {
  datafeed: UiDatafeed;
  symbol: string;
  /** A resolution string the core's parseResolution accepts: "5m", "75m", "3h", "1D", "2D", "1W", "3M". */
  interval: string;
  theme?: ThemeName | Partial<Theme>;
  /** BCP 47 tag; the built-in catalogues are "en" and "hi". */
  locale?: string;
  /** Text direction of the shell; default: the locale's (the chart itself stays left-to-right). */
  dir?: "ltr" | "rtl";
  /** Where layouts, templates, drawing templates, favourites and recent symbols live. Default: an in-memory store. */
  storage?: LayoutStore;
  features?: Partial<Features>;
  /** IANA time zone of the time axis. Default "UTC". */
  timeZone?: string;
  /** Study definitions to offer. Default: all of @alphacharts/indicators, loaded when the dialog first opens. */
  studies?: readonly StudyDef[];
  /** Drawing tools to offer. Default: all 82. */
  tools?: readonly ToolDef[];
  /** Grid preset id, see GRID_PRESETS. Default "1". */
  layout?: string;
  /** The script panel appears only when an adapter is given; it needs `scriptRunner` too. */
  scriptEditor?: ScriptEditorAdapter;
  /** Runs what the script panel's Run does. Required with `scriptEditor`. */
  scriptRunner?: ScriptRunAdapter;
  /** Called for each alert that fires, in addition to the shell's own notice. */
  onAlert?: (t: AlertTrigger & { symbol: string }) => void;
  /** Called with the PNG of a snapshot instead of downloading it. */
  onSnapshot?: (png: Blob) => void;
  /** Called for every failure the shell reports to the user. */
  onError?: (e: Error) => void;
}

export const DEFAULT_FEATURES: Features = {
  symbolSearch: true, compare: true, indicators: true, drawings: true, alerts: true, layouts: true,
  multiChart: true, snapshot: true, fullscreen: true, settings: true, themeSwitcher: true, localeSwitcher: true,
};
