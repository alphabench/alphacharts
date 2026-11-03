// Trading sessions and holidays, as data.
//
// A session calendar names, per weekday, the regular trading windows in the
// exchange's time zone (minutes from local midnight, end exclusive; a window
// may cross midnight), optional extended windows, and holiday dates. Crypto
// is `ALWAYS_OPEN`. The chart uses it to shade bars outside regular hours and
// the resampler uses it to align intraday buckets to the session open and to
// make a daily bar out of one trading day.

import { DAY_MS, TimeZone } from "./tz.js";

/** [start, end) in minutes from local midnight; end may exceed 1440 (crosses midnight). */
export type Window = readonly [number, number];

export interface SessionSpec {
  timeZone: string;
  /** Index 0 = Sunday … 6 = Saturday. Empty array: closed that weekday. */
  regular: readonly (readonly Window[])[];
  /** Pre/post-market windows; bars in them are "extended", not "closed". */
  extended?: readonly (readonly Window[])[];
  /** Local dates "YYYY-MM-DD" with no trading. */
  holidays?: readonly string[];
}

export type SessionState = "regular" | "extended" | "closed";

const all = (w: Window[]) => [w, w, w, w, w, w, w] as const;

export const ALWAYS_OPEN: SessionSpec = { timeZone: "UTC", regular: all([[0, 1440]]) };

/** Monday–Friday windows, weekends closed. */
export function weekdays(timeZone: string, regular: Window[], extended?: Window[], holidays?: string[]): SessionSpec {
  const days = (w: Window[]) => [[], w, w, w, w, w, []] as const;
  return { timeZone, regular: days(regular), ...(extended ? { extended: days(extended) } : {}), ...(holidays ? { holidays } : {}) };
}

/** NSE/BSE cash: 09:15–15:30 IST. Holidays are the integrator's to supply. */
export const NSE = (holidays: string[] = []) => weekdays("Asia/Kolkata", [[555, 930]], [[540, 555]], holidays);
/** NYSE/Nasdaq: 09:30–16:00 ET, pre 04:00–09:30, post 16:00–20:00. */
export const US_EQUITY = (holidays: string[] = []) => weekdays("America/New_York", [[570, 960]], [[240, 570], [960, 1200]], holidays);

export class Sessions {
  readonly tz: TimeZone;
  private readonly holidays: Set<string>;

  constructor(readonly spec: SessionSpec) {
    if (spec.regular.length !== 7) throw new RangeError("sessions: regular needs 7 weekdays (Sunday first)");
    if (spec.extended && spec.extended.length !== 7) throw new RangeError("sessions: extended needs 7 weekdays (Sunday first)");
    for (const day of [...spec.regular, ...(spec.extended ?? [])]) {
      for (const [a, b] of day) {
        if (!(a >= 0 && b > a && b - a <= 1440)) throw new RangeError(`sessions: bad window [${a}, ${b})`);
      }
    }
    for (const h of spec.holidays ?? []) if (!/^\d{4}-\d{2}-\d{2}$/.test(h)) throw new RangeError(`sessions: holiday "${h}" is not YYYY-MM-DD`);
    this.tz = new TimeZone(spec.timeZone);
    this.holidays = new Set(spec.holidays ?? []);
  }

  /** Is t (UTC ms) in a regular window, an extended one, or neither? */
  state(t: number): SessionState {
    const local = t + this.tz.offset(t);
    // A window that crosses midnight belongs to the day it started on.
    for (const back of [0, 1]) {
      const day = Math.floor(local / DAY_MS) - back;
      if (this.isHolidayDay(day)) continue;
      const min = (local - day * DAY_MS) / 60_000;
      const wd = weekday(day);
      if (inAny(this.spec.regular[wd]!, min)) return "regular";
      if (this.spec.extended && inAny(this.spec.extended[wd]!, min)) return "extended";
    }
    return "closed";
  }

  /**
   * Start (UTC ms) of the regular session containing t, or of the next one
   * if t is outside every session. Used to align buckets and daily bars.
   */
  sessionStart(t: number): number {
    const local = t + this.tz.offset(t);
    const today = Math.floor(local / DAY_MS);
    for (let day = today - 1; day <= today + 14; day++) {
      if (this.isHolidayDay(day)) continue;
      for (const [a, b] of this.spec.regular[weekday(day)]!) {
        const s = this.tz.fromLocal(day * DAY_MS + a * 60_000);
        const e = this.tz.fromLocal(day * DAY_MS + b * 60_000);
        if (t < e && (t >= s || day >= today)) return s;
      }
    }
    throw new RangeError("sessions: no regular session within two weeks (is every weekday closed?)");
  }

  /** The local trading date "YYYY-MM-DD" a time belongs to (by its session start). */
  tradingDate(t: number): string {
    const s = this.sessionStart(t);
    const c = this.tz.civil(s);
    return `${c.year}-${String(c.month).padStart(2, "0")}-${String(c.day).padStart(2, "0")}`;
  }

  private isHolidayDay(day: number): boolean {
    if (this.holidays.size === 0) return false;
    const c = this.tz.civil(this.tz.fromLocal(day * DAY_MS + 12 * 3_600_000));
    return this.holidays.has(`${c.year}-${String(c.month).padStart(2, "0")}-${String(c.day).padStart(2, "0")}`);
  }
}

/** 0 = Sunday for a count of days since 1970-01-01 (a Thursday). */
function weekday(day: number): number {
  return (((day + 4) % 7) + 7) % 7;
}

function inAny(ws: readonly Window[], min: number): boolean {
  for (const [a, b] of ws) if (min >= a && min < b) return true;
  return false;
}
