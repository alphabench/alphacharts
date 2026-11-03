<script lang="ts">
  // Records the enclosing chart for the browser tests.
  import { useChart } from "@alphacharts/svelte";
  import { track } from "../../example-shared/track.js";
  const chart = useChart();
  $effect(() => track(chart.current));
</script>
