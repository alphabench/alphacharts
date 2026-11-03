// Price formats: how a series' values become text on the axis, in labels and
// in the screen-reader readout.
//
// A "price" format without a minMove takes it from the data: the most decimals
// any sampled value needs (never fewer than the data has, so a readout is the
// value that was passed in). It only ever grows as new bars arrive.

import { PriceFormatter } from "./ticks.js";

export type PriceFormat =
  | { type: "price"; minMove?: number }
  /** Abbreviated: K/M/B/T, or K/L/Cr for Indian locales. */
  | { type: "volume"; minMove?: number }
  /** Values are already percentages; shown with a % sign. */
  | { type: "percent"; minMove?: number }
  | { type: "custom"; minMove: number; format: (value: number) => string };

export interface Formatter {
  /** Smallest step between distinct values; axis ticks are multiples of it. */
  readonly minMove: number;
  format(value: number): string;
}

const MAX_DECIMALS = 10;

/** Decimals needed to write v exactly (within float noise), capped at 10. */
export function decimalsOf(v: number): number {
  const a = Math.abs(v);
  for (let d = 0; d < MAX_DECIMALS; d++) {
    const s = a * 10 ** d;
    if (Math.abs(s - Math.round(s)) <= 1e-9 * Math.max(1, s)) return d;
  }
  return MAX_DECIMALS;
}

/** True when the locale groups and abbreviates the Indian way (lakh, crore). */
export function isIndianLocale(locale: string | undefined): boolean {
  const l = (locale ?? (typeof navigator !== "undefined" ? navigator.language : "en")).toLowerCase();
  return l.endsWith("-in") || l === "hi" || l.startsWith("hi-");
}

export function createFormatter(f: PriceFormat, derivedMinMove: number, locale: string | undefined): Formatter {
  switch (f.type) {
    case "custom":
      if (!(f.minMove > 0)) throw new RangeError(`custom priceFormat needs a positive minMove, got ${f.minMove}`);
      return { minMove: f.minMove, format: f.format };
    case "price": {
      const p = new PriceFormatter(f.minMove ?? derivedMinMove);
      return { minMove: p.minMove, format: (v) => p.format(v) };
    }
    case "percent": {
      const p = new PriceFormatter(f.minMove ?? Math.min(0.01, derivedMinMove));
      return { minMove: p.minMove, format: (v) => `${p.format(v)}%` };
    }
    case "volume": {
      const minMove = f.minMove ?? 1;
      const indian = isIndianLocale(locale);
      const steps: [number, string][] = indian
        ? [[1e7, "Cr"], [1e5, "L"], [1e3, "K"]]
        : [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];
      const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
      const plain = new PriceFormatter(minMove);
      return {
        minMove,
        format: (v) => {
          const a = Math.abs(v);
          for (const [div, suffix] of steps) if (a >= div) return `${nf.format(v / div)}${suffix}`;
          return plain.format(v);
        },
      };
    }
  }
}
