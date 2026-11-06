// TradingView's volume-based studies, session/anchored VWAP, pivot points and
// historical volatility, built from the built-in definitions and their default
// parameters. Period boundaries (session, week, month, year) are computed from
// the bar time shifted by `utcOffsetMinutes` (the exchange time zone); the
// boundary state lives in columns, so appends and revisions equal a batch run.

import { COLORS, band, defineStudy, float, hist, int, line, select, source } from "../define.js";
import type { Col, Graph, Node } from "../engine/graph.js";

const NaN_ = Number.NaN;
const DAY_MS = 86_400_000;

// ---- helpers ----------------------------------------------------------------------

/** Proleptic Gregorian year and month (0..11) of a day count since 1970-01-01 (Hinnant's civil_from_days). */
function civil(days: number): [number, number] {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const m = mp < 10 ? mp + 3 : mp - 9; // 1..12
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return [y, m - 1];
}

export type Period = "day" | "week" | "month" | "year";

/** An integer naming the calendar period (in the exchange time zone) each bar falls in; weeks start on Monday. */
function periodKey(g: Graph, period: Period, offsetMin: number): Node {
  const t = g.time;
  const off = offsetMin * 60_000;
  return g.calc((i) => {
    const day = Math.floor((t.v[i]! + off) / DAY_MS);
    switch (period) {
      case "day": return day;
      case "week": return Math.floor((day + 3) / 7); // 1970-01-01 was a Thursday; day 4 is the first Monday
      case "month": { const [y, m] = civil(day); return y * 12 + m; }
      case "year": return civil(day)[0];
    }
  });
}

/** Running sum of `term(i)` that restarts at bars where `fresh(i)` is true and is absent where `live(i)` is false. */
function cum(g: Graph, term: (i: number) => number, fresh: (i: number) => boolean, live: (i: number) => boolean = () => true): Node {
  return g.node((s, a, b) => {
    const v = s.v;
    for (let i = a; i < b; i++) {
      if (!live(i)) { v[i] = NaN_; continue; }
      v[i] = (fresh(i) ? 0 : v[i - 1]!) + term(i);
    }
  });
}

/** The four VWAP series from cumulative pv, v and pv2: vwap, stdev, upper, lower (zero cumulative volume is absent). */
function vwapOutputs(g: Graph, cpv: Col, cv: Col, cpv2: Col, mult: number): Node[] {
  const vw = g.calc((i) => (cv.v[i]! > 0 ? cpv.v[i]! / cv.v[i]! : NaN_));
  const sd = g.calc((i) => {
    const w = vw.v[i]!;
    const r = cpv2.v[i]! / cv.v[i]! - w * w;
    return w !== w ? NaN_ : r > 0 ? Math.sqrt(r) : 0;
  });
  return [vw, g.calc((i) => vw.v[i]! + mult * sd.v[i]!), g.calc((i) => vw.v[i]! - mult * sd.v[i]!)];
}

const OFFSET = int("utcOffsetMinutes", 0, -720, 840, "UTC offset (minutes)");

// ---- volume -----------------------------------------------------------------------

export const volume = defineStudy({
  id: "volume", name: "Volume", family: "tv", needs: "ohlcv", pane: "new",
  inputs: [int("maLength", 20, 1, 5000, "MA length")],
  columns: ["volume", "up", "down", "ma"],
  plots: [hist("up", COLORS.green, undefined, { title: "Volume (up)" }), hist("down", COLORS.red, undefined, { title: "Volume (down)" }), line("ma", COLORS.yellow, { title: "Volume MA" })],
  label: (p) => `${p.maLength}`,
  build: (g, p) => {
    const { volume: v, open, close } = g;
    const up = g.calc((i) => (close.v[i]! > open.v[i]! ? v.v[i]! : NaN_));
    const dn = g.calc((i) => (close.v[i]! > open.v[i]! ? NaN_ : v.v[i]!));
    return [g.calc((i) => v.v[i]!), up, dn, g.sma(v, p.maLength)];
  },
  reference: "TradingView Volume: histogram of volume, green when close > open, red otherwise; MA is ta.sma(volume, 20). Verified against TA-Lib SMA for the MA.",
});

// ---- volume oscillator ------------------------------------------------------------

