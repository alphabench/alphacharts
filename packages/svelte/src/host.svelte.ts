import type { Chart as CoreChart, ChartEvents, ChartOptionsInput } from "@alphacharts/core";
import { untrack } from "svelte";
import { syncGroup, type Cell } from "./context.svelte.js";
import { diffOptions, snapshot } from "./options.js";

export interface ChartEventProps {
  onCrosshairMove?: ((e: ChartEvents["crosshairMove"]) => void) | undefined;
  onClick?: ((e: ChartEvents["click"]) => void) | undefined;
  onDblClick?: ((e: ChartEvents["dblclick"]) => void) | undefined;
  onVisibleRangeChange?: ((e: ChartEvents["visibleRangeChange"]) => void) | undefined;
}

const EVENTS = [
  ["crosshairMove", "onCrosshairMove"],
  ["click", "onClick"],
  ["dblclick", "onDblClick"],
  ["visibleRangeChange", "onVisibleRangeChange"],
] as const;

export interface HostArgs {
  host: () => HTMLElement | undefined;
  options: () => ChartOptionsInput | undefined;
  /** Makes the chart, or null while its owner (a dashboard) does not exist yet. */
  make: () => ((el: HTMLElement, o: ChartOptionsInput) => CoreChart) | null;
  events: () => ChartEventProps;
  cell: Cell<CoreChart>;
  /** Told whenever the chart appears or goes away (for `bind:chart`). */
  publish: (c: CoreChart | null) => void;
}

/**
 * Create the chart in the host element once mounted (effects never run on the
 * server), keep its options in step, join the nearest SyncGroup and forward
 * the event props. Call during component initialisation.
 */
export function mountChart({ host, options, make, events, cell, publish }: HostArgs): void {
  const sync = syncGroup();
  let applied: ChartOptionsInput | undefined;

  $effect(() => {
    const el = host();
    const factory = make();
    if (!el || !factory) return;
    // Creation reads options once; later changes go through the diffing effect below.
    const c = untrack(() => {
      applied = snapshot(options());
      return factory(el, applied ?? {});
    });
    cell.current = c;
    publish(c);
    return () => {
      c.remove();
      cell.current = null;
      publish(null);
    };
  });

  $effect(() => {
    const next = snapshot(options());
    const c = cell.current;
    if (!c) return;
    const diff = diffOptions(applied, next);
    applied = next;
    if (diff) untrack(() => c.applyOptions(diff));
  });

  $effect(() => {
    const c = cell.current;
    const group = sync?.current;
    if (!c || !group) return;
    group.add(c);
    return () => group.remove(c);
  });

  // Only a present handler subscribes (core skips building an event nobody
  // listens to); `present` changes only when a handler appears or goes, not
  // when its closure is replaced, and the callback reads the latest closure.
  for (const [event, prop] of EVENTS) {
    const present = $derived(!!events()[prop]);
    $effect(() => {
      const c = cell.current;
      if (!c || !present) return;
      return (c as unknown as { on(t: string, f: (e: never) => void): () => void }).on(event, (e: never) => (events()[prop] as ((e: never) => void) | undefined)?.(e));
    });
  }
}
