# @alphacharts/react

React bindings for AlphaCharts: `<Chart>`, `<Series>`, `<PriceLine>`, `<Dashboard>`, `<DashboardCell>`,
`<SyncGroup>` and the hooks `useChart`, `useCrosshair`, `useDashboard`, `useVisibleRange`. The `/plot` entry has
`<Plot>` (needs `@alphacharts/plot`). React 18 or newer.

```
npm install @alphacharts/react @alphacharts/core
```

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

Keep `data` stable between ticks (a new array calls `setData`); pass the forming bar as `update`. MIT licence.
