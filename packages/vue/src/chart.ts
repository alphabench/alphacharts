import { createChart, type Chart as CoreChart, type ChartEvents, type ChartOptionsInput } from "@alphacharts/core";
import { computed, defineComponent, h, inject, onMounted, provide, ref, shallowRef, watch, type PropType, type Ref, type ShallowRef } from "vue";
import { CHART_KEY, DASHBOARD_KEY, SYNC_KEY } from "./keys.js";
import { diffOptions, snapshot } from "./options.js";

type Handler<K extends keyof ChartEvents> = ((e: ChartEvents[K]) => void) | ((e: ChartEvents[K]) => void)[];

// Listeners arrive as props (`@crosshair-move` is the prop `onCrosshairMove`), so they are
// reactive: a handler subscribes only while one is present, and a new closure never resubscribes.
const eventProps = {
  onCrosshairMove: Function as PropType<Handler<"crosshairMove">>,
  onClick: Function as PropType<Handler<"click">>,
  onDblclick: Function as PropType<Handler<"dblclick">>,
  onVisibleRangeChange: Function as PropType<Handler<"visibleRangeChange">>,
};
const EVENTS = [
  ["crosshairMove", "onCrosshairMove"],
  ["click", "onClick"],
  ["dblclick", "onDblclick"],
  ["visibleRangeChange", "onVisibleRangeChange"],
] as const;

const chartProps = {
  /** Chart options. `renderer` is read when the chart is created. */
  options: Object as PropType<ChartOptionsInput>,
  ...eventProps,
};

type Make = (el: HTMLElement, o: ChartOptionsInput) => CoreChart;

/**
 * Create the chart in the host element once mounted (never on the server),
 * keep its options in step, join the nearest SyncGroup, forward events, and
 * provide the chart to descendants.
 */
function setupChart(props: { options?: ChartOptionsInput | undefined } & { [K in (typeof EVENTS)[number][1]]?: unknown }, make: Ref<Make | null>) {
  const host = ref<HTMLElement | null>(null);
  const chart: ShallowRef<CoreChart | null> = shallowRef(null);
  const mounted = ref(false);
  const sync = inject(SYNC_KEY, null);
  let applied: ChartOptionsInput | undefined;
  provide(CHART_KEY, chart);
  onMounted(() => (mounted.value = true));

  // flush "sync": a child sees the chart in the same tick it is made.
  watch(
    () => [mounted.value, make.value] as const,
    ([isMounted, factory], _o, onCleanup) => {
      if (!isMounted || !factory) return;
      applied = snapshot(props.options);
      const c = factory(host.value!, applied ?? {});
      chart.value = c;
      onCleanup(() => {
        c.remove();
        chart.value = null;
      });
    },
    { immediate: true, flush: "sync" },
  );

  watch(
    () => snapshot(props.options),
    (next) => {
      if (!chart.value) return;
      const diff = diffOptions(applied, next);
      applied = next;
      if (diff) chart.value.applyOptions(diff);
    },
  );

  if (sync) {
    watch(
      () => [chart.value, sync.value] as const,
      ([c, group], _o, onCleanup) => {
        if (!c) return;
        group.add(c);
        onCleanup(() => group.remove(c));
      },
      { immediate: true, flush: "sync" },
    );
  }

  for (const [event, prop] of EVENTS) {
    const present = computed(() => !!props[prop]);
    watch(
      () => [chart.value, present.value] as const,
      ([c, has], _o, onCleanup) => {
        if (!c || !has) return;
        onCleanup(
          (c as unknown as { on(type: string, fn: (e: never) => void): () => void }).on(event, (e: never) => {
            const fn = props[prop] as Handler<typeof event> | undefined;
            if (Array.isArray(fn)) for (const f of fn) (f as (e: never) => void)(e);
            else (fn as ((e: never) => void) | undefined)?.(e);
          }),
        );
      },
      { immediate: true, flush: "sync" },
    );
  }

  return { host, chart };
}

/**
 * A chart. Size the element with `class`/`style` (they land on the host div).
 * The default slot takes `<AcSeries>`. Exposes `chart`: the core Chart, null
 * until mounted and always null on the server.
 */
export const AcChart = defineComponent({
  name: "AcChart",
  props: chartProps,
  setup(props, { slots, expose }) {
    const { host, chart } = setupChart(props, ref(createChart));
    expose({ chart });
    return () => h("div", { ref: host }, slots.default?.());
  },
});

/** One cell of an `<AcDashboard>`: a chart drawn into the dashboard's shared canvases. */
export const AcDashboardCell = defineComponent({
  name: "AcDashboardCell",
  props: chartProps,
  setup(props, { slots, expose }) {
    const dashboard = inject(DASHBOARD_KEY, null);
    if (!dashboard) throw new Error("alphacharts: <AcDashboardCell> must be inside <AcDashboard>");
    // The dashboard exists only after its own mount; until then the cell is empty.
    const make = computed<Make | null>(() => (dashboard.value ? (el, o) => dashboard.value!.addChart(el, o) : null));
    const { host, chart } = setupChart(props, make);
    expose({ chart });
    return () => h("div", { ref: host }, slots.default?.());
  },
});
