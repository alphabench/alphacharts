<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
    <img src="assets/logo-light.svg" alt="alphacharts" width="112" height="100">
  </picture>
</p>

<h1 align="center">alphacharts</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@alphacharts/core"><img alt="npm" src="https://img.shields.io/npm/v/@alphacharts/core?label=npm&color=cb3837"></a>
  <a href="https://www.npmjs.com/package/@alphacharts/core"><img alt="downloads" src="https://img.shields.io/npm/dm/@alphacharts/core?label=downloads"></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/github/license/alphabench/alphacharts?color=blue"></a>
  <img alt="core size" src="https://img.shields.io/badge/core-42%20kB%20gzip-brightgreen">
  <img alt="runtime dependencies" src="https://img.shields.io/badge/runtime%20dependencies-0-brightgreen">
  <img alt="types" src="https://img.shields.io/badge/types-TypeScript-3178c6">
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> |
  <a href="#packages">Packages</a> |
  <a href="#performance">Performance</a> |
  <a href="#known-limits">Known limits</a> |
  <a href="https://www.npmjs.com/org/alphacharts">npm</a> |
  <a href="https://github.com/alphabench/alphacharts/issues">Issues</a>
</p>

alphacharts is a financial charting library for the web. Series are drawn with WebGL2 and text with Canvas2D, so a
chart stays smooth with millions of bars, many synced charts and live ticks. The core has no runtime dependencies and
ships no data and no UI framework: React, Vue and Svelte bindings are separate packages.

It is for apps that show markets: candles, lines, areas, histograms, panes, a crosshair, markers, price lines,
drawing tools, technical studies, alerts and order-flow charts. Next to the real-time engine there is a declarative
plot layer (bars, heatmaps, treemaps, scatter, small multiples) for the analytical charts around a trading screen.

Version 0.1.0. The API may still change before 1.0; breaking changes are listed in the [changelog](CHANGELOG.md).

## Highlights

- **Fast at scale.** Autoscale over any range is O(log n) and only the visible window is uploaded to the GPU; a 10M-bar
  pan/zoom sweep held a 120 Hz display's frame rate in the recorded run. See [Performance](#performance) for what was
  measured, and what was not.
- **Small.** `@alphacharts/core` is about 42 kB gzip with every built-in series and no runtime dependencies. Everything
  else is opt-in, so a bundler keeps only what you import.
- **Live data built in.** `series.update(bar)` for ticks, `series.prepend(bars)` for history paging, and
  `connectDatafeed` to drive a series from a datafeed.
- **A whole workbench.** 82 drawing tools, 210 technical studies (run in a Web Worker), alerts, Heikin-Ashi, Renko,
  Kagi and point-and-figure, footprint, volume profile and TPO.
- **Frameworks.** Components and hooks for React, Vue 3 and Svelte 5, or use the plain TypeScript API.
- **Typed and strict.** Written in TypeScript. Bad input throws an error that names the problem.
- **Accessible and international.** Keyboard navigation and screen-reader announcements; message catalogues and locale
  formatting (English and Hindi included), right-to-left text.
- **MIT licensed.**

## Install

```
npm install @alphacharts/core
```

That is enough for a chart. Add what you need (every package is ESM; sibling packages declare
`@alphacharts/core` as a peer dependency, so install it yourself):

```
npm install @alphacharts/react       # or @alphacharts/vue, @alphacharts/svelte
npm install @alphacharts/plot        # declarative bars, heatmaps, treemaps, scatter, ...
npm install @alphacharts/indicators @alphacharts/drawings @alphacharts/alerts
npm install @alphacharts/chart-types @alphacharts/orderflow @alphacharts/i18n
```

Requirements: a browser with **WebGL2** for `@alphacharts/core` (without it `createChart` throws; there is no Canvas2D
fallback yet), and a bundler or runtime that understands ES modules. `@alphacharts/plot` draws on Canvas2D and does
not need WebGL.

## Quick start

### Vanilla TypeScript

```ts
import { createChart } from "@alphacharts/core";

const el = document.getElementById("chart")!;           // give it a height in CSS
const chart = createChart(el, { theme: "dark", timeZone: "UTC" });

const candles = chart.addSeries("candles", { priceFormat: { type: "price", minMove: 0.05 } });
candles.setData(bars);        // [{ time, open, high, low, close }], time in UTC milliseconds
candles.update(liveBar);      // live: the same time replaces the last bar, a later time appends one
candles.prepend(olderBars);   // history paging

chart.createPriceLine(candles, { price: 100, title: "target" });
chart.on("crosshairMove", (e) => console.log(e));
```

