<script lang="ts">
  import type { Chart as CoreChart, ChartOptionsInput } from "@alphacharts/core";
  import type { Snippet } from "svelte";
  import { dashboardCell, provideChart } from "./context.svelte.js";
  import { mountChart, type ChartEventProps } from "./host.svelte.js";

  interface Props extends ChartEventProps {
    options?: ChartOptionsInput | undefined;
    /** The core chart: null until mounted. Bindable. */
    chart?: CoreChart | null;
    class?: string | undefined;
    style?: string | undefined;
    children?: Snippet;
  }

  let { options, chart = $bindable(null), class: className, style, children, ...events }: Props = $props();
  const dashboard = dashboardCell();
  if (!dashboard) throw new Error("alphacharts: <DashboardCell> must be inside <Dashboard>");
  let host: HTMLDivElement | undefined = $state();
  const cell = provideChart();

  mountChart({
    host: () => host,
    options: () => options,
    // The dashboard exists only after its own mount; until then the cell is empty.
    make: () => {
      const d = dashboard.current;
      return d ? (el, o) => d.addChart(el, o) : null;
    },
    events: () => events,
    cell,
    publish: (c) => (chart = c),
  });
</script>

<div bind:this={host} class={className} {style}>{@render children?.()}</div>
