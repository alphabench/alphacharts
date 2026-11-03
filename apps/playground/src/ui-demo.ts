// ?ex=ui: the whole chart application on a synthetic datafeed (dev only).
// ?layout=4  grid preset   ?theme=light|dark|high-contrast|auto   ?locale=hi   ?dir=rtl
// ?storage=local  keep layouts in localStorage   ?autosave=1  restore the last session
// ?ticksize=none  the feed does not say the instrument's tick size   ?trades=1  give the feed trades (footprint)   ?anchor=15  shift every bar grid by 15 minutes (an exchange that opens at :15)   ?script=1  mount a stand-in script editor
// window.__feed.replay(symbol, prices) drives live bars for the alert tests.

import { createScriptRunAdapter } from "@alphacharts/script";
import { createScriptEditorAdapter } from "@alphacharts/script/editor";
import { LocalStorageStore, MemoryStore, parseResolution, type BarsRequest, type OhlcBar } from "@alphacharts/core";
import { createChartApp, type ChartAppController, type SymbolInfo, type ThemeName, type UiDatafeed } from "@alphacharts/ui";
import { ohlc, trades } from "./synthetic.js";

const SYMBOLS: Array<SymbolInfo & { seed: number; base: number }> = [
  { symbol: "ALPHA", name: "Alpha Industries", exchange: "SYN", type: "stock", seed: 11, base: 2500 },
  { symbol: "BETA", name: "Beta Financial Services", exchange: "SYN", type: "stock", seed: 12, base: 1450.5 },
  { symbol: "GAMMA", name: "Gamma Motors", exchange: "SYN", type: "stock", seed: 13, base: 640.25 },
  { symbol: "DELTA", name: "Delta Index", exchange: "SYN", type: "index", seed: 14, base: 24800 },
  { symbol: "EPSILON", name: "Epsilon Futures", exchange: "SYN", type: "futures", seed: 15, base: 52.4 },
];
const END = Date.UTC(2026, 9, 20);
const MS = { s: 1000, m: 60_000, h: 3_600_000, D: 86_400_000, W: 7 * 86_400_000, M: 30 * 86_400_000 } as const;

declare global {
  interface Window {
    __app?: ChartAppController;
    __feed?: { replay(symbol: string, prices: number[]): void; last(symbol: string): OhlcBar | undefined };
    __uiReady?: boolean;
  }
}

export async function run(app: HTMLElement, params: URLSearchParams): Promise<void> {
  const end = END + Number(params.get("anchor") ?? 0) * 60_000;
  const subs = new Map<string, Set<(b: OhlcBar & { volume: number }) => void>>();
  const lastBar = new Map<string, OhlcBar & { volume: number }>();
  const key = (s: string, r: string) => `${s}|${r}`;
  const info = (s: string) => {
    const x = SYMBOLS.find((y) => y.symbol === s);
    if (!x) throw new Error(`unknown symbol ${s}`);
    return x;
  };
  const feed: UiDatafeed = {
    async searchSymbols(q, signal) {
      await new Promise((r) => setTimeout(r, 30));
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      const w = q.toLowerCase();
      return SYMBOLS.filter((s) => s.symbol.toLowerCase().includes(w) || (s.name ?? "").toLowerCase().includes(w)).map(({ symbol, name, exchange, type }) => ({ symbol, name: name!, exchange: exchange!, type: type! }));
    },
    ...(params.get("ticksize") === "none" ? {} : { async resolveSymbol(symbol: string) { const { symbol: s, name, exchange, type } = info(symbol); return { symbol: s, name: name!, exchange: exchange!, type: type!, tickSize: 0.01 }; } }),
    async getBars(req: BarsRequest, signal) {
      await new Promise((r) => setTimeout(r, 20));
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      const s = info(req.symbol);
      const r = parseResolution(req.resolution);
      const step = r.n * MS[r.unit];
      const total = 20_000;
      const d = ohlc(total, s.seed, end, step, s.base);
      for (const a of [d.open, d.high, d.low, d.close]) for (let i = 0; i < a.length; i++) a[i] = Math.round(a[i]! * 100) / 100;
      let hi = total;
      while (hi > 0 && d.time[hi - 1]! > req.to) hi--;
      const lo = Math.max(0, hi - req.countBack);
      const sl = (a: Float64Array) => a.slice(lo, hi);
      if (hi > 0) {
        const i = hi - 1;
        lastBar.set(key(req.symbol, req.resolution), { time: d.time[i]!, open: d.open[i]!, high: d.high[i]!, low: d.low[i]!, close: d.close[i]!, volume: d.volume[i]! });
      }
      return { bars: { time: sl(d.time), open: sl(d.open), high: sl(d.high), low: sl(d.low), close: sl(d.close), volume: sl(d.volume) }, noMoreData: lo === 0 };
    },
    subscribeBars(symbol, resolution, onBar) {
      const k = key(symbol, resolution);
      let set = subs.get(k);
      if (!set) subs.set(k, (set = new Set()));
      set.add(onBar as never);
      return () => set!.delete(onBar as never);
    },
  };
  if (params.get("trades") === "1") {
    const all = trades(30_000, 7, 2500, end);
    feed.getTrades = async (req) => all.filter((t) => t.time >= req.from && t.time < req.to);
  }
  window.__feed = {
    last: (s) => lastBar.get(key(s, "1m")),
    replay(symbol, prices) {
      for (const [k, set] of subs) {
        if (!k.startsWith(`${symbol}|`)) continue;
        let b = lastBar.get(k);
        if (!b) throw new Error(`no bar loaded for ${k}`);
        for (const p of prices) {
          b = { ...b, close: p, high: Math.max(b.high, p), low: Math.min(b.low, p) };
          lastBar.set(k, b);
          for (const fn of set) fn(b);
        }
      }
    },
  };
  const theme = (params.get("theme") ?? "dark") as ThemeName;
  document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
  if (params.get("dir") === "rtl") document.documentElement.dir = "rtl";
  const storage = params.get("storage") === "local" ? new LocalStorageStore("ac-ui-dev:") : new MemoryStore();
  const ctl = createChartApp(app, {
    datafeed: feed, symbol: params.get("symbol") ?? "ALPHA", interval: params.get("interval") ?? "5m", theme, locale: params.get("locale") ?? "en", ...(params.get("dir") === "rtl" ? { dir: "rtl" as const } : {}), storage,
    layout: params.get("layout") ?? "1", timeZone: "Asia/Kolkata",
    // ?script=1: the real script editor and sandboxed runner.
    ...(params.get("script") === "1" ? { scriptEditor: createScriptEditorAdapter(), scriptRunner: createScriptRunAdapter() } : {}),
  });
  window.__app = ctl;
  await ctl.ready;
  const ok = () => ctl.instances.length > 0 && ctl.instances.every((i) => i.status === "ready" || i.status === "error");
  while (!ok()) await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => setTimeout(r, 150));
  window.__uiReady = true;
}
