import type { PriceScaleOptions, Series as CoreSeries, SeriesBar, SeriesInput, SeriesOptions, SeriesType } from "@alphacharts/core";
import { createElement, forwardRef, useContext, useEffect, useImperativeHandle, useRef, useState, type ReactElement, type ReactNode, type Ref } from "react";
import { ChartContext, SeriesContext } from "./context.js";
import { diffOptions } from "./options.js";

export interface SeriesProps<T extends SeriesType> {
  /** Changing the type replaces the series. */
  type: T;
  /** Applied with `series.applyOptions` as a shallow diff. `id`, `pane` and `priceScaleId` are honoured at creation and on change. */
  options?: Partial<SeriesOptions<T>> | undefined;
  /** Options of the price scale this series is drawn on (its `priceScaleId`, in its pane), applied as a shallow diff. Re-applied in full when the series moves pane or scale; not re-applied after a chart-level `rightPriceScale`/`leftPriceScale` option change. */
  priceScale?: Partial<PriceScaleOptions> | undefined;
  /**
   * The whole data set. A new array calls `setData`, so keep it stable between
   * live ticks. Leaving it undefined (or setting it to undefined later) does not clear the series.
   */
  data?: SeriesInput<T> | undefined;
  /**
   * The live bar: each new value calls `series.update` (same time replaces the
   * last bar, a later time appends). O(1); never touches the rest of the data.
   */
  update?: SeriesBar<T> | undefined;
  /** `<PriceLine>`s of this series. */
  children?: ReactNode;
}

function SeriesImpl<T extends SeriesType>({ type, options, priceScale, data, update, children }: SeriesProps<T>, ref: Ref<CoreSeries<T> | null>) {
  const chart = useContext(ChartContext);
  if (chart === undefined) throw new Error("alphacharts: <Series> must be inside <Chart>");
  const [series, setSeries] = useState<CoreSeries<T> | null>(null);
  const latest = useRef(options);
  latest.current = options;
  // The series the effects act on is read from this ref, not from `series` state: when `type`
  // and `data` change in one commit, the creation effect has already swapped the series but the
  // state (and so the other effects' closures) still holds the removed one.
  const cur = useRef<{ series: CoreSeries<T>; options: Partial<SeriesOptions<T>> | undefined; scale: Partial<PriceScaleOptions> | undefined; scaleKey: string; data: unknown; update: unknown } | null>(null);

  useEffect(() => {
    if (!chart) return;
    const opts = latest.current;
    const s = chart.addSeries(type, opts);
    cur.current = { series: s, options: opts, scale: undefined, scaleKey: "", data: undefined, update: undefined };
    setSeries(s);
    return () => {
      // A removed chart already dropped its series.
      if (!chart.isRemoved) chart.removeSeries(s);
      cur.current = null;
      setSeries(null);
    };
  }, [chart, type]);

  useEffect(() => {
    const c = cur.current;
    if (!c) return;
    const diff = diffOptions(c.options, options);
    c.options = options;
    if (diff) c.series.applyOptions(diff);
  }, [series, options]);

  // A scale is rebuilt when the series changes pane or scale id: the full options go to the new one.
  useEffect(() => {
    const c = cur.current;
    if (!chart || !c) return;
    const { priceScaleId, pane } = c.series.options();
    const key = `${pane}:${priceScaleId}`;
    const diff = diffOptions(key === c.scaleKey ? c.scale : undefined, priceScale);
    c.scale = priceScale;
    c.scaleKey = key;
    if (diff) chart.priceScale(priceScaleId, pane).applyOptions(diff);
  }, [chart, series, priceScale, options?.pane, options?.priceScaleId]);

  // Declared before the update effect: a fresh series gets its history, then the live bar.
  useEffect(() => {
    const c = cur.current;
    if (c && data !== undefined && c.data !== data) {
      c.data = data;
      c.series.setData(data);
    }
  }, [series, data]);

  useEffect(() => {
    const c = cur.current;
    if (c && update !== undefined && c.update !== update) {
      c.update = update;
      c.series.update(update);
    }
  }, [series, update]);

  useImperativeHandle(ref, () => series as CoreSeries<T>, [series]);
  return createElement(SeriesContext.Provider, { value: series as CoreSeries<SeriesType> | null }, children);
}

/** A series on the nearest `<Chart>`. The ref is the core `Series` (null until mounted). */
export const Series = forwardRef(SeriesImpl) as <T extends SeriesType>(props: SeriesProps<T> & { ref?: Ref<CoreSeries<T> | null> }) => ReactElement | null;
