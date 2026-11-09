// ?ex=drawings — every drawing tool, created from code, one per cell of a
// grid laid over the pane (cell positions are converted to time + price, so
// the drawings are anchored like any other). `?catalog=0` starts empty for
// interaction tests. Press "t" to arm the trend line tool by hand.

import { createChart, type Chart, type Theme } from "@alphacharts/core";
import { allTools, ArrayBarSource, DrawingsPlugin, type NewDrawing } from "@alphacharts/drawings";
import { ohlc, rng } from "./synthetic.js";

/** Catalog pages (`?catalog=<name>`): families grouped so each page holds 8-14 tools. */
export const CATALOG_GROUPS: Record<string, string[]> = {
  lines: ["lines"],
  channels: ["channels", "pitchforks"],
  fibonacci: ["fibonacci"],
  gann: ["gann", "cycles", "volume"],
  shapes: ["shapes"],
  annotations: ["annotations"],
  trading: ["position", "measure"],
  patterns: ["patterns", "elliott"],
};

// colour slots: drawn with the chart theme's colours (see resolveColor in @alphacharts/core)
const PALETTE = ["foreground", "chart-2", "chart-3", "chart-4", "chart-5", "chart-1"];

type UV = Array<[number, number]>;

const BY_COUNT: Record<number, UV> = {
  0: [],
  1: [[0.5, 0.5]],
  2: [[0.1, 0.8], [0.9, 0.2]],
  3: [[0.1, 0.8], [0.9, 0.3], [0.5, 0.75]],
  4: [[0.1, 0.8], [0.35, 0.2], [0.65, 0.7], [0.9, 0.25]],
  5: [[0.05, 0.8], [0.25, 0.2], [0.5, 0.6], [0.7, 0.25], [0.95, 0.7]],
  6: [[0.05, 0.8], [0.2, 0.3], [0.4, 0.6], [0.6, 0.15], [0.8, 0.5], [0.95, 0.25]],
  7: [[0.03, 0.8], [0.17, 0.5], [0.3, 0.65], [0.5, 0.15], [0.7, 0.65], [0.83, 0.45], [0.97, 0.75]],
};

const OVERRIDE: Record<string, { uv?: UV; props?: Record<string, unknown> }> = {
  longPosition: { uv: [[0.1, 0.5], [0.9, 0.15], [0.9, 0.85]], props: { accountSize: 100000, riskPercent: 1, lotSize: 1 } },
  shortPosition: { uv: [[0.1, 0.5], [0.9, 0.85], [0.9, 0.15]], props: { accountSize: 100000, riskPercent: 1, lotSize: 1 } },
  regressionTrendChannel: { uv: [[0.05, 0.5], [0.95, 0.5]] },
  volumeProfile: { uv: [[0.05, 0.5], [0.95, 0.5]] },
  barsPattern: { uv: [[0.05, 0.5], [0.3, 0.5], [0.7, 0.4]] },
  ghostFeed: { uv: [[0.05, 0.5], [0.3, 0.5], [0.7, 0.4]], props: { seed: 11, count: 12 } },
  anchoredVwap: { uv: [[0.1, 0.5]] },
  gannFan: { uv: [[0.1, 0.85], [0.5, 0.45]] },
  fibSpeedFan: { uv: [[0.1, 0.85], [0.9, 0.15]] },
  fibTimeZone: { uv: [[0.05, 0.8], [0.1, 0.2]] },
  cyclicLines: { uv: [[0.1, 0.8], [0.3, 0.2]] },
  timeCycles: { uv: [[0.1, 0.8], [0.4, 0.2]] },
  sineLine: { uv: [[0.1, 0.8], [0.4, 0.2]] },
};

function freehand(n: number, amp: number): UV {
  return Array.from({ length: n }, (_, i) => [0.05 + (0.9 * i) / (n - 1), 0.5 + amp * Math.sin(i / 2)] as [number, number]);
}

