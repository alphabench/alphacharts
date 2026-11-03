<script lang="ts" generics="T extends SeriesType">
  import type { PriceScaleOptions, Series as CoreSeries, SeriesBar, SeriesInput, SeriesOptions, SeriesType } from "@alphacharts/core";
  import { untrack, type Snippet } from "svelte";
  import { chartCell, provideSeries } from "./context.svelte.js";
  import { diffOptions, snapshot } from "./options.js";

  interface Props {
    /** Changing the type replaces the series. */
    type: T;
    /** Applied with `series.applyOptions` as a shallow diff (one nested group deep). */
    options?: Partial<SeriesOptions<T>> | undefined;
    /** Options of the price scale this series is drawn on (its `priceScaleId`, in its pane), applied as a shallow diff. Re-applied in full when the series moves pane or scale; not re-applied after a chart-level `rightPriceScale`/`leftPriceScale` option change. */
    priceScale?: Partial<PriceScaleOptions> | undefined;
    /**
     * The whole data set. A new array calls `setData`; mutating one in place
     * does not. Keep it out of deep `$state` (use `$state.raw`): a proxied
     * array makes every bar read go through the proxy.
     * Leaving it undefined does not clear the series.
     */
    data?: SeriesInput<T> | undefined;
    /** The live bar: each new value calls `series.update` (same time replaces the last bar, a later time appends). */
    update?: SeriesBar<T> | undefined;
    /** The core series: null until mounted. Bindable. */
    series?: CoreSeries<T> | null;
    /** `<PriceLine>`s of this series. */
    children?: Snippet;
  }

  let { type, options, priceScale, data, update, series = $bindable(null), children }: Props = $props();
  const chart = chartCell();
  if (!chart) throw new Error("alphacharts: <Series> must be inside <Chart>");
  const cell = provideSeries();
  let applied: Partial<SeriesOptions<T>> | undefined;
  let appliedScale: Partial<PriceScaleOptions> | undefined;
  let appliedScaleKey = "";

  $effect(() => {
    const c = chart.current;
    const t = type;
    if (!c) return;
    const s = untrack(() => {
      applied = snapshot(options);
      return c.addSeries(t, applied);
    });
    appliedScale = undefined;
    appliedScaleKey = "";
    cell.current = s as unknown as CoreSeries<SeriesType>;
    series = s;
    return () => {
      // A removed chart already dropped its series.
      if (!c.isRemoved) c.removeSeries(s);
      cell.current = null;
      series = null;
    };
  });

  $effect(() => {
    const next = snapshot(options);
    const s = cell.current;
    if (!s) return;
    const diff = diffOptions(applied, next);
    applied = next;
    if (diff) untrack(() => s.applyOptions(diff as never));
  });

  // A scale is rebuilt when the series changes pane or scale id: the full options go to the new one.
  $effect(() => {
    const c = chart.current;
    const s = cell.current;
    const next = snapshot(priceScale);
    void options?.pane;
    void options?.priceScaleId;
    if (!c || !s) return;
    untrack(() => {
      const { priceScaleId, pane } = s.options();
      const key = `${pane}:${priceScaleId}`;
      const diff = diffOptions(key === appliedScaleKey ? appliedScale : undefined, next);
      appliedScale = next;
      appliedScaleKey = key;
      if (diff) c.priceScale(priceScaleId, pane).applyOptions(diff);
    });
  });

  // Declared in this order so a fresh series gets its history, then the live bar.
  $effect(() => {
    const s = cell.current;
    const d = data;
    // untrack: core reads every bar; a proxied array must not register each read as a dependency.
    if (s && d !== undefined) untrack(() => s.setData(d as never));
  });

  $effect(() => {
    const s = cell.current;
    const bar = update;
    if (s && bar !== undefined) untrack(() => s.update(bar as never));
  });
</script>

{@render children?.()}
