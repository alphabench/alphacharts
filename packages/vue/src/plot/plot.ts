import { createPlot, type Plot as CorePlot, type PlotEvents, type PlotSpec, type PlotSyncGroup } from "@alphacharts/plot";
import { computed, defineComponent, h, inject, onMounted, ref, shallowRef, toRaw, watch, type PropType, type Ref, type ShallowRef } from "vue";
import { PLOT_SYNC_KEY } from "./keys.js";

type Handler<K extends keyof PlotEvents> = ((e: PlotEvents[K]) => void) | ((e: PlotEvents[K]) => void)[];

// Listeners arrive as props (`@crosshair` is the prop `onCrosshair`), so they are reactive:
// a handler subscribes only while one is present, and a new closure never resubscribes.
const eventProps = {
  onCrosshair: Function as PropType<Handler<"crosshair">>,
  onViewChange: Function as PropType<Handler<"view">>,
  onBrush: Function as PropType<Handler<"brush">>,
  onLegendToggle: Function as PropType<Handler<"legend">>,
  onHover: Function as PropType<Handler<"hover">>,
};
const EVENTS = [
  ["crosshair", "onCrosshair"], ["view", "onViewChange"], ["brush", "onBrush"], ["legend", "onLegendToggle"], ["hover", "onHover"],
] as const;

type EventHandlers = { [K in (typeof EVENTS)[number][1]]?: unknown };

/** Same top-level entries (by identity): a spec rebuilt over the same data arrays costs nothing. */
function sameSpec(a: PlotSpec | undefined, b: PlotSpec): boolean {
  if (!a) return false;
  const ka = Object.keys(a) as (keyof PlotSpec)[], kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && Object.is(a[k], b[k]));
}

/**
 * Create the plot in the host element once mounted (never on the server),
 * keep it in step with the spec, join the nearest `<AcPlotSync>` (or `sync`)
 * and forward events. The spec is watched shallowly: replace the object or its
 * top-level entries to redraw, do not mutate in place.
 */
export function usePlot(spec: () => PlotSpec, events: () => EventHandlers = () => ({}), sync?: () => PlotSyncGroup | undefined): { host: Ref<HTMLElement | null>; plot: ShallowRef<CorePlot | null> } {
  const host = ref<HTMLElement | null>(null);
  const plot: ShallowRef<CorePlot | null> = shallowRef(null);
  const mounted = ref(false);
  const injected = inject(PLOT_SYNC_KEY, null);
  let applied: PlotSpec | undefined;
  onMounted(() => (mounted.value = true));

  // flush "sync": a consumer sees the plot in the same tick it is made.
  watch(
    () => mounted.value,
    (isMounted, _o, onCleanup) => {
      if (!isMounted) return;
      applied = spec();
      const p = createPlot(host.value!, applied);
      plot.value = p;
      onCleanup(() => {
        p.dispose();
        plot.value = null;
      });
    },
    { immediate: true, flush: "sync" },
  );

  watch(spec, (next) => {
    if (!plot.value || sameSpec(applied, next)) return;
    applied = next;
    plot.value.update(next);
  });

  watch(
    () => [plot.value, sync?.() ?? injected?.value] as const,
    ([p, group], _o, onCleanup) => {
      if (!p || !group) return;
      group.add(p);
      onCleanup(() => void group.remove(p));
    },
    { immediate: true, flush: "sync" },
  );

  for (const [type, prop] of EVENTS) {
    const present = computed(() => !!events()[prop]);
    watch(
      () => [plot.value, present.value] as const,
      ([p, has], _o, onCleanup) => {
        if (!p || !has) return;
        onCleanup(
          (p as unknown as { on(t: string, fn: (e: never) => void): () => void }).on(type, (e: never) => {
            const fn = events()[prop] as Handler<typeof type> | undefined;
            if (Array.isArray(fn)) for (const f of fn) (f as (e: never) => void)(e);
            else (fn as ((e: never) => void) | undefined)?.(e);
          }),
        );
      },
      { immediate: true, flush: "sync" },
    );
  }
  return { host, plot };
}

/**
 * A plot. Size the element with `class`/`style` (they land on the host div), or give the
 * spec a width and height. Exposes `plot`: the core Plot, null until mounted and always
 * null on the server.
 */
export const AcPlot = defineComponent({
  name: "AcPlot",
  props: {
    spec: { type: Object as PropType<PlotSpec>, required: true },
    /** An explicit sync group; wins over the nearest `<AcPlotSync>`. */
    sync: Object as PropType<PlotSyncGroup>,
    ...eventProps,
  },
  setup(props, { expose }) {
    // toRaw: a spec held in a deep ref must not make every data array reactive.
    const { host, plot } = usePlot(() => toRaw(props.spec), () => props, () => props.sync);
    expose({ plot });
    return () => h("div", { ref: host });
  },
});
