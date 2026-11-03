<script lang="ts">
  import { Plot, PlotSync } from "../src/plot/index.js";
  let { spec, a, b, group }: { spec: never; a?: never; b?: never; group?: never } = $props();
</script>

<PlotSync>
  <Plot {spec} onCrosshair={a} />
  <Plot {spec} onBrush={b} sync={group} class="p" />
</PlotSync>