Data can also be columnar (`Float64Array`s for `time`, `open`, `high`, `low` and `close`), which is the fastest way in
for large histories.

### React

```tsx
import { Chart, Series, PriceLine } from "@alphacharts/react";

export function Candles({ bars, live }) {
  return (
    <Chart style={{ height: 400 }} options={{ theme: "dark", timeZone: "UTC" }}>
      <Series type="candles" data={bars} update={live} options={{ title: "SYNTH" }}>
        <PriceLine price={100} color="#f7a600" title="target" />
      </Series>
    </Chart>
  );
}
```

Keep `data` referentially stable between ticks (a new array calls `setData`) and pass the forming bar as `update`.
[Vue](packages/vue/README.md) (`AcChart`, `AcSeries`) and [Svelte 5](packages/svelte/README.md) have the same
surface.

### Volume, panes and several series

```ts
const volume = chart.addSeries("histogram", { priceScaleId: "vol", priceFormat: { type: "volume" } });
chart.priceScale("vol").applyOptions({ marginTop: 0.8, marginBottom: 0 });   // keep volume in the lower fifth
chart.addSeries("line", { pane: 1, title: "RSI" }).setData(rsi);              // its own pane

// Many series at once: one timeline rebuild instead of one per setData.
chart.batch(() => outputs.forEach((o) => o.series.setData(o.data)));
```

### Markers, options and keeping charts together

```ts
import { SyncGroup } from "@alphacharts/core";

candles.setMarkers([{ time: bar.time, position: "belowBar", shape: "arrowUp", color: "#26a69a", text: "Buy", id: "o-1" }]);
chart.on("click", (e) => e.hovered);     // { kind: "marker" | "primitive", id } under the pointer

chart.applyOptions({ grid: { vertLines: false }, crosshair: { priceLabel: false } });

const sync = new SyncGroup();   // same time window and crosshair, matched by time (different instruments work)
sync.add(chartA);
sync.add(chartB);
```

### Declarative plots

```ts
import { createPlot } from "@alphacharts/plot";

const plot = createPlot(el, {
  theme: "dark",
  scales: { x: { type: "time" } },
  marks: [
    { type: "bar", name: "inflow", x: days, y: inflow },
    { type: "line", name: "cumulative", x: days, y: cumulative },
    { type: "rule", y: 0 },
  ],
  tooltip: { mode: "shared" },
  interactions: { brush: true, zoom: true },
});
plot.update(nextSpec);   // the spec is plain, JSON-serialisable data
plot.exportCsv();        // exactly what is plotted
```

Mark types: bar, candle, line, area, errorBand, scatter, histogram, heatmap, treemap, rule, band, text. See the
[plot README](packages/plot/README.md).

### Studies, drawings and alerts

```ts
import { addStudy } from "@alphacharts/indicators";
import { rsi, bbands } from "@alphacharts/indicators/studies";   // import only the studies you use
import { DrawingsPlugin, ArrayBarSource, allTools } from "@alphacharts/drawings";

addStudy(chart, candles, bbands, { length: 20 });   // overlay on the candles' pane
addStudy(chart, candles, rsi, { length: 14 });      // its own pane

const drawings = new DrawingsPlugin({ tools: allTools, source: new ArrayBarSource(columns), interval: 60_000 });
chart.addPlugin(drawings);
drawings.setTool("trendLine");      // the user clicks and drags; Esc cancels
chart.saveState();                  // layout, including drawings; chart.restoreState(state) brings it back
```

Import named tools instead of `allTools` to keep the rest out of your bundle. Each package README has its own
guide: [indicators](packages/indicators/README.md), [drawings](packages/drawings/README.md),
[alerts](packages/alerts/README.md), [chart-types](packages/chart-types/README.md),
[orderflow](packages/orderflow/README.md), [i18n](packages/i18n/README.md).

## Things to know

- **Times are UTC milliseconds.** Pass `timeZone` (an IANA name) to choose how the axis labels days; the data stays UTC.
- **Prices are `Float64`** on the CPU. What you pass in is what a readout, a crosshair event or the screen-reader
  announcement gives back.
- **`update` vs `setData`.** `update(bar)` is for the live bar: same time replaces, later time appends. A `setData`
  whose times are all on the timeline already (an indicator over the same bars) places only that series; any other
  `setData` rebuilds the shared timeline and re-indexes every series, so wrap several in `chart.batch`.
