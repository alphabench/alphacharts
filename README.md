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
  <img alt="core size" src="https://img.shields.io/badge/core-42%20KiB%20gzip-brightgreen">
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

alphacharts is a financial charting library for the web. Series are drawn with WebGL2 (with a Canvas2D
fallback) and text with Canvas2D, so a chart stays smooth with millions of bars, many synced charts and live ticks. The core has no runtime dependencies and
ships no data and no UI framework: React, Vue and Svelte bindings are separate packages.

It is for apps that show markets: candles, lines, areas, histograms, panes, a crosshair, markers, price lines,
drawing tools, technical studies, alerts and order-flow charts. Next to the real-time engine there is a declarative
plot layer (bars, heatmaps, treemaps, scatter, small multiples) for the analytical charts around a trading screen.

Version 0.1.x (`@alphacharts/core`, `indicators` and `drawings` 0.1.1; the other packages 0.1.0). The API may still change before 1.0; breaking changes are listed in the [changelog](CHANGELOG.md).

## Highlights

- **Fast at scale.** Autoscale over any range is O(log n) and only the visible window is uploaded to the GPU; a 10M-bar
  pan/zoom sweep held a 120 Hz display's frame rate in the recorded run. See [Performance](#performance) for what was
  measured, and what was not.
- **Small.** `@alphacharts/core` is about 42 KiB gzip with every built-in series and no runtime dependencies. Everything
  else is opt-in, so a bundler keeps only what you import.
- **Live data built in.** `series.update(bar)` for ticks, `series.prepend(bars)` for history paging, and
  `connectDatafeed` to drive a series from a datafeed.
