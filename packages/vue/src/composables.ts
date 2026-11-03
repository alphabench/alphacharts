import type { Chart as CoreChart, CrosshairEvent, Dashboard as CoreDashboard } from "@alphacharts/core";
import { inject, shallowRef, watch, type ShallowRef } from "vue";
import { CHART_KEY, DASHBOARD_KEY } from "./keys.js";

/** The enclosing chart as a ref: null until it has mounted (and on the server). Throws outside an `<AcChart>`/`<AcDashboardCell>`. */
export function useChart(): ShallowRef<CoreChart | null> {
  const chart = inject(CHART_KEY, null);
  if (!chart) throw new Error("alphacharts: useChart() must be called in a component inside <AcChart> or <AcDashboardCell>");
  return chart;
}

/** The enclosing dashboard as a ref: null until it has mounted. Throws outside an `<AcDashboard>`. */
export function useDashboard(): ShallowRef<CoreDashboard | null> {
  const d = inject(DASHBOARD_KEY, null);
  if (!d) throw new Error("alphacharts: useDashboard() must be called in a component inside <AcDashboard>");
  return d;
}

/**
 * The latest crosshair event of the enclosing chart (undefined until the
 * pointer, keyboard or a synced chart moves it). Updates on every move: read
 * it in a small readout, not around the chart.
 */
export function useCrosshair(): ShallowRef<CrosshairEvent | undefined> {
  const chart = useChart();
  const event = shallowRef<CrosshairEvent | undefined>(undefined);
  watch(
    chart,
    (c, _o, onCleanup) => {
      if (c) onCleanup(c.on("crosshairMove", (e) => (event.value = e)));
    },
    { immediate: true, flush: "sync" },
  );
  return event;
}

/** The visible logical range of the enclosing chart; updates when the view moves. */
export function useVisibleRange(): ShallowRef<{ from: number; to: number } | undefined> {
  const chart = useChart();
  const range = shallowRef<{ from: number; to: number } | undefined>(undefined);
  watch(
    chart,
    (c, _o, onCleanup) => {
      if (!c) return;
      range.value = c.timeScale.getVisibleLogicalRange();
      onCleanup(c.on("visibleRangeChange", (e) => (range.value = { from: e.from, to: e.to })));
    },
    { immediate: true, flush: "sync" },
  );
  return range;
}
