// OrderFlow: the trade store plus the bars aggregated from it. Everything the
// footprint, profiles, TPO and CVD draw comes from one OrderFlow, so they can
// never disagree about a trade.
//
// Build it from trades (exact) or from bars only (`fromBars`: a labelled
// approximation, `approximate` is true and nothing derived from it is exact).

import type { Trade, Datafeed } from "@alphacharts/core";
import { FlowBars, fixedClock, type BarClock } from "./bars.js";
import type { Sessions } from "./sessions.js";
import { TradeStore, validateTrade } from "./trade-store.js";

export interface OrderFlowOptions {
  tickSize: number;
  /** Bar length in ms (the chart's resolution) ... */
  periodMs?: number;
  /** ... shifted by this many ms (bars that do not start on a multiple of the period). */
  anchorMs?: number;
  /** ... or any clock (e.g. calendar days in a zone); wins over periodMs. */
  clock?: BarClock;
  sessions?: Sessions;
  resetCvdBySession?: boolean;
  /** Keep the raw trades (needed for fixed-range profiles at non-bar boundaries). Default true. */
  keepTrades?: boolean;
}

/** Bars to approximate from: no trades, so no sides and no exact levels. */
export interface VolumeBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface FlowChange {
  /** Bar rows touched, inclusive. `appended` is true when a row was added past the old last. */
  firstBar: number;
  lastBar: number;
  appended: boolean;
}

export class OrderFlow {
  readonly bars: FlowBars;
  /** Null when constructed with keepTrades:false or from bars. */
  readonly store: TradeStore | null;
  private readonly listeners = new Set<(c: FlowChange) => void>();

  constructor(readonly options: OrderFlowOptions) {
    const clock = options.clock ?? (options.periodMs === undefined ? undefined : fixedClock(options.periodMs, options.anchorMs ?? 0));
    if (!clock) throw new TypeError("orderflow: give periodMs or a clock");
    this.bars = new FlowBars({ tickSize: options.tickSize, clock, sessions: options.sessions, resetCvdBySession: options.resetCvdBySession });
    this.store = options.keepTrades === false ? null : new TradeStore();
  }

  /**
   * Bars only: each bar's volume is spread equally over the ticks from its low
   * to its high, with unknown side. The result is flagged `approximate`.
   */
  static fromBars(bars: readonly VolumeBar[], options: Omit<OrderFlowOptions, "keepTrades">): OrderFlow {
    const f = new OrderFlow({ ...options, keepTrades: false });
    f.bars.approximate = true;
    bars.forEach((b, i) => {
      for (const k of ["time", "open", "high", "low", "close", "volume"] as const) {
        if (!Number.isFinite(b[k])) throw new TypeError(`orderflow: bar ${i}: ${k} ${b[k]} is not a finite number`);
      }
      if (!(b.volume >= 0) || b.high < b.low) throw new RangeError(`orderflow: bar ${i}: needs volume >= 0 and high >= low`);
      f.bars.appendApproximate(f.bars.clock.barStart(b.time), b.open, b.high, b.low, b.close, b.volume);
    });
    return f;
  }

  get approximate(): boolean {
    return this.bars.approximate;
  }