- **Markers** sit above a bar's high or below its low. A marker whose time is not a bar of its series throws.
- **`saveState()` cannot carry functions.** A custom price format, `timeLabel` or `autoscale` is recorded as present,
  and `restoreState(state, { formatters, timeLabel })` refuses until you pass them back.
- **Datafeeds.** `connectDatafeed(chart, series, feed, { symbol, resolution, onError })` loads the first page,
  prepends older pages as the view nears the left edge and applies live bars. Every failure reaches `onError`.
- **WebGL contexts.** Each chart owns one. A removed chart's context is parked for the next chart (at most 8, released
  after 10 s idle), which avoids the browser's "too many active WebGL contexts" warning on create/remove cycles.

### The brand mark

Charts draw a small α mark (the Alphabench brand mark) at the bottom-left of the plot area. It is an option, on by
default; hide or fade it per chart:

```ts
createChart(el, { watermark: { visible: false } });
createPlot(el, { watermark: { visible: false } });
// or keep it and fade it: { watermark: { opacity: 0.5 } }
```

## Packages

| Package | What it is |
|---|---|
| [`@alphacharts/core`](packages/core) | The engine: data, LOD, scales, WebGL renderers, chart, input, sync, datafeed |
| [`@alphacharts/plot`](packages/plot) | Declarative Canvas2D charts: bar, candle, line, area, scatter, histogram, heatmap, treemap, rules, facets; tooltip, legend, brush and zoom, CSV and PNG export |
| [`@alphacharts/react`](packages/react) | `<Chart>`, `<Series>`, `<PriceLine>`, `<Dashboard>`, `<SyncGroup>`, hooks; `/plot` has `<Plot>` |
| [`@alphacharts/vue`](packages/vue) | `<AcChart>`, `<AcSeries>`, `<AcPriceLine>`, `<AcDashboard>`, `<AcSyncGroup>`, composables |
| [`@alphacharts/svelte`](packages/svelte) | Svelte 5 components (runes), same surface |
| [`@alphacharts/indicators`](packages/indicators) | 210 studies (TA-Lib's catalogue plus TradingView's built-ins), an incremental engine and a Web Worker runner |
| [`@alphacharts/drawings`](packages/drawings) | 82 drawing tools, undo and redo, magnet, templates |
| [`@alphacharts/alerts`](packages/alerts) | An alert evaluator (pure, runs without a chart) and a chart plugin |
| [`@alphacharts/chart-types`](packages/chart-types) | Baseline, step, columns, hi-lo, dots, bricks, Kagi, P&F; Heikin-Ashi, Renko, range, line break, tick, volume and dollar bars |
| [`@alphacharts/orderflow`](packages/orderflow) | Trade store, footprint, volume profile, TPO, cumulative volume delta |
| [`@alphacharts/i18n`](packages/i18n) | Message catalogues (en, hi), ICU plurals, locale formatting, text direction |
| [`@alphacharts/wasm`](packages/wasm) | Optional WebAssembly kernels for the indicators engine |

## Performance

Measured on one MacBook Pro, Chrome stable, a 120 Hz display (8.3 ms frame), 1600×900 at DPR 2, on 21 Oct 2026.
`pnpm bench` re-measures; the numbers are one run, not a promise for your hardware.

| Scenario | bars | frame p95 | frames > 16.7 ms | alphacharts CPU p95 per frame |
|---|---|---|---|---|
| pan/zoom sweep | 1M | 9.3 ms | 0 / 598 | 1.0 ms |
| pan/zoom sweep | 10M | 9.3 ms | 0 / 598 | 0.7 ms |
| sweep + 100 Hz ticks | 1M | 9.3 ms | 0 / 598 | 2.1 ms |
| 16 synced charts | 16 × 100k | 9.1 ms | 0 / 598 | ≈ 2.3 ms (all 16) |
| lightweight-charts 5.2.1 sweep | 1M | 16.7 ms | 26 / 598 | n/a |
| lightweight-charts 5.2.1 | 10M | the tab crashed loading the data | | |

`setData` alone: 1M bars 81 ms and 10M bars 670 ms (columnar input); lightweight-charts took 1,960 ms for 1M bars
(row objects, built before timing). Heap growth over a 600-frame sweep after warm-up: none.

Bundle size (`pnpm size`, gzip): `@alphacharts/core` 42.2 kB, lightweight-charts 5.2.1 production ESM 59.0 kB.
lightweight-charts does more than the core in some areas (localisation of every option, more series options, its
plugin API), so read the size as a budget check, not a like-for-like win.

