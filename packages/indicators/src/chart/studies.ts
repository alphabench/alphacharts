// Studies on a chart, through the core plugin API.
//
// `addStudy(chart, source, study, inputs)` creates one core series per drawn
// plot (lines, histograms, areas, band edges) in the source's pane or a pane of
// its own, and draws what the series types cannot (fills between plots,
// markers, ZigZag, lines joined across gaps or shifted back in time) from the
// plugin's `drawPane` on the overlay. The studies follow the source:
// - a live bar appends or revises the engine's last bar and updates each
//   output series by one point (O(1) per tick),
// - setData/prepend/reindex on the source recompute the whole study (on the
//   runner when one is given; ticks that arrive meanwhile are folded into a
//   second recompute),
// - removing the source removes its studies.
// Output series carry the ids `study:<instance>:<plot>` so a saved layout
// (`chart.saveState()`) restores them; the plugin's own state (`toJSON`) holds
// what each study is: study id, inputs, source/volume series ids, visibility
// and style overrides, keyed by study instance id.
//
// Beyond lines and fills a study can colour the source's candles (`barcolor`
// plots; several studies compose on one source), shade the background of its
// pane (`bgcolor` plots, a core `BarShading` primitive: no part in autoscale),
// colour a line per point (`colorBy`), draw on the chart's left axis
// (`scale: "left"`), and read outside series its host gives it
// (`setFeed` / `pushFeedBar`, see engine/feed.ts for the join).
//
// Limits: a study plot with a negative shift or `connect` is drawn on the
// overlay, so it does not take part in autoscale or the crosshair readout. A
// line's dash style is not drawn on series lines (the core line has none).

import {
  BarShading, COL_C, COL_H, COL_L, COL_O, COL_V, cssColor, parseColor,
  type Chart, type ChartPlugin, type DataChange, type PluginApi, type PluginPaneView, type PriceLine, type Series, type SeriesData, type SeriesType,
} from "@alphacharts/core";
import { Feed, type FeedBar, type FeedBars, type FeedConfig } from "../engine/feed.js";
import { StudyEngine, resolveParams } from "../engine/study.js";
import { getStudy } from "../registry.js";
import { CancelledError, type StudyRunner } from "../runner.js";
import type { BarColumns, BarInput, InputValue, Params, PlotDef, StudyDef } from "../types.js";

export const PLUGIN_ID = "alphacharts.studies";

type AnySeries = Series<SeriesType>;
type SourceSeries = Series<"candles" | "bars" | "line" | "area" | "histogram">;

export interface AddStudyOptions {
  /** Volume series (histogram or line) for studies that need volume. */
  volume?: Series<"histogram" | "line" | "area">;
  /** Instance id; default `s<n>`. Layout state is keyed by it. */
  id?: string;
  /** Batch evaluation off the UI thread; ticks always run inline. */
  runner?: StudyRunner;
  /** Called once when the study is dropped or disposed (removed, source removed, layout restored over it). */
  onDispose?: () => void;
  /**
   * Whether `StudiesPlugin.toJSON` saves this study (default true). A study
   * that something else rebuilds on restore (a script, through
   * `restoreScript`) sets it false: the plugin could not recreate it, and a
   * layout holding it would be refused.
   */
  persist?: boolean;
}

export interface PlotStyle {
  color?: string;
  width?: number;
}

/** A series the study draws, with what is needed to keep it current. */
interface OutSeries {
  plot: PlotDef;
  key: string;
  col: number;
  series: Series<"line" | "histogram" | "area">;
  offset: number;
  /** Time of the last point written, to know when an update must become a rewrite. */
  lastTime: number;
}

export class Study {
  readonly def: StudyDef;
  private params: Params;
  private engine: StudyEngine;
  private outs: OutSeries[] = [];
  private lines: { series: AnySeries; line: PriceLine }[] = [];
  /** Background shading: one primitive per bgcolor plot, attached to the series of the pane it shades. */
  private shades: { plot: Extract<PlotDef, { kind: "bgcolor" }>; col: number; prim: BarShading; anchor: AnySeries }[] = [];
  /** Outside series the host gave this study, by key. */
  private feeds = new Map<string, Feed>();
  /**
   * Longer-timeframe series ("closed" join) whose forming bar is not shown on any chart bar: the last row sent to a runner,
   * and the newest revision of it not sent yet. A revision is sent when the next row opens (its final state), not per tick.
   */
  private feedSent = new Map<string, { time: number; held?: FeedBar }>();
  private sameScale = true;
  private styles: Record<string, PlotStyle> = {};
  private shown = true;
  private pane = 0;
  private scaleId = "right";
  private version = 0;
  private job: { cancel(): void } | null = null;
  /** A tick arrived while a job was pending (caught up on adoption). */
  private dirty = false;
  /** A replace/prepend arrived while a job was pending: the job's data is stale. */
  private structural = false;
  /** Set when a computation failed: the study stops following the source and says why. */
  error: Error | null = null;
  private ready_: Promise<void> = Promise.resolve();
  disposed = false;
  /** Decimals a separate-pane study's axis and labels show when its def does not set `minMove`: two, more when the values are small. */
  private decimals = 2;
  /** Whether the plugin saves this study (see `AddStudyOptions.persist`). */
  persist = true;

  /** @internal */
  constructor(
    private readonly host: StudiesPlugin,
    readonly id: string,
    def: StudyDef,
    inputs: Readonly<Record<string, InputValue>>,
    private readonly source: SourceSeries,
    private readonly volume: Series<"histogram" | "line" | "area"> | undefined,
    saved?: { visible?: boolean; styles?: Record<string, PlotStyle> },
    private readonly ownRunner?: StudyRunner,
    private readonly onDispose?: () => void,
  ) {
    this.def = def;
    this.params = resolveParams(def, inputs);
    this.engine = new StudyEngine(def, this.params);
    this.checkSource();
    if (saved?.styles) this.styles = { ...saved.styles };
    if (saved?.visible === false) this.shown = false;
    this.createSeries();
    this.recompute();
  }