export function runDrawings(app: HTMLElement, theme: Theme, params: URLSearchParams, extra: Record<string, unknown>): Chart {
  const n = Number(params.get("n") ?? 3000);
  const seed = 6;
  const d = ohlc(n, seed);
  const chart = createChart(app, { theme });
  const series = chart.addSeries("candles", { title: "SYNTH", priceFormat: { type: "price", minMove: 0.05 } });
  series.setData(d);
  const source = new ArrayBarSource({ time: d.time, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume });
  const plugin = new DrawingsPlugin({ tools: allTools, source, interval: 60_000, onError: (e) => console.error(e) });
  chart.addPlugin(plugin);
  const last = n - 1;
  chart.timeScale.setVisibleLogicalRange({ from: last - 399, to: last + 20 });

  const catalog = params.get("catalog") ?? "lines";
  if (catalog !== "0") {
    const families = CATALOG_GROUPS[catalog];
    if (!families) throw new Error(`unknown catalog "${catalog}" (${Object.keys(CATALOG_GROUPS).join(", ")}, or 0)`);
    const tools = allTools.filter((t) => families.includes(t.family));
    // Wait one frame so the pane has its size, then lay the cells over it.
    requestAnimationFrame(() => {
      const v = chart.element.getBoundingClientRect();
      const W = v.width - 64, H = v.height - 30; // inside the axes
      const cols = Math.ceil(Math.sqrt(tools.length * (W / H)));
      const rows = Math.ceil(tools.length / cols);
      const cw = W / cols, ch = H / rows;
      tools.forEach((t, i) => {
        const col = i % cols, row = Math.floor(i / cols);
        const x0 = col * cw + cw * 0.1, y0 = row * ch + ch * 0.1, w = cw * 0.8, h = ch * 0.8;
        const o = OVERRIDE[t.id];
        let uv = o?.uv ?? BY_COUNT[t.anchors]!;
        if (t.id === "brush") uv = freehand(24, 0.3);
        if (t.id === "highlighter") uv = freehand(18, 0.2);
        if (t.id === "polyline" || t.id === "path") uv = BY_COUNT[5]!;
        const props = { ...o?.props };
        if (t.screen) Object.assign(props, { fx: (x0 + w / 2) / W, fy: (y0 + h / 2) / H });
        const spec: NewDrawing = {
          tool: t.id,
          anchors: uv.map(([u, vv]) => plugin.anchorAt(0, x0 + u * w, y0 + vv * h)),
          ...(Object.keys(props).length ? { props } : {}),
          style: { color: PALETTE[i % PALETTE.length]! },
        };
        try {
          plugin.add(spec);
        } catch (e) {
          console.error(`catalog: ${t.id}`, e);
        }
      });
      (window as unknown as { __catalog: number }).__catalog = plugin.list().length;
    });
  }

  // ?stress=N: N seeded drawings of mixed tools over the data, for frame-time measurement.
  const stress = Number(params.get("stress") ?? 0);
  if (stress > 0) {
    const pool = ["trendLine", "rectangle", "fibRetracement", "parallelChannel", "ray", "horizontalLine", "ellipse", "arrow", "longPosition", "xabcd", "text", "pitchfork"];
    requestAnimationFrame(() => {
      const r = rng(5);
      const v = chart.element.getBoundingClientRect();
      const W = v.width - 64, H = v.height - 30;
      const specs: NewDrawing[] = [];
      for (let i = 0; i < stress; i++) {
        const t = allTools.find((x) => x.id === pool[i % pool.length])!;
        const cx = r() * W * 0.8 + W * 0.1, cy = r() * H * 0.7 + H * 0.15, sx = 40 + r() * 160, sy = 20 + r() * 80;
        const uv = t.id === "longPosition" ? [[0, 0.5], [1, 0.1], [1, 0.9]] : BY_COUNT[t.anchors === 0 ? 1 : t.anchors]!;
        specs.push({
          tool: t.id,
          anchors: uv.map(([u, vv]) => plugin.anchorAt(0, cx + (u! - 0.5) * sx, cy + (vv! - 0.5) * sy)),
          ...(t.id === "longPosition" ? { props: { accountSize: 100000, riskPercent: 1, lotSize: 1 } } : {}),
        });
      }
      for (const s of specs) plugin.add(s);
      (window as unknown as { __catalog: number }).__catalog = plugin.list().length;
    });
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "t" && !e.metaKey && !e.ctrlKey && !e.altKey) plugin.setTool("trendLine");
  });

  Object.assign(extra, {
    __drawings: plugin,
    __source: source,
    __series: series,
    /** Prepend k older bars to the series and to the bar source (history paging). */
    __prepend: (k: number) => {
      const first = d.time[0]!;
      const older = ohlc(k, 99, first - 60_000);
      series.prepend(older);
      source.prepend({ time: older.time, open: older.open, high: older.high, low: older.low, close: older.close, volume: older.volume });
    },
    __data: d,
  });
  return chart;
}
