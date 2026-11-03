// One chart of the grid: its core Chart, the bars of its symbol, the series
// each chart type draws, studies, drawings, alerts and compare symbols, and
// the datafeed plumbing (first page, older pages on scroll, live bars).
//
// The raw bars live in an ArrayBarSource (the drawings' and alerts' bar
// source). Studies read a hidden-or-shown candles series ("main") that always
// holds them. The time-based chart types draw extra series from the same bars;
// the ordinal ones (Renko, Kagi, ...) replace main altogether and switch the
// analysis plugins off, because those are anchored on real time.

import {
  parseColor, type Chart, type LayoutStore, type OhlcBar, type PriceScaleOptions, type Series, type SeriesType, type Theme,
} from "@alphacharts/core";
import { AlertsPlugin, type AlertDefinition, type AlertStatus, type AlertTrigger, type Condition, type SavedAlerts, type Tick, type TriggerOptions } from "@alphacharts/alerts";
import { ArrayBarSource, DrawingsPlugin, type Drawing, type DrawingsState, type MagnetMode, type ToolDef } from "@alphacharts/drawings";
import { HeikinAshi, Kagi, LineBreak, PointFigure, RangeBars, Renko, ordinalTimeLabel, type BarStore } from "@alphacharts/chart-types";
import { OrderFlow, attachFootprint, barsClock, loadTrades, type FootprintHandle, type TradeLoader } from "@alphacharts/orderflow";
import { installStudies, type Study, type StudiesPlugin } from "@alphacharts/indicators";
import type { InputValue, StudyDef } from "@alphacharts/indicators";
import { Emitter } from "../emitter.js";
import { chartTypeDef, decimalsOf, derivedSize, type ChartTypeId } from "../model/chartTypes.js";
import { intervalId, isIntraday, normalizeInterval, parseInterval } from "../model/intervals.js";
import type { UiDatafeed } from "../types.js";
import { floorIndex, rowsOf, toCols, type Cols } from "./bars.js";

export const PAGE = 1500;
const PREFETCH = 300;
const FOOTPRINT_BARS = 120;

export interface InstanceHost {
  readonly feed: UiDatafeed;
  readonly store: LayoutStore;
  readonly tools: readonly ToolDef[];
  /** A registered study by id (state restore). */
  studyDef(id: string): StudyDef;
  /** Loads the study definitions (a saved layout may need ones not yet loaded). */
  ensureStudies(): Promise<void>;
  report(e: unknown): void;
  alertFired(inst: ChartInstance, t: AlertTrigger): void;
  hostTheme(): Theme;
  magnet(): MagnetMode;
}

export interface StudyState {
  /** The study's instance id; alerts refer to a study by it ("<id>:<column>"). Absent in layouts saved before ids were kept: a restore then numbers it afresh. */
  id?: string;
  study: string;
  inputs: Record<string, InputValue>;
  styles: Record<string, { color?: string; width?: number }>;
  userHidden: boolean;
  intervals: string[] | null;
}

interface Slot {
  study: Study;
  userHidden: boolean;
  intervals: string[] | null;
}

export interface CompareState {
  symbol: string;
  mode: "same" | "scale" | "pane";
}

export interface InstanceState {
  symbol: string;
  interval: string;
  chartType: ChartTypeId;
  typeParams: Partial<Record<"box" | "reversal" | "range" | "lines", number>>;
  styles: Partial<Record<ChartTypeId, Record<string, unknown>>>;
  studies: StudyState[];
  drawings: Record<string, DrawingsState>;
  alerts: Record<string, SavedAlerts>;
  compares: CompareState[];
  scales: { right: Partial<PriceScaleOptions>; left: Partial<PriceScaleOptions> };
  options: Record<string, unknown>;
  /** Highest study id number ever issued on this chart: ids of removed studies are not reused after a reload. */
  studySeq?: number;
}

interface Compare extends CompareState {
  series: Series<"line">;
  stop: () => void;
}

export type Status = "loading" | "ready" | "empty" | "error";

export interface InstanceEvents {
  /** Structure changed: status, studies, series, alerts, plugins. */
  change: void;
  /** Data changed: a live bar, a page. */
  data: void;
  /** A drawing the user made, changed or removed (not one a loaded layout brought). Survives the drawings plugin being re-created. */
  drawing: { kind: "created" | "changed" | "removed"; drawing: Drawing };
}

const COMPARE_COLORS = ["#f7a600", "#7e57c2", "#26c6da", "#ec407a", "#8bc34a"];
const EMPTY_DRAWINGS: DrawingsState = { version: 1, drawings: [] };
const EMPTY_ALERTS: SavedAlerts = { version: 1, alerts: [] };

const packed = (css: string, alpha: number): number => (((parseColor(css) & 0xffffff00) | alpha) >>> 0);

export class ChartInstance {
  readonly events = new Emitter<InstanceEvents>();
  readonly raw = new ArrayBarSource();
  symbol: string;
  interval: string;
  chartType: ChartTypeId;
  status: Status = "loading";
  error: Error | null = null;
  hasVolume = false;
  /** The step the loaded bars need (the finest of all of them): sizes derived from the price (boxes, baseline) are multiples of it. Not what the axis shows, see `priceFormat`. */
  minMove = 0.01;
  /** The instrument's tick size from the datafeed's `resolveSymbol`, or null when the feed does not say. */
  tickSize: number | null = null;
  /** A saved chart's studies and compares waiting for bars to be restored over; saved as they are meanwhile. */
  private pendingRestore: { studies: InstanceState["studies"]; compares: InstanceState["compares"] } | null = null;
  /**
   * True while the alerts plugin does not hold this symbol's saved alerts
   * because the studies they may watch are not restored yet. The saved alerts
   * stay in `alertStash` untouched meanwhile and are loaded by `releaseAlerts`.
   */
  private alertsHeld = false;
  /** Tick time never goes back: bar updates carry no tick time, so the wall clock stands in. */
  private lastTickTime = -Infinity;
  private loadedInterval: string | null = null;
  typeParams: InstanceState["typeParams"] = {};
  styles: InstanceState["styles"] = {};
  main: Series<"candles"> | null = null;
  volume: Series<"histogram"> | null = null;
  drawings: DrawingsPlugin | null = null;
  alerts: AlertsPlugin | null = null;
  readonly studiesPlugin: StudiesPlugin;
  /** Series the current chart type draws besides (or instead of) main. */
  displaySeries: Series<SeriesType>[] = [];
  /** The derived bars of an event-based type, for the legend. */
  store: BarStore | null = null;
  footprintHandle: FootprintHandle | null = null;

