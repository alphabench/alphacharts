<script lang="ts">
  import { createChart, type Chart as CoreChart, type ChartOptionsInput } from "@alphacharts/core";
  import type { Snippet } from "svelte";
  import { provideChart } from "./context.svelte.js";
  import { mountChart, type ChartEventProps } from "./host.svelte.js";

  interface Props extends ChartEventProps {
    /** Chart options. `renderer` is read when the chart is created. */
    options?: ChartOptionsInput | undefined;
    /** The core chart: null until mounted and always null on the server. Bindable. */
    chart?: CoreChart | null;
    class?: string | undefined;
    style?: string | undefined;
    /** `<Series>` and anything else drawn beside the chart. */
    children?: Snippet;
  }

  let { options, chart = $bindable(null), class: className, style, children, ...events }: Props = $props();
  let host: HTMLDivElement | undefined = $state();
  const cell = provideChart();

  mountChart({
    host: () => host,
    options: () => options,
    make: () => createChart,
    events: () => events,
    cell,
    publish: (c) => (chart = c),
  });
</script>

<div bind:this={host} class={className} {style}>{@render children?.()}</div>
