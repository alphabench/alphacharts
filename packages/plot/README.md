# @alphacharts/plot

Declarative charts on Canvas2D: bars (grouped, stacked, diverging,
mirrored), candles, lines, areas (baseline split, gradient), steps, error bands, scatter and bubbles
(per-point style), histograms, heatmaps, treemaps, rules, bands, text, small
multiples. No runtime dependencies; peer of `@alphacharts/core` (scales, ticks,
number formats, colours, themes come from it).

```ts
import { createPlot } from "@alphacharts/plot";

const plot = createPlot(el, {            // el needs a size (CSS), or give width/height
  theme: "dark",                         // or "light", or resolved token colours: { background: "#101820", … }
  scales: { x: { type: "time" }, y2: {} },
  axes: { y: { label: "₹ cr", format: "compact" } },
  marks: [
    { type: "bar", name: "FII", x: days, y: fii, stack: "flows" },
    { type: "bar", name: "DII", x: days, y: dii, stack: "flows" },
    { type: "line", name: "Cumulative", x: days, y: cum, yAxis: "y2" },
    { type: "rule", y: 0, labels: ["zero"] },
  ],
  tooltip: { mode: "shared" },           // "nearest" | "none"
  interactions: { brush: true, zoom: true },
});
plot.update(nextSpec); plot.exportCsv(); await plot.exportPng(); plot.dispose();
```

The spec is plain, JSON-serialisable data (columns: arrays or Float64Arrays). The
only functions are optional host formatters (`axes.*.tickFormat`, `tooltip.format`).
Times are UTC milliseconds; colours are hex or `rgb()`/`rgba()`.

## Marks

