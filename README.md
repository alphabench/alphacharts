# AlphaCharts

A financial charting library: WebGL2 for series, Canvas2D for text, no runtime
dependencies, no bundled data. Candles, lines, histograms, panes, synced
charts, drawings, studies and a declarative plot layer, with React, Vue and
Svelte bindings. Version 0.1.0: the API may still change before 1.0.

Licensed under the MIT licence (see `LICENSE`).

## Install

```
npm install @alphacharts/core
# optional, pick what you need:
npm install @alphacharts/plot @alphacharts/react   # or /vue, /svelte
npm install @alphacharts/indicators @alphacharts/drawings @alphacharts/alerts
npm install @alphacharts/chart-types @alphacharts/orderflow @alphacharts/i18n
```

The packages are ES modules. Sibling packages (`plot`, `drawings`, ...) declare
`@alphacharts/core` as a peer dependency, so install it yourself.

## Brand mark

Charts draw a small Alphabench mark at the bottom-left of the plot area. It is
a configurable option, on by default; hide it per chart:

```ts
createChart(el, { watermark: { visible: false } });
createPlot(el, { watermark: { visible: false } });
// or keep it and fade it: { watermark: { opacity: 0.5 } }
```

## Layout

```
packages/core      @alphacharts/core — data, LOD, scales, WebGL renderers, chart, input, sync, datafeed
packages/i18n      @alphacharts/i18n — message catalogues (en, hi), ICU plurals, locale formatting, text direction
packages/orderflow @alphacharts/orderflow — trade store, footprint, volume profile, TPO, CVD (needs the core's Trade contract)
packages/chart-types  @alphacharts/chart-types — baseline, step, columns, hi-lo, dots, bricks, Kagi, P&F series; Heikin-Ashi, Renko, Kagi, P&F, range, line break, tick/volume/dollar transforms
packages/plot      @alphacharts/plot — declarative charts: bar, candle, line, area, scatter, histogram, heatmap, treemap, rules, facets; tooltip, legend, brush/zoom, sync, CSV/PNG export
packages/drawings  @alphacharts/drawings — chart plugin: 82 drawing tools, undo/redo, magnet, templates
packages/alerts    @alphacharts/alerts — alert evaluator (pure) and chart plugin
packages/react     @alphacharts/react  — <Chart>, <Series>, <PriceLine>, <Dashboard>, <SyncGroup>, hooks (+ /plot: <Plot>)
packages/vue       @alphacharts/vue    — <AcChart>, <AcSeries>, <AcPriceLine>, <AcDashboard>, <AcSyncGroup>, composables
packages/svelte    @alphacharts/svelte — Svelte 5 components (runes), same surface
apps/playground    Vite app: one example per ?ex= route, synthetic data (dev only)
apps/example-*     React, Vue and Svelte apps: candles + volume, live ticks, price line, synced dashboard
bench              Playwright: perf sweeps, visual snapshots, behaviour tests
scripts/size.mjs   gzip size beside lightweight-charts
```

## Commands (from `charts/`)

```
pnpm install
pnpm dev          # playground on http://127.0.0.1:5199 (?ex=basic|big|panes|types|synced|live|feed|i18n|lwc|orderflow|chart-types|drawings|alerts|plot|integration)
pnpm test         # unit tests of every package (vitest)
pnpm typecheck
pnpm build        # every package's dist/
pnpm size         # after build
pnpm bench        # perf sweeps, writes bench/results/perf.json
pnpm visual       # snapshots (zero tolerance) + pixel alignment + behaviour
```

`pnpm size` and the benches need the playground installed (`pnpm install` at the root). The visual
snapshots are macOS-only (Chrome, Firefox, WebKit renderings differ per platform), so they do not run
in CI; unit tests, typecheck and `node scripts/check-deps.mjs` do.

