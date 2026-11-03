# @alphacharts/orderflow

Order-flow for `@alphacharts/core`: a trade store, bars with per-level volume, footprint series, volume profile,
TPO and cumulative volume delta. Trades follow the core's `Trade` shape
(`{ time, price, size, side: "buy" | "sell" | "unknown" }`, time in UTC ms); a side is never guessed.

```
npm install @alphacharts/orderflow @alphacharts/core
```

```ts
import { createChart } from "@alphacharts/core";
import { OrderFlow, attachFootprint } from "@alphacharts/orderflow";

const flow = new OrderFlow({ tickSize: 0.05, periodMs: 5 * 60_000 });
flow.addMany(trades);                 // history, then flow.add(trade) live

const chart = createChart(el, { theme: "dark", timeZone: "UTC" });
const footprint = attachFootprint(chart, flow);
// footprint.dispose() when done
```

`@alphacharts/core` is a peer dependency. MIT licence.
