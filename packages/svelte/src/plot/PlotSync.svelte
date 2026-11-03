<script lang="ts">
  import { PlotSyncGroup } from "@alphacharts/plot";
  import type { Snippet } from "svelte";
  import { providePlotSync } from "./context.svelte.js";

  // `view` (default true: share the zoomed x range as well as the crosshair) is read when the
  // group is made; changing it makes a new group and the plots re-join it. Renders only its children.
  interface Props {
    view?: boolean | undefined;
    children?: Snippet;
  }

  let { view, children }: Props = $props();
  const group = $derived(new PlotSyncGroup({ ...(view !== undefined && { view }) }));
  providePlotSync({
    get current() {
      return group;
    },
  });
</script>

{@render children?.()}
