# @alphacharts/core

The alphacharts engine: WebGL2 series (candles, line, area, histogram, ...), Canvas2D text, panes, price and time
scales, crosshair, markers, price lines, synced charts and a datafeed driver. No runtime dependencies. WebGL2 is
used when available, with a Canvas2D fallback (`renderer: "auto" | "webgl" | "canvas2d"`).

```
npm install @alphacharts/core
```

```ts
import { createChart } from "@alphacharts/core";

const chart = createChart(el, { theme: "dark", timeZone: "UTC" });
const candles = chart.addSeries("candles", { priceFormat: { type: "price", minMove: 0.05 } });
candles.setData(bars);   // [{ time, open, high, low, close }], time in UTC ms
candles.update(bar);     // live: same time replaces, later time appends
chart.createPriceLine(candles, { price: 100, title: "target" });
```

Colour individual candles or bars, and shade a pane's background per bar:

```ts
candles.setBarColors({ time: Float64Array.of(t1, t2), color: Uint32Array.of(0xffd835ff, 0) }); // 0xRRGGBBAA, 0 = the up/down colours
candles.clearBarColors();                                   // exactly as before, column and all
candles.attachPrimitive(new BarShading());                   // .set(times, colors) / .setAt(time, color): behind the series, no part in autoscale
```

A bar's colour belongs to (series, time): `update`, `prepend` and `setData` keep the colours of the bars they keep, `OhlcBar.color` and
`ColumnarOhlc.color` set them from the data. The colour column is added to the store, and to the level-of-detail pyramid (a bucket takes the last coloured
bar's colour), the first time a colour is written; a series never coloured has no such column, and its candle and bar shaders do one
integer compare per vertex on the colour slot every GPU record already carries (no added buffer). A value series' points
may carry their own colour too (`ValuePoint.color`), which the line renderers draw per segment (the colour of the point the segment arrives at), in WebGL and Canvas2D.
`DataChange.kind` has a new value, `"color"`, announced to renderers only: plugins such as studies are not told, because nothing they follow moved.

The crosshair line is a dashed hairline by default; `crosshair: { lineStyle: "solid", lineWidth: 2 }` changes it (`lineStyle` takes the names a
price line does; `lineWidth` is 1 or 2 CSS px). The chart takes keyboard focus (Tab) and draws a 2 px ring on it, only for keyboard focus
(`:focus-visible`), in `theme.focusRing` (default: the crosshair colour; under `theme: "inherit"`, `--ac-ring` then `--ring`).
On an engine without `:focus-visible` support the ring shows on pointer focus too. Set `focusRing: "transparent"` in the theme to draw none.

Hide the Alphabench brand mark with `createChart(el, { watermark: { visible: false } })`.

`@alphacharts/core/internal` exposes rendering internals for the sibling series packages (`chart-types`,
`orderflow`). It is not public API and changes without notice.

See the [repository README](https://github.com/alphabench/alphacharts#readme) for the full guide. MIT licence.
