import type { Chart as CoreChart, CrosshairEvent, Dashboard as CoreDashboard, VisibleRangeEvent } from "@alphacharts/core";
import { useContext, useEffect, useState } from "react";
import { ChartContext, DashboardContext } from "./context.js";

/** The enclosing chart: null until it has mounted (and on the server). Throws outside a `<Chart>`/`<DashboardCell>`. */
export function useChart(): CoreChart | null {
  const chart = useContext(ChartContext);
  if (chart === undefined) throw new Error("alphacharts: useChart() must be called inside <Chart> or <DashboardCell>");
  return chart;
}

/** The enclosing dashboard: null until it has mounted. Throws outside a `<Dashboard>`. */
export function useDashboard(): CoreDashboard | null {
  const d = useContext(DashboardContext);
  if (d === undefined) throw new Error("alphacharts: useDashboard() must be called inside <Dashboard>");
  return d;
}

/**
 * The latest crosshair event of the enclosing chart (undefined until the
 * pointer, keyboard or a synced chart moves it). Re-renders its component on
 * every move: use it in a small readout, not around the chart.
 */
export function useCrosshair(): CrosshairEvent | undefined {
  const chart = useChart();
  const [event, setEvent] = useState<CrosshairEvent | undefined>(undefined);
  useEffect(() => {
    if (!chart) return;
    return chart.on("crosshairMove", setEvent);
  }, [chart]);
  return event;
}

/** The visible logical range of the enclosing chart; updates when the view moves. */
export function useVisibleRange(): { from: number; to: number } | undefined {
  const chart = useChart();
  const [range, setRange] = useState<{ from: number; to: number } | undefined>(undefined);
  useEffect(() => {
    if (!chart) return;
    setRange(chart.timeScale.getVisibleLogicalRange());
    return chart.on("visibleRangeChange", (e: VisibleRangeEvent) => setRange({ from: e.from, to: e.to }));
  }, [chart]);
  return range;
}