  inputs(): Params {
    return this.params;
  }

  get visible(): boolean {
    return this.shown;
  }

  /** Resolves when the last requested computation has been applied to the chart. */
  ready(): Promise<void> {
    return this.ready_;
  }

  /**
   * Redraw from the engine's columns after they were written from outside (a
   * computation that arrives late, e.g. a script worker): the last bar when
   * `onlyLast`, else every bar.
   */
  refresh(onlyLast = true): void {
    if (this.disposed || this.error || this.engine.length === 0) return;
    if (onlyLast) this.tickSync();
    else this.syncAll();
    this.host.api?.requestRender(true);
  }

  /** Output series, in plot order. */
  series(): readonly AnySeries[] {
    return this.outs.map((o) => o.series as unknown as AnySeries);
  }

  /**
   * Change inputs; unspecified ones keep their value, and the keys in `reset` go back to their defaults (a preset that
   * has no value for an input the study has). Validated before anything changes. Outside series the study was given stay.
   */
  setInputs(partial: Readonly<Record<string, InputValue>>, reset: readonly string[] = []): void {
    const kept: Record<string, InputValue> = { ...this.params };
    for (const k of reset) delete kept[k];
    const next = resolveParams(this.def, { ...kept, ...partial });
    const engine = new StudyEngine(this.def, next);
    this.params = next;
    this.engine = engine;
    this.retitle();
    this.recompute();
    this.host.changed();
  }

  setVisible(visible: boolean): void {
    this.shown = visible;
    for (const o of this.outs) o.series.applyOptions({ visible } as never);
    for (const sh of this.shades) sh.prim.setVisible(visible);
    if (this.hasBarColor()) this.host.syncBarColors(this.source);
    this.host.changed();
  }

  setStyle(plotKey: string, style: PlotStyle): void {
    if (style.color !== undefined) parseColor(style.color);
    this.styles[plotKey] = { ...this.styles[plotKey], ...style };
    for (const o of this.outs) {
      if (o.key.split(":")[0] !== plotKey) continue;
      o.series.applyOptions(this.seriesOptions(o.plot, o.key) as never);
    }
    // a shade or a bar colour is not a series: it is drawn again from the columns
    if (!this.job && this.engine.length > 0 && (this.shades.length > 0 || this.hasBarColor())) this.syncOverlays();
    this.host.changed();
  }

  remove(): void {
    this.host.removeStudy(this.id);
  }

  /** The last computed value of each column (undefined while in warm-up), by column name. */
  lastValues(): Record<string, number | undefined> {
    const n = this.engine.length;
    const out: Record<string, number | undefined> = {};
    this.def.columns.forEach((c, k) => {
      const v = n > 0 ? this.engine.column(k)[n - 1]! : Number.NaN;
      out[c] = v === v ? v : undefined;
    });
    return out;
  }

  /** Output column `name` over the source bars (a view: copy it to keep it). */
  column(name: string): Float64Array {
    const k = this.def.columns.indexOf(name);
    if (k < 0) throw new RangeError(`${this.def.id} has no column "${name}"`);
    return this.engine.column(k);
  }

  /** Bar times of the columns. */
  times(): Float64Array {
    return this.engine.graph.time.v.subarray(0, this.engine.length);
  }

  /** The study as saved: its id, definition, inputs, source series ids, visibility and styles. `StudiesPlugin.toJSON` is a list of these. */
  state() {
    return {
      id: this.id,
      study: this.def.id,
      inputs: { ...this.params } as Record<string, InputValue>,
      source: this.source.options().id,
      ...(this.volume && { volume: this.volume.options().id }),
      visible: this.shown,
      styles: this.styles,
    };
  }

  /** @internal Detach without removing series (the chart already did). */
  drop(): void {
    if (!this.disposed) this.onDispose?.();
    this.disposed = true;
    this.job?.cancel();
  }

  /** @internal */
  dispose(chart: Chart): void {
    this.drop();
    for (const { series, line } of this.lines) chart.removePriceLine(series as never, line);
    for (const sh of this.shades) sh.anchor.detachPrimitive(sh.prim);
    for (const o of this.outs) chart.removeSeries(o.series);
    this.outs = [];
    this.lines = [];
    this.shades = [];
  }

  // ---- outside series -------------------------------------------------------------

  /**
   * Give the study outside series `key` (see engine/feed.ts for what a feed is and how it is joined), replacing the
   * previous bars of that key, and compute everything again. The study keeps its own copy.
   */
  setFeed(key: string, bars: FeedBars, cfg: FeedConfig): void {
    let f = this.feeds.get(key);
    if (!f) this.feeds.set(key, (f = new Feed()));
    f.load(bars, cfg, `outside series ${key}`);
    this.feedSent.delete(key);
    this.recompute();
    this.host.changed();
  }

  /** Keys of the outside series given so far. */
  feedKeys(): string[] {
    return [...this.feeds.keys()];
  }

