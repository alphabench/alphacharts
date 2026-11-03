import { createChart, type Chart as CoreChart, type ChartEvents, type ChartOptionsInput } from "@alphacharts/core";
import {
  createElement, forwardRef, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState,
  type CSSProperties, type ReactNode, type Ref, type RefObject,
} from "react";
import { ChartContext, DashboardContext, SyncContext } from "./context.js";
import { diffOptions } from "./options.js";

export interface ChartEventProps {
  onCrosshairMove?: ((e: ChartEvents["crosshairMove"]) => void) | undefined;
  onClick?: ((e: ChartEvents["click"]) => void) | undefined;
  onDblClick?: ((e: ChartEvents["dblclick"]) => void) | undefined;
  onVisibleRangeChange?: ((e: ChartEvents["visibleRangeChange"]) => void) | undefined;
}

export interface ChartProps extends ChartEventProps {
  /** Chart options. `renderer` is read when the chart is created. */
  options?: ChartOptionsInput | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  children?: ReactNode;
}

/**
 * Create a chart in `host` once mounted, keep its options in step with
 * `options`, join the nearest SyncGroup and forward the event props. Returns
 * the chart (null on the server and before mount).
 */
function useCoreChart(host: RefObject<HTMLDivElement | null>, options: ChartOptionsInput | undefined, events: ChartEventProps, make: ((el: HTMLElement, o: ChartOptionsInput) => CoreChart) | null): CoreChart | null {
  const [chart, setChart] = useState<CoreChart | null>(null);
  const latest = useRef(options);
  latest.current = options;
  const applied = useRef<ChartOptionsInput | undefined>(undefined);
  const sync = useContext(SyncContext);

  useEffect(() => {
    if (!make) return;
    const opts = latest.current;
    const c = make(host.current!, opts ?? {});
    applied.current = opts;
    setChart(c);
    return () => {
      c.remove();
      setChart(null);
    };
  }, [host, make]);

  useEffect(() => {
    if (!chart) return;
    const diff = diffOptions(applied.current, options);
    applied.current = options;
    if (diff) chart.applyOptions(diff);
  }, [chart, options]);

  useEffect(() => {
    if (!chart || !sync) return;
    sync.add(chart);
    return () => sync.remove(chart);
  }, [chart, sync]);

  // Handlers are read through a ref so a new closure each render does not resubscribe;
  // core skips building an event when nothing listens, so only present handlers subscribe.
  const handlers = useRef(events);
  handlers.current = events;
  const has = { crosshairMove: !!events.onCrosshairMove, click: !!events.onClick, dblclick: !!events.onDblClick, visibleRangeChange: !!events.onVisibleRangeChange };
  useEffect(() => {
    if (!chart || !has.crosshairMove) return;
    return chart.on("crosshairMove", (e) => handlers.current.onCrosshairMove?.(e));
  }, [chart, has.crosshairMove]);
  useEffect(() => {
    if (!chart || !has.click) return;
    return chart.on("click", (e) => handlers.current.onClick?.(e));
  }, [chart, has.click]);
  useEffect(() => {
    if (!chart || !has.dblclick) return;
    return chart.on("dblclick", (e) => handlers.current.onDblClick?.(e));
  }, [chart, has.dblclick]);
  useEffect(() => {
    if (!chart || !has.visibleRangeChange) return;
    return chart.on("visibleRangeChange", (e) => handlers.current.onVisibleRangeChange?.(e));
  }, [chart, has.visibleRangeChange]);

  return chart;
}

function render(host: RefObject<HTMLDivElement | null>, chart: CoreChart | null, props: { className?: string | undefined; style?: CSSProperties | undefined; children?: ReactNode }) {
  // Children (Series, PriceLine, overlays) sit beside the chart's own root inside the host.
  return createElement("div", { ref: host, className: props.className, style: props.style }, createElement(ChartContext.Provider, { value: chart }, props.children));
}

/**
 * A chart. The ref is the core `Chart` (null until mounted; always null on the
 * server). The element needs a size: give it one through `className`/`style`.
 */
export const Chart = forwardRef<CoreChart | null, ChartProps>(function Chart({ options, className, style, children, ...events }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useCoreChart(host, options, events, createChart);
  useImperativeHandle(ref, () => chart as CoreChart, [chart]);
  return render(host, chart, { className, style, children });
});

/** One cell of a `<Dashboard>`: a chart drawn into the dashboard's shared canvases. */
export const DashboardCell = forwardRef<CoreChart | null, ChartProps>(function DashboardCell({ options, className, style, children, ...events }, ref) {
  const dashboard = useContext(DashboardContext);
  if (dashboard === undefined) throw new Error("alphacharts: <DashboardCell> must be inside <Dashboard>");
  const host = useRef<HTMLDivElement>(null);
  // The dashboard exists only after its own mount; until then the cell is empty.
  const make = useMemo(() => (dashboard ? (el: HTMLElement, o: ChartOptionsInput) => dashboard.addChart(el, o) : null), [dashboard]);
  const chart = useCoreChart(host, options, events, make);
  useImperativeHandle(ref, () => chart as CoreChart, [chart]);
  return render(host, chart, { className, style, children });
});

export type ChartRef = Ref<CoreChart | null>;
