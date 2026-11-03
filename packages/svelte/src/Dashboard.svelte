<script lang="ts">
  import { Dashboard as CoreDashboard, type DashboardOptions } from "@alphacharts/core";
  import { untrack, type Snippet } from "svelte";
  import { provideDashboard } from "./context.svelte.js";
  import { snapshot } from "./options.js";

  interface Props {
    /** The renderer is read when the dashboard is created. */
    options?: Partial<DashboardOptions> | undefined;
    /** The core dashboard: null until mounted. Bindable. */
    dashboard?: CoreDashboard | null;
    class?: string | undefined;
    style?: string | undefined;
    /** `<DashboardCell>`s, laid out by your CSS (grid, flex, absolute). */
    children?: Snippet;
  }

  let { options, dashboard = $bindable(null), class: className, style, children }: Props = $props();
  let host: HTMLDivElement | undefined = $state();
  const cell = provideDashboard();

  $effect(() => {
    const el = host;
    if (!el) return;
    const d = untrack(() => new CoreDashboard(el, snapshot(options)));
    cell.current = d;
    dashboard = d;
    return () => {
      d.remove();
      cell.current = null;
      dashboard = null;
    };
  });
</script>

<div bind:this={host} class={className} {style}>{@render children?.()}</div>