  private slots: Slot[] = [];
  private compares: Compare[] = [];
  private mode: "time" | "ordinal" = "time";
  private gen = 0;
  private abort: AbortController | null = null;
  private unsubLive: (() => void) | null = null;
  private early: Cols[] = [];
  private ready = false;
  private noMore = false;
  private loadingOlder = false;
  private stashedStudies: StudyState[] = [];
  /** Compares of the time-based chart, kept while an event-based type is shown. */
  private stashedCompares: CompareState[] = [];
  private readonly drawStash = new Map<string, DrawingsState>();
  private readonly alertStash = new Map<string, SavedAlerts>();
  private ha: HeikinAshi | null = null;
  private derivedSync: ((bar: OhlcBar) => void) | null = null;
  private rebuildQueued = false;
  private flow: OrderFlow | null = null;
  private loader: TradeLoader | null = null;
  private offRange: () => void;
  private switchedScale = false;
  private disposed = false;
  private alertSeq = 0;
  readonly alertMeta = new Map<string, { createdAt: number }>();

  constructor(readonly chart: Chart, private readonly host: InstanceHost, init: { symbol: string; interval: string; chartType: ChartTypeId }) {
    this.symbol = init.symbol;
    this.interval = normalizeInterval(init.interval);
    this.chartType = init.chartType;
    this.studiesPlugin = installStudies(chart, { resolve: (id) => host.studyDef(id) });
    chart.applyOptions({ resolution: this.interval });
    this.installAnalysis();
    this.offRange = chart.on("visibleRangeChange", (e) => {
      const first = this.main?.range()?.first;
      if (first !== undefined && e.from < first + PREFETCH) void this.loadOlder();
    });
    void this.load();
  }

  // ---- plugins ----------------------------------------------------------------

  /** `holdAlerts`: leave the saved alerts in the stash until `releaseAlerts` (the studies they watch are restored after this). */
  private installAnalysis(holdAlerts = false): void {
    const intervalMs = intervalId(this.interval);
    const d = new DrawingsPlugin({
      tools: this.host.tools, source: this.raw, interval: intervalMs, store: this.host.store, magnet: this.host.magnet(),
      onError: (e) => this.host.report(e),
    });
    this.chart.addPlugin(d);
    d.events.on("history", () => this.events.emit("change", undefined));
    // What the user drew, changed or deleted is told to the app (to mirror it, or to keep the tool). A layout being loaded is not.
    for (const kind of ["created", "changed", "removed"] as const) {
      d.events.on(kind, (drawing) => {
        this.events.emit("change", undefined);
        if (!d.restoring) this.events.emit("drawing", { kind, drawing });
      });
    }
    d.events.on("selected", () => this.events.emit("change", undefined));
    d.events.on("tool", () => this.events.emit("change", undefined));
    this.drawings = d;
    const a = new AlertsPlugin({
      drawings: d, source: this.raw, indicators: this.indicators(), onError: (e) => this.host.report(e),
      onTrigger: (t) => this.host.alertFired(this, t),
    });
    a.on("status", () => this.events.emit("change", undefined));
    this.chart.addPlugin(a);
    this.alerts = a;
    this.alertsHeld = holdAlerts;
    this.restoreStash();
  }

  private removeAnalysis(): void {
    this.stashCurrent();
    for (const id of ["drawings", "alerts"]) this.chart.removePlugin(id);
    this.drawings = null;
    this.alerts = null;
  }

  private stashCurrent(): void {
    if (this.drawings) this.drawStash.set(this.symbol, this.drawings.toJSON());
    // Held: the plugin is empty on purpose, and what is in the stash is the saved truth.
    if (this.alerts && !this.alertsHeld) this.alertStash.set(this.symbol, this.alerts.toJSON());
  }

  private restoreStash(): void {
    this.drawings?.fromJSON(this.drawStash.get(this.symbol) ?? EMPTY_DRAWINGS);
    if (!this.alertsHeld) this.alerts?.fromJSON(this.alertStash.get(this.symbol) ?? EMPTY_ALERTS);
  }

  /** Load this symbol's saved alerts into the plugin, now that the studies they watch exist. Throws (and stays held) when the plugin refuses them. */
  private releaseAlerts(): void {
    if (!this.alerts || !this.alertsHeld) return;
    this.alerts.fromJSON(this.alertStash.get(this.symbol) ?? EMPTY_ALERTS);
    this.alertsHeld = false;
    this.events.emit("change", undefined);
  }

  /**
   * Indicator values by "<study>:<column>" for indicator alerts. The study is
   * looked up when a tick is evaluated, not when the alert is created, so an
   * alert can be restored before its study is; a study that is not there when
   * a tick arrives stops that alert with the reason (status "error").
   */
  private indicators(): Record<string, (t: Tick) => number | undefined> {
    return new Proxy({} as Record<string, (t: Tick) => number | undefined>, {
      get: (_t, key) => {
        if (typeof key !== "string") return undefined;
        const [sid, col] = key.split(":");
        if (!sid || !col) return undefined;
        return (t: Tick) => {
          const slot = this.slots.find((s) => s.study.id === sid);
          if (!slot) throw new Error(`study "${sid}" is not on the chart`);
          if (!slot.study.def.columns.includes(col)) throw new Error(`study "${sid}" (${slot.study.def.id}) has no column "${col}"`);
          const times = slot.study.times();
          const i = floorIndex(times, t.bar);
          if (i < 0 || times[i] !== t.bar) return undefined;
          const v = slot.study.column(col)[i]!;
          return Number.isNaN(v) ? undefined : v;
        };
      },
    });
  }