export const volumeOsc = defineStudy({
  id: "volume-osc", name: "Volume Oscillator", family: "tv", needs: "ohlcv", pane: "new",
  inputs: [int("short", 5, 1, 5000, "Short length"), int("long", 10, 1, 5000, "Long length")],
  columns: ["osc"],
  plots: [line("osc", COLORS.blue, { title: "Volume Oscillator" })],
  label: (p) => `${p.short}, ${p.long}`,
  build: (g, p) => {
    const s = g.ema(g.volume, p.short), l = g.ema(g.volume, p.long);
    return [g.map2(s, l, (a, b) => (b === 0 ? NaN_ : (100 * (a - b)) / b))];
  },
  reference: "TradingView Volume Oscillator: 100 * (ta.ema(volume, 5) - ta.ema(volume, 10)) / ta.ema(volume, 10). Equals TA-Lib PPO(volume, 5, 10, EMA).",
});

// ---- cumulative / flow ------------------------------------------------------------

export const pvt = defineStudy({
  id: "pvt", name: "Price Volume Trend", family: "tv", needs: "ohlcv", pane: "new",
  inputs: [], columns: ["pvt"],
  plots: [line("pvt", COLORS.blue, { title: "PVT" })],
  build: (g) => {
    const { close, volume: vol } = g;
    // ta.pvt = ta.cum(ta.change(close) / close[1] * volume); the first bar has no change, so it is absent.
    const term = g.calc((i) => (i === 0 ? NaN_ : ((close.v[i]! - close.v[i - 1]!) / close.v[i - 1]!) * vol.v[i]!));
    return [cum(g, (i) => term.v[i]!, (i) => i <= 1, (i) => i >= 1)];
  },
  reference: "Pine ta.pvt = ta.cum(ta.change(close) / close[1] * volume)",
});

export const netVolume = defineStudy({
  id: "net-volume", name: "Net Volume", family: "tv", needs: "ohlcv", pane: "new",
  inputs: [], columns: ["netVolume"],
  plots: [hist("netVolume", COLORS.green, COLORS.red, { title: "Net Volume" })],
  build: (g) => {
    const { close, volume: vol } = g;
    return [g.calc((i) => {
      if (i === 0) return NaN_;
      const d = close.v[i]! - close.v[i - 1]!;
      return d > 0 ? vol.v[i]! : d < 0 ? -vol.v[i]! : 0;
    })];
  },
  reference: "TradingView Net Volume: volume signed by the sign of ta.change(close) (zero on an unchanged close)",
});

export const elderForce = defineStudy({
  id: "elder-force", name: "Elder's Force Index", family: "tv", needs: "ohlcv", pane: "new",
  inputs: [int("length", 13, 1, 5000)], columns: ["efi"],
  plots: [line("efi", COLORS.red, { title: "EFI" })],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const { close, volume: vol } = g;
    const raw = g.calc((i) => (i === 0 ? NaN_ : (close.v[i]! - close.v[i - 1]!) * vol.v[i]!));
    return [g.ema(raw, p.length)];
  },
  reference: "TradingView Elder's Force Index: ta.ema(ta.change(close) * volume, 13)",
});

export const eom = defineStudy({
  id: "eom", name: "Ease of Movement", family: "tv", needs: "ohlcv", pane: "new",
  inputs: [int("length", 14, 1, 5000), int("divisor", 10000, 1, 1_000_000_000)], columns: ["eom"],
  plots: [line("eom", COLORS.teal, { title: "EOM" })],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const { high, low, volume: vol } = g;
    const hl2 = g.src("hl2");
    const num = g.calc((i) => (i === 0 ? NaN_ : p.divisor * (hl2.v[i]! - hl2.v[i - 1]!) * (high.v[i]! - low.v[i]!)));
    return [g.sma(g.div(num, vol), p.length)];
  },
  reference: "TradingView Ease of Movement: ta.sma(10000 * ta.change(hl2) * (high - low) / volume, 14); zero volume is absent",
});

export const chaikinMf = defineStudy({
  id: "chaikin-mf", name: "Chaikin Money Flow", family: "tv", needs: "ohlcv", pane: "new",
  inputs: [int("length", 20, 1, 5000)], columns: ["cmf"],
  plots: [line("cmf", COLORS.green, { title: "CMF" })],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const { high, low, close, volume: vol } = g;
    // ad = close == high and close == low or high == low ? 0 : (2*close - low - high) / (high - low) * volume
    const ad = g.calc((i) => {
      const h = high.v[i]!, l = low.v[i]!, c = close.v[i]!;
      return h === l ? 0 : ((2 * c - l - h) / (h - l)) * vol.v[i]!;
    });
    return [g.div(g.sum(ad, p.length), g.sum(vol, p.length))];
  },
  reference: "TradingView Chaikin Money Flow: sum(ad, 20) / sum(volume, 20), ad = (2*close - low - high) / (high - low) * volume (0 when high == low)",
});

