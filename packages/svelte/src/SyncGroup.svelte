<script lang="ts">
  import { SyncGroup as CoreSyncGroup } from "@alphacharts/core";
  import type { Snippet } from "svelte";
  import { provideSync } from "./context.svelte.js";

  // `time` and `crosshair` (both default true) are read when the group is made;
  // changing one makes a new group and the charts re-join it. Renders only its children.
  interface Props {
    time?: boolean | undefined;
    crosshair?: boolean | undefined;
    children?: Snippet;
  }

  let { time, crosshair, children }: Props = $props();
  const group = $derived(new CoreSyncGroup({ ...(time !== undefined && { time }), ...(crosshair !== undefined && { crosshair }) }));
  provideSync({
    get current() {
      return group;
    },
  });
</script>

{@render children?.()}