  /** Fires after every add/addMany with the rows touched. Returns an unsubscribe. */
  onChange(fn: (c: FlowChange) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  add(trade: Trade): void {
    this.addMany([trade]);
  }

  /**
   * Add trades in time order. All are validated first; a bad trade throws with its
   * position and nothing from the call is applied.
   */
  addMany(trades: readonly Trade[]): void {
    if (this.approximate) throw new Error("orderflow: this flow was built from bars (approximate); it cannot take trades");
    if (trades.length === 0) return;
    const codes = new Int8Array(trades.length);
    let prev = this.bars.lastTradeTime;
    for (let i = 0; i < trades.length; i++) {
      const t = trades[i]!;
      codes[i] = validateTrade(t, `trade ${i}`);
      if (t.time < prev) throw new RangeError(`orderflow: trade ${i} at ${t.time} is older than the previous trade (${prev}); trades must arrive in time order`);
      this.bars.tickOf(t.price, `trade ${i}`);
      prev = t.time;
    }
    const before = this.bars.length;
    let first = Number.POSITIVE_INFINITY, last = -1;
    for (let i = 0; i < trades.length; i++) {
      const t = trades[i]!;
      const b = this.bars.add(t.time, t.price, t.size, codes[i]!);
      this.store?.push(t.time, t.price, t.size, codes[i]!);
      if (b < first) first = b;
      if (b > last) last = b;
    }
    const change: FlowChange = { firstBar: first, lastBar: last, appended: this.bars.length > before };
    for (const l of [...this.listeners]) l(change);
  }
}

// ---- loading ----------------------------------------------------------------------

export interface TradeLoadOptions {
  symbol: string;
  /** History window: trades with from <= time < to (UTC ms). */
  from: number;
  to: number;
  /** History is requested in windows of this many ms, so a request stays bounded. Default 1 hour. */
  chunkMs?: number;
  /** Subscribe to live trades after the history (default true when the feed can). */
  live?: boolean;
  /** Every failure lands here; nothing is retried or dropped silently. */
  onError: (error: unknown) => void;
  /** Called after each history chunk with the number of trades loaded so far. */
  onProgress?: (trades: number) => void;
  /** Live trades held while history loads; more is reported and dropped. */
  maxEarlyTrades?: number;
}

export interface TradeLoader {
  /** Resolves when history is in and live (if any) is flowing; rejects never (errors go to onError). */
  readonly done: Promise<void>;
  /** Live trades that were older than the history's end and so already covered by it. */
  readonly coveredByHistory: number;
  dispose(): void;
}

/**
 * Drive `flow` from a Datafeed's getTrades/subscribeTrades: history first, window
 * by window; live trades that arrive meanwhile are held, those before `to` are
 * dropped (history covers them) and counted, the rest are applied in order.
 */
export function loadTrades(flow: OrderFlow, feed: Datafeed, o: TradeLoadOptions): TradeLoader {
  if (!feed.getTrades) throw new TypeError("orderflow: the datafeed has no getTrades");
  if (o.to > Date.now()) throw new RangeError(`orderflow: history end ${o.to} is in the future; live trades before it would be dropped as covered`);
  if (!(o.to > o.from)) throw new RangeError(`orderflow: history window [${o.from}, ${o.to}) is empty`);
  const ac = new AbortController();
  const chunk = o.chunkMs ?? 3_600_000;
  const maxEarly = o.maxEarlyTrades ?? 100_000;
  let ready = false;
  let covered = 0;
  let overflow = false;
  const early: Trade[] = [];
  let unsubscribe: (() => void) | undefined;

  const fail = (e: unknown) => {
    if (!ac.signal.aborted) o.onError(e);
  };
  const apply = (t: Trade) => {
    try {
      flow.add(t);
    } catch (e) {
      fail(e);
    }
  };
  const live = (t: Trade) => {
    if (ac.signal.aborted) return;
    if (!ready) {
      if (early.length < maxEarly) early.push(t);
      else if (!overflow) {
        overflow = true;
        fail(new Error(`orderflow: more than ${maxEarly} live trades arrived before history finished; later ones were dropped`));
      }
      return;
    }
    if (t.time < o.to) covered++;
    else apply(t);
  };
  if (o.live !== false && feed.subscribeTrades) unsubscribe = feed.subscribeTrades(o.symbol, live);

  const done = (async () => {
    try {
      let loaded = 0;
      for (let from = o.from; from < o.to && !ac.signal.aborted; from += chunk) {
        const to = Math.min(from + chunk, o.to);
        const trades = await feed.getTrades!({ symbol: o.symbol, from, to }, ac.signal);
        if (ac.signal.aborted) return;
        for (const t of trades) {
          if (!(t.time >= from && t.time < to)) throw new RangeError(`orderflow: getTrades returned a trade at ${t.time} outside the requested [${from}, ${to})`);
        }
        flow.addMany(trades);
        loaded += trades.length;
        o.onProgress?.(loaded);
      }
      ready = true;
      for (const t of early) {
        if (t.time < o.to) covered++;
        else apply(t);
      }
      early.length = 0;
    } catch (e) {
      fail(e);
    }
  })();

  return {
    done,
    get coveredByHistory() {
      return covered;
    },
    dispose() {
      ac.abort();
      unsubscribe?.();
    },
  };
}
