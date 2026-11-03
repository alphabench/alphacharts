# @alphacharts/svelte

Svelte 5 (runes) bindings for AlphaCharts: `Chart`, `Series`, `PriceLine`, `Dashboard`, `DashboardCell`,
`SyncGroup` and the hooks `useChart`, `useCrosshair`, `useDashboard`, `useVisibleRange`. The `/plot` entry has
the plot component (needs `@alphacharts/plot`).

```
npm install @alphacharts/svelte @alphacharts/core
```

```svelte
<script lang="ts">
  import { Chart, Series, PriceLine } from "@alphacharts/svelte";
  let { bars, live } = $props();
</script>

<Chart style="height: 400px" options={{ theme: "dark", timeZone: "UTC" }}>
  <Series type="candles" data={bars} update={live} options={{ title: "SYNTH" }}>
    <PriceLine price={100} color="#f7a600" title="target" />
  </Series>
</Chart>
```

Keep `data` stable between ticks (a new array calls `setData`); pass the forming bar as `update`. MIT licence.
