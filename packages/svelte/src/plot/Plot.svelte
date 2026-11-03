<script lang="ts">
  import type { Plot as CorePlot, PlotSpec, PlotSyncGroup } from "@alphacharts/plot";
  import { usePlot, type PlotEventProps } from "./use-plot.svelte.js";

  interface Props extends PlotEventProps {
    /** The spec. Replace it (or its top-level entries) to redraw; do not mutate it in place. */
    spec: PlotSpec;
    /** An explicit sync group; wins over the nearest `<PlotSync>`. */
    sync?: PlotSyncGroup | undefined;
    /** The core plot: null until mounted and always null on the server. Bindable. */
    plot?: CorePlot | null;
    class?: string | undefined;
    style?: string | undefined;
  }

  let { spec, sync, plot = $bindable(null), class: className, style, ...events }: Props = $props();
  let host: HTMLDivElement | undefined = $state();
  const cell = usePlot(() => host, () => spec, () => events, () => sync);
  $effect(() => {
    plot = cell.current;
  });
</script>

<div bind:this={host} class={className} {style}></div>
