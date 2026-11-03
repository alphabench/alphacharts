<script setup lang="ts">
import { AcChart, AcDashboard, AcDashboardCell, AcPriceLine, AcSeries, AcSyncGroup } from "@alphacharts/vue";
import type { OhlcBar, ValuePoint } from "@alphacharts/core";
import { nextTick, onMounted, onUnmounted, ref, shallowRef } from "vue";
import { CELLS, cellData, history, Stream } from "../../example-shared/data.js";
import { autoTicks } from "../../example-shared/track.js";
import Track from "./Track.js";

// Plain (non-reactive) arrays: a deep ref would proxy every bar.
const data = history();
const cells = CELLS.map((c) => ({ ...c, data: cellData(c) as never }));
const last = data.candles[data.candles.length - 1]!;
const bar = shallowRef<OhlcBar>();
const volume = shallowRef<ValuePoint>();
const ticks = ref(0);
const priceFormat = { type: "price", minMove: 0.05 } as const;
const chartOptions = { theme: "dark", timeZone: "UTC" } as const;

let timer: ReturnType<typeof setInterval> | undefined;
const stream = new Stream(last);
const tick = () => {
  const t = stream.next();
  // One tick per render: the live bar goes through <AcSeries :update>, one series.update() each.
  bar.value = t.bar;
  volume.value = t.volume;
  ticks.value++;
};
onMounted(() => {
  window.__tick = async (k) => {
    for (let i = 0; i < k; i++) {
      tick();
      await nextTick();
    }
  };
  if (autoTicks()) timer = setInterval(tick, 100);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <div class="page">
    <header>
      <b>Vue</b>
      <span>candles + volume, live ticks, price line, synced dashboard</span>
      <span class="stat" id="stat">{{ ticks }} ticks</span>
    </header>
    <section class="main">
      <AcChart class="fill" :options="chartOptions">
        <Track />
        <AcSeries type="candles" :data="data.candles" :update="bar" :options="{ title: 'SYNTH', priceFormat }">
          <AcPriceLine :price="last.close * 0.9985" color="#f7a600" title="target" />
        </AcSeries>
        <AcSeries
          type="histogram"
          :data="data.volume"
          :update="volume"
          :options="{ priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false, priceFormat: { type: 'volume' } }"
          :price-scale="{ marginTop: 0.8, marginBottom: 0 }"
        />
      </AcChart>
    </section>
    <section class="dash">
      <AcDashboard class="fill cells">
        <AcSyncGroup>
          <AcDashboardCell v-for="c in cells" :key="c.id" :options="chartOptions">
            <Track />
            <AcSeries :type="c.type" :data="c.data" :options="{ title: c.id, priceFormat }" />
          </AcDashboardCell>
        </AcSyncGroup>
      </AcDashboard>
    </section>
  </div>
</template>
