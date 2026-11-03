# Comparison harness: alphacharts, lightweight-charts, Apache ECharts

A reproducible benchmark for the posts that compare alphacharts with
[lightweight-charts](https://github.com/tradingview/lightweight-charts) and
[Apache ECharts](https://echarts.apache.org). Every number in such a post must come from
`bench/results/compare.json`, committed with the post, and the tables from
`scripts/compare-report.mjs`. Nothing is typed in by hand.

## What it renders

One candlestick series of seeded synthetic 1-minute bars (`apps/playground/src/synthetic.ts`
`ohlc()`, seed `20261103`), the same Float64 arrays handed to each library, at **10k, 100k,
1M and 4.8M bars**, in a 1600x900 viewport at device pixel ratio 2. The page shows the last
500 bars first. A checksum of the generated data (sum of closes, first and last time) is recorded for every
run and the spec fails if two runs generated different data. It covers the generator's output,
not what each adapter converts it into (lightweight-charts rows in seconds, ECharts row arrays);
that conversion is in `src/adapters/*.ts` and is what `prepareMs` times.

| id | library | renderer | notes |
|---|---|---|---|
| `alphacharts` | `@alphacharts/core` from source | WebGL2 | `candles` series, columnar `setData`, `timeScale.setVisibleLogicalRange` |
| `lightweight-charts` | 5.2.1 | Canvas2D | `CandlestickSeries`, one `setData` of row objects (its only input form), default options |
| `echarts` | version in `compare.json` | Canvas | tree-shaken `echarts/core`; candlestick on a time axis, `large: true` (threshold 600), default progressive rendering, `dataZoom` inside, animation off |
| `echarts-sync` | same | Canvas | as `echarts` with `progressive: 0`, so every frame is drawn in full before it counts |

The exact configuration each used is written into `compare.json` (`results[].path`) and
printed by the report.

ECharts appears twice on purpose. Its default progressive rendering paints large series in
chunks over several frames, so a frame can be cheap because it is incomplete. `echarts` is
the documented default; `echarts-sync` is what you get if you require every frame complete.
Report both, or say which one you quote.

## What is measured

Per library and size, `RUNS` (default 5) fresh page loads, each in a new browser context:

- **Time to first paint** after the data is handed over: from the start of preparing the data
  in the library's format to the second animation frame after the load call.
- **Settled time** (ECharts only): until its own `finished` event, when progressive rendering
  is complete.
- **Load time**: `prepareMs` (building the library's input format from the arrays; zero for
  alphacharts, which takes typed arrays as they are) and `setDataMs` (the load call).
- **Pan/zoom sweep**: 600 frames driven from `requestAnimationFrame`, after one identical
  warm-up pass. The sweep is the one in `bench/tests/perf.spec.ts`: zoom out from 200 bars
  to the whole history (anchored right), pan across it at a 2%-of-history window, zoom back
  in (anchored left). Frame interval p50, p95, p99 and max; frames over 16.7 ms; **missed
  frames** (longer than 1.5 x the display's own refresh interval, measured per run - the
  rule `perf.spec.ts` gates on).
- **Memory**: JS heap growth over the measured sweep after the warm-up (`usedJSHeapSize`
  after a forced GC), and the same with `performance.measureUserAgentSpecificMemory()`, which
  also counts typed arrays (the page is cross-origin isolated for this). The page memory
  added by the hand-over is recorded too (`pageLoadDeltaMB`).
- **Bars on screen at the widest zoom**: how many bars the library actually showed when the
  sweep asked for the whole history.
- **Bundle size**: raw and gzip (level 9) bytes of the library's chunk(s) in a minified
  production build of this page, found through Vite's manifest.

`compare.json` holds `meta` (machine, OS, CPU, GPU, memory, Chrome version, display refresh
rate, library versions and the alphacharts commit, dataset seed, date, harness settings),
`bundles`, and for every library x size the raw numbers of every run plus
`summary` (median, min, max over the runs that produced a number) and `outcomes`.

## How to run

From `charts/`:

```
pnpm install
pnpm bench:compare                          # about 1 to 2 hours, see below
node scripts/compare-report.mjs bench/results/compare.json > report.md
```

`pnpm bench:compare` builds `bench/compare` with Vite (a production build), serves it with
`vite preview` on port 5210 (`AC_PORT_COMPARE` moves it), and runs
`bench/tests/compare.spec.ts` in project `compare`. No other dev server is started. It does
not need `pnpm build`: alphacharts is bundled from `packages/core/src`.

Subsets for development (these write `bench/results/compare.partial.json`, so the committed
`compare.json` is never overwritten by a partial run):

```
AC_COMPARE_SIZES=10000,100000 AC_COMPARE_LIBS=alphacharts,echarts AC_COMPARE_RUNS=2 pnpm bench:compare
```

`bench/results/compare-shots/<library>-<bars>.png` is a screenshot of each library's first
run, to check that all of them drew the same candles. Look at them before quoting numbers.

### Hardware and conditions

- A real display and GPU: headed system Chrome, like `perf.spec.ts`. Headless Chromium falls
  back to software GL and measures the wrong thing. The window is parked off-screen.
- A quiet machine: close other apps (browsers, Docker, builds, tests), plug in the power,
  disable low-power mode, and leave the machine alone while it runs. Nothing else of this
  repo's suites may run at the same time.
- Free memory: the 4.8M row holds the dataset, the library's copy of it and ECharts' row
  arrays at once. 16 GB is the least that is sensible.
- Quote the machine from `compare.json` with the numbers. A 60 Hz display and a 120 Hz one
  give different "missed frame" counts; the report states the refresh rate it measured.

## Fairness rules

1. **Same data.** One generator, one seed, the same arrays (the generator's output is checksum-checked). Each library
   gets them in its own documented input form and the cost of building that form is reported
   (`prepareMs`), not hidden and not counted against `setDataMs`.
2. **Same viewport, same starting view, same sweep.** Full-viewport chart, no volume, no
   indicators, no drawings, dark theme colours copied from alphacharts' `DARK` for all three,
   candle up/down colours equal, price axis on the right, UTC time. Every library is moved by
   its own public range API: `setVisibleLogicalRange` (alphacharts, lightweight-charts) and
   `dispatchAction({type: "dataZoom"})` (ECharts).
3. **Each library's recommended configuration for large data**, stated in the output. No
   option is tuned for one library and left at its default for another; defaults are used
   unless a library's documentation says to change them for large data. Candlestick `large`
   mode is on for ECharts, tree-shaken imports are used for ECharts, and `animation` is off
   (alphacharts and lightweight-charts have none).
4. **Production builds**, minified, served by `vite preview`, not the dev server. All three
   run in the same page shell.
5. **Run-major, rotated order.** Run 1 measures every library, then run 2, and so on, with
   the library order rotated each run, so thermal drift and cache state do not favour the
   library that always goes first or last.
6. **Failures are results.** A library that cannot load a size, crashes the tab or times out
   is recorded with the reason (`failed to load`, `tab crashed`, `timed out`) and shown in the
   report. After two failed runs in a row at a size, the remaining runs for that cell are
   written as `not attempted` with that reason, not dropped. A sweep that exceeds its 90 s
   budget per pass is kept as `partial` with the frames it managed.
7. **Medians with ranges.** The report shows median (min-max) over the runs, not the best run.

## Known limits of the comparison

- **The libraries do different things at full zoom-out.** lightweight-charts stops zooming
  at 0.5 px per bar, so at 1M and 4.8M bars it shows a few thousand bars where the others
  show everything. Its widest frames are therefore cheaper than the same frame in the others.
  `fullZoomOutVisibleBars` records what each really showed. Setting `minBarSpacing` lower is
  not its recommended path and is not done here.
- **ECharts progressive rendering** can report fast frames for pictures not yet complete;
  the `echarts-sync` variant and the settled time exist to expose that. ECharts' `dataZoom`
  `filterMode: "filter"` re-filters the data on every zoom; that cost is real and included.
  A `slider` dataZoom, tooltips and the other components are not mounted; a chart with them
  would be slower, not faster.
- **ECharts input.** Row arrays (`[time, open, close, low, high]`) are the documented
  candlestick form. If a typed-array path exists for candlesticks it is not used.
- **First paint is main-thread time, not GPU time.** It ends at the second animation frame
  after the load call. A library that queues GPU work after that is not charged for it, and a
  library that paints a coarse frame first is credited for it; `settledMs` covers ECharts
  only. Frame intervals do include GPU back-pressure, as in `perf.spec.ts`.
- **`usedJSHeapSize` does not count typed arrays**, so it favours libraries that keep data in
  them. The page-memory figure does count them, but needs cross-origin isolation and is
  skipped (null) if the browser refuses; it is also coarse (MB) and includes the harness's
  own copy of the dataset in both measurements. GPU memory is not measured.
- **The sweep helper is a copy.** `perf.spec.ts` keeps its sweep as a string evaluated in the
  page, not an importable module, and was left unchanged. `compare/src/main.ts` repeats the
  same phases and arithmetic. If one changes, change the other, or the numbers stop
  reading against `perf.json`.
- **alphacharts is bundled from source**; lightweight-charts and ECharts from their npm
  packages. Bundle sizes include the same ~1 kB adapter in each. alphacharts is core only (no
  plugins); lightweight-charts is its tree-shaken v5 build; ECharts is the tree-shaken
  candlestick + grid + inside dataZoom + canvas renderer, which is what an app would ship,
  not the 1 MB full build.
- **One machine, one browser, one display.** Chrome on the recorded GPU only; no Firefox or
  Safari, no integrated or low-end GPU, no touch. alphacharts is measured on its WebGL
  path (the adapter throws if the chart did not get a WebGL surface); its Canvas2D fallback is
  not benchmarked here.
- **Synthetic random-walk data**, 24/7 1-minute bars with no gaps. Real sessions have gaps
  and clustering; the relative costs should hold but were not checked.
- **What is not compared**: features (alphacharts ships panes, drawings, studies, order flow;
  the others differ), API ergonomics, live-update and datafeed behaviour, accessibility,
  mobile and the quality of the picture. A post must not claim anything this harness did not
  measure.
- **Variance.** Five runs show spread, not a confidence interval. If a range is wide, say
  so, or raise `AC_COMPARE_RUNS`.