  // ---- loading ------------------------------------------------------------------

  private setStatus(s: Status, e?: Error): void {
    this.status = s;
    this.error = e ?? null;
    this.events.emit("change", undefined);
  }

  retry(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    this.abort?.abort();
    this.unsubLive?.();
    this.unsubLive = null;
    const ac = (this.abort = new AbortController());
    const gen = ++this.gen;
    this.ready = false;
    this.early = [];
    this.noMore = false;
    // A new tick series: the old one's bar and time order must not judge it.
    // Same interval: bar times still mean the same, so a once-per-bar alert keeps the bar it fired on (a symbol switch or Retry must not fire it again).
    this.alerts?.resetClock({ keepTriggerBars: this.loadedInterval === this.interval });
    this.loadedInterval = this.interval;
    this.lastTickTime = -Infinity;
    this.setStatus("loading");
    const feed = this.host.feed;
    if (feed.subscribeBars) {
      this.unsubLive = feed.subscribeBars(this.symbol, this.interval, (b) => {
        if (gen !== this.gen) return;
        try {
          const c = toCols([b as never], "live bar");
          if (!this.ready) this.early.push(c);
          else this.onLive(c);
        } catch (e) {
          this.host.report(e);
        }
      });
    }
    try {
      const info = feed.resolveSymbol ? await feed.resolveSymbol(this.symbol, ac.signal) : null;
      if (gen !== this.gen) return;
      if (info?.tickSize !== undefined && !(info.tickSize > 0)) throw new RangeError(`resolveSymbol(${this.symbol}): tickSize ${info.tickSize} must be positive`);
      this.tickSize = info?.tickSize ?? null;
      const r = await feed.getBars({ symbol: this.symbol, resolution: this.interval, to: Date.now(), countBack: PAGE }, ac.signal);
      if (gen !== this.gen) return;
      const cols = toCols(r.bars, `getBars(${this.symbol}, ${this.interval})`);
      this.noMore = r.noMoreData || cols.time.length === 0;
      if (cols.time.length === 0) {
        this.applyEmpty();
        this.ready = true;
        this.setStatus("empty");
        await this.applyPending(gen);
        return;
      }
      this.applyFull(cols);
      this.ready = true;
      const last = cols.time[cols.time.length - 1]!;
      for (const e of this.early) if (e.time[0]! >= last) this.onLive(e);
      this.early = [];
      this.setStatus("ready");
      this.events.emit("data", undefined);
      void this.reloadCompares();
      await this.applyPending(gen);
    } catch (e) {
      if (gen !== this.gen || ac.signal.aborted) return;
      const err = e instanceof Error ? e : new Error(String(e));
      this.setStatus("error", err);
      this.host.report(err);
    }
  }

  /**
   * Restore what a saved chart carried over bars: its studies and compares,
   * then its alerts (which may watch those studies). Runs at the end of every
   * successful load, so a restore whose first load failed or was superseded is
   * applied by the next one that works.
   */
  private async applyPending(gen: number): Promise<void> {
    try {
      const pending = this.pendingRestore;
      if (pending) {
        if (pending.studies.length) await this.host.ensureStudies();
        if (this.disposed || gen !== this.gen || this.pendingRestore !== pending) return;
        this.pendingRestore = null;
        for (const st of pending.studies) {
          if (this.mode === "time") this.restoreStudy(st);
          else this.stashedStudies.push(st);
        }
        for (const c of pending.compares) {
          if (this.mode === "time") this.addCompare(c.symbol, c.mode).catch((e) => this.host.report(e));
          else this.stashedCompares.push(c);
        }
      }
      this.releaseAlerts();
    } catch (e) {
      this.host.report(e);
    }
  }

  private async loadOlder(): Promise<void> {
    if (this.loadingOlder || this.noMore || !this.ready || this.mode !== "time" || !this.main) return;
    const first = this.raw.length > 0 ? this.raw.at(0).time : undefined;
    if (first === undefined) return;
    this.loadingOlder = true;
    const gen = this.gen;
    try {
      const r = await this.host.feed.getBars({ symbol: this.symbol, resolution: this.interval, to: first - 1, countBack: PAGE }, this.abort!.signal);
      if (gen !== this.gen) return;
      const cols = toCols(r.bars, "older page");
      if (cols.time.length) {
        if (cols.time[cols.time.length - 1]! >= first) throw new RangeError(`getBars returned a bar at ${cols.time[cols.time.length - 1]} for a request ending before ${first}`);
        this.widenPrecision(cols);
        this.raw.prepend({ time: cols.time, open: cols.open, high: cols.high, low: cols.low, close: cols.close, volume: cols.volume ?? new Float64Array(cols.time.length) });
        this.main.prepend(cols as never);
        if (this.volume && cols.volume) this.volume.prepend(this.volumeData(cols) as never);
        this.rebuildDisplay();
      }
      this.noMore = r.noMoreData || cols.time.length === 0;
      this.events.emit("data", undefined);
    } catch (e) {
      if (gen === this.gen && !this.abort!.signal.aborted) this.host.report(e);
    } finally {
      this.loadingOlder = false;
    }
  }