Not measured: other hardware (mid-range, Windows, mobile), Safari, Firefox, GPU time (the timer-query extension is
unavailable in Chrome on macOS). At 48 synced charts × 100k bars the sweep does miss frames; see
`bench/results/perf.json`.

### How it is fast

- **Columnar, double-ended storage** (`packages/core/src/data/deque.ts`, `model.ts`). The x axis is the logical bar
  index over a shared timeline, so gaps cost nothing. Prepending history lowers the first index; nothing already
  loaded moves.
- **LOD pyramid** (`data/lod.ts`): open-first, high-max, low-min, close-last per 8, 16, 32 … bars. It lets a chart draw
  at most about one screen of marks at any zoom, and answers `minMax` over any range in O(log n), so autoscale follows
  a pan over 10M bars every frame.
- **Windowed GPU upload** (`render/window.ts`). Only the visible range plus one screen each side is uploaded, at the
  level being drawn, relative to a base index and base price, so Float32 keeps sub-pixel accuracy at deep zoom (tested:
  a price of 100,000 zoomed to a range of 0.13). Panning inside the window changes uniforms only; a tick rewrites one
  record.
- **Pixel-snapped instanced quads** (`render/renderers.ts`): integer body and wick widths of equal parity, so wicks
  sit centred at every DPR. Lines are anti-aliased in the fragment shader; zoomed-out lines draw the exact per-bucket
  envelope.
- **Three layers per chart** (background, GL, overlay) and one page-wide `requestAnimationFrame` scheduler: a mouse
  move redraws only the overlay, and 100 Hz ticks render once per frame.
- **Time labels** come from calendar boundaries mapped to bars by binary search when zoomed out; when zoomed in, bars
  lighter than any label that could survive the spacing are skipped. Text widths are cached.

## Extending

- **Series types:** `registerSeriesType(name, def)` with a data shape, theme defaults, a WebGL `SeriesRenderer`,
  autoscale and the axis value. The built-in types register this way. Extend `SeriesOptionsMap` by declaration merging
  to type a new one.
- **Pane primitives** (`chart/primitives.ts`): draw on the overlay in pane CSS px, add price-axis labels, claim the
  cursor. `PriceLine` is one. A primitive's `hitTest` may return `{ id, cursor? }`.
- **Plugins:** `chart.addPlugin(plugin)` is how drawings, studies and alerts attach to a chart.

`@alphacharts/core/internal` exposes rendering internals for the sibling series packages. It is not public API and
changes without notice.

## Known limits

- WebGL2 is required for the core; without it `createChart` throws. No Canvas2D fallback yet.
- Each chart owns a WebGL context, and browsers cap live contexts (Chrome about 16), so a dashboard with more charts
  than that needs a shared-context renderer (not built yet).
- Price scales are linear only (log, percent and indexed are not built yet).
- A bar's high and low are drawn as given; the library does not check `high >= max(open, close)`.
- A series' line has a gap where it has no bar on the shared timeline.
- The API is pre-1.0 and may change between minor versions.

## Development

A pnpm workspace (a current Node LTS and pnpm 10). Run from the repository root:

```
pnpm install
pnpm dev          # playground on http://127.0.0.1:5199 (?ex=basic|big|panes|types|synced|live|feed|i18n|lwc|orderflow|chart-types|drawings|alerts|plot|integration)
pnpm test         # unit tests of every package (vitest)
pnpm typecheck
pnpm build        # every package's dist/
pnpm size         # gzip size beside lightweight-charts (after build)
pnpm bench        # perf sweeps, writes bench/results/perf.json
pnpm visual       # snapshots (zero tolerance) + pixel alignment + behaviour
```

```
packages/*         the published packages
apps/playground    Vite app, one example per ?ex= route, synthetic data
apps/example-*     React, Vue and Svelte apps: candles + volume, live ticks, price line, synced dashboard
bench              Playwright: perf sweeps, visual snapshots, behaviour tests
scripts            size.mjs and check-deps.mjs
```

`pnpm size` and the benches need the playground installed (`pnpm install` at the root). The visual snapshots are
macOS-only (Chrome, Firefox and WebKit render differently per platform), so they do not run in CI; unit tests,
typecheck and `node scripts/check-deps.mjs` do. The perf benches drive headed system Chrome (`channel: "chrome"`),
parked off-screen; the visual and behaviour suites run Chrome headless, which still renders on the GPU.

## Contributing, security, licence

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Report vulnerabilities privately as described
in [SECURITY.md](SECURITY.md). alphacharts is released under the [MIT licence](LICENSE); see [NOTICE](NOTICE) for
third-party material.
