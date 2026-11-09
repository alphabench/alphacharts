// ?ex=ui: the whole chart application on a synthetic datafeed (dev only).
// ?theme=inherit  take the page's shadcn tokens: ?scope=app|research picks which set the page defines (app: square and neutral; research: warm, with Luma's radius), ?dark=1 adds .dark
// ?layout=4  grid preset   ?theme=light|dark|high-contrast|auto|inherit   ?locale=hi   ?dir=rtl
// ?storage=local  keep layouts in localStorage   ?autosave=1  restore the last session
// ?ticksize=none  the feed does not say the instrument's tick size   ?trades=1  give the feed trades (footprint)   ?anchor=15  shift every bar grid by 15 minutes (an exchange that opens at :15)   ?script=1  mount a stand-in script editor   ?noheader=1  snapshots without the header   ?hostsnap=1  onSnapshot collects the images in window.__snaps   ?auto=1  the auto-drawing analyses (Fib, trend lines, key levels, pitchfork)   ?assistant=1  the "describe an indicator" box with an offline stand-in (no model) and a host drawing tool
// window.__feed.replay(symbol, prices) drives live bars for the alert tests.

import { allTools } from "@alphacharts/drawings";
import { analysisEntry, autoDrawings, createAdapterRegistry, runAssistant } from "@alphacharts/extend";
import { compile, createScriptRunAdapter } from "@alphacharts/script";
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
    /** For the browser tests of the shell's options: a second app on the same feed. */
    __createApp?: (el: HTMLElement, extra: Record<string, unknown>) => ChartAppController;
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
  // A host page that themes itself the shadcn way. Two scopes stand for the application and its research panel: the same chart
  // code, two sets of variables.
  const scope = params.get("scope");
  if (scope) {
    const st = document.createElement("style");
    st.textContent = `
      /* "app": a square, neutral shadcn theme (radius 0). */
      .scope-app {
        --radius: 0rem; --background: #f7f7f7; --foreground: #0a0a0a; --card: #ffffff; --card-foreground: #0a0a0a; --popover: #ffffff;
        --popover-foreground: #0a0a0a; --primary: #0a0a0a; --primary-foreground: #ffffff; --secondary: #ededed; --secondary-foreground: #0a0a0a;
        --muted: #ededed; --muted-foreground: #6b6b6b; --accent: #ededed; --accent-foreground: #0a0a0a; --destructive: #e5484d; --border: #e6e6e6;
        --input: #e6e6e6; --ring: #6b6b6b; --chart-up: #0e9f6e; --chart-down: #e5484d;
      }
      .scope-app.dark {
        --background: #0b0b0b; --foreground: #f2f2f2; --card: #121212; --card-foreground: #f2f2f2; --popover: #161616; --popover-foreground: #f2f2f2;
        --primary: #f2f2f2; --primary-foreground: #0b0b0b; --secondary: #1c1c1c; --secondary-foreground: #f2f2f2; --muted: #1c1c1c;
        --muted-foreground: #858585; --accent: #1c1c1c; --accent-foreground: #f2f2f2; --destructive: #ff6369; --border: rgb(255 255 255 / 9%);
        --input: rgb(255 255 255 / 14%); --ring: rgb(255 255 255 / 65%); --chart-up: #3dd68c; --chart-down: #ff6369;
      }
      /* "research": a warm stone palette with Luma's radius, for a second panel of the same page. */
      .scope-research {
        --radius: 0.625rem; --background: oklch(0.985 0.004 80); --foreground: oklch(0.22 0.01 60); --card: oklch(1 0 0); --card-foreground: oklch(0.22 0.01 60);
        --popover: oklch(1 0 0); --popover-foreground: oklch(0.22 0.01 60); --primary: oklch(0.45 0.08 50); --primary-foreground: oklch(0.985 0.004 80);
        --secondary: oklch(0.95 0.008 75); --secondary-foreground: oklch(0.3 0.02 60); --muted: oklch(0.95 0.008 75); --muted-foreground: oklch(0.52 0.02 65);
        --accent: oklch(0.95 0.008 75); --accent-foreground: oklch(0.3 0.02 60); --destructive: oklch(0.58 0.2 27); --border: oklch(0.9 0.01 75);
        --input: oklch(0.9 0.01 75); --ring: oklch(0.7 0.03 65); --chart-up: oklch(0.6 0.12 165); --chart-down: oklch(0.6 0.19 27);
      }
      .scope-research.dark {
        --background: oklch(0 0 0); --foreground: oklch(0.95 0.008 80); --card: oklch(0.17 0.006 60); --card-foreground: oklch(0.95 0.008 80);
        --popover: oklch(0.17 0.006 60); --popover-foreground: oklch(0.95 0.008 80); --primary: oklch(0.82 0.06 70); --primary-foreground: oklch(0.2 0.01 60);
        --secondary: oklch(0.25 0.008 60); --secondary-foreground: oklch(0.95 0.008 80); --muted: oklch(0.25 0.008 60); --muted-foreground: oklch(0.7 0.02 70);
        --accent: oklch(0.25 0.008 60); --accent-foreground: oklch(0.95 0.008 80); --destructive: oklch(0.7 0.19 22); --border: oklch(1 0 0 / 10%);
        --input: oklch(1 0 0 / 15%); --ring: oklch(0.55 0.02 60);
      }
    `;
    document.head.appendChild(st);
    app.classList.add(`scope-${scope}`);
    if (params.get("dark") === "1") app.classList.add("dark");
  }
  if (params.get("dir") === "rtl") document.documentElement.dir = "rtl";
  // ?assistant=1: an assistant adapter with no model behind it. "ema 20" or "sma 50" writes that average; a prompt with
  // "broken" first returns a script that does not compile, to show the repair round trip. The host drawing tool is a
  // built-in one under another id, to show the Custom group of the drawing bar.
  const registry = createAdapterRegistry();
  const analyses: Array<ReturnType<typeof analysisEntry>> = [];
  if (params.get("assistant") === "1") {
    registry.register({
      kind: "assistant", manifest: { id: "demo.offline", version: "1.0.0", name: "Offline stand-in", permissions: [] },
      generate: async ({ prompt, previous }) => {
        const m = /\b(ema|sma)\s*(\d+)\b/i.exec(prompt);
        if (!m) throw new Error('This stand-in only understands "ema 20" or "sma 50".');
        if (/broken/i.test(prompt) && !previous) return { script: "plot(close" };
        const [, kind, len] = m;
        return { script: `indicator("${kind!.toUpperCase()} ${len}", overlay=true)\nplot(ta.${kind!.toLowerCase()}(close, ${len}))`, explanation: `Plots the ${len}-bar ${kind!.toUpperCase()} of the close.` };
      },
    });
    registry.register({ kind: "drawing", manifest: { id: "demo.tools", version: "1.0.0", name: "Demo tools", permissions: [] }, tools: [{ ...allTools.find((t) => t.id === "horizontalLine")!, id: "demo.tools.level", label: "Demo level" }] });
  }
  if (params.get("auto") === "1") {
    const grants = createAdapterRegistry({ allow: ["bars"] });
    for (const a of autoDrawings()) grants.register(a);
    analyses.push(...grants.list("analysis").map((a) => analysisEntry(a as never, { allowBars: grants.mayReadBars(a.manifest.id) })));
  }
  const assistant = registry.assistants()[0];
  const storage = params.get("storage") === "local" ? new LocalStorageStore("ac-ui-dev:") : new MemoryStore();
  const ctl = createChartApp(app, {
    datafeed: feed, symbol: params.get("symbol") ?? "ALPHA", interval: params.get("interval") ?? "5m", theme, locale: params.get("locale") ?? "en", ...(params.get("dir") === "rtl" ? { dir: "rtl" as const } : {}), storage,
    layout: params.get("layout") ?? "1", timeZone: "Asia/Kolkata",
    ...(analyses.length ? { analyses } : {}),
    ...(params.get("noheader") === "1" ? { snapshotHeader: false } : {}),
    ...(params.get("hostsnap") === "1" ? { onSnapshot: (png: Blob, action: string) => ((window as unknown as { __snaps?: string[] }).__snaps ??= []).push(`${action}:${png.type}`) } : {}),
    ...(registry.tools().length ? { tools: [...allTools, ...registry.tools()] } : {}),
    // ?script=1: the real script editor and sandboxed runner.
    ...(assistant ? {
      assistant: { ask: ({ prompt, symbol, interval, signal }: { prompt: string; symbol: string; interval: number; signal: AbortSignal }) => runAssistant(assistant, { prompt, symbol, interval }, { signal, compile: (s) => { const r = compile(s); return r.ok ? { ok: true } : { ok: false, diagnostics: r.diagnostics }; } }) },
      scriptRunner: createScriptRunAdapter({ workerFactory: () => new Worker(new URL("../../../packages/script/src/sandbox-worker.ts", import.meta.url), { type: "module" }) as never }),
    } : {}),
    ...(params.get("script") === "1" ? { scriptEditor: createScriptEditorAdapter(), scriptRunner: createScriptRunAdapter({ workerFactory: () => new Worker(new URL("../../../packages/script/src/sandbox-worker.ts", import.meta.url), { type: "module" }) as never }) } : {}),
  });
  window.__app = ctl;
  window.__createApp = (el, extra) => createChartApp(el, { datafeed: feed, symbol: "ALPHA", interval: "5m", timeZone: "Asia/Kolkata", ...extra });
  await ctl.ready;
  const ok = () => ctl.instances.length > 0 && ctl.instances.every((i) => i.status === "ready" || i.status === "error");
  while (!ok()) await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => setTimeout(r, 150));
  window.__uiReady = true;
}