  private volumeData(c: Cols): { time: Float64Array; value: Float64Array; color: Uint32Array } {
    const t = this.host.hostTheme();
    const up = packed(t.up, 0x80), down = packed(t.down, 0x80);
    const color = new Uint32Array(c.time.length);
    for (let i = 0; i < color.length; i++) color[i] = c.close[i]! >= c.open[i]! ? up : down;
    return { time: c.time, value: c.volume!, color };
  }

  private applyEmpty(): void {
    this.raw.setData({ time: [], open: [], high: [], low: [], close: [], volume: [] });
    this.hasVolume = false;
    const z = () => new Float64Array(0);
    this.structure({ time: z(), open: z(), high: z(), low: z(), close: z(), volume: null });
  }

  private applyFull(cols: Cols): void {
    this.hasVolume = cols.volume !== null;
    this.raw.setData({ time: cols.time, open: cols.open, high: cols.high, low: cols.low, close: cols.close, volume: cols.volume ?? new Float64Array(cols.time.length) });
    let dec = 0;
    for (const a of [cols.open, cols.high, cols.low, cols.close]) for (let i = 0; i < a.length; i++) dec = Math.max(dec, decimalsOf(a[i]!));
    this.minMove = 10 ** -dec;
    this.structure(cols);
  }

  /** Make the series match the chart type and the bars: the one place series are created or removed. */
  private structure(cols: Cols | null = null): void {
    const def = chartTypeDef(this.chartType);
    const want = def.kind;
    if (want !== this.mode) {
      if (want === "ordinal") this.enterOrdinal();
      else this.leaveOrdinal();
    }
    if (this.mode === "time") {
      const c = cols ?? this.colsFromRaw();
      if (!this.main) this.createMain();
      this.main!.applyOptions({ priceFormat: this.priceFormat() } as never);
      this.main!.setData(c as never);
      if (this.hasVolume) {
        if (!this.volume) this.createVolume();
        this.volume!.setData(this.volumeData(c) as never);
      } else if (this.volume) {
        this.chart.removeSeries(this.volume);
        this.volume = null;
      }
    }
    this.rebuildDisplay();
  }

  private colsFromRaw(): Cols {
    const n = this.raw.length;
    const c: Cols = { time: new Float64Array(n), open: new Float64Array(n), high: new Float64Array(n), low: new Float64Array(n), close: new Float64Array(n), volume: this.hasVolume ? new Float64Array(n) : null };
    for (let i = 0; i < n; i++) {
      const b = this.raw.at(i);
      c.time[i] = b.time; c.open[i] = b.open; c.high[i] = b.high; c.low[i] = b.low; c.close[i] = b.close;
      if (c.volume) c.volume[i] = b.volume;
    }
    return c;
  }

  private createMain(): void {
    this.main = this.chart.addSeries("candles", { id: "main", title: this.symbol, priceFormat: this.priceFormat(), scaleFormat: true }) as never;
  }

  private createVolume(): void {
    this.volume = this.chart.addSeries("histogram", { id: "volume", priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false, priceFormat: { type: "volume" } }) as never;
    this.chart.priceScale("vol").applyOptions({ marginTop: 0.8, marginBottom: 0 });
  }

  // ---- display per chart type -----------------------------------------------------

  private clearDisplay(): void {
    this.loader?.dispose();
    this.loader = null;
    this.footprintHandle?.dispose();
    this.footprintHandle = null;
    this.flow = null;
    for (const s of this.displaySeries) this.chart.removeSeries(s);
    this.displaySeries = [];
    this.ha = null;
    this.derivedSync = null;
    this.store = null;
  }

  private styled(extra: Record<string, unknown>): Record<string, unknown> {
    return { ...extra, ...(this.styles[this.chartType] ?? {}) };
  }

  private rebuildDisplay(): void {
    this.clearDisplay();
    const id = this.chartType;
    const pf = this.priceFormat();
    const add = (type: string, o: Record<string, unknown>) => {
      const s = this.chart.addSeries(type as SeriesType, this.styled({ priceFormat: pf, title: this.symbol, ...o }) as never);
      this.displaySeries.push(s as never);
      return s as unknown as Series<SeriesType>;
    };
    const n = this.raw.length;
    if (n === 0) {
      this.main?.applyOptions({ visible: id === "candles" } as never);
      return;
    }
    const cols = n ? this.colsFromRaw() : null;
    const value = cols ? { time: cols.time, value: cols.close } : null;
    const showMain = id === "candles";
    this.main?.applyOptions({ visible: showMain, ...(showMain ? this.styles[id] ?? {} : {}), lastValueVisible: showMain, priceLineVisible: showMain } as never);
    switch (id) {
      case "candles":
        break;
      case "bars": case "hiLo": case "columns": {
        const t = { bars: "bars", hiLo: "hi-lo", columns: "columns" }[id];
        add(t, {}).setData(cols as never);
        break;
      }
      case "line": case "area": case "stepLine": {
        const t = { line: "line", area: "area", stepLine: "step-line" }[id];
        add(t, {}).setData(value as never);
        break;
      }
      case "baseline": {
        const closes = cols!.close;
        let lo = Infinity, hi = -Infinity;
        for (let i = Math.max(0, closes.length - 100); i < closes.length; i++) (lo = Math.min(lo, closes[i]!), (hi = Math.max(hi, closes[i]!)));
        const base = Number(((lo + hi) / 2).toFixed(decimalsOf(this.minMove)));
        add("baseline", { base }).setData(value as never);
        break;
      }
      case "heikinAshi": {
        const ha = new HeikinAshi();
        ha.pushAll(rowsOf(cols!));
        this.ha = ha;
        const s = add("candles", {});
        s.setData(ha.store.columns() as never);
        this.derivedSync = (bar) => {
          ha.push(bar);
          const b = ha.store.bar(ha.store.length - 1);
          s.update({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close } as never);
        };
        this.store = ha.store;
        break;
      }
      case "renko": case "kagi": case "pointFigure": case "rangeBars": case "lineBreak":
        this.buildOrdinal(id, cols!, add);
        break;
      case "footprint":
        this.buildFootprint();
        break;
    }
  }

