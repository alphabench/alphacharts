# @alphacharts/vue

Vue 3 bindings for AlphaCharts: `AcChart`, `AcSeries`, `AcPriceLine`, `AcDashboard`, `AcDashboardCell`,
`AcSyncGroup` and the composables `useChart`, `useCrosshair`, `useDashboard`, `useVisibleRange`. The `/plot`
entry has the plot component (needs `@alphacharts/plot`). Vue 3.4 or newer.

```
npm install @alphacharts/vue @alphacharts/core
```

```vue
<script setup lang="ts">
import { AcChart, AcSeries, AcPriceLine } from "@alphacharts/vue";
defineProps<{ bars: unknown[]; live?: unknown }>();
</script>

<template>
  <AcChart style="height: 400px" :options="{ theme: 'dark', timeZone: 'UTC' }">
    <AcSeries type="candles" :data="bars" :update="live" :options="{ title: 'SYNTH' }">
      <AcPriceLine :price="100" color="#f7a600" title="target" />
    </AcSeries>
  </AcChart>
</template>
```

Keep `data` stable between ticks (a new array calls `setData`); pass the forming bar as `update`. MIT licence.
