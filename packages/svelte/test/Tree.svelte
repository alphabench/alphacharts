<script lang="ts">
  // A fixed tree for the tests: Chart > Series > PriceLine, every part driven by props.
  import { Chart, PriceLine, Series } from "../src/index.js";
  import type { Chart as CoreChart, Series as CoreSeries } from "@alphacharts/core";

  let { chartOptions, seriesType = "candles", seriesOptions, priceScale, data, update, price, withSeries = true, onCrosshairMove, onClick, onDblClick, onVisibleRangeChange, chart = $bindable(null), series = $bindable(null) }: Record<string, any> = $props();
</script>

<Chart options={chartOptions} {onCrosshairMove} {onClick} {onDblClick} {onVisibleRangeChange} bind:chart>
  {#if withSeries}
    <Series type={seriesType} options={seriesOptions} {priceScale} {data} {update} bind:series>
      {#if price !== undefined}<PriceLine {price} color="#f00" />{/if}
    </Series>
  {/if}
</Chart>