  /**
   * A live bar of outside series `key` (same time as its last bar revises it, a later time appends). Only the study's
   * last bar is evaluated again, and only when it sees a different feed bar through the join; otherwise nothing is
   * recomputed or redrawn.
   */
  pushFeedBar(key: string, bar: FeedBar): void {
    const f = this.feeds.get(key);
    if (!f) throw new RangeError(`${this.def.id}: no outside series "${key}"; give it with setFeed first`);
    f.apply(bar, `outside series ${key}`); // the study's own copy: what a later full computation sends
    if (this.disposed || this.error) return;
    if (this.job) {
      // a batch that started before this bar is in flight: run again when it lands
      this.structural = true;
      return;
    }
    const runner = this.ownRunner ?? this.host.runner;
    if (runner?.canRun(this.def)) {
      if (f.align === "closed") {
        const sent = this.feedSent.get(key);
        if (sent && sent.time === bar.time) {
          sent.held = bar; // the forming bar again: no chart bar sees it yet
          return;
        }
        // a new row: the one before is final now
        if (sent?.held) runner.feedBar?.(this.def, key, sent.held);
        this.feedSent.set(key, { time: bar.time });
      }
      runner.feedBar?.(this.def, key, bar);
      return;
    }
    if (this.engine.pushFeed(key, bar)) {
      this.tickSync();
      this.host.api?.requestRender();
    }
  }

  // ---- bar colours (composed by the plugin) --------------------------------------------

  /** @internal */
  hasBarColor(): boolean {
    return this.def.plots.some((p) => p.kind === "barcolor");
  }

  /** @internal The source series this study colours. */
  barColorSource(): SourceSeries {
    return this.source;
  }

  /** @internal Colour of the bar at engine row `j` from this study's barcolor plots: the latest that applies, 0 if none. */
  barColorAt(j: number): number {
    const e = this.engine;
    let c = 0;
    if (j < 0) return c;
    for (const p of this.def.plots) {
      if (p.kind !== "barcolor") continue;
      const v = e.outputs[this.def.columns.indexOf(p.col)]!.v[j]!;
      if (v === v && v !== 0) c = parseColor(this.color(p));
    }
    return c;
  }

  /** @internal Time and colour of every row (0 = none). */
  barColors(): { time: Float64Array; color: Uint32Array } {
    const n = this.engine.length;
    const color = new Uint32Array(n);
    for (let j = 0; j < n; j++) color[j] = this.barColorAt(j);
    return { time: this.engine.graph.time.v.slice(0, n), color };
  }

  /** @internal Engine row of the bar at `time` (the last row when it is the last bar's time), -1 if none. */
  rowOf(time: number): number {
    const n = this.engine.length;
    return n > 0 && this.engine.graph.time.v[n - 1] === time ? n - 1 : -1;
  }

  /** @internal Time of the last row, NaN when empty. */
  lastTime(): number {
    const n = this.engine.length;
    return n > 0 ? this.engine.graph.time.v[n - 1]! : Number.NaN;
  }

  get isShown(): boolean {
    return this.shown && !this.error && !this.disposed;
  }

  // ---- source ------------------------------------------------------------------

  private get ohlc(): boolean {
    return this.source.data.shape === "ohlc";
  }

  private checkSource(): void {
    const need = this.def.needs;
    if (!this.ohlc) {
      if (need !== "value") throw new TypeError(`${this.def.id} needs ${need} bars; the source series holds single values`);
      if (this.params.source !== undefined && this.params.source !== "close") {
        throw new RangeError(`${this.def.id}: a single-value source has only "close", not "${this.params.source}"`);
      }
    }
    if (need === "ohlcv" && !this.volume) throw new TypeError(`${this.def.id} needs volume: pass the volume series as options.volume`);
    if (!this.ohlc && this.def.plots.some((p) => p.kind === "barcolor")) throw new TypeError(`${this.def.id} colours bars; the source series holds single values, not candles or bars`);
  }

  /** Whether `d` is the store of one of this study's inputs. */
  private watches(d: SeriesData | null): "source" | "volume" | null {
    if (d === this.source.data) return "source";
    if (this.volume && d === this.volume.data) return "volume";
    return null;
  }

  private bars(): BarColumns {
    const chart = this.host.chart;
    const sd = this.source.data;
    const st = sd.store;
    let n = 0;
    for (let i = st.first; i < st.end; i++) if (sd.has(i)) n++;
    const time = new Float64Array(n), close = new Float64Array(n);
    const ohlc = this.ohlc;
    const open = ohlc ? new Float64Array(n) : undefined, high = ohlc ? new Float64Array(n) : undefined, low = ohlc ? new Float64Array(n) : undefined;
    const vol = this.volume ? new Float64Array(n) : undefined;
    let k = 0;
    for (let i = st.first; i < st.end; i++) {
      if (!sd.has(i)) continue;
      time[k] = chart.logicalToTime(i);
      if (ohlc) {
        open![k] = sd.get(i, COL_O);
        high![k] = sd.get(i, COL_H);
        low![k] = sd.get(i, COL_L);
        close[k] = sd.get(i, COL_C);
      } else close[k] = sd.get(i, COL_V);
      if (vol) vol[k] = this.volume!.data.get(i, COL_V);
      k++;
    }
    return { time, close, ...(ohlc && { open, high, low }), ...(vol && { volume: vol }) } as BarColumns;
  }

  private barAt(i: number): BarInput {
    const sd = this.source.data;
    const nan = Number.NaN;
    return {
      time: this.host.chart.logicalToTime(i),
      open: this.ohlc ? sd.get(i, COL_O) : nan,
      high: this.ohlc ? sd.get(i, COL_H) : nan,
      low: this.ohlc ? sd.get(i, COL_L) : nan,
      close: this.ohlc ? sd.get(i, COL_C) : sd.get(i, COL_V),
      volume: this.volume ? this.volume.data.get(i, COL_V) : nan,
    };
  }

  // ---- following the source ------------------------------------------------------

