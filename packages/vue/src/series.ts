import type { Chart as CoreChart, PriceScaleOptions, Series as CoreSeries, SeriesBar, SeriesInput, SeriesOptions, SeriesType } from "@alphacharts/core";
import { defineComponent, inject, onScopeDispose, provide, shallowRef, toRaw, watch, type PropType, type ShallowRef } from "vue";
import { CHART_KEY, SERIES_KEY } from "./keys.js";
import { diffOptions, snapshot } from "./options.js";

export interface AcSeriesProps<T extends SeriesType> {
  /** Changing the type replaces the series. */
  type: T;
  /** Applied with `series.applyOptions` as a shallow diff (one nested group deep). */
  options?: Partial<SeriesOptions<T>> | undefined;
  /** Options of the price scale this series is drawn on (its `priceScaleId`, in its pane), applied as a shallow diff. Re-applied in full when the series moves pane or scale; not re-applied after a chart-level `rightPriceScale`/`leftPriceScale` option change. */
  priceScale?: Partial<PriceScaleOptions> | undefined;
  /**
   * The whole data set. A new array calls `setData`; mutating an array in place
   * does not. Pass a `shallowRef`/`markRaw` array: a deep `ref` would wrap every
   * bar in a proxy (the wrapper unwraps it, but the proxying cost is yours).
   * Leaving it undefined does not clear the series.
   */
  data?: SeriesInput<T> | undefined;
  /** The live bar: each new value calls `series.update` (same time replaces the last bar, a later time appends). */
  update?: SeriesBar<T> | undefined;
}

const AcSeriesImpl = defineComponent({
  name: "AcSeries",
  props: {
    type: { type: String as PropType<SeriesType>, required: true },
    options: Object as PropType<Record<string, unknown>>,
    priceScale: Object as PropType<Record<string, unknown>>,
    data: [Array, Object] as PropType<unknown>,
    update: Object as PropType<unknown>,
  },
  setup(props, { slots, expose }) {
    const chart = inject(CHART_KEY, null);
    if (!chart) throw new Error("alphacharts: <AcSeries> must be inside <AcChart>");
    const series: ShallowRef<CoreSeries<SeriesType> | null> = shallowRef(null);
    let applied: Record<string, unknown> | undefined;
    let appliedScale: Record<string, unknown> | undefined;
    let appliedScaleKey = "";
    let appliedData: unknown;
    let appliedUpdate: unknown;
    let dispose: (() => void) | null = null;
    provide(SERIES_KEY, series);

    // The scale is rebuilt when the series changes pane or scale id: then the full options go to the new one.
    const applyScale = () => {
      const c = chart.value, s = series.value;
      if (!c || !s) return;
      const { priceScaleId, pane } = s.options();
      const key = `${pane}:${priceScaleId}`;
      const next = snapshot(props.priceScale);
      const diff = diffOptions(key === appliedScaleKey ? appliedScale : undefined, next);
      appliedScale = next;
      appliedScaleKey = key;
      if (diff) c.priceScale(priceScaleId, pane).applyOptions(diff);
    };
    const applyData = () => {
      const d = props.data;
      if (series.value && d !== undefined && d !== appliedData) {
        appliedData = d;
        series.value.setData(toRaw(d) as never);
      }
    };
    const applyUpdate = () => {
      const bar = props.update;
      if (series.value && bar !== undefined && bar !== appliedUpdate) {
        appliedUpdate = bar;
        series.value.update(toRaw(bar) as never);
      }
    };

    // `dispose` is set before anything that can throw, so a series whose data is refused is still removed.
    const detach = () => {
      dispose?.();
      dispose = null;
    };
    const attach = (c: CoreChart, type: SeriesType) => {
      applied = snapshot(props.options);
      const s = c.addSeries(type, applied);
      dispose = () => {
        // A removed chart already dropped its series.
        if (!c.isRemoved) c.removeSeries(s);
        series.value = null;
      };
      series.value = s;
      appliedScale = undefined;
      appliedScaleKey = "";
      appliedData = appliedUpdate = undefined;
      applyScale();
      // A fresh series gets its history, then the live bar.
      applyData();
      applyUpdate();
    };

    // The chart appearing is synchronous: a child sees its series in the tick the chart is made.
    watch(
      chart,
      (c) => {
        detach();
        if (c) attach(c, props.type);
      },
      { immediate: true, flush: "sync" },
    );
    onScopeDispose(detach);
    // The rest are "pre": run once after all of a render's props are assigned, so a change of
    // type together with new data never hands the old series the new shape (or the reverse).
    watch(
      () => props.type,
      (type) => {
        if (!chart.value) return;
        detach();
        attach(chart.value, type);
      },
      { flush: "pre" },
    );
    watch(
      () => snapshot(props.options),
      (next) => {
        if (!series.value) return;
        const diff = diffOptions(applied, next);
        applied = next;
        if (diff) series.value.applyOptions(diff as never);
      },
      { flush: "pre" },
    );
    watch(() => [snapshot(props.priceScale), props.options?.pane, props.options?.priceScaleId], applyScale, { flush: "pre" });
    watch(() => props.data, applyData, { flush: "pre" });
    watch(() => props.update, applyUpdate, { flush: "pre" });

    expose({ series });
    return () => slots.default?.();
  },
});

/** A series on the nearest `<AcChart>`. Exposes `series`: the core Series, null until mounted. Slot: `<AcPriceLine>`s. */
export const AcSeries = AcSeriesImpl as unknown as <T extends SeriesType>(
  props: AcSeriesProps<T>,
  ctx?: { slots: { default?: () => unknown }; expose?: (exposed: { series: CoreSeries<T> | null }) => void },
) => unknown;