  private lastClose(): number {
    return this.raw.at(this.raw.length - 1).close;
  }

  /** Size parameter of an ordinal type: the user's, else derived from the last close. */
  /** Renko with no box set sizes its bricks from the 14-bar ATR, not from paramValue's fallback. */
  get boxFromAtr(): boolean {
    return this.chartType === "renko" && this.typeParams.box === undefined;
  }

  paramValue(kind: "box" | "reversal" | "range" | "lines"): number {
    const set = this.typeParams[kind];
    if (set !== undefined) return set;
    if (kind === "lines") return 3;
    if (this.raw.length === 0) throw new Error("no bars to derive a size from");
    const f = kind === "range" ? 0.005 : 0.01;
    return derivedSize(this.lastClose(), f, this.minMove);
  }

  private buildOrdinal(id: ChartTypeId, cols: Cols, add: (t: string, o: Record<string, unknown>) => Series<SeriesType>): void {
    const rows = rowsOf(cols);
    let store: BarStore;
    let s: Series<SeriesType>;
    const box = () => this.paramValue("box");
    switch (id) {
      case "renko": {
        const t = this.typeParams.box !== undefined ? new Renko({ box: this.typeParams.box }) : new Renko({ atrPeriod: 14 });
        t.pushBars(rows);
        store = t.store;
        s = add("bricks", {});
        break;
      }
      case "kagi": {
        const t = new Kagi({ amount: this.paramValue("reversal") });
        t.pushBars(rows);
        store = t.store;
        s = add("kagi", { lineWidth: 1 });
        const thick = add("kagi", { lineWidth: 3, connectors: false, lastValueVisible: false, priceLineVisible: false });
        thick.setData(t.thick.columns() as never);
        break;
      }
      case "pointFigure": {
        const b = box();
        const t = new PointFigure(b, 3);
        t.pushBars(rows);
        store = t.store;
        s = add("point-figure", { boxSize: b });
        break;
      }
      case "rangeBars": {
        const t = new RangeBars(this.paramValue("range"));
        t.pushBars(rows);
        store = t.store;
        s = add("candles", {});
        break;
      }
      default: {
        const t = new LineBreak(this.paramValue("lines"));
        t.pushBars(rows);
        store = t.store;
        s = add("bricks", {});
      }
    }
    if (store.length > 0) s.setData(store.columns() as never);
    this.store = store;
    this.displaySeries.unshift(...this.displaySeries.splice(this.displaySeries.indexOf(s), 1));
  }

  private buildFootprint(): void {
    const feed = this.host.feed;
    if (!feed.getTrades) throw new Error("the datafeed has no getTrades; the footprint needs trades");
    if (this.tickSize === null) throw new Error(`the footprint needs ${this.symbol}'s tick size: the datafeed's resolveSymbol must return it`);
    if (!isIntraday(this.interval)) throw new RangeError(`the footprint is built for second, minute and hour intervals, not ${this.interval}`);
    const periodMs = intervalId(this.interval);
    const raw = this.raw;
    const n = this.raw.length;
    const from = this.raw.at(Math.max(0, n - FOOTPRINT_BARS)).time;
    const to = Math.min(Date.now(), this.raw.at(n - 1).time + periodMs);
    // Bars start where the feed's bars start (an exchange that opens at 09:15 has half-hour bars at :15 and :45), not on the UTC grid.
    const flow = new OrderFlow({ tickSize: this.tickSize!, clock: barsClock({ get length() { return raw.length; }, timeAt: (i) => raw.at(i).time }, periodMs) });
    this.flow = flow;
    this.footprintHandle = attachFootprint(this.chart, flow);
    this.displaySeries.push(this.footprintHandle.series as never);
    this.loader = loadTrades(flow, feed, { symbol: this.symbol, from, to, onError: (e) => this.host.report(e) });
  }

  private enterOrdinal(): void {
    this.stashedStudies = this.studyStates();
    for (const s of [...this.slots]) s.study.remove();
    this.slots = [];
    // A compare is a time series on the time axis; an event-based chart has none. It is kept for the way back.
    this.stashedCompares = this.compareList().map((c) => ({ ...c }));
    for (const c of this.stashedCompares) this.removeCompare(c.symbol);
    this.removeAnalysis();
    this.clearDisplay();
    if (this.volume) this.chart.removeSeries(this.volume);
    if (this.main) this.chart.removeSeries(this.main);
    this.volume = null;
    this.main = null;
    this.mode = "ordinal";
    this.chart.applyOptions({ timeLabel: ordinalTimeLabel });
  }

  private leaveOrdinal(): void {
    this.mode = "time";
    this.chart.applyOptions({ timeLabel: undefined });
    this.clearDisplay();
    this.createMain();
    if (this.hasVolume) this.createVolume();
    // Alerts may watch the studies, which come back below: they load after them.
    this.installAnalysis(true);
    const stash = this.stashedStudies;
    this.stashedStudies = [];
    this.pendingStudies = stash;
    const compares = this.stashedCompares;
    this.stashedCompares = [];
    // Studies and compares are re-added once the bars are on the main series (structure() continues).
    queueMicrotask(() => {
      if (this.disposed || this.mode !== "time") return;
      for (const s of this.pendingStudies.splice(0)) this.restoreStudy(s);
      for (const c of compares) this.addCompare(c.symbol, c.mode).catch((e) => this.host.report(e));
      // A saved chart still to restore (fromJSON) loads them itself, after its own studies.
      if (!this.pendingRestore) {
        try {
          this.releaseAlerts();
        } catch (e) {
          this.host.report(e);
        }
      }
    });
  }
  private pendingStudies: StudyState[] = [];

  get ordinal(): boolean {
    return this.mode === "ordinal";
  }

