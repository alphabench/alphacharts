import type { PriceLine as CorePriceLine, PriceLineOptions } from "@alphacharts/core";
import { useContext, useEffect, useRef, useState } from "react";
import { ChartContext, SeriesContext } from "./context.js";
import { diffOptions } from "./options.js";

export type PriceLineProps = Partial<PriceLineOptions> & { price: number };

/** A horizontal line at a price on the enclosing `<Series>`. Renders nothing. */
export function PriceLine(props: PriceLineProps): null {
  const chart = useContext(ChartContext);
  const series = useContext(SeriesContext);
  if (chart === undefined || series === undefined) throw new Error("alphacharts: <PriceLine> must be inside <Series>");
  const [line, setLine] = useState<CorePriceLine | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const applied = useRef<PriceLineProps | undefined>(undefined);

  useEffect(() => {
    if (!chart || !series) return;
    const p = latest.current;
    const l = chart.createPriceLine(series, p);
    applied.current = p;
    setLine(l);
    return () => {
      if (!chart.isRemoved) chart.removePriceLine(series, l);
      setLine(null);
    };
  }, [chart, series]);

  useEffect(() => {
    if (!line) return;
    const diff = diffOptions(applied.current, props);
    applied.current = props;
    if (diff) line.applyOptions(diff);
  }, [line, props]);

  return null;
}
