// Number and date text for axes, tooltips and the tables.

import { createFormatter, PriceFormatter, TimeZone } from "@alphacharts/core";
import { timeFormats, timeTickLabel, type TimeFormats } from "./scale.js";
import type { AxisFormat } from "./spec.js";

export class Fmt {
  readonly tz: TimeZone;
  readonly time: TimeFormats;
  private readonly whole: Intl.NumberFormat;
  private readonly frac: Intl.NumberFormat;
  private readonly small: Intl.NumberFormat;
  private readonly fixed = new Map<number, Intl.NumberFormat>();

  constructor(readonly locale: string | undefined, tzId: string) {
    this.tz = new TimeZone(tzId);
    this.time = timeFormats(locale, tzId);
    this.whole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
    this.frac = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
    this.small = new Intl.NumberFormat(locale, { maximumSignificantDigits: 3 });
  }

  /** A value as the tooltip and tables show it: whole numbers whole, else 2 decimals (3 significant below 1). */
  value(v: number): string {
    if (v !== v) return "";
    if (!Number.isFinite(v)) return v > 0 ? "∞" : "-∞";
    if (Number.isInteger(v)) return this.whole.format(v);
    return Math.abs(v) < 1 ? this.small.format(v) : this.frac.format(v);
  }

  fixedDigits(d: number): Intl.NumberFormat {
    let f = this.fixed.get(d);
    if (!f) this.fixed.set(d, (f = new Intl.NumberFormat(this.locale, { minimumFractionDigits: d, maximumFractionDigits: d })));
    return f;
  }

  /** A time instant for a tooltip: the date, with the time when it is not midnight in the zone. */
  instant(t: number): string {
    const c = this.tz.civil(t);
    return c.hour === 0 && c.minute === 0 && c.second === 0 ? this.time.date.format(t) : this.time.datetime.format(t);
  }

  /** Axis tick text for numbers: as many decimals as the tick step needs. */
  numberTicks(values: readonly number[], format: AxisFormat | undefined): string[] {
    const step = values.length > 1 ? Math.abs(values[1]! - values[0]!) : 1;
    const decimals = step > 0 ? new PriceFormatter(Math.max(step, 1e-9)).decimals : 0;
    const nf = this.fixedDigits(decimals);
    switch (format) {
      case "compact": case "compact-abs": {
        const f = createFormatter({ type: "volume" }, 1, this.locale);
        return values.map((v) => f.format(format === "compact-abs" ? Math.abs(v) : v));
      }
      case "percent": return values.map((v) => `${nf.format(v)}%`);
      case "abs": return values.map((v) => nf.format(Math.abs(v)));
      default: return values.map((v) => nf.format(v));
    }
  }

  timeTicks(values: readonly number[], format: AxisFormat | undefined): string[] {
    if (format === "date") return values.map((v) => this.time.date.format(v));
    if (format === "datetime") return values.map((v) => this.time.datetime.format(v));
    return values.map((v) => timeTickLabel(v, this.tz, this.locale, this.time));
  }
}
