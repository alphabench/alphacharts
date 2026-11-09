// Test fixtures: a linear fake pane (4 px per bar, 10 px per price unit), a
// recording 2D context, and one valid drawing per tool.

import type { PluginApi, PluginPaneView, PluginPointer } from "@alphacharts/core";
import { LUMA_DARK } from "@alphacharts/core";
import { ArrayBarSource } from "../src/source.js";
import { DrawingsPlugin, type DrawingsOptions, type NewDrawing } from "../src/plugin.js";
import { allTools } from "../src/tools/all.js";
import type { Anchor, ToolCtx } from "../src/types.js";

export const T0 = Date.UTC(2026, 9, 19, 3, 45); // first bar
export const STEP = 60_000;
export const BARS = 200;
export const W = 800, H = 400;
export const P_LO = 90, P_HI = 130;
export const PX_PER_BAR = 4, PX_PER_PRICE = H / (P_HI - P_LO);

export const k = (i: number, price: number): Anchor => ({ time: T0 + i * STEP, price });

export function view(pane = 0): PluginPaneView {
  return {
    pane, width: W, height: H, dpr: 1,
    timeToX: (t) => ((t - T0) / STEP) * PX_PER_BAR,
    xToTime: (x) => T0 + (x / PX_PER_BAR) * STEP,
    priceToY: (p) => H - (p - P_LO) * PX_PER_PRICE,
    yToPrice: (y) => P_LO + (H - y) / PX_PER_PRICE,
    formatPrice: (p) => p.toFixed(2),
  };
}

export function ctx(source: ArrayBarSource | null = bars()): ToolCtx {
  const v = view();
  return {
    W, H, dpr: 1, X: v.timeToX, Y: v.priceToY, T: v.xToTime, P: v.yToPrice, fmt: v.formatPrice,
    source, interval: STEP,
  };
}

/** 200 one-minute bars on a deterministic wave, volumes 100..999. */
export function bars(n = BARS): ArrayBarSource {
  const time = new Float64Array(n), open = new Float64Array(n), high = new Float64Array(n), low = new Float64Array(n), close = new Float64Array(n), volume = new Float64Array(n);
  let prev = 110;
  for (let i = 0; i < n; i++) {
    const c = 110 + 12 * Math.sin(i / 17) + 3 * Math.sin(i / 5);
    time[i] = T0 + i * STEP;
    open[i] = prev;
    close[i] = c;
    high[i] = Math.max(prev, c) + 0.5 + ((i * 7) % 5) * 0.1;
    low[i] = Math.min(prev, c) - 0.5 - ((i * 3) % 4) * 0.1;
    volume[i] = 100 + ((i * 37) % 900);
    prev = c;
  }
  return new ArrayBarSource({ time, open, high, low, close, volume });
}

export interface FakeChart {
  api: PluginApi;
  renders: number;
  cursor: string | null;
}

export function fakeApi(panes = 1): FakeChart {
  const state: FakeChart = {
    renders: 0, cursor: null,
    api: {
      requestRender: () => { state.renders++; },
      paneCount: panes,
      paneView: (p) => view(p),
      barTimeAtOrBefore: (t) => (t < T0 ? undefined : T0 + Math.floor((t - T0) / STEP) * STEP),
      setCursor: (c) => { state.cursor = c; },
      theme: LUMA_DARK,
    },
  };
  return state;
}

export function plugin(opts: Partial<DrawingsOptions> = {}): { p: DrawingsPlugin; chart: FakeChart; src: ArrayBarSource; errors: Error[] } {
  const src = bars();
  const errors: Error[] = [];
  const p = new DrawingsPlugin({ tools: allTools, source: src, interval: STEP, onError: (e) => errors.push(e), ...opts });
  const chart = fakeApi();
  p.install(chart.api);
  return { p, chart, src, errors };
}

export function ptr(type: PluginPointer["type"], x: number, y: number, extra: Partial<PluginPointer> = {}): PluginPointer {
  const v = view();
  return {
    type, pane: 0, x, y, time: v.xToTime(x), price: v.yToPrice(y), pointerType: "mouse", buttons: type === "up" || type === "move" ? 0 : 1,
    shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...extra,
  };
}

export const px = (a: Anchor): { x: number; y: number } => ({ x: view().timeToX(a.time), y: view().priceToY(a.price) });

export function key(k: string, extra: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return { key: k, metaKey: false, ctrlKey: false, shiftKey: false, ...extra } as KeyboardEvent;
}

// ---- recording 2D context ------------------------------------------------------

