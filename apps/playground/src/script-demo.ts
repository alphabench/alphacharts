// ?ex=script — a script editor beside a chart. Typing recompiles live; a script
// with errors shows them inline and leaves the last good plot on the chart.
// Tests drive it through window.__script. ?auto=0 stops nothing (no timer by
// default); ?live=1 ticks at 100 Hz.

import { createChart, type Chart, type Theme } from "@alphacharts/core";
import { compile, runScript, ScriptRunner, type Diagnostic, type ScriptHandle } from "@alphacharts/script";
import { createScriptEditorAdapter } from "@alphacharts/script/editor";
import { ohlc, rng, volume } from "./synthetic.js";

const DEFAULT_SCRIPT = `indicator("SMA cross", overlay=true)
len = input.int(20, "Length", minval=2, maxval=200)
fast = ta.ema(close, 8)
slow = ta.sma(close, len)
plot(slow, "Slow", color.orange, 2)
plot(fast, "Fast", color.blue)
plotshape(ta.crossover(fast, slow), "Up", shape.triangleup, location.belowbar, color.green)
`;

export interface ScriptDemoApi {
  setSource(text: string): void;
  source(): string;
  handle(): ScriptHandle | null;
  diagnostics(): Diagnostic[];
  runtimeError(): Diagnostic | null;
  tick(k: number): void;
  /** Plot values of the running script, by plot key (a copy). */
  column(key: string): number[];
  /** The closes the chart holds now (ticks included). */
  closes(): number[];
  setBatchMs(ms: number): void;
  /** A second and third script, each with its own private runner, beside the first: returns their last values. */
  extraScripts(): Promise<number[]>;
}

export function runScriptDemo(app: HTMLElement, theme: Theme, params: URLSearchParams, extra: Record<string, unknown>, stat: HTMLElement): Chart {
  const n = Number(params.get("n") ?? 2000);
  const d = ohlc(n, 31);
  app.style.cssText = "display:grid;grid-template-columns:minmax(280px,38%) 1fr;gap:1px;background:var(--pg-line)";
  const left = document.createElement("div");
  left.style.cssText = "display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--pg-bg)";
  const editorEl = document.createElement("div");
  editorEl.id = "script-editor";
  editorEl.style.cssText = "flex:1;min-height:0;overflow:auto";
  const diagEl = document.createElement("ul");
  diagEl.id = "script-diagnostics";
  diagEl.style.cssText = "margin:0;padding:6px 10px;list-style:none;max-height:28%;overflow:auto;border-top:1px solid var(--pg-line);font:12px ui-monospace,monospace;color:var(--pg-muted)";
  left.append(editorEl, diagEl);
  const right = document.createElement("div");
  right.style.cssText = "min-width:0;min-height:0;background:var(--pg-bg)";
  app.append(left, right);

  const chart = createChart(right, { theme });
  const c = chart.addSeries("candles", { title: "SYNTH", priceFormat: { type: "price", minMove: 0.05 } });
  c.setData(d);
  const packed = (css: string) => ((parseInt(css.replace("#", ""), 16) << 8) | 0x80) >>> 0;
  const v = chart.addSeries("histogram", { priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false, priceFormat: { type: "volume" } });
  chart.priceScale("vol").applyOptions({ marginTop: 0.8, marginBottom: 0 });
  v.setData(volume(d, packed(theme.up), packed(theme.down)));
  chart.timeScale.setVisibleLogicalRange({ from: n - 160, to: n + 12 });

  const workerFactory = () => new Worker(new URL("../../../packages/script/src/sandbox-worker.ts", import.meta.url), { type: "module" }) as never;
  const runner = new ScriptRunner(workerFactory, { batchMs: 4000, tickMs: 1000 });

  let handle: ScriptHandle | null = null;
  let diagnostics: Diagnostic[] = [];
  let runtimeError: Diagnostic | null = null;
  let current = params.get("script") ?? DEFAULT_SCRIPT;
  let editorApi: { setDiagnostics(d: Diagnostic[]): void; destroy(): void } | null = null;

  const render = () => {
    const all = [...diagnostics, ...(runtimeError ? [runtimeError] : [])];
    editorApi?.setDiagnostics(all);
    diagEl.replaceChildren(...all.map((x) => {
      const li = document.createElement("li");
      li.dataset.severity = x.severity;
      li.textContent = `${x.line}:${x.column} ${x.message}`;
      return li;
    }));
    stat.textContent = all.some((x) => x.severity === "error") ? `${all.filter((x) => x.severity === "error").length} error(s)` : "ok";
  };

  const apply = (text: string) => {
    current = text;
    const r = compile(text);
    diagnostics = r.diagnostics;
    runtimeError = null;
    if (r.ok) {
      handle?.remove();
      handle = runScript(chart, c, text, {}, { volume: v, runner, onError: (e) => { runtimeError = e; render(); } });
    }
    render();
  };

  // Editing recompiles after a short pause; Mod-Enter runs at once.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ed = createScriptEditorAdapter().mount(editorEl, {
    value: current,
    onChange: (t) => { current = t; clearTimeout(timer); timer = setTimeout(() => apply(t), 120); },
    onRun: (t) => { clearTimeout(timer); apply(t); },
    diagnostics: [],
  });
  editorApi = ed;

  let last = { time: d.time[n - 1]!, open: d.open[n - 1]!, high: d.high[n - 1]!, low: d.low[n - 1]!, close: d.close[n - 1]! };
  let vol = d.volume[n - 1]!;
  const r = rng(555);
  let ticks = 0;
  const closes = Array.from(d.close);
  const tick = () => {
    ticks++;
    const p = Math.max(0.05, last.close + (r() - 0.5) * last.close * 0.0004);
    if (ticks % 40 === 0) {
      last = { time: last.time + 60_000, open: last.close, high: Math.max(last.close, p), low: Math.min(last.close, p), close: p };
      vol = 0;
      closes.push(p);
    } else {
      last = { ...last, high: Math.max(last.high, p), low: Math.min(last.low, p), close: p };
      closes[closes.length - 1] = p;
    }
    vol += Math.round(r() * 50);
    c.update(last);
    v.update({ time: last.time, value: vol, color: last.close >= last.open ? theme.up : theme.down });
  };
  if (params.get("live") === "1") setInterval(tick, 10);

  const api: ScriptDemoApi = {
    setSource: (t) => { clearTimeout(timer); apply(t); },
    source: () => current,
    handle: () => handle,
    diagnostics: () => diagnostics,
    runtimeError: () => runtimeError,
    tick: (k) => { for (let i = 0; i < k; i++) tick(); },
    column: (key) => Array.from(handle!.study.column(key)),
    closes: () => closes.slice(),
    setBatchMs: (ms) => runner.setLimits({ batchMs: ms }),
    extraScripts: async () => {
      const hs = ["plot(ta.sma(close, 3), \"a\")", "plot(ta.ema(close, 3), \"b\")"].map((t) => runScript(chart, c, t, {}, { workerFactory }));
      await Promise.all(hs.map((h) => h.ready()));
      const out = hs.map((h) => { const col = h.study.column(h.study.def.columns[0]!); return col[col.length - 1]!; });
      hs.forEach((h) => h.remove());
      return out;
    },
  };
  extra.__script = api;
  extra.__editorText = () => current;
  apply(current);
  return chart;
}
