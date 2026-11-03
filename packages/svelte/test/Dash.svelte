<script lang="ts">
  import { Dashboard, DashboardCell, Series, SyncGroup } from "../src/index.js";
  let { cells = 4 }: { cells?: number } = $props();
</script>

<Dashboard options={{ renderer: "auto" }}>
  <SyncGroup>
    {#each Array.from({ length: cells }, (_, i) => i) as i (i)}
      <DashboardCell options={{ theme: "dark" }}><Series type="line" /></DashboardCell>
    {/each}
  </SyncGroup>
</Dashboard>