  /** @internal */
  onChange(c: DataChange): void {
    if (this.disposed || this.error || c.kind === "color") return;
    const which = this.watches(c.series);
    if (c.series === null) {
      // A removal elsewhere rebuilt the timeline: nothing of ours moved unless an input died.
      return;
    }
    if (!which) return;
    if (this.job) {
      if (c.kind === "update") this.dirty = true;
      else this.structural = true;
      return;
    }
    if (c.kind !== "update") {
      this.recompute();
      return;
    }
    const sd = this.source.data;
    const last = sd.lastIndex();
    if (last === undefined) return this.recompute();
    if (which === "volume" && c.lo > last) return; // a volume bar for a time the source has not reached
    if (which === "volume" && c.lo < last) return this.recompute(); // a late volume revision of an earlier bar
    const bar = this.barAt(last);
    const e = this.engine;
    const n = e.length;
    const lastTime = n > 0 ? e.graph.time.v[n - 1]! : Number.NaN;
    if (n > 0 && bar.time === lastTime) e.reviseLast(bar);
    else if (n === 0 || bar.time > lastTime) e.push(bar);
    else return this.recompute();
    this.tickSync();
    this.host.api?.requestRender();
  }

  /** Recompute everything from the source's bars. */
  private recompute(): void {
    this.version++;
    this.job?.cancel();
    this.job = null;
    this.dirty = false;
    this.structural = false;
    this.error = null;
    const bars = this.bars();
    const runner = this.ownRunner ?? this.host.runner;
    if (!runner || !runner.canRun(this.def)) {
      for (const [k, f] of this.feeds) this.engine.setFeed(k, f.snapshot(), f);
      this.engine.load(bars);
      this.syncAll();
      this.ready_ = Promise.resolve();
      return;
    }
    const v = this.version;
    const feeds = this.feeds.size > 0 ? Object.fromEntries([...this.feeds].map(([k, f]) => [k, { align: f.align, spanMs: f.spanMs, bars: f.snapshot() }])) : undefined;
    const run = runner.run(this.def, { studyId: this.def.id, params: this.params, bars, ...(feeds && { feeds }) });
    this.job = run;
    this.ready_ = run.promise.then(
      (res) => {
        if (v !== this.version || this.disposed) return;
        this.job = null;
        this.engine.graph.adopt(res.buffers, res.n);
        if (this.structural) {
          this.recompute();
          return;
        }
        if (this.dirty) {
          this.dirty = false;
          this.catchUp();
        }
        this.syncAll();
      },
      (err: unknown) => {
        if (err instanceof CancelledError || v !== this.version || this.disposed) return;
        this.job = null;
        this.error = err instanceof Error ? err : new Error(String(err));
        throw this.error;
      },
    );
  }

  /** Bring an adopted engine up to the source's current last bars (ticks that arrived during the job). */
  private catchUp(): void {
    const e = this.engine;
    const b = this.bars();
    const n = b.time.length;
    if (e.length === 0 || n === 0) return this.fullLoad(b);
    const lastTime = e.graph.time.v[e.length - 1]!;
    let k = lowerBound(b.time, n, lastTime);
    const at = (j: number): BarInput => ({
      time: b.time[j]!, open: b.open?.[j] ?? Number.NaN, high: b.high?.[j] ?? Number.NaN, low: b.low?.[j] ?? Number.NaN, close: b.close[j]!, volume: b.volume?.[j] ?? Number.NaN,
    });
    if (k < n && b.time[k] === lastTime) e.reviseLast(at(k++));
    else if (k < n && k === 0) return this.fullLoad(b);
    for (; k < n; k++) e.push(at(k));
  }

  private fullLoad(b: BarColumns): void {
    this.engine.load(b);
  }

  // ---- output series ---------------------------------------------------------------

  private title(): string {
    const l = this.def.label?.(this.params);
    return l ? `${this.def.name} (${l})` : this.def.name;
  }

  private retitle(): void {
    this.outs.forEach((o, i) => o.series.applyOptions({ title: i === 0 ? this.title() : o.plot.title } as never));
  }

  private color(plot: PlotDef & { color?: string }): string {
    return this.styles[plot.key]?.color ?? (plot as { color: string }).color;
  }

  private seriesOptions(plot: PlotDef, key: string): Record<string, unknown> {
    const st = this.styles[plot.key];
    const color = st?.color;
    switch (plot.kind) {
      case "line": return { color: color ?? plot.color, lineWidth: st?.width ?? plot.width ?? 1.5 };
      case "band": return { color: color ?? plot.color, lineWidth: st?.width ?? plot.width ?? 1 };
      case "histogram": return { color: color ?? plot.color };
      case "area": {
        const c = color ?? plot.color;
        return { lineColor: c, topColor: withAlpha(c, 0.28), bottomColor: withAlpha(c, 0.02), lineWidth: st?.width ?? 1.5 };
      }
      default: return {};
    }
    void key;
  }

