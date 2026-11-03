<script lang="ts">
  import { Chart, SyncGroup } from "../src/index.js";
  let { crosshair, count = 1 }: { crosshair?: boolean | undefined; count?: number } = $props();
</script>

<SyncGroup {crosshair}>
  {#each Array.from({ length: count }, (_, i) => i) as i (i)}<Chart />{/each}
</SyncGroup>
