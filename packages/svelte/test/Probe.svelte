<script lang="ts">
  import { useChart, useCrosshair, useVisibleRange } from "../src/index.js";
  const chart = useChart();
  const x = useCrosshair();
  const r = useVisibleRange();
  let { seen }: { seen: { chart: unknown } } = $props();
  $effect(() => void (seen.chart = chart.current));
</script>

<output>{x.current?.time ?? "-"}|{r.current ? `${r.current.from},${r.current.to}` : "-"}</output>