  private createSeries(): void {
    const chart = this.host.chart;
    const so = this.source.options();
    if (this.def.pane === "overlay") {
      this.pane = so.pane;
      this.scaleId = this.def.scale ?? so.priceScaleId;
    } else {
      this.pane = this.host.freePane();
      this.scaleId = this.def.scale ?? "right";
    }
    const overlay = this.def.pane === "overlay";
    // an overlay on the source's own scale reads like its source; on the other axis (or in a pane of its own) it has its own scale and format
    this.sameScale = overlay && this.scaleId === so.priceScaleId;
    const cols = this.def.columns;
    const add = (plot: PlotDef, key: string, type: "line" | "histogram" | "area", col: string, offset: number) => {
      const s = chart.addSeries(type, {
        id: `study:${this.id}:${key}`, pane: this.pane, priceScaleId: this.scaleId, title: this.outs.length === 0 ? this.title() : plot.title,
        lastValueVisible: !this.sameScale, priceLineVisible: false, visible: this.shown, ...this.seriesOptions(plot, key),
        // Overlays read like their source; oscillators show two decimals instead of whatever the data happens to carry.
        priceFormat: this.sameScale ? so.priceFormat : { type: "price", minMove: this.def.minMove ?? 10 ** -this.decimals },
      } as never) as unknown as Series<"line" | "histogram" | "area">;
      this.outs.push({ plot, key, col: cols.indexOf(col), series: s, offset, lastTime: Number.NaN });
    };
    for (const plot of this.def.plots) {
      switch (plot.kind) {
        case "line":
          if (!isOverlayLine(plot)) add(plot, plot.key, "line", plot.col, plot.offset ?? 0);
          break;
        case "histogram": add(plot, plot.key, "histogram", plot.col, 0); break;
        case "area": add(plot, plot.key, "area", plot.col, 0); break;
        case "band":
          add(plot, `${plot.key}:upper`, "line", plot.upper, 0);
          add(plot, `${plot.key}:lower`, "line", plot.lower, 0);
          break;
        default: break;
      }
    }
    const anchor = this.outs[0]?.series as unknown as AnySeries | undefined;
    for (const plot of this.def.plots) {
      if (plot.kind !== "bgcolor") continue;
      // shades the pane the study draws in: the source's for an overlay, else the pane its first series made
      const host = overlay ? (this.source as unknown as AnySeries) : anchor;
      if (!host) throw new TypeError(`${this.def.id}: bgcolor shades the study's pane, and a study in its own pane needs a plot to hold it`);
      const prim = new BarShading();
      prim.setVisible(this.shown);
      host.attachPrimitive(prim);
      this.shades.push({ plot, col: cols.indexOf(plot.col), prim, anchor: host });
    }
    if (anchor) {
      for (const plot of this.def.plots) {
        if (plot.kind !== "hline") continue;
        const price = typeof plot.value === "function" ? plot.value(this.params) : plot.value;
        const line = chart.createPriceLine(anchor as never, { price, color: plot.color, lineStyle: plot.style ?? "dashed", lineWidth: 1, axisLabelVisible: false });
        this.lines.push({ series: anchor, line });
      }
    }
  }

  private syncAll(): void {
    const e = this.engine;
    const n = e.length;
    const times = e.graph.time.v;
    for (const o of this.outs) this.writeSeries(o, e.outputs[o.col]!.v, times, n);
    this.syncOverlays();
    this.host.api?.requestRender(true);
  }

  /** Background shades and bar colours, from the engine's columns (every bar). */
  private syncOverlays(): void {
    const e = this.engine;
    const n = e.length;
    const times = e.graph.time.v;
    for (const sh of this.shades) {
      const col = e.outputs[sh.col]!.v;
      const rgba = parseColor(this.color(sh.plot));
      const color = new Uint32Array(n);
      for (let j = 0; j < n; j++) color[j] = col[j]! === col[j]! && col[j] !== 0 ? rgba : 0;
      sh.prim.set(times.slice(0, n), color);
    }
    if (this.hasBarColor()) this.host.syncBarColors(this.source);
  }

  private writeSeries(o: OutSeries, col: Float64Array, times: Float64Array, n: number): void {
    const down = o.plot.kind === "histogram" && o.plot.colorDown ? { up: parseColor(this.color(o.plot)), down: parseColor(o.plot.colorDown) } : null;
    const by = o.plot.kind === "line" && o.plot.colorBy ? { col: this.engine.outputs[this.def.columns.indexOf(o.plot.colorBy.col)]!.v, color: parseColor(o.plot.colorBy.color) } : null;
    let m = 0;
    for (let j = 0; j < n; j++) {
      const t = j + o.offset;
      if (t >= 0 && t < n && col[j] === col[j]) m++;
    }
    const time = new Float64Array(m), value = new Float64Array(m);
    const color = down || by ? new Uint32Array(m) : undefined;
    let k = 0;
    for (let j = 0; j < n; j++) {
      const t = j + o.offset;
      if (t < 0 || t >= n || col[j] !== col[j]) continue;
      time[k] = times[t]!;
      value[k] = col[j]!;
      if (down) color![k] = col[j]! >= 0 ? down.up : down.down;
      else if (by) color![k] = by.col[j]! === by.col[j]! && by.col[j] !== 0 ? by.color : 0;
      k++;
    }
    let maxAbs = 0;
    for (let q = 0; q < m; q++) maxAbs = Math.max(maxAbs, Math.abs(value[q]!));
    this.widen(maxAbs);
    o.series.setData({ time, value, ...(color && { color }) } as never);
    o.lastTime = m > 0 ? time[m - 1]! : Number.NaN;
  }

  /** Show enough decimals for values below 1 (three significant digits); only ever grows. A def's own `minMove` wins; an overlay reads like its source. */
  private widen(maxAbs: number): void {
    if (this.sameScale || this.def.minMove !== undefined || !(maxAbs > 0) || maxAbs >= 1) return;
    const d = Math.min(8, 2 - Math.floor(Math.log10(maxAbs)));
    if (d <= this.decimals) return;
    this.decimals = d;
    for (const o of this.outs) o.series.applyOptions({ priceFormat: { type: "price", minMove: 10 ** -d } } as never);
  }

  /** The output series that draws `column`, or undefined when no plot does (a column that is only an input to others). */
  seriesOfColumn(column: string): AnySeries | undefined {
    const k = this.def.columns.indexOf(column);
    return this.outs.find((o) => o.col === k)?.series as unknown as AnySeries | undefined;
  }

