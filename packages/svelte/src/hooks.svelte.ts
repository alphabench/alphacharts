import type { Chart as CoreChart, CrosshairEvent, Dashboard as CoreDashboard } from "@alphacharts/core";
import { chartCell, dashboardCell } from "./context.svelte.js";

/** The enclosing chart: `.current` is null until it has mounted (and on the server). Throws outside a `<Chart>`/`<DashboardCell>`. */
export function useChart(): { readonly current: CoreChart | null } {
  const cell = chartCell();
  if (!cell) throw new Error("alphacharts: useChart() must be called in a component inside <Chart> or <DashboardCell>");
  return cell;
}

/** The enclosing dashboard: `.current` is null until it has mounted. Throws outside a `<Dashboard>`. */
export function useDashboard(): { readonly current: CoreDashboard | null } {
  const cell = dashboardCell();
  if (!cell) throw new Error("alphacharts: useDashboard() must be called in a component inside <Dashboard>");
  return cell;
}

/**
 * The latest crosshair event of the enclosing chart (`.current` is undefined
 * until the pointer, keyboard or a synced chart moves it). Updates on every
 * move: read it in a small readout, not around the chart.
 */
export function useCrosshair(): { readonly current: CrosshairEvent | undefined } {
  const chart = useChart();
  let event: CrosshairEvent | undefined = $state.raw(undefined);
  $effect(() => {
    const c = chart.current;
    if (!c) return;
    return c.on("crosshairMove", (e) => (event = e));
  });
  return {
    get current() {
      return event;
    },
  };
}

/** The visible logical range of the enclosing chart; `.current` updates when the view moves. */
export function useVisibleRange(): { readonly current: { from: number; to: number } | undefined } {
  const chart = useChart();
  let range: { from: number; to: number } | undefined = $state.raw(undefined);
  $effect(() => {
    const c = chart.current;
    if (!c) return;
    range = c.timeScale.getVisibleLogicalRange();
    return c.on("visibleRangeChange", (e) => (range = { from: e.from, to: e.to }));
  });
  return {
    get current() {
      return range;
    },
  };
}
