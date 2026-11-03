<script lang="ts">
  import { Chart, Dashboard, DashboardCell, PriceLine, Series, SyncGroup } from "@alphacharts/svelte";
  import type { OhlcBar, ValuePoint } from "@alphacharts/core";
  import { flushSync } from "svelte";
  import { CELLS, cellData, history, Stream } from "../../example-shared/data.js";
  import { autoTicks } from "../../example-shared/track.js";
  import Track from "./Track.svelte";

  // $state.raw: bars are read by the engine, so they stay out of Svelte's deep proxy.
  const data = history();
  const cells = CELLS.map((c) => ({ ...c, data: cellData(c) as never }));
  const last = data.candles[data.candles.length - 1]!;
  let bar = $state.raw<OhlcBar>();
  let volume = $state.raw<ValuePoint>();
  let ticks = $state(0);
  const priceFormat = { type: "price", minMove: 0.05 } as const;
  const chartOptions = { theme: "dark", timeZone: "UTC" } as const;

  const stream = new Stream(last);
  const tick = () => {
    const t = stream.next();
    // One tick per flush: the live bar goes through <Series update>, one series.update() each.
    bar = t.bar;
    volume = t.volume;
    ticks++;
    flushSync();
  };

  $effect(() => {
    window.__tick = async (k) => {
      for (let i = 0; i < k; i++) tick();
    };
    const id = autoTicks() ? setInterval(tick, 100) : undefined;
    return () => clearInterval(id);
  });
</script>

<div class="page">
  <header>
    <b>Svelte</b>
    <span>candles + volume, live ticks, price line, synced dashboard</span>
    <span class="stat" id="stat">{ticks} ticks</span>
  </header>
  <section class="main">
    <Chart class="fill" options={chartOptions}>
      <Track />
      <Series type="candles" data={data.candles} update={bar} options={{ title: "SYNTH", priceFormat }}>
        <PriceLine price={last.close * 0.9985} color="#f7a600" title="target" />
      </Series>
      <Series
        type="histogram"
        data={data.volume}
        update={volume}
        options={{ priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false, priceFormat: { type: "volume" } }}
        priceScale={{ marginTop: 0.8, marginBottom: 0 }}
      />
    </Chart>
  </section>
  <section class="dash">
    <Dashboard class="fill cells">
      <SyncGroup>
        {#each cells as c (c.id)}
          <DashboardCell options={chartOptions}>
            <Track />
            <Series type={c.type} data={c.data} options={{ title: c.id, priceFormat }} />
          </DashboardCell>
        {/each}
      </SyncGroup>
    </Dashboard>
  </section>
</div>
