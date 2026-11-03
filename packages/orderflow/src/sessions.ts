// Session boundaries in a time zone. A session is a calendar day in `timeZone`
// shifted by `startOffsetMs` (e.g. a session that opens at 09:15 local).
//
// Zone offsets come from Intl once per 6-hour bucket and only a bucket that
// contains a transition is resolved exactly per call (the same approach as the
// core's time scale, kept here because the core does not export it).

export const DAY_MS = 86_400_000;
const BUCKET_MS = 6 * 3_600_000;

export interface Sessions {
  /** Stable identity of the session containing `time` (increasing in time). */
  id(time: number): number;
  /** UTC ms at which that session starts. */
  start(time: number): number;
}

class ZoneOffsets {
  private readonly fmt: Intl.DateTimeFormat | null;
  private readonly cache = new Map<number, number>();

  constructor(readonly id: string) {
    this.fmt = id === "UTC" ? null : new Intl.DateTimeFormat("en-US", { timeZone: id, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
  }

  offset(t: number): number {
    if (!this.fmt) return 0;
    const b = Math.floor(t / BUCKET_MS);
    let off = this.cache.get(b);
    if (off === undefined) {
      const a = this.exact(b * BUCKET_MS), z = this.exact((b + 1) * BUCKET_MS - 1);
      off = a === z ? a : Number.NaN;
      this.cache.set(b, off);
    }
    return Number.isNaN(off) ? this.exact(t) : off;
  }

  private exact(t: number): number {
    let y = 0, mo = 0, d = 0, h = 0, mi = 0, s = 0;
    for (const p of this.fmt!.formatToParts(t)) {
      switch (p.type) {
        case "year": y = +p.value; break;
        case "month": mo = +p.value; break;
        case "day": d = +p.value; break;
        case "hour": h = +p.value; break;
        case "minute": mi = +p.value; break;
        case "second": s = +p.value; break;
      }
    }
    return Date.UTC(y, mo - 1, d, h, mi, s) - (t - (((t % 1000) + 1000) % 1000));
  }
}

/** Calendar-day sessions in `timeZone` ("UTC" or an IANA name; unknown names throw RangeError). */
export function daySessions(timeZone: string, startOffsetMs = 0): Sessions {
  if (!Number.isFinite(startOffsetMs) || startOffsetMs < 0 || startOffsetMs >= DAY_MS) throw new RangeError(`orderflow: startOffsetMs ${startOffsetMs} must be in [0, 86400000)`);
  const z = new ZoneOffsets(timeZone);
  // Local wall-clock ms of the session start containing t, then back to UTC.
  const localStart = (t: number) => Math.floor((t + z.offset(t) - startOffsetMs) / DAY_MS) * DAY_MS + startOffsetMs;
  return {
    id: (t) => Math.floor((t + z.offset(t) - startOffsetMs) / DAY_MS),
    start: (t) => {
      const local = localStart(t);
      const guess = local - z.offset(local);
      return local - z.offset(guess);
    },
  };
}