The perf benches drive headed system Chrome (`channel: "chrome"`), parked
off-screen. The visual and behaviour suites run Chrome headless: it still
renders on the GPU (ANGLE/Metal on macOS), and a headed off-screen window gets
synthetic pointer events during screenshot capture that move the crosshair.

## Use

```ts
import { createChart } from "@alphacharts/core";

const chart = createChart(el, { theme: "dark", timeZone: "Asia/Kolkata" });
const candles = chart.addSeries("candles", { minMove: 0.05 });
candles.setData(bars);            // [{ time, open, high, low, close }] or columnar Float64Arrays
candles.update(bar);              // live: same time replaces, later time appends
candles.prepend(olderBars);       // history paging
chart.batch(() => outputs.forEach((o) => o.series.setData(o.data)));  // many series, one timeline rebuild

const volume = chart.addSeries("histogram", { priceScaleId: "vol", minMove: 1 });
chart.priceScale("vol").applyOptions({ marginTop: 0.8, marginBottom: 0 });
chart.addSeries("line", { pane: 1, title: "RSI" }).setData(rsi);
chart.createPriceLine(candles, { price: 25_000, title: "target" });
chart.on("crosshairMove", (e) => …);
```

Many series: a `setData` whose times are all on the timeline already (a study
output over the same bars) places only that series; any other `setData` rebuilds
the shared timeline and re-indexes every series. Inside `chart.batch(fn)` those
rebuilds and the change events wait for the end of `fn` (one rebuild for the
batch); timeline lookups inside it show the state before the batch.

Annotations and per-series hooks:

```ts
candles.setMarkers([{ time: bar.time, position: "belowBar", shape: "arrowUp", color: "#26a69a", text: "Buy", id: "o-1" }]);
chart.on("click", (e) => e.hovered);   // { kind: "marker" | "primitive", id } under the pointer
candles.priceToCoordinate(p); candles.coordinateToPrice(y);   // pane CSS px; NaN until the scale has a range
chart.paneWidth(); chart.priceAxisWidth("right");
chart.applyOptions({ grid: { vertLines: false }, crosshair: { priceLabel: false }, timeFormat: { hour: "2-digit", minute: "2-digit" } });
chart.priceScale("right").applyOptions({ minWidth: 80 });
chart.addSeries("candles", { title: "NIFTY", autoscale: (r) => (r ? { low: Math.min(r.low, 100), high: r.high } : null) });
```

Markers sit above a bar's high or below its low, stacked outward in the order
given; a marker whose time is not a bar of the series throws (naming it). They
are not saved by `saveState`, nor is a series' `autoscale` function. A series
`title` is drawn as a tag beside the last-value label (inside the pane) when
`lastValueVisible`. A primitive's `hitTest` may return `{ id, cursor? }`; its
`drawBackground` draws behind the series (`host.requestRender("background")`
repaints it).

`saveState()` cannot carry functions: a custom price format or `timeLabel` is
recorded as present, and `restoreState(state, { formatters, timeLabel })` refuses
(changing nothing) until they are passed back.

A removed chart keeps its WebGL context parked for the next chart in the page
(at most 8, released after 10 s idle): browsers count a removed canvas's
context until it is garbage collected and warn "too many active WebGL contexts"
after about 8 create/remove cycles otherwise.

Times are UTC milliseconds. Prices stay Float64 on the CPU: a readout
(`series.barAt`, crosshair events, the screen-reader announcement) is the
value that was passed in.

`connectDatafeed(chart, series, feed, { symbol, resolution, onError })` drives
a series from a `Datafeed` (`getBars` + optional `subscribeBars`): it loads the
first page, prepends older pages as the view nears the left edge, and applies
live bars. Every failure reaches `onError`.

`new SyncGroup().add(a).add(b)` keeps charts on the same time window
(matched by time, so different instruments work) and crosshair.

## How it is fast

- **Columnar, double-ended storage** (`data/deque.ts`, `data/model.ts`). The x
  axis is the logical bar index over a shared timeline, so gaps cost nothing.
  Prepending history lowers the first index; nothing already loaded moves.