  // ---- live ------------------------------------------------------------------------

  /** A bar with more decimals than the price format shows must not be displayed rounded. */
  private widenPrecision(c: Cols): void {
    let dec = decimalsOf(this.minMove);
    const was = dec;
    for (const a of [c.open, c.high, c.low, c.close]) for (let i = 0; i < a.length; i++) dec = Math.max(dec, decimalsOf(a[i]!));
    if (dec === was) return;
    this.minMove = 10 ** -dec;
    // Without a tick size the core widens every series' format from its own data; with one, the format is ours to keep wide enough.
    if (this.tickSize !== null) for (const s of [this.main, ...this.displaySeries]) s?.applyOptions({ priceFormat: this.priceFormat() } as never);
  }

  /**
   * What the price axis and labels show. The instrument's tick size when the
   * feed gave one (and the data keeps to it); otherwise nothing is fixed here
   * and the core derives each series' precision from that series' own data, so
   * no bar, old or new, is shown rounded.
   */
  private priceFormat(): { type: "price"; minMove?: number } {
    if (this.tickSize === null) return { type: "price" };
    return { type: "price", minMove: Math.min(this.tickSize, this.minMove) };
  }

  private onLive(c: Cols): void {
    this.widenPrecision(c);
    const bar = { time: c.time[0]!, open: c.open[0]!, high: c.high[0]!, low: c.low[0]!, close: c.close[0]! };
    this.raw.update({ ...bar, volume: c.volume ? c.volume[0]! : 0 });
    if (this.mode === "time") {
      this.main!.update(bar as never);
      if (this.volume && c.volume) {
        const t = this.host.hostTheme();
        this.volume.update({ time: bar.time, value: c.volume[0]!, color: bar.close >= bar.open ? t.up : t.down } as never);
      }
      for (const s of this.displaySeries) {
        if (this.footprintHandle && s === (this.footprintHandle.series as never)) continue;
        if (this.derivedSync) continue;
        const type = s.type as string;
        if (type === "line" || type === "area" || type === "step-line" || type === "baseline") s.update({ time: bar.time, value: bar.close } as never);
        else s.update(bar as never);
      }
      this.derivedSync?.(bar);
    } else if (!this.rebuildQueued) {
      this.rebuildQueued = true;
      requestAnimationFrame(() => {
        this.rebuildQueued = false;
        if (!this.disposed && this.mode === "ordinal") this.rebuildDisplay();
      });
    }
    try {
      // The bar is the bar's; the tick is now (a bar update carries no tick time of its own).
      this.lastTickTime = Math.max(Date.now(), this.lastTickTime);
      this.alerts?.tick({ time: this.lastTickTime, price: bar.close, bar: bar.time });
    } catch (e) {
      this.host.report(e);
    }
    this.events.emit("data", undefined);
  }

  // ---- symbol, interval, chart type ----------------------------------------------------

  setSymbol(symbol: string): void {
    if (symbol === this.symbol) return;
    this.stashCurrent();
    for (const c of this.compares) c.stop();
    this.symbol = symbol;
    this.main?.applyOptions({ title: symbol } as never);
    this.restoreStash();
    void this.load();
  }

  setInterval(interval: string): void {
    const next = normalizeInterval(interval);
    if (next === this.interval) return;
    parseInterval(next);
    this.interval = next;
    this.chart.applyOptions({ resolution: next });
    this.drawings?.setInterval(intervalId(next));
    this.applyStudyVisibility();
    void this.load();
  }

  setChartType(id: ChartTypeId): void {
    const def = chartTypeDef(id);
    if (def.needsTrades && !this.host.feed.getTrades) throw new Error("the datafeed has no getTrades; the footprint needs trades");
    const prev = this.chartType;
    this.chartType = id;
    try {
      if (this.raw.length > 0 || this.mode !== def.kind) this.structure();
    } catch (e) {
      // Leave the chart as it was: a type that cannot be built must not leave half a chart.
      this.chartType = prev;
      this.structure();
      throw e;
    }
    this.events.emit("change", undefined);
  }

  setTypeParam(kind: "box" | "reversal" | "range" | "lines", value: number | undefined): void {
    if (value !== undefined && !(value > 0)) throw new RangeError(`${kind} must be positive, got ${value}`);
    if (value === undefined) delete this.typeParams[kind];
    else this.typeParams[kind] = value;
    if (this.mode === "ordinal" && this.raw.length) this.rebuildDisplay();
    this.events.emit("change", undefined);
  }

  /** Apply series options to what the current chart type draws and remember them for that type. */
  setSeriesStyle(patch: Record<string, unknown>): void {
    this.styles[this.chartType] = { ...(this.styles[this.chartType] ?? {}), ...patch };
    const targets = this.chartType === "candles" ? (this.main ? [this.main] : []) : this.displaySeries;
    for (const s of targets) (s as Series<SeriesType>).applyOptions(patch as never);
    this.events.emit("change", undefined);
  }

  /** A price as this chart's price format writes it. */
  priceText(price: number): string {
    const s = this.main ?? this.displaySeries[0];
    if (!s) throw new Error("no series to format a price with");
    return s.formatPrice(price);
  }

  /** The series whose options the Symbol settings tab edits. */
  styleTarget(): Series<SeriesType> | null {
    if (this.chartType === "candles") return (this.main as never) ?? null;
    return this.displaySeries[0] ?? null;
  }

  /** Recolour what follows the theme (volume bars; series with unset colours follow it themselves). */
  themeChanged(): void {
    if (this.volume && this.hasVolume && this.raw.length) this.volume.setData(this.volumeData(this.colsFromRaw()) as never);
  }

  // ---- studies ------------------------------------------------------------------------

  studies(): ReadonlyArray<{ study: Study; userHidden: boolean; intervals: string[] | null; effectivelyVisible: boolean }> {
    return this.slots.map((s) => ({ study: s.study, userHidden: s.userHidden, intervals: s.intervals, effectivelyVisible: s.study.visible }));
  }