| type | data | notes |
| --- | --- | --- |
| `bar` | `x`, `y` | vertical or horizontal (`orient`, inferred from a band y); `stack` key stacks (positives up, negatives down), otherwise side by side; `mirror` draws on the other side of zero keeping the true value (call OI against put OI); `signColors`, `colors`, `strokes` + `strokeWidth` (an outline per bar), `opacity` (0..1, fill only, multiplied with each colour's own alpha), `base`, `labels` |
| `candle` | `x`, `open`, `high`, `low`, `close` | body and wick; `up` / `down` colours (default: the theme's); a bad candle (`high` below `open`, say) is refused, NaN leaves a gap; tooltip rows O, H, L, C; CSV columns `open`..`close` |
| `line` | `x`, `y` | `curve`: linear, step, stepBefore, stepAfter, monotone; `dash`, `points`; NaN breaks the line |
| `area` | `x`, `y`, `y0` | `y0` a level or a column; `split: { above, below }` fills each side of the baseline in its own colour; `gradient` fades the fill to nothing at a level baseline; `strokeColor`, `width` for the outline; `stack` |
| `errorBand` | `x`, `lo`, `hi` | dispersion band |
| `scatter` | `x`, `y` | shapes `circle`, `square`, `diamond`, `triangle`, `triangleDown`, `cross`; `size` column makes bubbles (`radius` px range, area scale); `colorValue` through `scales.color`; per-point `colors`, `shapes`, `opacities`, `hollow`, `states` (text in tooltip and CSV) |
| `histogram` | `values` | `bins`: count, `"fd"` (Freedman-Diaconis, nice edges), `"sturges"`, or edges; `density` |
| `heatmap` | `x`, `y`, `value` | band x and y; sequential or diverging `colorScale`; `labels` |
| `treemap` | `root` tree | squarified, nested groups with title strips; `colorBy: "group" \| "value"` (`colorValue` per node) |
| `rule` | `x` and/or `y` | reference lines with labels (a number between numeric band categories interpolates) |
| `band` | `x` and/or `y` range | shaded stripe |
| `text` | `x`, `y`, `text` | annotations; `chip` / `chips` (background, border, colour, padding, radius, `etch` hatching), `weights`, `anchor` (`radius` px or `from` a scatter mark's name), `avoid` (labels never overlap each other or other points: each tries top, bottom, right, left, the diagonals; one with no room is dropped, `order` sets priority) |

Scales: `linear`, `log`, `time` (calendar ticks in a zone), `band`, `point`, plus
`y2` for a second value axis and a colour scale (`sequential`, `diverging`).
Axis kinds are inferred from the data (strings make a band axis).

## Interaction

Tooltip (shared at the nearest x / category, or the nearest point; snapping),
crosshair, legend (click or keys 1-9 toggles series), brush (`interactions.brush`)
and wheel / pan zoom (`interactions.zoom`, opt-in so a plot never hijacks page
scrolling), double click resets, keyboard (arrows, Home/End, +/-, Escape, PageUp/Down
between facet cells), live-region announcements. `new PlotSyncGroup().add(a).add(b)`
shares the crosshair and zoom. Events: `plot.on("crosshair" | "view" | "brush" |
"legend" | "hover", fn)`.

## Chrome

- `axes.y.side: "right"` moves the primary axis (`y2` then takes the left); the grid and zero line stay with `y`. `axes.y2: false` hides the second axis but keeps its scale, so marks with `yAxis: "y2"` (a volume strip) stay on it.
- `axes.*.tickMarks: false`; `axes.y.width` (px) fixes the label gutter so synced plots line up; the first and last x labels are kept inside the chart.
- `padding` (a number or `{ top, right, bottom, left }`) replaces the built-in margins.
- A mark's `tooltip: false` keeps it out of the tooltip, its dots and the keyboard stops. `tooltip.format` and the `hover` event get rows with `index` (into the mark's columns), `raw` (the number, unformatted) and `mark` (its name, or `line#1`); the content's `index` is that of its first datum row.
- `tooltip.title({ index, x, label })` titles the tooltip for the datum under the pointer (`x`: its number, time in ms or category; `label`: the title it replaces); `title: "axis"` titles a continuous x axis with its `tickFormat`. By default an axis `tickFormat` does not touch the title. `tooltip.confine: "plot"` keeps the tooltip inside the plot area (between the axes) instead of anywhere in the chart, so it does not cover a right-hand axis. The tooltip hides when the plot loses focus. `tooltip.swatch: false` drops the colour square before each row (one series).
- `axes.*.tickFormat(value, { step, values, index })`: the second argument is the tick step, every tick value and this tick's place, to pick a precision that keeps neighbours apart; a one-argument formatter works as before. The library always supplies the context; it is optional in the type, so direct callers may omit it. The built-in number labels add decimals (to 10) while two different ticks would read alike. `format: "compact"` is K / M / B, and K / L / Cr under an Indian `locale` (`"en-IN"`).
- Theme: `tooltipRadius` (CSS length, default `"4px"`), `tooltipShadow` (CSS `box-shadow` or `"none"`), the tooltip text is `tooltipFontSize` (CSS px, used as is) or else one px above `fontSize`, and `focusRing` (the keyboard outline; default `accent`). With `theme: "inherit"` they come from `--ac-tooltip-radius`, `--ac-tooltip-shadow`, `--ac-tooltip-font-size` and `--ac-ring` / `--ring`.
- `watermark` is a per-plot option; there is no global default, so set `{ watermark: { visible: false } }` where the specs are built.
- `decorative: true` (a sparkline in a list row): `aria-hidden`, no tab stop, no data table, no live region, no keyboard or document listeners. A theme `background` of `rgba(0,0,0,0)` makes it transparent. It cannot change in `update()`.
- `update()` keeps the tooltip under the pointer (looked up again in the new layout) and the synced crosshair. The screen-reader table is not rebuilt per update: it is refreshed when the plot gains focus or a second after the updates stop.

## Export and accessibility

`plot.exportCsv()` writes the data actually plotted (visible series only, as given,
no rounding); `plot.exportPng({ scale })` draws the chart at that scale. The chart
is a focusable `role="group"` with a visually hidden data table (inside a clipped
`div`: a `<table>` ignores `overflow:hidden`) built from the same rows as the CSV.
Strings go through the `messages` function, like the core's.

## Wrappers

`@alphacharts/react/plot` (`<Plot spec/>`, `<PlotSync>`, `usePlot`),
`@alphacharts/vue/plot` (`<AcPlot>`, `<AcPlotSync>`, `usePlot`) and
`@alphacharts/svelte/plot` (`<Plot>`, `<PlotSync>`, `usePlot`). Memoise the spec (React),
and keep it out of deep reactivity (`$state.raw` in Svelte): the wrappers redraw when a
top-level entry of the spec changes identity.

## Performance

Canvas2D, device-pixel-snapped edges. Dense lines and areas draw first, min, max and
last per device-pixel column. 10k line points plus 10k dots at DPR 2: about 7 ms per
full draw, 2 ms per hover (`pnpm bench`, `bench/results/plot-perf.json`). A replay tick
(`update()` on two charts of 2,000 points, then their draws): about 1 ms and 3 ms
(`bench/results/plot-update.json`).
