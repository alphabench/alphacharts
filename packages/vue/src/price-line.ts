import type { PriceLine as CorePriceLine, PriceLineOptions } from "@alphacharts/core";
import { defineComponent, inject, shallowRef, watch, type PropType } from "vue";
import { CHART_KEY, SERIES_KEY } from "./keys.js";
import { diffOptions } from "./options.js";

/** A horizontal line at a price on the enclosing `<AcSeries>`. Renders nothing. */
export const AcPriceLine = defineComponent({
  name: "AcPriceLine",
  props: {
    price: { type: Number, required: true },
    color: String,
    lineWidth: Number,
    lineStyle: String as PropType<PriceLineOptions["lineStyle"]>,
    title: String,
    // `default: undefined`: Vue would otherwise turn an absent Boolean into false.
    axisLabelVisible: { type: Boolean, default: undefined },
    labelTextColor: String,
  },
  setup(props) {
    const chart = inject(CHART_KEY, null);
    const series = inject(SERIES_KEY, null);
    if (!chart || !series) throw new Error("alphacharts: <AcPriceLine> must be inside <AcSeries>");
    const line = shallowRef<CorePriceLine | null>(null);
    let applied: Partial<PriceLineOptions> & { price: number };
    const current = () => {
      const o: Partial<PriceLineOptions> & { price: number } = { price: props.price };
      for (const k of ["color", "lineWidth", "lineStyle", "title", "axisLabelVisible", "labelTextColor"] as const) {
        if (props[k] !== undefined) (o as Record<string, unknown>)[k] = props[k];
      }
      return o;
    };

    watch(
      () => [chart.value, series.value] as const,
      ([c, s], _o, onCleanup) => {
        if (!c || !s) return;
        applied = current();
        const l = c.createPriceLine(s, applied);
        line.value = l;
        onCleanup(() => {
          if (!c.isRemoved) c.removePriceLine(s, l);
          line.value = null;
        });
      },
      { immediate: true, flush: "sync" },
    );
    watch(current, (next) => {
      if (!line.value) return;
      const diff = diffOptions(applied, next);
      applied = next;
      if (diff) line.value.applyOptions(diff);
    });
    return () => null;
  },
});