  addStudy(def: StudyDef, inputs: Record<string, InputValue> = {}, id?: string): Study {
    if (this.mode === "ordinal" || !this.main) throw new Error("studies are off while an event-based chart type is shown");
    const study = this.studiesPlugin.add(def, inputs, this.main, { ...(this.hasVolume && this.volume ? { volume: this.volume } : {}), ...(id !== undefined ? { id } : {}) });
    this.slots.push({ study, userHidden: false, intervals: null });
    study.ready().catch((e) => this.host.report(e));
    this.events.emit("change", undefined);
    return study;
  }

  private restoreStudy(s: StudyState): void {
    try {
      const study = this.addStudy(this.host.studyDef(s.study), s.inputs, s.id);
      for (const [k, st] of Object.entries(s.styles)) study.setStyle(k, st);
      const slot = this.slots.find((x) => x.study === study)!;
      slot.userHidden = s.userHidden;
      slot.intervals = s.intervals;
      this.applyStudyVisibility();
    } catch (e) {
      this.host.report(e);
    }
  }

  removeStudy(id: string): void {
    const i = this.slots.findIndex((s) => s.study.id === id);
    if (i < 0) return;
    this.slots[i]!.study.remove();
    this.slots.splice(i, 1);
    this.events.emit("change", undefined);
  }

  setStudyHidden(id: string, hidden: boolean): void {
    const s = this.slots.find((x) => x.study.id === id);
    if (!s) return;
    s.userHidden = hidden;
    this.applyStudyVisibility();
  }

  setStudyIntervals(id: string, intervals: string[] | null): void {
    const s = this.slots.find((x) => x.study.id === id);
    if (!s) return;
    s.intervals = intervals;
    this.applyStudyVisibility();
  }

  private applyStudyVisibility(): void {
    for (const s of this.slots) {
      const show = !s.userHidden && (s.intervals === null || s.intervals.includes(this.interval));
      if (s.study.visible !== show) s.study.setVisible(show);
    }
    this.events.emit("change", undefined);
  }

  private studyStates(): StudyState[] {
    return this.slots.map((s) => {
      const st = s.study.state();
      return { id: st.id, study: st.study, inputs: st.inputs, styles: st.styles, userHidden: s.userHidden, intervals: s.intervals };
    });
  }

  // ---- compare ----------------------------------------------------------------------------

  compareList(): readonly CompareState[] {
    return this.compares.map(({ symbol, mode }) => ({ symbol, mode }));
  }

  async addCompare(symbol: string, mode: CompareState["mode"]): Promise<void> {
    if (this.mode === "ordinal") throw new Error("compare is off while an event-based chart type is shown");
    if (symbol === this.symbol || this.compares.some((c) => c.symbol === symbol)) throw new Error(`${symbol} is already on the chart`);
    const color = COMPARE_COLORS[this.compares.length % COMPARE_COLORS.length]!;
    const pane = mode === "pane" ? Math.max(1, ...this.chart.series().map((s) => s.options().pane + 1)) : 0;
    const series = this.chart.addSeries("line", {
      id: `compare:${symbol}`, title: symbol, color, lineWidth: 1.5, pane, priceScaleId: mode === "scale" ? "left" : "right",
      priceFormat: { type: "price" },
    }) as never as Series<"line">;
    if (mode === "scale") this.chart.applyOptions({ leftPriceScale: { visible: true } });
    if (mode === "same" && this.chart.options().rightPriceScale.mode === "linear") {
      this.chart.applyOptions({ rightPriceScale: { mode: "percent" } });
      this.switchedScale = true;
    }
    const entry: Compare = { symbol, mode, series, stop: () => {} };
    this.compares.push(entry);
    this.events.emit("change", undefined);
    await this.loadCompare(entry);
  }

  private async loadCompare(c: Compare): Promise<void> {
    const ac = new AbortController();
    let off: (() => void) | undefined;
    c.stop = () => {
      ac.abort();
      off?.();
    };
    try {
      const r = await this.host.feed.getBars({ symbol: c.symbol, resolution: this.interval, to: Date.now(), countBack: PAGE }, ac.signal);
      if (ac.signal.aborted) return;
      const cols = toCols(r.bars, `compare ${c.symbol}`);
      c.series.setData({ time: cols.time, value: cols.close } as never);
      off = this.host.feed.subscribeBars?.(c.symbol, this.interval, (b) => {
        try {
          const x = toCols([b as never], "compare live bar");
          c.series.update({ time: x.time[0]!, value: x.close[0]! } as never);
        } catch (e) {
          this.host.report(e);
        }
      });
    } catch (e) {
      if (!ac.signal.aborted) {
        this.removeCompare(c.symbol);
        this.host.report(e);
      }
    }
  }

  private async reloadCompares(): Promise<void> {
    await Promise.all(this.compares.map((c) => (c.stop(), this.loadCompare(c))));
  }

  removeCompare(symbol: string): void {
    const i = this.compares.findIndex((c) => c.symbol === symbol);
    if (i < 0) return;
    const [c] = this.compares.splice(i, 1);
    c!.stop();
    this.chart.removeSeries(c!.series);
    if (this.compares.length === 0 && this.switchedScale) {
      this.chart.applyOptions({ rightPriceScale: { mode: "linear" } });
      this.switchedScale = false;
    }
    this.events.emit("change", undefined);
  }

  // ---- alerts -------------------------------------------------------------------------------

  /** Active alerts nobody is evaluating: stored for other symbols, or for this one while an event-based type is shown. */
  pausedAlerts(): number {
    this.stashCurrent();
    let n = 0;
    for (const [sym, saved] of this.alertStash) {
      if (sym === this.symbol && this.alerts && !this.alertsHeld) continue;
      n += saved.alerts.filter((a) => a.status === "active").length;
    }
    return n;
  }