- **A whole workbench.** 90 drawing tools, 227 technical studies (run in a Web Worker), alerts, Heikin-Ashi, Renko,
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
npm install @alphacharts/script      # a Pine-like indicator language on top of @alphacharts/indicators
npm install @alphacharts/chart-types @alphacharts/orderflow @alphacharts/i18n
npm install @alphacharts/report      # optional, off by default: anonymous crash reports (see below)
```

Requirements: a browser and a bundler or runtime that understands ES modules. `@alphacharts/core` draws series with
WebGL2 when it is available and falls back to Canvas2D when it is not (see [Renderer](#renderer)). `@alphacharts/plot`
draws on Canvas2D and does not need WebGL.

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
- **WebGL contexts.** A standalone chart owns one. A removed chart's context is parked for the next chart (at most 8,
  released after 10 s idle), which avoids the browser's "too many active WebGL contexts" warning on create/remove
  cycles. See [Renderer](#renderer) for what happens past 8 live charts.

### Renderer

`createChart(el, { renderer })` takes `"auto"` (the default), `"webgl"` or `"canvas2d"`.

- `"auto"` uses WebGL2, and draws on Canvas2D instead when WebGL2 is unavailable or the page already holds 8 live
  standalone charts (browsers evict the oldest WebGL context past about 16).
- `"webgl"` throws if WebGL2 is unavailable. `"canvas2d"` never uses WebGL.
- Every built-in series type and every type in `@alphacharts/chart-types` and `@alphacharts/orderflow` has a Canvas2D
  renderer. A custom series type registered without `createRenderer2D` throws when it has to draw on Canvas2D.
- A `Dashboard` draws all of its charts on one set of canvases and one WebGL context, so many charts in a grid do not
  use up the context budget.
- `chart.renderer` tells you which surface a chart ended up on.
- The performance figures below were measured on the WebGL path. The Canvas2D path has not been benchmarked.

### The brand mark

Charts draw a small α mark (the Alphabench brand mark) at the bottom-left of the plot area. It is an option, on by
default; hide or fade it per chart:

```ts
createChart(el, { watermark: { visible: false } });
createPlot(el, { watermark: { visible: false } });
// or keep it and fade it: { watermark: { opacity: 0.5 } }
```

## Theming

alphacharts is themed the way a shadcn/ui app is: with shadcn's CSS variables. Its default look is shadcn's Luma
preset (neutral greys, black in dark mode), and a page that already defines shadcn tokens gets charts that match it,
with nothing else to configure.

```ts
createChart(el, { theme: "inherit" });          // the page's variables at `el`, followed live (a .dark switch, the OS)
createPlot(el, { theme: "inherit", ...spec });
createChartApp(el, { datafeed, symbol, interval }); // the full UI: "inherit" is its default
```

`"dark"` and `"light"` are the Luma palettes, fixed; `"auto"` follows the OS; an object is a custom theme.

### The variables

Each is read at the chart's element, so two parts of one page can theme their charts differently by defining the
variables under two selectors (an application and a research panel, say):

```css
.app      { --background: #f7f7f7; --foreground: #0a0a0a; --primary: #0a0a0a; --radius: 0rem; /* … */ }
.research { --background: oklch(0.985 0.004 80); --primary: oklch(0.45 0.08 50); --radius: 0.625rem; }
.dark .research { --background: oklch(0 0 0); /* … */ }
```

| Variable | Used for |
|---|---|
| `--background`, `--foreground`, `--muted-foreground`, `--border` | the chart's background, text, axis text, grid and borders |
| `--primary` | the accent: alert levels, the shade outside trading hours |
| `--chart-1` … `--chart-5` | the data palette: studies, Fibonacci levels, compared symbols, plot series |
| `--chart-up`, `--chart-down` | rising and falling bars (not shadcn tokens; default emerald and red) |
| `--font-sans` | the chart's font |
| `--card`, `--popover`, `--secondary`, `--muted`, `--accent`, `--destructive` (each with `-foreground`), `--input`, `--ring`, `--radius` | the UI shell (`@alphacharts/ui`): menus, dialogs, buttons, fields |

Any CSS colour is read: `oklch()`, `hsl()`, `color-mix()`, hex, and shadcn v3's bare `H S% L%`.

**Precedence**, first one set wins: `--ac-<token>` (an override for the chart only: `--ac-background`,
`--ac-chart-up`, `--ac-radius` …), then the shadcn token, then Luma for the page's light or dark mode. The chart-only
keys shadcn has no token for are `--ac-grid`, `--ac-crosshair`, `--ac-label-background`, `--ac-label-text` and
`--ac-extended-hours`. `THEME_VARIABLES` (core) lists every name the chart reads.

Under `"inherit"` the chart reads these names whatever the page means by them: a page that uses `--muted` or
`--border` for something else should name its own variables differently, pass a fixed theme, or set the `--ac-*`
overrides.

### Colour slots

A data colour can name a role instead of a value: `"chart-1"` … `"chart-5"`, `"chart-up"`, `"chart-down"`,
`"muted"` or `"foreground"`, with an optional opacity (`"chart-2/0.35"`). It draws with the chart's current theme and
changes when the theme does. The built-in studies, drawing tools and order-flow defaults use slots; so can you, in
series options, price lines, markers and drawing styles:

```ts
chart.addSeries("line", { color: "chart-2" });
chart.createPriceLine(series, { price: 100, color: "muted" });
```

`resolveColor(color, theme)` gives the colour a slot draws with.

### The UI shell

`@alphacharts/ui` is built like shadcn's components, in the Luma style, and is restyled the same three ways:

1. **Tokens.** The variables above, plus radius roles derived from `--radius` (`--ac-radius-control` for buttons and
   toggles, `--ac-radius-field`, `--ac-radius-surface`, `--ac-radius-dialog`, `--ac-radius-item`, `--ac-radius-tooltip`),
   and `--ac-control-height`, `--ac-control-height-sm`, `--ac-icon-size`, `--ac-font-sans`.
2. **One component.** Every element carries shadcn's `data-slot`, `data-variant`, `data-size` and `data-state`, and a
   CSS `part` of its slot's name:
   ```css
   alpha-chart-app::part(dropdown-menu-item) { font-weight: 400; }
   ```
   or, inside the shadow root, through the `styles` option, which comes after the built-in sheet and wins without
   `!important`:
   ```ts
   createChartApp(el, { ..., styles: '[data-slot="button"][data-variant="ghost"]:hover { background: var(--c-accent); }' });
   ```
3. **The whole stylesheet.** `@alphacharts/ui/styles.css` is the built-in sheet as a file. Copy it, edit it like a
   shadcn component's source, and pass it with `stylesheet: "none", styles: myCss`.

Icons are Lucide's (shadcn's icon set) plus our own for the drawing tools; `icons: { trendLine: "M4 20 20 4" }`
replaces any of them by name.

## Packages

| Package | What it is |
|---|---|
| [`@alphacharts/core`](packages/core) | The engine: data, LOD, scales, WebGL renderers, chart, input, sync, datafeed |
| [`@alphacharts/plot`](packages/plot) | Declarative Canvas2D charts: bar, candle, line, area, scatter, histogram, heatmap, treemap, rules, facets; tooltip, legend, brush and zoom, CSV and PNG export |
| [`@alphacharts/react`](packages/react) | `<Chart>`, `<Series>`, `<PriceLine>`, `<Dashboard>`, `<SyncGroup>`, hooks; `/plot` has `<Plot>` |
| [`@alphacharts/vue`](packages/vue) | `<AcChart>`, `<AcSeries>`, `<AcPriceLine>`, `<AcDashboard>`, `<AcSyncGroup>`, composables |
| [`@alphacharts/svelte`](packages/svelte) | Svelte 5 components (runes), same surface |
| [`@alphacharts/indicators`](packages/indicators) | 227 studies (TA-Lib's catalogue plus TradingView's built-ins), an incremental engine and a Web Worker runner |
| [`@alphacharts/drawings`](packages/drawings) | 90 drawing tools, undo and redo, magnet, templates |
| [`@alphacharts/alerts`](packages/alerts) | An alert evaluator (pure, runs without a chart) and a chart plugin |
| [`@alphacharts/chart-types`](packages/chart-types) | Baseline, step, columns, hi-lo, dots, bricks, Kagi, P&F; Heikin-Ashi, Renko, range, line break, tick, volume and dollar bars |
| [`@alphacharts/orderflow`](packages/orderflow) | Trade store, footprint, volume profile, TPO, cumulative volume delta |
| [`@alphacharts/i18n`](packages/i18n) | Message catalogues (en, hi), ICU plurals, locale formatting, text direction |
| [`@alphacharts/report`](packages/report) | Opt-in anonymous crash reports; off unless you call `enableCrashReporting` |
| [`@alphacharts/wasm`](packages/wasm) | Optional WebAssembly kernels for the indicators engine |

## Performance

Measured on one MacBook Pro, Chrome stable, a 120 Hz display (8.3 ms frame), 1600×900 at DPR 2, on 21 Oct 2026.
These are one run by the maintainers and no result file is committed for them: `pnpm bench` re-measures on your
hardware, and the numbers are not a promise for it.

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

Bundle size (`pnpm size`, gzip): `@alphacharts/core` 42.2 KiB, lightweight-charts 5.2.1 production ESM 59.0 KiB.
lightweight-charts does more than the core in some areas (localisation of every option, more series options, its
plugin API), so read the size as a budget check, not a like-for-like win.

Not measured: other hardware (mid-range, Windows, mobile), Safari, Firefox, GPU time (the timer-query extension is
unavailable in Chrome on macOS). The 48 synced charts × 100k bars scenario in `pnpm bench` does miss
frames on the maintainers' machine. A like-for-like comparison with lightweight-charts and ECharts, with its raw
results, lives in `bench/compare` (`pnpm bench:compare`).

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

## Crash reporting (optional)

Off by default and not part of `@alphacharts/core`: nothing is collected or sent unless you install
[`@alphacharts/report`](packages/report) and call `enableCrashReporting({ endpoint, key })` with the capture endpoint (a
full URL, used exactly as given: no path is appended) and public key of your own PostHog project. There is no default
server: without both it throws. It sends one event per distinct fault, at most 5 per page load: error class name, source
(`draw-loop`, `ctor`, `context-lost`, `shader`, `plot`, `drawings`, `alerts`, `feed`), renderer
kind, WebGL2 available, context lost, browser family and major version, OS family, core and report library versions, and a random id new on every page load. Never error messages, stack frames, file names, ids, symbols,
prices, data, GPU strings or anything stored. Exact fields are listed in [the package README](packages/report/README.md).

## Known limits

- The Canvas2D fallback is not benchmarked, so do not assume WebGL-level performance on very large series. Use a
  `Dashboard` when you need many charts at once.
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