- **LOD pyramid** (`data/lod.ts`): open-first, high-max, low-min, close-last
  per 8, 16, 32 … bars. Two jobs: drawing at most about one screen of marks at
  any zoom, and `minMax` over any range in O(log n), so autoscale follows a pan
  over 10M bars every frame.
- **Windowed GPU upload** (`render/window.ts`). Only the visible range plus one
  screen each side is uploaded, at the level being drawn, relative to a base
  index and base price, so Float32 keeps sub-pixel accuracy at deep zoom
  (tested: ₹1,00,000 zoomed to a ₹0.13 range). Panning inside the window
  changes uniforms only; a tick rewrites one record.
- **Pixel-snapped instanced quads** (`render/renderers.ts`): integer body and
  wick widths of equal parity, so wicks sit centred at every DPR (asserted on
  the WebGL buffer at DPR 1 and 2). Lines are anti-aliased in the fragment
  shader; zoomed-out lines draw the exact per-bucket envelope.
- **Three layers per chart** (bg / gl / overlay) and one page-wide rAF
  scheduler: a mouse move redraws only the overlay; 100 Hz ticks render once
  per frame.
- **Time labels** come from calendar boundaries mapped to bars by binary
  search when zoomed out; when zoomed in, bars lighter than any label that
  could survive the spacing are skipped. Text widths are cached.

## Extending

- Series types: `registerSeriesType(name, def)` with a data shape, theme
  defaults, a WebGL `SeriesRenderer`, autoscale and the axis value. The five
  built-ins register this way. Extend `SeriesOptionsMap` by declaration
  merging to type a new one.
- Pane primitives (`chart/primitives.ts`): draw on the overlay in pane CSS px,
  add price-axis labels, claim the cursor. `PriceLine` is one.

## Measured (21 Oct 2026)

This MacBook Pro only, Chrome stable, 120 Hz display (8.3 ms frame), 1600×900
at DPR 2. `pnpm bench` re-measures; numbers below are one run.

| Scenario | bars | frame p95 | frames > 16.7 ms | our CPU p95 per frame |
|---|---|---|---|---|
| pan/zoom sweep | 1M | 9.3 ms | 0 / 598 | 1.0 ms |
| pan/zoom sweep | 10M | 9.3 ms | 0 / 598 | 0.7 ms |
| sweep + 100 Hz ticks | 1M | 9.3 ms | 0 / 598 | 2.1 ms |
| 16 synced charts | 16 × 100k | 9.1 ms | 0 / 598 | ≈2.3 ms (all 16) |
| lightweight-charts 5.2.1 sweep | 1M | 16.7 ms | 26 / 598 | — |
| lightweight-charts 5.2.1 | 10M | tab crashed loading the data | | |

setData alone: 1M bars 81 ms, 10M bars 670 ms (columnar input);
lightweight-charts 1M bars 1,960 ms (row objects, built before timing). Heap growth over a
600-frame sweep after a warm-up pass: none (≤ 0 KB after GC).
Bundle (`pnpm size`): core 23.5 KB gzip; lightweight-charts' production ESM
59.0 KB gzip. Lightweight-charts does more than AlphaCharts does (localisation of
every option, more series options, its plugin API), so read the size as a
budget check, not a like-for-like win.

Not measured: other hardware (mid-range, Windows, mobile), Safari, Firefox,
GPU time (the timer-query extension is unavailable in Chrome on macOS).

## Known limits

- WebGL2 is required; without it `createChart` throws. No Canvas2D fallback yet.
- Each chart owns a WebGL context; browsers cap live contexts (Chrome ~16), so
  dashboards beyond that need a shared-context renderer (not built yet).
- Price scales are linear only (log / percent / indexed: not yet).
- A bar's high/low are drawn as given; the library does not check high ≥ max(open, close).
- A series' line has a gap where it has no bar on the shared timeline.
