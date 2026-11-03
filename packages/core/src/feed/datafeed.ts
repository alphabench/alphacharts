// Datafeed contract and a loader that drives one series from it: initial
// history, older pages as the user scrolls left, and live bars.
//
// The library ships no data; the consumer implements Datafeed over its own
// backend. Every failure goes to `onError`: nothing is retried or dropped
// silently, except live bars that arrived before the first history page and
// are older than its last bar (the history already covers them). A failed
// first page leaves the feed `failed` until the caller asks to retry().

import type { Chart } from "../chart/chart.js";
import type { Series } from "../chart/series.js";
import type { SeriesType } from "../chart/series-types.js";
import type { ColumnarOhlc, ColumnarValue, OhlcBar, ValuePoint } from "../data/model.js";

export interface BarsRequest {
  symbol: string;
  resolution: string;
  /** Return bars with time <= to (UTC ms), newest last. */
  to: number;
  /** How many bars, at most, ending at `to`. */
  countBack: number;
}

export interface BarsResponse {
  bars: readonly OhlcBar[] | readonly ValuePoint[] | ColumnarOhlc | ColumnarValue;
  /** No bars exist before the ones returned. */
  noMoreData: boolean;
}

/** One trade (time and sales). Order-flow charts and trade-built bars use it. */
export interface Trade {
  /** UTC ms; equal times are allowed, order is arrival order. */
  time: number;
  price: number;
  size: number;
  /** Aggressor side when the venue reports it; "unknown" is never guessed. */
  side: "buy" | "sell" | "unknown";
}

export interface TradesRequest {
  symbol: string;
  /** Trades with from <= time < to (UTC ms). */
  from: number;
  to: number;
}

export interface Datafeed {
  getBars(request: BarsRequest, signal: AbortSignal): Promise<BarsResponse>;
  /** Live bars: the current bar repeatedly, then the next one. Returns an unsubscribe. */
  subscribeBars?(symbol: string, resolution: string, onBar: (bar: OhlcBar | ValuePoint) => void): () => void;
  /** Historical trades, for footprint, profiles and tick/volume bars. */
  getTrades?(request: TradesRequest, signal: AbortSignal): Promise<Trade[]>;
  /** Live trades. Returns an unsubscribe. */
  subscribeTrades?(symbol: string, onTrade: (trade: Trade) => void): () => void;
}

export interface FeedOptions {
  symbol: string;
  resolution: string;
  /** Bars per request. */
  pageSize?: number;
  /** Load older history when the left edge is within this many bars of the first one. */
  prefetchBars?: number;
  /** Where the newest history ends; default now. */
  to?: number;
  onError: (error: unknown) => void;
  /** Live bars held while the first page loads; more is reported as an error and dropped. */
  maxEarlyBars?: number;
}

export interface FeedController {
  readonly loading: boolean;
  readonly noMoreData: boolean;
  /** The first page failed and nothing is loaded; retry() asks again. */
  readonly failed: boolean;
  /** Request the first page again after a failure (no-op otherwise). */
  retry(): void;
  /** Stop requests and the live subscription. */
  dispose(): void;
}

const barTime = (b: BarsResponse["bars"]): { first: number; last: number } | undefined => {
  if (Array.isArray(b)) {
    const a = b as readonly { time: number }[];
    return a.length ? { first: a[0]!.time, last: a[a.length - 1]!.time } : undefined;
  }
  const t = (b as ColumnarOhlc | ColumnarValue).time;
  return t.length ? { first: t[0]!, last: t[t.length - 1]! } : undefined;
};

export function connectDatafeed<T extends SeriesType>(chart: Chart, series: Series<T>, feed: Datafeed, options: FeedOptions): FeedController {
  const pageSize = options.pageSize ?? 2000;
  const prefetch = options.prefetchBars ?? 300;
  const ac = new AbortController();
  let loading = true;
  let noMoreData = false;
  let ready = false;
  let firstTime = Number.NaN;
  let lastTime = Number.NaN;
  const early: (OhlcBar | ValuePoint)[] = [];
  let unsubscribe: (() => void) | undefined;
  let offRange: (() => void) | undefined;

  const fail = (e: unknown) => {
    if (ac.signal.aborted) return;
    options.onError(e);
  };

  const maxEarly = options.maxEarlyBars ?? 10_000;
  let overflowReported = false;
  let failed = false;

  const live = (bar: OhlcBar | ValuePoint) => {
    if (ac.signal.aborted) return;
    if (!ready) {
      if (early.length < maxEarly) early.push(bar);
      else if (!overflowReported) {
        overflowReported = true;
        fail(new Error(`datafeed: more than ${maxEarly} live bars arrived before the first history page; later ones were dropped`));
      }
      return;
    }
    try {
      series.update(bar as never);
      lastTime = Math.max(lastTime, bar.time);
    } catch (e) {
      fail(e);
    }
  };

  const loadOlder = () => {
    if (loading || noMoreData || !ready || Number.isNaN(firstTime)) return;
    loading = true;
    feed
      .getBars({ symbol: options.symbol, resolution: options.resolution, to: firstTime - 1, countBack: pageSize }, ac.signal)
      .then((r) => {
        if (ac.signal.aborted) return;
        const span = barTime(r.bars);
        if (span) {
          series.prepend(r.bars as never);
          firstTime = span.first;
        }
        noMoreData = r.noMoreData || !span;
      })
      .catch(fail)
      .finally(() => {
        loading = false;
      });
  };

  if (feed.subscribeBars) unsubscribe = feed.subscribeBars(options.symbol, options.resolution, live);

  const loadFirst = () => {
    loading = true;
    failed = false;
    feed
      .getBars({ symbol: options.symbol, resolution: options.resolution, to: options.to ?? Date.now(), countBack: pageSize }, ac.signal)
      .then((r) => {
        if (ac.signal.aborted) return;
        series.setData(r.bars as never);
        const span = barTime(r.bars);
        firstTime = span?.first ?? Number.NaN;
        lastTime = span?.last ?? Number.NaN;
        noMoreData = r.noMoreData || !span;
        ready = true;
        for (const b of early) if (Number.isNaN(lastTime) || b.time >= lastTime) live(b);
        early.length = 0;
        offRange = chart.on("visibleRangeChange", (e) => {
          const first = series.range()?.first;
          if (first !== undefined && e.from < first + prefetch) loadOlder();
        });
      })
      .catch((e) => {
        failed = !ready;
        fail(e);
      })
      .finally(() => {
        loading = false;
      });
  };
  loadFirst();

  return {
    get loading() {
      return loading;
    },
    get noMoreData() {
      return noMoreData;
    },
    get failed() {
      return failed;
    },
    retry() {
      if (failed && !loading && !ac.signal.aborted) loadFirst();
    },
    dispose() {
      ac.abort();
      unsubscribe?.();
      offRange?.();
    },
  };
}
