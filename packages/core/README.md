# @alphacharts/core

The alphacharts engine: WebGL2 series (candles, line, area, histogram, ...), Canvas2D text, panes, price and time
scales, crosshair, markers, price lines, synced charts and a datafeed driver. No runtime dependencies. WebGL2 is
required.

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

Hide the Alphabench brand mark with `createChart(el, { watermark: { visible: false } })`.

`@alphacharts/core/internal` exposes rendering internals for the sibling series packages (`chart-types`,
`orderflow`). It is not public API and changes without notice.

See the [repository README](https://github.com/alphabench/alphacharts#readme) for the full guide. MIT licence.
