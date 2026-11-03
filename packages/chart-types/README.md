# @alphacharts/chart-types

More series types for `@alphacharts/core`: baseline, step line, columns, hi-lo, OHLC dots, line with markers,
bricks, Kagi and point-and-figure; plus the transforms Heikin-Ashi, Renko, range bars, line break, Kagi,
point-and-figure and tick/volume/dollar bars.

```
npm install @alphacharts/chart-types @alphacharts/core
```

```ts
import { createChart } from "@alphacharts/core";
import { HeikinAshi, registerAllChartTypes } from "@alphacharts/chart-types";

registerAllChartTypes();   // or register only the types you use

const chart = createChart(el, { theme: "dark", timeZone: "UTC" });
const ha = new HeikinAshi();
ha.pushAll(bars);          // bars: [{ time, open, high, low, close }]
chart.addSeries("candles").setData(ha.store.columns());
```

Event-based transforms (Renko, Kagi, point-and-figure, ...) sit on an ordinal axis: pass `ordinalTimeLabel` as the
chart's `timeLabel`. `@alphacharts/core` is a peer dependency. MIT licence.