  /** After one appended or revised bar: one point per output series. */
  private tickSync(): void {
    const e = this.engine;
    const n = e.length;
    const times = e.graph.time.v;
    const t = times[n - 1]!;
    const cols = this.def.columns;
    for (const sh of this.shades) {
      const v = e.outputs[sh.col]!.v[n - 1]!;
      sh.prim.setAt(t, v === v && v !== 0 ? parseColor(this.color(sh.plot)) : 0);
    }
    if (this.hasBarColor()) this.host.syncBarColors(this.source, true);
    for (const o of this.outs) {
      const j = n - 1 - o.offset;
      if (j < 0) continue;
      const col = e.outputs[o.col]!.v;
      const v = col[j]!;
      if (v === v) {
        this.widen(Math.abs(v));
        const down = o.plot.kind === "histogram" && o.plot.colorDown;
        const by = o.plot.kind === "line" ? o.plot.colorBy : undefined;
        const cond = by ? e.outputs[cols.indexOf(by.col)]!.v[j]! : Number.NaN;
        const own = by && cond === cond && cond !== 0 ? by.color : undefined;
        o.series.update({ time: t, value: v, ...(down && { color: v >= 0 ? this.color(o.plot) : down }), ...(own && { color: own }) } as never);
        o.lastTime = t;
      } else if (o.lastTime === t) this.writeSeries(o, col, times, n); // a point turned absent: rewrite
    }
  }

  // ---- overlay drawing ---------------------------------------------------------------

  /** @internal */
  draw(ctx: CanvasRenderingContext2D, view: PluginPaneView): void {
    if (!this.shown || view.pane !== this.pane) return;
    const e = this.engine;
    const n = e.length;
    if (n === 0) return;
    const times = e.graph.time.v;
    const lo = Math.max(0, lowerBound(times, n, view.xToTime(0)) - 1);
    const hi = Math.min(n, lowerBound(times, n, view.xToTime(view.width)) + 2);
    if (hi <= lo) return;
    const step = Math.max(1, Math.floor((hi - lo) / (view.width * 2)));
    const X = (j: number) => view.timeToX(times[j]!);
    const Y = (v: number) => view.priceToY(v, this.scaleId);
    const col = (name: string) => e.outputs[this.def.columns.indexOf(name)]!.v;
    for (const plot of this.def.plots) {
      switch (plot.kind) {
        case "band": fillBetween(ctx, lo, hi, step, X, Y, col(plot.upper), col(plot.lower), this.styles[plot.key]?.color ?? plot.fill, 0); break;
        case "fill": fillBetween(ctx, lo, hi, step, X, Y, col(plot.a), col(plot.b), this.styles[plot.key]?.color ?? plot.color, 0); break;
        case "line":
          if (isOverlayLine(plot)) polyline(ctx, lo, hi, step, n, X, Y, col(plot.col), plot.offset ?? 0, !!plot.connect, this.color(plot), this.styles[plot.key]?.width ?? plot.width ?? 1.5);
          break;
        case "markers": this.drawMarkers(ctx, plot, lo, hi, X, Y, col(plot.col), n); break;
        case "zigzag": zigzag(ctx, lo, hi, X, Y, col(plot.price), col(plot.back), times, this.color(plot), plot.width ?? 1.5); break;
        default: break;
      }
    }
  }

  private drawMarkers(ctx: CanvasRenderingContext2D, plot: Extract<PlotDef, { kind: "markers" }>, lo: number, hi: number, X: (j: number) => number, Y: (v: number) => number, col: Float64Array, n: number): void {
    const off = plot.offset ?? 0;
    const high = this.engine.graph.high.v, low = this.engine.graph.low.v;
    const color = this.color(plot);
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "center";
    let drawn = 0;
    for (let j = lo; j < hi && drawn < 4000; j++) {
      const v = col[j]!;
      if (v !== v || (plot.text && v === 0)) continue;
      const b = j + off;
      if (b < 0 || b >= n) continue;
      const x = X(b);
      const side = plot.position === "sign" ? (v > 0 ? "below" : "above") : plot.position;
      let y: number, dir: 1 | -1;
      if (side === "value") { y = Y(v); dir = 1; }
      else if (side === "above") { y = Y(high[b]!) - 8; dir = -1; }
      else { y = Y(low[b]!) + 8; dir = 1; }
      if (plot.text) {
        ctx.textBaseline = dir < 0 ? "bottom" : "top";
        ctx.fillText(String(Math.round(v)), x, side === "above" ? y - 2 : y + 2);
      } else shape(ctx, plot.shape, x, y, side === "above" ? -1 : 1);
      drawn++;
    }
    ctx.restore();
  }
}

// ---- drawing helpers -----------------------------------------------------------------

function isOverlayLine(p: Extract<PlotDef, { kind: "line" }>): boolean {
  return (p.offset ?? 0) < 0 || !!p.connect;
}

