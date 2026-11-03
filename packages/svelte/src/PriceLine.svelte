<script lang="ts">
  import type { PriceLine as CorePriceLine, PriceLineOptions } from "@alphacharts/core";
  import { untrack } from "svelte";
  import { chartCell, seriesCell } from "./context.svelte.js";
  import { diffOptions } from "./options.js";

  // A horizontal line at a price on the enclosing <Series>. Renders nothing.
  let { price, ...rest }: Partial<PriceLineOptions> & { price: number } = $props();
  const chart = chartCell();
  const series = seriesCell();
  if (!chart || !series) throw new Error("alphacharts: <PriceLine> must be inside <Series>");
  let line: CorePriceLine | null = $state.raw(null);
  let applied: Partial<PriceLineOptions> & { price: number };

  const current = () => {
    const o: Partial<PriceLineOptions> & { price: number } = { price };
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) (o as Record<string, unknown>)[k] = v;
    return o;
  };

  $effect(() => {
    const c = chart.current;
    const s = series.current;
    if (!c || !s) return;
    const l = untrack(() => {
      applied = current();
      return c.createPriceLine(s, applied);
    });
    line = l;
    return () => {
      if (!c.isRemoved) c.removePriceLine(s, l);
      line = null;
    };
  });

  $effect(() => {
    const next = current();
    const l = line;
    if (!l) return;
    const diff = diffOptions(applied, next);
    applied = next;
    if (diff) untrack(() => l.applyOptions(diff));
  });
</script>