export const klinger = defineStudy({
  id: "klinger", name: "Klinger Oscillator", family: "tv", needs: "ohlcv", pane: "new",
  inputs: [int("fast", 34, 1, 5000), int("slow", 55, 1, 5000), int("signal", 13, 1, 5000)],
  columns: ["kvo", "signal"],
  plots: [line("kvo", COLORS.blue, { title: "KVO" }), line("signal", COLORS.green, { title: "Signal" })],
  label: (p) => `${p.fast}, ${p.slow}, ${p.signal}`,
  build: (g, p) => {
    const h3 = g.src("hlc3");
    const vol = g.volume;
    // sv = ta.change(hlc3) >= 0 ? volume : -volume
    const sv = g.calc((i) => (i === 0 ? NaN_ : h3.v[i]! - h3.v[i - 1]! >= 0 ? vol.v[i]! : -vol.v[i]!));
    const kvo = g.sub(g.ema(sv, p.fast), g.ema(sv, p.slow));
    return [kvo, g.ema(kvo, p.signal)];
  },
  reference: "TradingView Klinger Oscillator: sv = ta.change(hlc3) >= 0 ? volume : -volume; kvo = ta.ema(sv, 34) - ta.ema(sv, 55); signal = ta.ema(kvo, 13)",
});

// ---- VWAP -------------------------------------------------------------------------

export const vwap = defineStudy({
  id: "vwap", name: "Session VWAP", family: "tv", needs: "ohlcv", pane: "overlay",
  inputs: [select("anchor", "session", ["session", "week", "month", "year"]), source("hlc3"), float("bandMult", 1, 0, 100, 0.1, "Band multiplier"), OFFSET],
  columns: ["vwap", "upper", "lower"],
  plots: [line("vwap", COLORS.blue, { title: "Session VWAP" }), band("bands", "upper", "lower", COLORS.green, "rgba(8,153,129,0.1)", "Session VWAP bands")],
  label: (p) => `${p.anchor}`,
  build: (g, p) => {
    const key = periodKey(g, p.anchor === "session" ? "day" : p.anchor, p.utcOffsetMinutes);
    const src = g.src(p.source), vol = g.volume;
    const fresh = (i: number) => i === 0 || key.v[i] !== key.v[i - 1];
    const cv = cum(g, (i) => vol.v[i]!, fresh);
    const cpv = cum(g, (i) => src.v[i]! * vol.v[i]!, fresh);
    const cpv2 = cum(g, (i) => src.v[i]! * src.v[i]! * vol.v[i]!, fresh);
    return vwapOutputs(g, cpv, cv, cpv2, p.bandMult);
  },
  reference: "Pine ta.vwap(hlc3, anchor, stdev_mult 1): cumulative sum(src*volume) / sum(volume) restarting at each session/week/month/year; bands = vwap +/- mult * sqrt(sum(volume*src^2)/sum(volume) - vwap^2). Session = calendar day in the exchange time zone. It restarts at each session, which is what a trader means by VWAP intraday; it is never a running average over the whole chart (use anchored-vwap for a start you choose).",
});

export const anchoredVwap = defineStudy({
  id: "anchored-vwap", name: "Anchored VWAP", family: "tv", needs: "ohlcv", pane: "overlay",
  inputs: [float("anchorTime", 0, 0, 1e15, 1, "Anchor time (UTC ms)"), source("hlc3"), float("bandMult", 1, 0, 100, 0.1, "Band multiplier")],
  columns: ["vwap", "upper", "lower"],
  plots: [line("vwap", COLORS.orange, { title: "Anchored VWAP" }), band("bands", "upper", "lower", COLORS.orange, "rgba(255,109,0,0.1)", "Anchored VWAP bands")],
  build: (g, p) => {
    const t = g.time, src = g.src(p.source), vol = g.volume;
    const live = (i: number) => t.v[i]! >= p.anchorTime;
    const fresh = (i: number) => i === 0 || !live(i - 1);
    const cv = cum(g, (i) => vol.v[i]!, fresh, live);
    const cpv = cum(g, (i) => src.v[i]! * vol.v[i]!, fresh, live);
    const cpv2 = cum(g, (i) => src.v[i]! * src.v[i]! * vol.v[i]!, fresh, live);
    return vwapOutputs(g, cpv, cv, cpv2, p.bandMult);
  },
  reference: "TradingView Anchored VWAP: VWAP (hlc3) accumulated from the first bar at or after the anchor time, with stdev bands; earlier bars are absent",
});