  alertList(): Array<{ definition: AlertDefinition; status: AlertStatus; createdAt: number }> {
    return (this.alerts?.list() ?? []).map((a) => ({ ...a, createdAt: this.alertMeta.get(a.definition.id)?.createdAt ?? 0 }));
  }

  addAlert(condition: Condition, trigger: TriggerOptions, o: { label?: string; expiresAt?: number | null } = {}): AlertDefinition {
    if (!this.alerts) throw new Error("alerts are off while an event-based chart type is shown");
    if (this.alertsHeld) throw new Error("the saved alerts are still being restored");
    const id = `a${Date.now().toString(36)}${++this.alertSeq}`;
    const def: AlertDefinition = { id, condition, trigger, ...(o.label ? { label: o.label } : {}), ...(o.expiresAt !== undefined ? { expiresAt: o.expiresAt } : {}) };
    this.alerts.add(def);
    this.alertMeta.set(id, { createdAt: Date.now() });
    this.events.emit("change", undefined);
    return def;
  }

  addDrawingAlert(drawingId: string, line: string, op: "crossing" | "crossingUp" | "crossingDown" | "enteringChannel" | "exitingChannel", trigger: TriggerOptions, o: { label?: string; expiresAt?: number | null } = {}): AlertDefinition {
    if (!this.alerts) throw new Error("alerts are off while an event-based chart type is shown");
    if (this.alertsHeld) throw new Error("the saved alerts are still being restored");
    const id = `a${Date.now().toString(36)}${++this.alertSeq}`;
    const def = this.alerts.addDrawingAlert({ id, drawingId, line, op, trigger, ...o });
    this.alertMeta.set(id, { createdAt: Date.now() });
    this.events.emit("change", undefined);
    return def;
  }

  removeAlert(id: string): void {
    this.alerts?.remove(id);
    this.alertMeta.delete(id);
    this.events.emit("change", undefined);
  }

  // ---- drawings helpers ---------------------------------------------------------------------------

  drawingList(): Drawing[] {
    return this.drawings?.list() ?? [];
  }

  // ---- state ---------------------------------------------------------------------------------------

  toJSON(): InstanceState {
    this.stashCurrent();
    const o = this.chart.options();
    const pick = { timeZone: o.timeZone, crosshair: o.crosshair, timeVisible: o.timeVisible, interaction: o.interaction, sessions: o.sessions, countdown: o.countdown, a11yTable: o.a11yTable, keymap: o.keymap };
    // A scale exists once a series uses it; until then its options are the chart's.
    const scale = (id: "right" | "left"): Partial<PriceScaleOptions> => {
      try {
        return { ...this.chart.priceScale(id).options() };
      } catch {
        return { ...(id === "right" ? o.rightPriceScale : o.leftPriceScale) };
      }
    };
    return {
      symbol: this.symbol, interval: this.interval, chartType: this.chartType, typeParams: { ...this.typeParams }, styles: structuredClone(this.styles),
      studies: this.pendingRestore ? this.pendingRestore.studies.slice() : this.mode === "time" ? this.studyStates() : this.stashedStudies,
      drawings: Object.fromEntries(this.drawStash), alerts: Object.fromEntries(this.alertStash), compares: (this.pendingRestore ? this.pendingRestore.compares : this.mode === "time" ? this.compareList() : this.stashedCompares).map((c) => ({ ...c })),
      studySeq: this.studiesPlugin.idHighWater(), scales: { right: scale("right"), left: scale("left") }, options: JSON.parse(JSON.stringify(pick)) as Record<string, unknown>,
    };
  }

  /** Apply a saved chart: options and scales now, symbol/interval/type/studies through the usual paths. */
  fromJSON(s: InstanceState): void {
    this.chart.applyOptions(s.options as never);
    this.chart.applyOptions({ rightPriceScale: s.scales.right, leftPriceScale: s.scales.left });
    for (const id of ["right", "left"] as const) {
      try {
        this.chart.priceScale(id).applyOptions(s.scales[id]);
      } catch {
        // No series on that scale yet: the chart options above hold it.
      }
    }
    if (s.studySeq !== undefined) this.studiesPlugin.reserveIds(s.studySeq);
    this.typeParams = { ...s.typeParams };
    this.styles = structuredClone(s.styles);
    this.drawStash.clear();
    this.alertStash.clear();
    for (const [k, v] of Object.entries(s.drawings)) this.drawStash.set(k, v);
    for (const [k, v] of Object.entries(s.alerts)) this.alertStash.set(k, v);
    // The saved alerts may watch saved studies, which do not exist yet: hold them in the stash until the studies are restored.
    this.alertsHeld = true;
    this.alerts?.fromJSON(EMPTY_ALERTS);
    for (const st of [...this.slots]) st.study.remove();
    this.slots = [];
    for (const c of [...this.compares]) this.removeCompare(c.symbol);
    this.stashedStudies = [];
    this.stashedCompares = [];
    this.symbol = s.symbol;
    this.interval = normalizeInterval(s.interval);
    this.chartType = s.chartType;
    this.chart.applyOptions({ resolution: this.interval });
    this.drawings?.setInterval(intervalId(this.interval));
    this.restoreStash();
    // Until they are restored (by the end of the first load that works, see applyPending), a save (or the autosave) must still carry them, or a slow or failed load would erase them.
    this.pendingRestore = { studies: s.studies.slice(), compares: s.compares.slice() };
    void this.load();
  }

  dispose(): void {
    this.disposed = true;
    this.gen++;
    this.abort?.abort();
    this.unsubLive?.();
    this.offRange();
    this.loader?.dispose();
    for (const c of this.compares) c.stop();
    this.events.clear();
    if (!this.chart.isRemoved) this.chart.remove();
  }
}