export function recorder(): { ctx: CanvasRenderingContext2D; calls: string[] } {
  const calls: string[] = [];
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get(t, name: string) {
      if (name === "measureText") return (s: string) => ({ width: s.length * 6 });
      if (name in t) return t[name];
      return (...args: unknown[]) => {
        calls.push(name);
        for (const a of args) if (typeof a === "number" && !Number.isFinite(a)) throw new Error(`non-finite argument to ${name}: ${args.join(",")}`);
      };
    },
    set(t, name: string, v) {
      t[name] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

// ---- one valid drawing per tool -------------------------------------------------

const ONE = [k(40, 110)];
const TWO = [k(20, 100), k(90, 118)];
const THREE = [k(20, 100), k(80, 118), k(50, 108)];
const FOUR = [k(20, 100), k(50, 118), k(80, 104), k(110, 116)];
const FIVE = [k(10, 100), k(30, 120), k(50, 108), k(70, 118), k(90, 104)];
const SIX = [k(10, 100), k(30, 118), k(50, 106), k(70, 120), k(90, 108), k(110, 119)];
const SEVEN = [k(10, 100), k(30, 112), k(45, 104), k(65, 122), k(85, 105), k(105, 113), k(125, 102)];

const FIXTURES: Record<string, NewDrawing> = {
  longPosition: { tool: "longPosition", anchors: [k(20, 100), k(60, 110), k(60, 95)], props: { accountSize: 100000, riskPercent: 1, lotSize: 1 } },
  shortPosition: { tool: "shortPosition", anchors: [k(20, 100), k(60, 90), k(60, 105)], props: { accountSize: 100000, riskPercent: 1, lotSize: 1 } },
  projection: { tool: "projection", anchors: THREE },
  barsPattern: { tool: "barsPattern", anchors: [k(20, 105), k(40, 105), k(100, 112)] },
  ghostFeed: { tool: "ghostFeed", anchors: [k(20, 105), k(60, 105), k(100, 112)], props: { seed: 7, count: 25 } },
  regressionTrendChannel: { tool: "regressionTrendChannel", anchors: [k(10, 100), k(120, 100)] },
  volumeProfile: { tool: "volumeProfile", anchors: [k(10, 100), k(120, 100)] },
  anchoredVwap: { tool: "anchoredVwap", anchors: [k(30, 110)] },
  table: { tool: "table", anchors: [], props: { fx: 0.2, fy: 0.3, cells: [["Entry", "100"], ["Stop", "95"]] } },
  icon: { tool: "icon", anchors: ONE, props: { glyph: "★" } },
  anchoredText: { tool: "anchoredText", anchors: [], props: { fx: 0.3, fy: 0.4 } },
  anchoredNote: { tool: "anchoredNote", anchors: [], props: { fx: 0.6, fy: 0.3 } },
  fibSpeedFan: { tool: "fibSpeedFan", anchors: TWO },
  gannFan: { tool: "gannFan", anchors: TWO },
  polyline: { tool: "polyline", anchors: FOUR },
  path: { tool: "path", anchors: FOUR },
  brush: { tool: "brush", anchors: [k(10, 100), k(12, 104), k(14, 103), k(16, 108), k(18, 107)] },
  highlighter: { tool: "highlighter", anchors: [k(10, 100), k(14, 104), k(18, 103), k(22, 108)] },
  xabcd: { tool: "xabcd", anchors: FIVE },
  cypher: { tool: "cypher", anchors: FIVE },
  threeDrives: { tool: "threeDrives", anchors: SEVEN },
  headAndShoulders: { tool: "headAndShoulders", anchors: SEVEN },
  elliottImpulse: { tool: "elliottImpulse", anchors: SIX },
  elliottTriangle: { tool: "elliottTriangle", anchors: SIX },
  elliottTripleCombo: { tool: "elliottTripleCombo", anchors: SIX },
  elliottCorrection: { tool: "elliottCorrection", anchors: FOUR },
  elliottDoubleCombo: { tool: "elliottDoubleCombo", anchors: FOUR },
};

export function fixture(toolId: string): NewDrawing {
  const f = FIXTURES[toolId];
  if (f) return structuredClone(f);
  const def = allTools.find((t) => t.id === toolId);
  if (!def) throw new Error(`no tool ${toolId}`);
  const by = [[], ONE, TWO, THREE, FOUR, FIVE, SIX, SEVEN][def.anchors];
  if (!by) throw new Error(`no fixture anchors for ${toolId} (${def.anchors})`);
  return { tool: toolId, anchors: structuredClone(by) };
}