// ---- pivot points -----------------------------------------------------------------

type Levels = { p: number; r1: number; r2: number; r3: number; r4: number; s1: number; s2: number; s3: number; s4: number };
const LEVEL_KEYS = ["p", "r1", "r2", "r3", "r4", "s1", "s2", "s3", "s4"] as const;

/** Levels from the previous period's open, high, low, close; kinds lacking a level leave it absent. */
function levels(kind: string, O: number, H: number, L: number, C: number): Levels {
  const out: Levels = { p: NaN_, r1: NaN_, r2: NaN_, r3: NaN_, r4: NaN_, s1: NaN_, s2: NaN_, s3: NaN_, s4: NaN_ };
  const R = H - L;
  if (kind === "dm") {
    const x = C < O ? H + 2 * L + C : C > O ? 2 * H + L + C : H + L + 2 * C;
    out.p = x / 4; out.r1 = x / 2 - L; out.s1 = x / 2 - H;
    return out;
  }
  if (kind === "woodie") {
    const P = (H + L + 2 * C) / 4;
    out.p = P; out.r1 = 2 * P - L; out.s1 = 2 * P - H; out.r2 = P + R; out.s2 = P - R;
    out.r3 = H + 2 * R; out.s3 = L - 2 * R; out.r4 = out.r3 + R; out.s4 = out.s3 - R;
    return out;
  }
  if (kind === "camarilla") {
    out.p = (H + L + C) / 3;
    out.r1 = C + (R * 1.1) / 12; out.r2 = C + (R * 1.1) / 6; out.r3 = C + (R * 1.1) / 4; out.r4 = C + (R * 1.1) / 2;
    out.s1 = C - (R * 1.1) / 12; out.s2 = C - (R * 1.1) / 6; out.s3 = C - (R * 1.1) / 4; out.s4 = C - (R * 1.1) / 2;
    return out;
  }
  const P = (H + L + C) / 3;
  out.p = P;
  if (kind === "fibonacci") {
    out.r1 = P + 0.382 * R; out.r2 = P + 0.618 * R; out.r3 = P + R;
    out.s1 = P - 0.382 * R; out.s2 = P - 0.618 * R; out.s3 = P - R;
  } else if (kind === "classic") {
    out.r1 = 2 * P - L; out.s1 = 2 * P - H;
    out.r2 = P + R; out.s2 = P - R; out.r3 = P + 2 * R; out.s3 = P - 2 * R; out.r4 = P + 3 * R; out.s4 = P - 3 * R;
  } else { // standard (TradingView "Traditional")
    out.r1 = 2 * P - L; out.s1 = 2 * P - H; out.r2 = P + R; out.s2 = P - R;
    out.r3 = 2 * P + H - 2 * L; out.s3 = 2 * P - (2 * H - L); out.r4 = 3 * P + H - 3 * L; out.s4 = 3 * P - (3 * H - L);
  }
  return out;
}

const PIVOT_COLORS: Record<(typeof LEVEL_KEYS)[number], string> = {
  p: COLORS.gray, r1: COLORS.red, r2: COLORS.red, r3: COLORS.red, r4: COLORS.red, s1: COLORS.green, s2: COLORS.green, s3: COLORS.green, s4: COLORS.green,
};

