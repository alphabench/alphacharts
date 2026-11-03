// Time-zone arithmetic without per-bar Intl calls.
//
// Intl.DateTimeFormat is the only portable source of IANA offsets, but one
// formatToParts call costs microseconds, which is seconds over millions of
// bars. Offsets change only at DST/legal transitions, so they are cached per
// 6-hour bucket; a bucket whose two ends disagree contains a transition and
// is resolved exactly per call.

const BUCKET_MS = 6 * 3_600_000;
const TRANSITION = Number.NaN;

export const DAY_MS = 86_400_000;

export interface CivilTime {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number;
  minute: number;
  second: number;
  ms: number;
}

export class TimeZone {
  readonly id: string;
  private readonly fmt: Intl.DateTimeFormat | null;
  private readonly cache = new Map<number, number>();

  /** `id` is "UTC" or an IANA name; an unknown name throws RangeError. */
  constructor(id: string) {
    this.id = id;
    this.fmt =
      id === "UTC"
        ? null
        : new Intl.DateTimeFormat("en-US", {
            timeZone: id,
            hourCycle: "h23",
            year: "numeric",
            month: "numeric",
            day: "numeric",
            hour: "numeric",
            minute: "numeric",
            second: "numeric",
          });
  }

  /** Offset (ms) to add to a UTC instant to get local wall-clock time. */
  offset(t: number): number {
    if (this.fmt === null) return 0;
    const b = Math.floor(t / BUCKET_MS);
    let off = this.cache.get(b);
    if (off === undefined) {
      const a = this.exactOffset(b * BUCKET_MS);
      const z = this.exactOffset((b + 1) * BUCKET_MS - 1);
      off = a === z ? a : TRANSITION;
      this.cache.set(b, off);
    }
    return Number.isNaN(off) ? this.exactOffset(t) : off;
  }

  /** UTC instant whose local wall-clock time is `local` (earlier instant on overlap). */
  fromLocal(local: number): number {
    const guess = local - this.offset(local);
    return local - this.offset(guess);
  }

  civil(t: number): CivilTime {
    return civilFromLocal(t + this.offset(t));
  }

  private exactOffset(t: number): number {
    const parts = this.fmt!.formatToParts(t);
    let y = 0, mo = 0, d = 0, h = 0, mi = 0, s = 0;
    for (const p of parts) {
      switch (p.type) {
        case "year": y = +p.value; break;
        case "month": mo = +p.value; break;
        case "day": d = +p.value; break;
        case "hour": h = +p.value; break;
        case "minute": mi = +p.value; break;
        case "second": s = +p.value; break;
      }
    }
    const wall = Date.UTC(y, mo - 1, d, h, mi, s);
    // formatToParts drops milliseconds; compare at whole-second resolution.
    return wall - (t - (((t % 1000) + 1000) % 1000));
  }
}

/** Civil fields of a local-time millisecond count (Hinnant's algorithm). */
export function civilFromLocal(local: number): CivilTime {
  const days = Math.floor(local / DAY_MS);
  let rem = local - days * DAY_MS;
  const hour = Math.floor(rem / 3_600_000);
  rem -= hour * 3_600_000;
  const minute = Math.floor(rem / 60_000);
  rem -= minute * 60_000;
  const second = Math.floor(rem / 1000);
  const ms = rem - second * 1000;

  const z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return { year, month, day, hour, minute, second, ms };
}

/** Local-time milliseconds at 00:00 of a civil date. */
export function localFromCivil(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day);
}