function lowerBound(a: Float64Array, n: number, t: number): number {
  let lo = 0, hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (a[mid]! < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function withAlpha(css: string, alpha: number): string {
  const c = parseColor(css);
  return cssColor(((c & 0xffffff00) | Math.round(alpha * 255)) >>> 0);
}

function fillBetween(ctx: CanvasRenderingContext2D, lo: number, hi: number, step: number, X: (j: number) => number, Y: (v: number) => number, a: Float64Array, b: Float64Array, color: string, _off: number): void {
  ctx.save();
  ctx.fillStyle = color;
  let run: number[] = [];
  const flush = () => {
    if (run.length > 1) {
      ctx.beginPath();
      ctx.moveTo(X(run[0]!), Y(a[run[0]!]!));
      for (let k = 1; k < run.length; k++) ctx.lineTo(X(run[k]!), Y(a[run[k]!]!));
      for (let k = run.length - 1; k >= 0; k--) ctx.lineTo(X(run[k]!), Y(b[run[k]!]!));
      ctx.closePath();
      ctx.fill();
    }
    run = [];
  };
  for (let j = lo; j < hi; j += step) {
    if (a[j] === a[j] && b[j] === b[j]) run.push(j);
    else flush();
  }
  flush();
  ctx.restore();
}

function polyline(ctx: CanvasRenderingContext2D, lo: number, hi: number, step: number, n: number, X: (j: number) => number, Y: (v: number) => number, col: Float64Array, off: number, connect: boolean, color: string, width: number): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  let pen = false;
  for (let j = lo; j < hi; j += step) {
    const v = col[j]!, b = j + off;
    if (v !== v || b < 0 || b >= n) {
      if (!connect) pen = false;
      continue;
    }
    if (pen) ctx.lineTo(X(b), Y(v));
    else ctx.moveTo(X(b), Y(v));
    pen = true;
  }
  ctx.stroke();
  ctx.restore();
}

function zigzag(ctx: CanvasRenderingContext2D, lo: number, hi: number, X: (j: number) => number, Y: (v: number) => number, price: Float64Array, back: Float64Array, times: Float64Array, color: string, width: number): void {
  void times;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  let pen = false;
  // start a little left of the view so the segment entering it is drawn
  for (let j = Math.max(0, lo - 2000); j < hi; j++) {
    const p = price[j]!;
    if (p !== p) continue;
    const at = j - back[j]!;
    if (pen) ctx.lineTo(X(at), Y(p));
    else ctx.moveTo(X(at), Y(p));
    pen = true;
  }
  ctx.stroke();
  ctx.restore();
}

function shape(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, dir: 1 | -1): void {
  const r = 4;
  ctx.beginPath();
  switch (kind) {
    case "square": ctx.rect(x - r, y - r, 2 * r, 2 * r); ctx.fill(); return;
    case "diamond": ctx.moveTo(x, y - r - 1); ctx.lineTo(x + r + 1, y); ctx.lineTo(x, y + r + 1); ctx.lineTo(x - r - 1, y); ctx.closePath(); ctx.fill(); return;
    case "triangleUp": case "arrowUp": ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r); ctx.lineTo(x - r, y + r); ctx.closePath(); ctx.fill(); return;
    case "triangleDown": case "arrowDown": ctx.moveTo(x, y + r); ctx.lineTo(x + r, y - r); ctx.lineTo(x - r, y - r); ctx.closePath(); ctx.fill(); return;
    case "cross": ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke(); return;
    default: ctx.arc(x, y, r - 1, 0, Math.PI * 2); ctx.fill(); void dir;
  }
}

// ---- the plugin -------------------------------------------------------------------------

interface SavedStudy {
  id: string;
  study: string;
  inputs: Record<string, InputValue>;
  source: string;
  volume?: string;
  visible: boolean;
  styles: Record<string, PlotStyle>;
}

export class StudiesPlugin implements ChartPlugin {
  readonly id = PLUGIN_ID;
  api: PluginApi | null = null;
  private readonly studies = new Map<string, Study>();
  private counter = 0;
  /** Sources whose bars the plugin has coloured: the plugin owns their colour column while a barcolor study exists. */
  private readonly coloured = new Set<SourceSeries>();

  constructor(readonly chart: Chart, readonly runner: StudyRunner | undefined, private readonly resolve: (id: string) => StudyDef) {}

  install(api: PluginApi): void {
    this.api = api;
  }

  uninstall(): void {
    const sources = [...this.coloured];
    for (const s of [...this.studies.values()]) s.dispose(this.chart);
    this.studies.clear();
    for (const src of sources) this.syncBarColors(src);
    this.api = null;
  }

  /**
   * Bring the colours of `source`'s candles in line with every visible study that colours them: per bar, the latest
   * study (in creation order) whose barcolor applies wins. With no such study the colour column is removed, so the
   * candles are exactly as they were. `last`: only the source's last bar (a tick).
   * @internal
   */
  syncBarColors(source: SourceSeries, last = false): void {
    const live = [...this.studies.values()].filter((s) => s.barColorSource() === source && s.hasBarColor() && s.isShown);
    const target = source as unknown as Series<"candles">;
    if (live.length === 0) {
      if (this.coloured.delete(source)) target.clearBarColors();
      return;
    }
    this.coloured.add(source);
    if (last) {
      const t = live[0]!.lastTime();
      if (t !== t) return;
      let c = 0;
      for (const s of live) if (s.lastTime() === t) c = s.barColorAt(s.rowOf(t)) || c;
      target.setBarColors({ time: Float64Array.of(t), color: Uint32Array.of(c) });
      return;
    }
    const base = live[0]!.barColors();
    const time = base.time, color = base.color;
    for (let k = 1; k < live.length; k++) {
      const o = live[k]!.barColors();
      let j = 0;
      for (let i = 0; i < o.time.length; i++) {
        while (j < time.length && time[j]! < o.time[i]!) j++;
        if (j < time.length && time[j] === o.time[i] && o.color[i] !== 0) color[j] = o.color[i]!;
      }
    }
    target.setBarColors({ time, color });
  }

  dataChanged(c: DataChange): void {
    for (const s of this.studies.values()) s.onChange(c);
    this.reap();
  }

  drawPane(ctx: CanvasRenderingContext2D, view: PluginPaneView): void {
    for (const s of this.studies.values()) s.draw(ctx, view);
  }

  list(): Study[] {
    return [...this.studies.values()];
  }

  get(id: string): Study | undefined {
    return this.studies.get(id);
  }

  /** @internal */
  changed(): void {
    this.api?.requestRender(true);
  }

  /** Lowest pane index >= 1 holding no series (reuses a gap), else a new pane. */
  freePane(): number {
    const used = new Set(this.chart.series().map((s) => s.options().pane));
    let p = 1;
    while (used.has(p)) p++;
    return p;
  }

