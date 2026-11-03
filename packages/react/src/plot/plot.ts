import { createPlot, type Plot as CorePlot, type PlotEvents, type PlotSpec, type PlotSyncGroup } from "@alphacharts/plot";
import { createElement, forwardRef, useContext, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type Ref, type RefObject } from "react";
import { PlotSyncContext } from "./sync.js";

export interface PlotEventProps {
  onCrosshair?: ((e: PlotEvents["crosshair"]) => void) | undefined;
  onViewChange?: ((e: PlotEvents["view"]) => void) | undefined;
  onBrush?: ((e: PlotEvents["brush"]) => void) | undefined;
  onLegendToggle?: ((e: PlotEvents["legend"]) => void) | undefined;
  onHover?: ((e: PlotEvents["hover"]) => void) | undefined;
}

export interface PlotProps extends PlotEventProps {
  /** The spec. Memoise it: a new top-level `marks` array each render redraws each render. */
  spec: PlotSpec;
  /** An explicit sync group; wins over the nearest `<PlotSync>`. */
  sync?: PlotSyncGroup | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
}

/** Same top-level entries (by identity): an inline spec literal over the same data arrays costs nothing. */
function sameSpec(a: PlotSpec | undefined, b: PlotSpec): boolean {
  if (!a) return false;
  const ka = Object.keys(a) as (keyof PlotSpec)[], kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && Object.is(a[k], b[k]));
}

/** Subscribe only while a handler is present; a new closure each render does not resubscribe. */
function useEvent<K extends keyof PlotEvents>(plot: CorePlot | null, type: K, fn: ((e: PlotEvents[K]) => void) | undefined): void {
  const latest = useRef(fn);
  latest.current = fn;
  const has = fn !== undefined;
  useEffect(() => {
    if (!plot || !has) return;
    return plot.on(type, (e) => latest.current?.(e));
  }, [plot, type, has]);
}

/**
 * Create a plot in the element `ref` points at once mounted (never on the
 * server), keep it in step with `spec`, join the sync group and forward events.
 * `plot` is null until mounted and on the server.
 */
export function usePlot(spec: PlotSpec, events: PlotEventProps = {}, sync?: PlotSyncGroup): { ref: RefObject<HTMLDivElement | null>; plot: CorePlot | null } {
  const ref = useRef<HTMLDivElement>(null);
  const [plot, setPlot] = useState<CorePlot | null>(null);
  const latest = useRef(spec);
  latest.current = spec;
  const applied = useRef<PlotSpec | undefined>(undefined);
  const ctx = useContext(PlotSyncContext);
  const group = sync ?? ctx;

  useEffect(() => {
    const p = createPlot(ref.current!, latest.current);
    applied.current = latest.current;
    setPlot(p);
    return () => {
      p.dispose();
      setPlot(null);
    };
  }, []);

  useEffect(() => {
    if (!plot || sameSpec(applied.current, spec)) return;
    applied.current = spec;
    plot.update(spec);
  }, [plot, spec]);

  useEffect(() => {
    if (!plot || !group) return;
    group.add(plot);
    return () => void group.remove(plot);
  }, [plot, group]);

  useEvent(plot, "crosshair", events.onCrosshair);
  useEvent(plot, "view", events.onViewChange);
  useEvent(plot, "brush", events.onBrush);
  useEvent(plot, "legend", events.onLegendToggle);
  useEvent(plot, "hover", events.onHover);
  return { ref, plot };
}

/**
 * A plot. The ref is the core `Plot` (null until mounted; always null on the
 * server). Give the element a size through `className`/`style`, or the spec a
 * width and height.
 */
export const Plot = forwardRef<CorePlot | null, PlotProps>(function Plot({ spec, sync, className, style, ...events }, ref) {
  const { ref: host, plot } = usePlot(spec, events, sync);
  useImperativeHandle(ref, () => plot as CorePlot, [plot]);
  return createElement("div", { ref: host, className, style });
});

export type PlotRef = Ref<CorePlot | null>;
