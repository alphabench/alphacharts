import { createPlot, type Plot as CorePlot, type PlotEvents, type PlotSpec, type PlotSyncGroup } from "@alphacharts/plot";
import { untrack } from "svelte";
import { plotSync } from "./context.svelte.js";

export interface PlotEventProps {
  onCrosshair?: ((e: PlotEvents["crosshair"]) => void) | undefined;
  onViewChange?: ((e: PlotEvents["view"]) => void) | undefined;
  onBrush?: ((e: PlotEvents["brush"]) => void) | undefined;
  onLegendToggle?: ((e: PlotEvents["legend"]) => void) | undefined;
  onHover?: ((e: PlotEvents["hover"]) => void) | undefined;
}

const EVENTS = [
  ["crosshair", "onCrosshair"], ["view", "onViewChange"], ["brush", "onBrush"], ["legend", "onLegendToggle"], ["hover", "onHover"],
] as const;

/** Same top-level entries (by identity): a spec rebuilt over the same data arrays costs nothing. */
function sameSpec(a: PlotSpec | undefined, b: PlotSpec): boolean {
  if (!a) return false;
  const ka = Object.keys(a) as (keyof PlotSpec)[], kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && Object.is(a[k], b[k]));
}

/**
 * Create the plot in the host element once mounted (effects never run on the
 * server), keep it in step with the spec, join the nearest `<PlotSync>` (or
 * `sync`) and forward the event props. Call during component initialisation;
 * `.current` is null until mounted and always null on the server.
 *
 * The spec is read shallowly: replace the object or its top-level entries to
 * redraw, do not mutate in place.
 */
export function usePlot(host: () => HTMLElement | undefined, spec: () => PlotSpec, events: () => PlotEventProps = () => ({}), sync: () => PlotSyncGroup | undefined = () => undefined): { readonly current: CorePlot | null } {
  const injected = plotSync();
  let current: CorePlot | null = $state.raw(null);
  let applied: PlotSpec | undefined;

  $effect(() => {
    const el = host();
    if (!el) return;
    const p = untrack(() => {
      applied = spec();
      return createPlot(el, applied);
    });
    current = p;
    return () => {
      p.dispose();
      current = null;
    };
  });

  $effect(() => {
    const next = spec();
    const p = current;
    if (!p || sameSpec(applied, next)) return;
    applied = next;
    untrack(() => p.update(next));
  });

  $effect(() => {
    const p = current;
    const group = sync() ?? injected?.current;
    if (!p || !group) return;
    group.add(p);
    return () => void group.remove(p);
  });

  // Only a present handler subscribes; the callback reads the latest closure.
  for (const [type, prop] of EVENTS) {
    const present = $derived(!!events()[prop]);
    $effect(() => {
      const p = current;
      if (!p || !present) return;
      return (p as unknown as { on(t: string, f: (e: never) => void): () => void }).on(type, (e: never) => (events()[prop] as ((e: never) => void) | undefined)?.(e));
    });
  }

  return {
    get current() {
      return current;
    },
  };
}