  add(def: StudyDef, inputs: Readonly<Record<string, InputValue>>, source: SourceSeries, o: AddStudyOptions = {}, saved?: { visible?: boolean; styles?: Record<string, PlotStyle> }): Study {
    const id = o.id ?? this.nextId();
    if (this.studies.has(id)) throw new Error(`alphacharts: a study with id "${id}" already exists`);
    const bump = /^s(\d+)$/.exec(id);
    if (bump) this.counter = Math.max(this.counter, Number(bump[1]));
    const s = new Study(this, id, def, inputs, source, o.volume, saved, o.runner, o.onDispose);
    s.persist = o.persist !== false;
    this.studies.set(id, s);
    // a study computed inline has already written once, before it was registered to be composed
    if (s.hasBarColor()) this.syncBarColors(source);
    return s;
  }

  removeStudy(id: string): void {
    const s = this.studies.get(id);
    if (!s) return;
    this.studies.delete(id);
    s.dispose(this.chart);
    if (s.hasBarColor()) this.syncBarColors(s.barColorSource());
    this.changed();
  }

  /** Drop studies whose source series was removed from the chart. */
  private reap(): void {
    const alive = new Set<SeriesData>(this.chart.series().map((s) => s.data));
    for (const [id, s] of this.studies) {
      const inputs = s as unknown as { source: SourceSeries; volume?: Series<"histogram" | "line" | "area"> };
      if (!alive.has(inputs.source.data) || (inputs.volume && !alive.has(inputs.volume.data))) {
        this.studies.delete(id);
        s.dispose(this.chart);
        if (!alive.has(inputs.source.data)) this.coloured.delete(inputs.source);
        else if (s.hasBarColor()) this.syncBarColors(inputs.source);
      }
    }
  }

  /** Never hand out an id at or below `n` again: ids of removed studies stay retired, so an alert that still names one cannot land on a different study. */
  reserveIds(n: number): void {
    this.counter = Math.max(this.counter, n);
  }

  /** The highest `s<n>` number handed out or restored so far. */
  idHighWater(): number {
    return this.counter;
  }

  private nextId(): string {
    return `s${++this.counter}`;
  }

  toJSON(): unknown {
    return { version: 1, studies: [...this.studies.values()].filter((s) => s.persist).map((s) => s.state()) };
  }

  /** Throws what `fromJSON(state)` would, changing nothing: the layout is refused whole when a study cannot be rebuilt. */
  validateState(state: unknown, ctx: { seriesIds: readonly string[] }): void {
    const st = state as { version?: number; studies?: SavedStudy[] };
    if (st?.version !== 1 || !Array.isArray(st.studies)) throw new TypeError("alphacharts studies: unrecognised layout state");
    const seen = new Set<string>();
    for (const ss of st.studies) {
      if (seen.has(ss.id)) throw new Error(`alphacharts studies: the layout repeats study id "${ss.id}"`);
      seen.add(ss.id);
      if (!ctx.seriesIds.includes(ss.source)) throw new Error(`alphacharts studies: study "${ss.id}" needs series "${ss.source}", which the layout does not contain`);
      if (ss.volume && !ctx.seriesIds.includes(ss.volume)) throw new Error(`alphacharts studies: study "${ss.id}" needs volume series "${ss.volume}"`);
      resolveParams(this.resolve(ss.study), ss.inputs);
    }
  }

  /** Called after the chart restored its series: rebuild each study over the restored series. */
  fromJSON(state: unknown): void {
    const st = state as { version?: number; studies?: SavedStudy[] };
    if (st?.version !== 1 || !Array.isArray(st.studies)) throw new TypeError("alphacharts studies: unrecognised layout state");
    for (const s of this.studies.values()) s.drop();
    this.studies.clear();
    const byId = new Map(this.chart.series().map((s) => [s.options().id, s]));
    for (const ss of st.studies) {
      const source = byId.get(ss.source);
      if (!source) throw new Error(`alphacharts studies: study "${ss.id}" needs series "${ss.source}", which the layout does not contain`);
      const volume = ss.volume ? byId.get(ss.volume) : undefined;
      if (ss.volume && !volume) throw new Error(`alphacharts studies: study "${ss.id}" needs volume series "${ss.volume}"`);
      // The restored layout already holds this study's output series (bare); replace them with live ones.
      for (const s of [...byId.values()]) if (s.options().id.startsWith(`study:${ss.id}:`)) this.chart.removeSeries(s);
      this.add(this.resolve(ss.study), ss.inputs, source as SourceSeries, { id: ss.id, ...(volume && { volume: volume as never }) }, { visible: ss.visible, styles: ss.styles });
    }
    // Output series of studies this plugin does not save (a script's) came back bare in the layout: whoever owns the study rebuilds them.
    const live = new Set<unknown>([...this.studies.values()].flatMap((s) => s.series()));
    for (const s of this.chart.series()) if (s.options().id.startsWith("study:") && !live.has(s)) this.chart.removeSeries(s);
  }
}

// ---- public entry points -------------------------------------------------------------------

/** Install the studies plugin on a chart (idempotent). Restoring a layout that holds studies needs this first. */
export function installStudies(chart: Chart, opts: { runner?: StudyRunner; resolve?: (id: string) => StudyDef } = {}): StudiesPlugin {
  const have = chart.plugin<StudiesPlugin>(PLUGIN_ID);
  if (have) return have;
  const p = new StudiesPlugin(chart, opts.runner, opts.resolve ?? getStudy);
  chart.addPlugin(p);
  return p;
}

/**
 * Add a study over `source`. `study` is a definition (tree-shakable) or the id of
 * a registered one. Throws on unknown inputs, out-of-range values or a source
 * that lacks what the study needs.
 */
export function addStudy(chart: Chart, source: SourceSeries, study: StudyDef | string, inputs: Readonly<Record<string, InputValue>> = {}, opts: AddStudyOptions = {}): Study {
  const def = typeof study === "string" ? getStudy(study) : study;
  const plugin = installStudies(chart, opts.runner ? { runner: opts.runner } : {});
  return plugin.add(def, inputs, source, opts);
}