export const pivotPoints = defineStudy({
  id: "pivot-points", name: "Pivot Points Standard", family: "tv", needs: "ohlc", pane: "overlay",
  inputs: [
    select("kind", "standard", ["standard", "fibonacci", "woodie", "classic", "dm", "camarilla"]),
    select("period", "day", ["day", "week", "month", "year"]),
    OFFSET,
  ],
  columns: [...LEVEL_KEYS],
  plots: LEVEL_KEYS.map((k) => line(k, PIVOT_COLORS[k], { title: k.toUpperCase(), width: 1 })),
  label: (p) => `${p.kind} ${p.period}`,
  build: (g, p) => {
    const key = periodKey(g, p.period, p.utcOffsetMinutes);
    const { open, high, low, close } = g;
    // current period's running O/H/L/C and the previous completed period's, one slot per bar
    const cO = g.col(), cH = g.col(), cL = g.col(), cC = g.col(), pO = g.col(), pH = g.col(), pL = g.col(), pC = g.col();
    g.node((_s, a, b) => {
      for (let i = a; i < b; i++) {
        if (i === 0 || key.v[i] !== key.v[i - 1]) {
          if (i === 0) { pO.v[i] = NaN_; pH.v[i] = NaN_; pL.v[i] = NaN_; pC.v[i] = NaN_; }
          else { pO.v[i] = cO.v[i - 1]!; pH.v[i] = cH.v[i - 1]!; pL.v[i] = cL.v[i - 1]!; pC.v[i] = cC.v[i - 1]!; }
          cO.v[i] = open.v[i]!; cH.v[i] = high.v[i]!; cL.v[i] = low.v[i]!;
        } else {
          pO.v[i] = pO.v[i - 1]!; pH.v[i] = pH.v[i - 1]!; pL.v[i] = pL.v[i - 1]!; pC.v[i] = pC.v[i - 1]!;
          cO.v[i] = cO.v[i - 1]!; cH.v[i] = Math.max(cH.v[i - 1]!, high.v[i]!); cL.v[i] = Math.min(cL.v[i - 1]!, low.v[i]!);
        }
        cC.v[i] = close.v[i]!;
      }
    });
    return LEVEL_KEYS.map((k) => g.calc((i) => (pH.v[i]! === pH.v[i]! ? levels(p.kind, pO.v[i]!, pH.v[i]!, pL.v[i]!, pC.v[i]!)[k] : NaN_)));
  },
  reference: "TradingView Pivot Points Standard (Traditional, Fibonacci, Woodie, Classic, DM, Camarilla) from the previous completed period's open/high/low/close; constant over the current period, absent in the first",
});

// ---- volatility / range -----------------------------------------------------------

export const histVol = defineStudy({
  id: "hist-vol", name: "Historical Volatility", family: "tv", needs: "value", pane: "new",
  inputs: [int("length", 10, 2, 5000), int("annual", 252, 1, 10_000, "Periods per year"), int("periodDays", 1, 1, 10_000, "Days per bar")],
  columns: ["hv"],
  plots: [line("hv", COLORS.blue, { title: "HV" })],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const c = g.close;
    const r = g.calc((i) => (i === 0 ? NaN_ : Math.log(c.v[i]! / c.v[i - 1]!)));
    const k = 100 * Math.sqrt(p.annual / p.periodDays);
    return [g.map(g.stdev(r, p.length), (s) => s * k)];
  },
  reference: "TradingView Historical Volatility: 100 * ta.stdev(ln(close/close[1]), 10) * sqrt(annual / periodDays); ta.stdev is the population deviation (biased). annual defaults to 252 trading days (TradingView's script uses 365).",
});

export const adr = defineStudy({
  id: "adr", name: "Average Day Range", family: "tv", needs: "ohlc", pane: "new",
  inputs: [int("length", 14, 1, 5000)], columns: ["adr"],
  plots: [line("adr", COLORS.orange, { title: "ADR" })],
  label: (p) => `${p.length}`,
  build: (g, p) => [g.sma(g.sub(g.high, g.low), p.length)],
  reference: "TradingView Average Day Range: ta.sma(high - low, 14) on the chart's bars",
});

// ---- bars per year ---------------------------------------------------------------

export const barsPerYear = defineStudy({
  id: "bars-per-year", name: "Bars per year", family: "tv", needs: "value", pane: "new",
  inputs: [source(), OFFSET], columns: ["barsPerYear"],
  plots: [line("barsPerYear", COLORS.gray, { title: "Bars per year" })],
  label: (p) => `${p.utcOffsetMinutes}`,
  // `source` is not read: it only says whose bars are counted (a script passes an outside series to count that series' bars)
  build: (g, p) => [g.barsPerYear(p.utcOffsetMinutes)],
  reference: "Annualisation made causal: intraday = median bars per exchange-clock day over the last 60 finished days x 252; bars of a day or longer = 252 for a daily series without weekends, else 365 days / median spacing. Constant within a day; absent before the first day has finished. Use it for sqrt(bars per year) in Sharpe and annualised volatility instead of a typed number",
});
