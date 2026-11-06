// The chart: DOM, layout, autoscale and the three render layers.
//
// Layers, bottom to top, one canvas each covering the whole chart:
//   bg      (2D)     background, grid, axes, separators — redrawn on view change
//   gl      (WebGL2) every series — redrawn on view or data change
//   overlay (2D)     crosshair, price lines, last-value labels, primitives —
//                    redrawn on pointer moves without touching the other two
// Panes are rectangles inside those canvases (scissor + viewport for GL).
// Every frame starts with layout(): sync the time scale to the timeline,
// autoscale each price scale over the visible bars, measure the axes. If that
// changed anything, the layers that depend on it are promoted to dirty.

import { emitFault } from "../fault.js";
import { COL_H, COL_L, COL_V, DataModel, type ColumnarColors, type DataChange } from "../data/model.js";
import type { Timeline } from "../data/timeline.js";
import { TimeZone } from "../data/tz.js";
import { parseColor } from "../render/color.js";
import type { SurfaceChoice, SurfaceEvents, SurfaceKind } from "../render/surface.js";
import { OwnLayers, type Layers } from "./layers.js";
import type { ChartPlugin, PluginApi, PluginPaneView, PluginPointer } from "./plugin.js";
import { checkCustomOptions, LAYOUT_VERSION, migrate, plain, type ChartState, type SeriesState } from "./layout.js";
import type { DrawView } from "../render/renderers.js";
import { checkPriceScaleOptions, DEFAULT_PRICE_SCALE, PriceScale, type PriceScaleOptions } from "../scale/price-scale.js";
import type { Formatter } from "../scale/format.js";
import { axisText, scaleTicks, TimeFormatter, timeText, timeTicks, type TimeLabel, type TimeTick } from "../scale/ticks.js";
import { DEFAULT_TIME_SCALE, TimeScale, type TimeScaleOptions } from "../scale/time-scale.js";
import { Interaction } from "../interaction/input.js";
import { Emitter } from "./emitter.js";
import { crisp, PriceLine, type AxisLabel, type PanePrimitive, type PaneView, type PriceLineOptions, type RenderLayer } from "./primitives.js";
import { drawMarkers, markerLowerBound, placeMarkers, type PlacedMarker } from "./markers.js";
import { cancelRender, LAYER_ALL, LAYER_BG, LAYER_GL, LAYER_OVERLAY, requestRender, type Renderable } from "./scheduler.js";
import { Series } from "./series.js";
import { seriesType, type SeriesOptions, type SeriesType } from "./series-types.js";
import { DARK, HIGH_CONTRAST, LIGHT, systemTheme, type Theme } from "./theme.js";
import { defaultMessages, type ChartMessages } from "./messages.js";
import { Sessions, type SessionSpec } from "../data/session.js";
import { parseResolution, Resampler } from "../data/resample.js";
import { checkWatermarkOptions, DEFAULT_WATERMARK, drawWatermark, type WatermarkOptions } from "./watermark.js";

// ---- options & events ---------------------------------------------------------

export interface CrosshairOptions {
  /**
   * "magnet" snaps the horizontal line to the main series' close; "hidden"
   * draws nothing but still reports crosshair events.
   */
  mode: "magnet" | "normal" | "hidden";
  visible: boolean;
  /** The crosshair's label on the price axis. False hides only that label; the line, the time label and events stay. */
  priceLabel: boolean;
}

export interface GridOptions {
  /** Vertical lines at the time ticks. */
  vertLines: boolean;
  /** Horizontal lines at the price ticks. */
  horzLines: boolean;
}

export interface InteractionOptions {
  pan: boolean;
  zoom: boolean;
  kinetic: boolean;
  keyboard: boolean;
}

export interface ChartOptions {
  theme: Theme;
  /** "UTC" or an IANA zone; axis labels and day boundaries use it. */
  timeZone: string;
  locale: string | undefined;
  timeScale: TimeScaleOptions;
  crosshair: CrosshairOptions;
  /** Grid lines (theme colour); both on by default. */
  grid: GridOptions;
  /**
   * Format of the crosshair time label (and the screen-reader readout), e.g.
   * `{ day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }`;
   * undefined keeps the default. The chart's `timeZone` and `locale` apply; the
   * options must not set `timeZone`. `timeLabel` takes precedence when set.
   */
  timeFormat: Intl.DateTimeFormatOptions | undefined;
  /** Show hours and minutes in the crosshair time label; "auto" decides from the bar interval. */
  timeVisible: boolean | "auto";
  /** Replaces the calendar text of the time axis and the crosshair time label (for an x axis that is not a clock). */
  timeLabel: TimeLabel | undefined;
  rightPriceScale: PriceScaleOptions;
  leftPriceScale: PriceScaleOptions;
  interaction: InteractionOptions;
  /** The brand mark at the bottom-left of the main pane; on by default, `{ visible: false }` hides it. */
  watermark: WatermarkOptions;
  /** Accessible name of the chart; default: the "chart.ariaLabel" message. */
  ariaLabel: string;
  /** Text for the chart's own user-visible strings (aria, readout, table, countdown); English by default. */
  messages: ChartMessages;
  /** Series surface: own WebGL2 context, Canvas2D, or auto. Fixed at creation. */
  renderer: SurfaceChoice;
  /** Trading hours: bars outside regular hours are shaded. */
  sessions: SessionSpec | null;
  /** Bar resolution (e.g. "5m", "1D"): enables the bar-close countdown. */
  resolution: string | null;
  /** Countdown to the current bar's close under the last-price label. */
  countdown: boolean;
  /** Key bindings; each action takes key strings like "Shift+ArrowLeft", "Alt+R". */
  keymap: Partial<Record<KeyAction, string[]>>;
  /** A visually hidden table of the visible bars for screen readers. */
  a11yTable: boolean;
}

export type KeyAction =
  | "panLeft" | "panRight" | "zoomIn" | "zoomOut" | "scrollToStart" | "scrollToLatest"
  | "crosshairLeft" | "crosshairRight" | "hideCrosshair" | "resetChart";

export const DEFAULT_KEYMAP: Record<KeyAction, string[]> = {
  panLeft: ["ArrowLeft"],
  panRight: ["ArrowRight"],
  zoomIn: ["ArrowUp", "+", "Shift++", "="],
  zoomOut: ["ArrowDown", "-", "_"],
  scrollToStart: ["Home"],
  scrollToLatest: ["End"],
  crosshairLeft: ["Shift+ArrowLeft"],
  crosshairRight: ["Shift+ArrowRight"],
  hideCrosshair: ["Escape"],
  resetChart: ["Alt+R", "Alt+r"],
};

export type ChartOptionsInput = {
  [K in keyof ChartOptions]?: K extends "theme"
    ? Theme | "dark" | "light" | "high-contrast" | "auto" | Partial<Theme>
    : K extends "sessions" | "resolution" | "messages" | "timeLabel"
      ? ChartOptions[K]
      : ChartOptions[K] extends object | undefined
        ? Partial<ChartOptions[K]>
        : ChartOptions[K];
};

/** The object under the pointer: a series marker (by its id) or a primitive's hit (by its id). */
export interface HoveredObject {
  kind: "marker" | "primitive";
  id: string;
}

export interface CrosshairEvent {
  /** Timeline index under the crosshair, if over data. */
  index?: number;
  time?: number;
  /** Pane-relative CSS px. */
  point?: { x: number; y: number };
  pane?: number;
  /** Marker or primitive item under the pointer; only for pointer-driven events. Markers win over primitives. */
  hovered?: HoveredObject;
  source: "pointer" | "keyboard" | "sync";
}

export interface VisibleRangeEvent {
  /** Fractional timeline indices at the left and right edges. */
  from: number;
  to: number;
  /** What moved the view: input or the timeScale API ("user"), a SyncGroup, or new data. */
  source: "user" | "sync" | "data";
}

export interface ChartEvents {
  crosshairMove: CrosshairEvent;
  click: CrosshairEvent;
  dblclick: CrosshairEvent;
  visibleRangeChange: VisibleRangeEvent;
}

// ---- internals ------------------------------------------------------------------

interface Pane {
  stretch: number;
  readonly scales: Map<string, PriceScale>;
  readonly series: Series<SeriesType>[];
  /** CSS px within the chart. */
  top: number;
  height: number;
}

export type Region =
  | { kind: "pane"; pane: number; x: number; y: number }
  | { kind: "priceAxis"; pane: number; scaleId: string }
  | { kind: "timeAxis" }
  | { kind: "separator"; index: number }
  | { kind: "none" };

const SEPARATOR = 1;
const AXIS_PAD = 6;
const MIN_AXIS_W = 48;

function resolveTheme(t: ChartOptionsInput["theme"], base: Theme): Theme {
  if (t === undefined) return base;
  if (t === "dark") return DARK;
  if (t === "light") return LIGHT;
  if (t === "high-contrast") return HIGH_CONTRAST;
  if (t === "auto") return systemTheme();
  const theme = { ...base, ...t };
  // A colour the renderer cannot read fails here, at the call, not in a frame.
  for (const k of Object.keys(theme) as (keyof Theme)[]) {
    if (k !== "fontFamily" && k !== "fontSize") parseColor(theme[k] as string);
  }
  return theme;
}

export class Chart implements Renderable {
  readonly element: HTMLDivElement;
  private readonly live: HTMLDivElement;
  private readonly layers: Layers;

  /** @internal */ readonly model = new DataModel();
  /** @internal */ readonly time: TimeScale;
  /** @internal */ readonly panes: Pane[] = [];
  private readonly events = new Emitter<ChartEvents>();
  private readonly primitives = new Map<Series<SeriesType>, Set<PanePrimitive>>();
  private readonly plugins = new Map<string, ChartPlugin>();
  /** What each plugin saved right after install: `restoreState` puts a plugin the layout does not mention back to it. */
  private readonly pluginInitial = new Map<string, unknown>();
  private cursorOverride: string | null = null;
  private lastPluginPane = 0;
  private intervalCache = -1;
  private seriesCounter = 0;
  private sessions: Sessions | null = null;
  private resampler: Resampler | null = null;
  private countdownTimer = 0;
  private autoTheme = false;
  private readonly mediaQueries: MediaQueryList[] = [];
  private table: HTMLTableElement | null = null;
  private tableTimer = 0;
  /** True when the caller set ariaLabel; otherwise it follows the "chart.ariaLabel" message. */
  private ariaLabelFixed: boolean;
  private opts: ChartOptions;
  private tz: TimeZone;
  private fmt: TimeFormatter;
  private readonly interaction: Interaction;
  private readonly resizeObs: ResizeObserver;
  private dprQuery: MediaQueryList | null = null;
  private removed = false;
  private readonly removeListeners: (() => void)[] = [];

  // Layout (CSS px).
  private cssW = 0;
  /** Device-px size of this chart's cell. */
  private devW = 1;
  private devH = 1;
  private cssH = 0;
  private dpr = 1;
  private leftW = 0;
  private rightW = 0;
  private timeH = 0;
  /** Time ticks for the current view, recomputed when the view changes. */
  private tticks: TimeTick[] = [];
  private tticksKey = "";
  private lastRange = { from: Number.NaN, to: Number.NaN };
  private viewSource: VisibleRangeEvent["source"] = "data";
  private readonly minmax = new Float64Array(2);
  private readonly vis = { lo: 0, hi: -1 };
  /** Axis column widths per side, CSS px (index 0 is next to the panes). */
  private readonly axisCols: Record<"left" | "right", number[]> = { left: [], right: [] };
  private readonly widths = new Map<string, number>();
  private widthFont = "";

  /** @internal Crosshair in chart CSS px; `syncIndex` when driven by another chart. */
  crosshair: { x: number; y: number; pane: number } | null = null;
  private syncIndex: number | null = null;
  private crosshairSource: CrosshairEvent["source"] = "pointer";
  private lastAnnounce = 0;

  /**
   * @param layers internal: a Dashboard passes its shared canvases; a
   * standalone chart creates its own.
   */
  constructor(container: HTMLElement, options: ChartOptionsInput = {}, layers?: (root: HTMLElement, events: SurfaceEvents) => Layers) {
    try {
      this.opts = {
        theme: resolveTheme(options.theme, DARK),
        timeZone: options.timeZone ?? "UTC",
        locale: options.locale,
        timeScale: { ...DEFAULT_TIME_SCALE, ...options.timeScale },
        crosshair: { mode: "magnet", visible: true, priceLabel: true, ...options.crosshair },
        grid: { vertLines: true, horzLines: true, ...options.grid },
        timeFormat: options.timeFormat,
        timeVisible: options.timeVisible ?? "auto",
        timeLabel: options.timeLabel,
        rightPriceScale: { ...DEFAULT_PRICE_SCALE, ...options.rightPriceScale, position: "right" },
        leftPriceScale: { ...DEFAULT_PRICE_SCALE, ...options.leftPriceScale, position: "left" },
        interaction: { pan: true, zoom: true, kinetic: true, keyboard: true, ...options.interaction },
        watermark: { ...DEFAULT_WATERMARK, ...options.watermark },
        messages: options.messages ?? defaultMessages,
        ariaLabel: options.ariaLabel ?? (options.messages ?? defaultMessages)("chart.ariaLabel"),
        renderer: options.renderer ?? "auto",
        sessions: options.sessions ?? null,
        resolution: options.resolution ?? null,
        countdown: options.countdown ?? true,
        keymap: { ...DEFAULT_KEYMAP, ...options.keymap },
        a11yTable: options.a11yTable ?? true,
      };
      this.ariaLabelFixed = options.ariaLabel !== undefined;
      this.autoTheme = options.theme === "auto";
      this.sessions = this.opts.sessions ? new Sessions(this.opts.sessions) : null;
      this.resampler = this.opts.resolution ? new Resampler(parseResolution(this.opts.resolution), this.opts.sessions ? { sessions: this.opts.sessions } : { timeZone: this.opts.timeZone }) : null;
      checkPriceScaleOptions(this.opts.rightPriceScale);
      checkPriceScaleOptions(this.opts.leftPriceScale);
      checkWatermarkOptions(this.opts.watermark);
      this.tz =new TimeZone(this.opts.timeZone);
      this.fmt = new TimeFormatter(this.opts.locale, this.tz, this.opts.timeFormat);
      this.time = new TimeScale(this.opts.timeScale);

      const root = document.createElement("div");
      root.style.cssText = "position:relative;width:100%;height:100%;overflow:hidden;user-select:none;-webkit-user-select:none;touch-action:none;outline:none";
      root.tabIndex = 0;
      root.setAttribute("role", "application");
      root.setAttribute("aria-roledescription", "chart");
      root.setAttribute("aria-label", this.opts.ariaLabel);
      this.live = document.createElement("div");
      this.live.setAttribute("aria-live", "polite");
      this.live.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap";
      root.appendChild(this.live);
      container.appendChild(root);
      this.element = root;

      const events: SurfaceEvents = {
        // GL objects are gone; renderers are rebuilt from the CPU stores on restore.
        lost: () => this.dropRenderers(),
        restored: () => this.invalidate(LAYER_ALL),
      };
      this.layers = layers ? layers(root, events) : new OwnLayers(root, this.opts.renderer, events);

      this.model.onChange(this.onData);
      this.interaction = new Interaction(this, root, root);
      this.resizeObs = new ResizeObserver(() => this.measure());
      this.resizeObs.observe(root);
      this.watchDpr();
      this.watchSystem();
      this.syncCountdown();
      this.measure();
    } catch (error) {
      emitFault({ source: "ctor", error });
      throw error;
    }
  }

  // ---- public API ---------------------------------------------------------------

  addSeries<T extends SeriesType>(type: T, options: Partial<SeriesOptions<T>> = {}): Series<T> {
    const id = options.id || this.nextSeriesId();
    if (this.allSeries().some((x) => x.options().id === id)) throw new Error(`alphacharts: a series with id "${id}" already exists`);
    const data = this.model.add(seriesType(type).shape);
    const s = new Series<T>(type, data, this, { ...options, id }, this.opts.theme);
    this.placeSeries(s as unknown as Series<SeriesType>);
    this.invalidate(LAYER_ALL);
    return s;
  }

  /**
   * Run `fn` and defer the data work to its end: any number of
   * `series.setData` calls cost one timeline rebuild and one round of change
   * events. Inside `fn`, timeline lookups (`timeToIndex`, ...) and series whose
   * times are not yet on the timeline still show the state before the batch.
   * Returns what `fn` returns; nests.
   */
  batch<T>(fn: () => T): T {
    return this.model.batch(fn);
  }

  removeSeries<T extends SeriesType>(series: Series<T>): void {
    const s = series as unknown as Series<SeriesType>;
    for (const p of this.panes) {
      const i = p.series.indexOf(s);
      if (i >= 0) p.series.splice(i, 1);
    }
    for (const prim of this.primitives.get(s) ?? []) prim.detached?.();
    this.primitives.delete(s);
    s.renderer?.dispose();
    s.renderer = null;
    s.renderer2d?.dispose();
    s.renderer2d = null;
    this.model.remove(s.data);
    this.prunePanes();
    this.invalidate(LAYER_ALL);
  }

  /** A horizontal line at a price, drawn with the series' scale. */
  createPriceLine<T extends SeriesType>(s: Series<T>, options: Partial<PriceLineOptions> & { price: number }): PriceLine {
    const line = new PriceLine({ labelTextColor: this.opts.theme.labelText, ...options });
    this.attachPrimitive(s as unknown as Series<SeriesType>, line);
    return line;
  }

  removePriceLine<T extends SeriesType>(s: Series<T>, line: PriceLine): void {
    this.detachPrimitive(s as unknown as Series<SeriesType>, line);
  }

  options(): Readonly<ChartOptions> {
    return this.opts;
  }

  /** True after remove(). */
  get isRemoved(): boolean {
    return this.removed;
  }

  applyOptions(o: ChartOptionsInput): void {
    const prev = this.opts;
    // Build everything that can throw before committing any of it.
    const tz = o.timeZone !== undefined ? new TimeZone(o.timeZone) : this.tz;
    const theme = resolveTheme(o.theme, prev.theme);
    if (o.rightPriceScale) checkPriceScaleOptions(o.rightPriceScale);
    if (o.leftPriceScale) checkPriceScaleOptions(o.leftPriceScale);
    const watermark = { ...prev.watermark, ...o.watermark };
    checkWatermarkOptions(watermark);
    const timeChanged = o.timeZone !== undefined || o.locale !== undefined || "timeFormat" in o;
    const fmt = timeChanged ? new TimeFormatter("locale" in o ? o.locale : prev.locale, tz, "timeFormat" in o ? o.timeFormat : prev.timeFormat) : this.fmt;
    this.opts = {
      ...prev,
      ...(o as Partial<ChartOptions>),
      theme,
      timeScale: { ...prev.timeScale, ...o.timeScale },
      crosshair: { ...prev.crosshair, ...o.crosshair },
      grid: { ...prev.grid, ...o.grid },
      rightPriceScale: { ...prev.rightPriceScale, ...o.rightPriceScale, position: "right" },
      leftPriceScale: { ...prev.leftPriceScale, ...o.leftPriceScale, position: "left" },
      interaction: { ...prev.interaction, ...o.interaction },
      watermark,
    };
    Object.assign(this.time.options, this.opts.timeScale);
    if (o.keymap) this.opts.keymap = { ...prev.keymap, ...o.keymap };
    if (o.theme !== undefined) this.autoTheme = o.theme === "auto";
    if (o.sessions !== undefined) this.sessions = o.sessions ? new Sessions(o.sessions) : null;
    if (o.resolution !== undefined || o.sessions !== undefined || o.timeZone !== undefined) {
      this.resampler = this.opts.resolution ? new Resampler(parseResolution(this.opts.resolution), this.opts.sessions ? { sessions: this.opts.sessions } : { timeZone: this.opts.timeZone }) : null;
    }
    this.syncCountdown();
    if (timeChanged) {
      this.tz = tz;
      this.fmt = fmt;
      this.tticksKey = "";
    }
    if (o.rightPriceScale && "minWidth" in o.rightPriceScale) this.axisCols.right = [];
    if (o.leftPriceScale && "minWidth" in o.leftPriceScale) this.axisCols.left = [];
    if (o.theme !== undefined) for (const p of this.panes) for (const s of p.series) s.themeChanged(this.opts.theme);
    for (const p of this.panes) {
      for (const [id, sc] of p.scales) {
        if (id === "right" && o.rightPriceScale) sc.options = { ...this.opts.rightPriceScale };
        if (id === "left" && o.leftPriceScale) sc.options = { ...this.opts.leftPriceScale };
      }
    }
    if (o.ariaLabel !== undefined) this.ariaLabelFixed = true;
    if (!this.ariaLabelFixed) this.opts.ariaLabel = this.opts.messages("chart.ariaLabel");
    this.element.setAttribute("aria-label", this.opts.ariaLabel);
    // Table text (headers, caption, time labels) depends on these.
    if (o.messages !== undefined || o.locale !== undefined || o.ariaLabel !== undefined || o.timeZone !== undefined) this.scheduleTable();
    this.invalidate(LAYER_ALL);
  }

  on<K extends keyof ChartEvents>(type: K, fn: (e: ChartEvents[K]) => void): () => void {
    return this.events.on(type, fn);
  }

  /** Options of a price scale in a pane ("right", "left" or an overlay id). */
  priceScale(id: string, pane = 0): { options(): Readonly<PriceScaleOptions>; applyOptions(o: Partial<PriceScaleOptions>): void } {
    const sc = this.panes[pane]?.scales.get(id);
    if (!sc) throw new RangeError(`no price scale "${id}" in pane ${pane}`);
    return {
      options: () => sc.options,
      applyOptions: (o) => {
        checkPriceScaleOptions(o);
        sc.options = { ...sc.options, ...o };
        if ("minWidth" in o) this.axisCols[sc.options.position === "left" ? "left" : "right"] = [];
        this.invalidate(LAYER_ALL);
      },
    };
  }

  /** Relative height of a pane (default 1; the first pane is usually 3). */
  setPaneStretch(pane: number, stretch: number): void {
    const p = this.panes[pane];
    if (!p) throw new RangeError(`no pane ${pane}`);
    if (!(stretch > 0)) throw new RangeError(`stretch must be positive, got ${stretch}`);
    p.stretch = stretch;
    this.invalidate(LAYER_ALL);
  }

  readonly timeScale = {
    scrollToLatest: () => this.viewChanged(() => this.time.scrollToLatest()),
    scrollToStart: () => this.viewChanged(() => this.time.scrollToStart()),
    fitContent: () => this.viewChanged(() => this.time.fitAll()),
    reset: () => this.viewChanged(() => this.time.reset()),
    /** Show fractional timeline indices [from, to]. */
    setVisibleLogicalRange: (r: { from: number; to: number }) => this.viewChanged(() => this.time.setRange(r.from, r.to)),
    getVisibleLogicalRange: (): { from: number; to: number } => ({ from: this.time.left, to: this.time.right }),
    /** Show [from, to] (UTC ms), snapped to the bars at or after each time. */
    setVisibleTimeRange: (r: { from: number; to: number }) => {
      const tl = this.model.timeline;
      this.viewChanged(() => this.time.setRange(tl.lowerBound(r.from) - 0.5, Math.min(tl.end - 1, tl.lowerBound(r.to)) + 0.5));
    },
    barSpacing: () => this.time.spacing,
    timeToIndex: (t: number) => this.model.timeline.indexOf(t),
    indexToTime: (i: number) => this.model.timeline.timeAt(i),
  };

  /** Pane-relative CSS x of a time, or undefined when no bar has that time. */
  timeToX(time: number): number | undefined {
    const i = this.model.timeline.indexOf(time);
    return i === undefined ? undefined : this.time.x(i);
  }

  /** CSS px of the pane area (the width the time scale draws in); 0 before the first layout. */
  paneWidth(): number {
    return Math.max(0, this.cssW - this.leftW - this.rightW);
  }

  /** CSS px taken by the price axes on one side (all their columns); 0 when there is no axis there. */
  priceAxisWidth(side: "left" | "right"): number {
    if (side !== "left" && side !== "right") throw new RangeError(`alphacharts: priceAxisWidth side must be "left" or "right", got "${String(side)}"`);
    return side === "left" ? this.leftW : this.rightW;
  }

  /** Release DOM, observers and the WebGL context. */
  remove(): void {
    if (this.removed) return;
    this.removed = true;
    for (const fn of this.removeListeners) fn();
    // Last installed first, so a plugin that builds on another is released before it. A plugin that throws does not stop the rest of the teardown.
    const failed: unknown[] = [];
    for (const [id, p] of [...this.plugins].reverse()) {
      try {
        p.uninstall?.();
      } catch (e) {
        failed.push(e);
      }
      this.plugins.delete(id);
    }
    this.pluginInitial.clear();
    cancelRender(this);
    this.interaction.dispose();
    this.resizeObs.disconnect();
    this.dprQuery?.removeEventListener("change", this.onDpr);
    for (const q of this.mediaQueries) q.removeEventListener("change", this.onSystem);
    clearInterval(this.countdownTimer);
    clearTimeout(this.tableTimer);
    for (const p of this.panes) for (const s of p.series) s.renderer?.dispose();
    this.layers.dispose();
    this.events.clear();
    this.element.remove();
    if (failed.length) throw failed.length === 1 ? failed[0] : new AggregateError(failed, "alphacharts: plugins failed to uninstall");
  }

  /** Every series on the chart, pane by pane. */
  series(): readonly Series<SeriesType>[] {
    return this.allSeries();
  }

  private allSeries(): Series<SeriesType>[] {
    return this.panes.flatMap((p) => p.series);
  }

  private nextSeriesId(): string {
    let id: string;
    do id = `s${++this.seriesCounter}`;
    while (this.allSeries().some((x) => x.options().id === id));
    return id;
  }

  // ---- layout ------------------------------------------------------------------

  /** The chart's arrangement as versioned JSON (no bar data). */
  saveState(): ChartState {
    const plugins: Record<string, unknown> = {};
    for (const [id, p] of this.plugins) if (p.toJSON) plugins[id] = p.toJSON();
    return {
      version: LAYOUT_VERSION,
      options: plain({ ...this.opts }),
      panes: this.panes.map((p) => ({
        stretch: p.stretch,
        scales: Object.fromEntries(
          [...p.scales].map(([id, sc]) => [id, sc.options.autoScale ? { options: plain(sc.options) } : { options: plain(sc.options), range: { min: sc.min, max: sc.max } }]),
        ),
      })),
      series: this.allSeries().map((x) => ({ id: x.options().id, type: x.type, options: plain(x.options()) })),
      view: { spacing: this.time.spacing, rightOffset: this.time.rightOffset },
      plugins,
      ...(this.opts.timeLabel ? { customOptions: ["timeLabel" as const] } : {}),
    };
  }

  /**
   * Replace every series, pane, scale, view and plugin state with a saved
   * layout. `data(series)` supplies each series' bars (or nothing, to fill it
   * later); `formatters` re-supplies custom price formatters by series id;
   * `timeLabel` re-supplies the custom time label function. A layout saved with
   * a custom price format or `timeLabel` is refused (nothing changed) when the
   * function is not passed.
   */
  restoreState(
    raw: unknown,
    opts: { data?: (s: SeriesState) => unknown; formatters?: Record<string, (v: number) => string>; timeLabel?: TimeLabel } = {},
  ): Series<SeriesType>[] {
    const st = migrate(raw);
    checkCustomOptions(st, { timeLabel: opts.timeLabel });
    const missing = Object.keys(st.plugins).filter((id) => !this.plugins.has(id));
    if (missing.length) throw new Error(`alphacharts: layout needs plugins that are not installed: ${missing.join(", ")}`);
    for (const ss of st.series) {
      const pf = (ss.options.priceFormat ?? {}) as { type?: string };
      if (pf.type === "custom" && !opts.formatters?.[ss.id]) throw new Error(`alphacharts: series "${ss.id}" has a custom price format; pass its formatter to restoreState`);
    }
    // Every plugin takes its state or the layout is refused: nothing is replaced before this passes.
    const seriesIds = st.series.map((s) => s.id);
    for (const [id, state] of Object.entries(st.plugins)) this.plugins.get(id)!.validateState?.(state, { seriesIds });
    // Everything applyOptions can refuse is checked before the first series is removed.
    const so = st.options as { timeFormat?: Intl.DateTimeFormatOptions; rightPriceScale?: object; leftPriceScale?: object; timeZone?: string; locale?: string };
    new TimeFormatter(so.locale ?? this.opts.locale, new TimeZone(so.timeZone ?? this.opts.timeZone), so.timeFormat);
    checkPriceScaleOptions((so.rightPriceScale ?? {}) as Partial<PriceScaleOptions>);
    checkPriceScaleOptions((so.leftPriceScale ?? {}) as Partial<PriceScaleOptions>);
    checkWatermarkOptions({ ...this.opts.watermark, ...(st.options as { watermark?: Partial<WatermarkOptions> }).watermark });
    for (const pn of st.panes) for (const sc of Object.values(pn.scales)) checkPriceScaleOptions(sc.options as Partial<PriceScaleOptions>);
    for (const x of this.allSeries()) this.removeSeries(x);
    this.applyOptions({ ...(st.options as ChartOptionsInput), ...(opts.timeLabel ? { timeLabel: opts.timeLabel } : {}) });
    const created: Series<SeriesType>[] = [];
    for (const ss of st.series) {
      const o = { ...ss.options } as Record<string, unknown>;
      const pf = o.priceFormat as { type?: string; minMove?: number } | undefined;
      if (pf?.type === "custom") o.priceFormat = { ...pf, format: opts.formatters![ss.id]! };
      const x = this.addSeries(ss.type as SeriesType, o as never);
      const input = opts.data?.(ss);
      if (input !== undefined) x.setData(input as never);
      created.push(x as unknown as Series<SeriesType>);
    }
    st.panes.forEach((ps, i) => {
      const p = this.panes[i];
      if (!p) return;
      p.stretch = ps.stretch;
      for (const [id, scs] of Object.entries(ps.scales)) {
        const sc = p.scales.get(id);
        if (!sc) continue;
        sc.options = { ...sc.options, ...(scs.options as Partial<PriceScaleOptions>) };
        if (scs.range) {
          sc.min = scs.range.min;
          sc.max = scs.range.max;
          sc.ranged = true;
        }
      }
    });
    this.time.spacing = st.view.spacing;
    this.time.rightOffset = st.view.rightOffset;
    this.time.clamp();
    for (const [id, state] of Object.entries(st.plugins)) this.plugins.get(id)!.fromJSON?.(state);
    // A plugin the layout does not mention must not keep the content of the layout it replaces.
    for (const [id, p] of this.plugins) if (!(id in st.plugins) && p.fromJSON && this.pluginInitial.has(id)) p.fromJSON(this.pluginInitial.get(id));
    this.invalidate(LAYER_ALL);
    return created;
  }

  // ---- plugins -----------------------------------------------------------------

  /** Install a plugin; ids are unique per chart. */
  addPlugin(plugin: ChartPlugin): void {
    if (this.plugins.has(plugin.id)) throw new Error(`alphacharts: a plugin with id "${plugin.id}" is already installed`);
    this.plugins.set(plugin.id, plugin);
    plugin.install(this.pluginApi);
    if (plugin.toJSON && plugin.fromJSON) this.pluginInitial.set(plugin.id, plugin.toJSON());
    this.invalidate(LAYER_OVERLAY);
  }

  removePlugin(id: string): void {
    const p = this.plugins.get(id);
    if (!p) return;
    this.plugins.delete(id);
    this.pluginInitial.delete(id);
    p.uninstall?.();
    this.invalidate(LAYER_ALL);
  }

  plugin<P extends ChartPlugin = ChartPlugin>(id: string): P | undefined {
    return this.plugins.get(id) as P | undefined;
  }

  private readonly pluginApi: PluginApi = Object.defineProperty(
    {
      requestRender: (all?: boolean) => this.invalidate(all ? LAYER_ALL : LAYER_OVERLAY),
      paneView: (pane: number) => this.pluginView(pane),
      barTimeAtOrBefore: (t: number) => {
        const i = this.model.timeline.indexAtOrBefore(t);
        return i === undefined ? undefined : this.model.timeline.timeAt(i);
      },
      setCursor: (css: string | null) => {
        this.cursorOverride = css;
      },
    },
    "paneCount",
    { get: () => this.panes.length },
  ) as PluginApi;

  /** @internal Offer a pointer event to plugins; true when one consumed it. */
  pluginPointer(type: PluginPointer["type"], x: number, y: number, e: PointerEvent | MouseEvent | null): boolean {
    if (this.plugins.size === 0) return false;
    const r = this.region(x, y);
    if (r.kind !== "pane" && type !== "up" && type !== "leave") return false;
    const pane = r.kind === "pane" ? r.pane : this.lastPluginPane;
    // An up/leave can follow a layout change that removed the pane it started
    // in, or its last series (a dashboard regrid, a symbol switch): with no
    // price scale there is no price under the pointer to report.
    if (!this.panes[pane]?.scales.size) return false;
    this.lastPluginPane = pane;
    const v = this.pluginView(pane);
    const px = x - this.leftW, py = y - (this.panes[pane]?.top ?? 0);
    const ev: PluginPointer = {
      type, pane, x: px, y: py, time: v.xToTime(px), price: v.yToPrice(py),
      pointerType: e && "pointerType" in e ? e.pointerType : "mouse",
      buttons: e?.buttons ?? 0, shiftKey: e?.shiftKey ?? false, altKey: e?.altKey ?? false, ctrlKey: e?.ctrlKey ?? false, metaKey: e?.metaKey ?? false,
    };
    let consumed = false;
    for (const pl of [...this.plugins.values()].reverse()) {
      if (pl.pointer?.(ev)) {
        consumed = true;
        break;
      }
    }
    return consumed;
  }

  /** @internal */
  pluginKey(e: KeyboardEvent): boolean {
    for (const pl of [...this.plugins.values()].reverse()) if (pl.key?.(e)) return true;
    return false;
  }

  /** Fractional timeline index of a time, extrapolated past either end. */
  timeToLogical(t: number): number {
    const tl = this.model.timeline;
    if (tl.length === 0) return Number.NaN;
    const first = tl.first, last = tl.end - 1;
    const t0 = tl.timeAt(first), t1 = tl.timeAt(last);
    if (t <= t0) return first - (t0 - t) / this.barInterval();
    if (t >= t1) return last + (t - t1) / this.barInterval();
    const i = tl.lowerBound(t);
    const ti = tl.timeAt(i);
    if (ti === t) return i;
    const tp = tl.timeAt(i - 1);
    return i - 1 + (t - tp) / (ti - tp);
  }

  /** Time at a fractional timeline index, extrapolated past either end. */
  logicalToTime(l: number): number {
    const tl = this.model.timeline;
    if (tl.length === 0) return Number.NaN;
    const first = tl.first, last = tl.end - 1;
    if (l <= first) return tl.timeAt(first) - (first - l) * this.barInterval();
    if (l >= last) return tl.timeAt(last) + (l - last) * this.barInterval();
    const i = Math.floor(l);
    const a = tl.timeAt(i), b = tl.timeAt(i + 1);
    return a + (l - i) * (b - a);
  }

  /** Median spacing of the last bars, for extrapolating beyond the data. */
  private barInterval(): number {
    if (this.intervalCache > 0) return this.intervalCache;
    const tl = this.model.timeline;
    const d: number[] = [];
    for (let i = tl.end - 1; i > tl.first && d.length < 15; i--) d.push(tl.timeAt(i) - tl.timeAt(i - 1));
    d.sort((a, b) => a - b);
    this.intervalCache = d.length ? d[d.length >> 1]! : 60_000;
    return this.intervalCache;
  }

  /**
   * A plugin's view of one pane. Plugins install before any series exists, so
   * the pane is looked up on every call, not captured: before it exists the
   * view has height 0 and anything that needs a price scale throws.
   */
  private pluginView(pane: number): PluginPaneView {
    const t = this.time;
    const paneOf = () => {
      const p = this.panes[pane];
      if (!p) throw new RangeError(`no pane ${pane} on this chart yet`);
      return p;
    };
    const scaleOf = (id?: string) => {
      const p = paneOf();
      const sc = id ? p.scales.get(id) : (sideScales(p, "right")[0] ?? sideScales(p, "left")[0] ?? p.scales.values().next().value);
      if (!sc) throw new RangeError(`no price scale ${id ?? ""} in pane ${pane}`);
      return sc;
    };
    const chart = this;
    return {
      pane,
      get width() {
        return t.width;
      },
      get height() {
        return chart.panes[pane]?.height ?? 0;
      },
      get dpr() {
        return chart.dpr;
      },
      timeToX: (time) => t.x(this.timeToLogical(time)),
      xToTime: (x) => this.logicalToTime(t.logical(x)),
      priceToY: (price, id) => scaleOf(id).y(price),
      yToPrice: (y, id) => scaleOf(id).price(y),
      formatPrice: (price, id) => {
        const sc = scaleOf(id);
        return axisText(sc, this.formatterFor(paneOf(), sc.id), price);
      },
      priceScaleMode: (id) => scaleOf(id).mode,
    };
  }

  // ---- SeriesHost ------------------------------------------------------------

  /** @internal */
  setData(s: Series<SeriesType>, input: unknown): void {
    this.model.setData(s.data, input as never);
  }
  /** @internal */
  prepend(s: Series<SeriesType>, input: unknown): void {
    this.model.prepend(s.data, input as never);
  }
  /** @internal */
  update(s: Series<SeriesType>, bar: unknown): void {
    this.model.update(s.data, bar as never);
  }
  /** @internal */
  setColors(s: Series<SeriesType>, colors: ColumnarColors): void {
    this.model.setColors(s.data, colors);
  }
  /** @internal */
  clearColors(s: Series<SeriesType>): void {
    this.model.clearColors(s.data);
  }
  /** @internal */
  optionsChanged(s: Series<SeriesType>, moved: boolean): void {
    if (moved) {
      for (const p of this.panes) {
        const i = p.series.indexOf(s);
        if (i >= 0) p.series.splice(i, 1);
      }
      this.placeSeries(s);
      this.prunePanes();
    }
    this.invalidate(LAYER_ALL);
  }
  /** @internal */
  attachPrimitive(s: Series<SeriesType>, p: PanePrimitive): void {
    let set = this.primitives.get(s);
    if (!set) this.primitives.set(s, (set = new Set()));
    set.add(p);
    p.attached?.({
      requestRender: (layer: RenderLayer = "overlay") => {
        if (layer !== "overlay" && layer !== "background" && layer !== "all") throw new RangeError(`alphacharts: requestRender layer must be "background", "overlay" or "all", got "${String(layer)}"`);
        this.invalidate(layer === "all" ? LAYER_BG | LAYER_OVERLAY : layer === "background" ? LAYER_BG : LAYER_OVERLAY);
      },
    });
    this.invalidate(LAYER_BG | LAYER_OVERLAY);
  }
  /** @internal */
  detachPrimitive(s: Series<SeriesType>, p: PanePrimitive): void {
    if (this.primitives.get(s)?.delete(p)) {
      p.detached?.();
      this.invalidate(LAYER_BG | LAYER_OVERLAY);
    }
  }
  /** @internal */
  markersChanged(): void {
    this.invalidate(LAYER_OVERLAY);
  }
  /** @internal */
  priceToY(s: Series<SeriesType>, price: number): number {
    const sc = this.rangedScale(s);
    return sc ? sc.y(price) : Number.NaN;
  }
  /** @internal */
  yToPrice(s: Series<SeriesType>, y: number): number {
    const sc = this.rangedScale(s);
    return sc ? sc.price(y) : Number.NaN;
  }
  private rangedScale(s: Series<SeriesType>): PriceScale | undefined {
    const p = this.panes.find((x) => x.series.includes(s));
    const sc = p?.scales.get(s.options().priceScaleId);
    return sc?.ranged ? sc : undefined;
  }
  /** @internal */
  timeAt(i: number): number {
    return this.model.timeline.timeAt(i);
  }
  /** @internal */
  get locale(): string | undefined {
    return this.opts.locale;
  }
  /** @internal */
  indexOf(t: number): number | undefined {
    return this.model.timeline.indexOf(t);
  }

  // ---- used by Interaction and SyncGroup ---------------------------------------------

  /** @internal */
  get timeline(): Timeline {
    return this.model.timeline;
  }

  /** @internal */
  get interactionOptions(): InteractionOptions {
    return this.opts.interaction;
  }

  /** @internal A dashboard redraws this cell's series when a neighbour drew (see DashboardCanvases.noteGLDraw). */
  redrawGL(): void {
    if (!this.removed && this.cssW > 0 && this.cssH > 0) this.drawGL();
  }

  /** @internal Called once when the chart is removed. */
  onRemove(fn: () => void): void {
    this.removeListeners.push(fn);
  }

  /** @internal The shared surface lost its context: drop GL objects. */
  surfaceLost(): void {
    this.dropRenderers();
  }

  /** Re-read size and cell position even if the size is unchanged (a host that moved the chart without resizing it). */
  remeasure(): void {
    this.cssW = -1;
    this.measure();
  }

  /** What is under chart CSS point (x, y): a pane, a price axis, the time axis, a pane separator or nothing. For hosts that build their own menus and hit tests. */
  region(x: number, y: number): Region {
    const paneX = this.leftW;
    const paneR = this.cssW - this.rightW;
    for (let i = 0; i < this.panes.length; i++) {
      const p = this.panes[i]!;
      if (i > 0 && Math.abs(y - (p.top - SEPARATOR / 2)) <= 4) return { kind: "separator", index: i };
      if (y >= p.top && y < p.top + p.height) {
        if (x < paneX || x >= paneR) {
          for (const [id, sc] of p.scales) if (axisShown(sc) && x >= sc.axisX && x < sc.axisX + sc.axisW) return { kind: "priceAxis", pane: i, scaleId: id };
          return { kind: "none" };
        }
        return { kind: "pane", pane: i, x: x - paneX, y: y - p.top };
      }
    }
    if (y >= this.cssH - this.timeH && x >= paneX && x < paneR) return { kind: "timeAxis" };
    return { kind: "none" };
  }

  /** True when a plugin asks for a cursor at the point: it owns the pointer there, so no `hovered`. */
  private pluginClaims(pane: number, x: number, y: number): boolean {
    // A pane removed since the crosshair was set has no plugin view to ask.
    if (!this.panes[pane]) return false;
    for (const pl of this.plugins.values()) if (pl.cursor?.(pane, x, y)) return true;
    return false;
  }

  /** @internal CSS cursor a primitive wants at a pane point, if any. */
  primitiveCursor(pane: number, x: number, y: number): string | null {
    if (this.cursorOverride) return this.cursorOverride;
    for (const pl of this.plugins.values()) {
      const c = pl.cursor?.(pane, x, y);
      if (c) return c;
    }
    return this.hit(pane, x, y).cursor;
  }

  /** @internal */
  viewChanged(fn: () => void, source: "user" | "sync" = "user"): void {
    fn();
    this.viewSource = source;
    this.invalidate(LAYER_ALL);
  }

  /** @internal Price-axis drag: factor > 1 zooms in. */
  scalePrice(pane: number, scaleId: string, factor: number): void {
    const sc = this.panes[pane]?.scales.get(scaleId);
    if (!sc) return;
    sc.scale(factor);
    this.invalidate(LAYER_ALL);
  }

  /** @internal Vertical pan of every scale in a pane that is not autoscaling. */
  panPrice(pane: number, dy: number): void {
    const p = this.panes[pane];
    if (!p) return;
    let moved = false;
    for (const sc of p.scales.values()) {
      if (sc.options.autoScale) continue;
      sc.pan(dy);
      moved = true;
    }
    if (moved) this.invalidate(LAYER_ALL);
  }

  /** Back to autoscale for one price scale of a pane (what a double-click on its axis does). */
  resetPriceScale(pane: number, scaleId: string): void {
    const sc = this.panes[pane]?.scales.get(scaleId);
    if (!sc) return;
    sc.options = { ...sc.options, autoScale: true };
    this.invalidate(LAYER_ALL);
  }

  /** @internal Drag a separator by dy CSS px. */
  resizePanes(index: number, dy: number): void {
    const a = this.panes[index - 1], b = this.panes[index];
    if (!a || !b) return;
    const total = a.height + b.height;
    const ha = Math.max(30, Math.min(total - 30, a.height + dy));
    const sum = a.stretch + b.stretch;
    a.stretch = (sum * ha) / total;
    b.stretch = sum - a.stretch;
    this.invalidate(LAYER_ALL);
  }

  /** @internal */
  setCrosshair(c: { x: number; y: number; pane: number } | null, source: CrosshairEvent["source"]): void {
    this.crosshair = c;
    this.syncIndex = null;
    this.crosshairSource = source;
    this.invalidate(LAYER_OVERLAY);
    if (this.events.has("crosshairMove")) this.events.emit("crosshairMove", this.crosshairEvent(source));
    if (source === "keyboard") this.announce();
  }

  /** @internal Show a vertical crosshair at a timeline index (synced chart). */
  setSyncedCrosshair(index: number | null): void {
    this.crosshair = null;
    this.syncIndex = index;
    this.invalidate(LAYER_OVERLAY);
  }

  /** @internal */
  pointerEvent(type: "click" | "dblclick"): void {
    if (this.events.has(type)) this.events.emit(type, this.crosshairEvent("pointer"));
  }

  /** @internal Index under the crosshair (pointer or keyboard), if any. */
  crosshairIndex(): number | undefined {
    if (!this.crosshair) return undefined;
    const i = this.time.indexAt(this.crosshair.x - this.leftW);
    return i >= this.time.first && i <= this.time.last ? i : undefined;
  }

  /** @internal Pane-area CSS geometry. */
  get paneArea(): { x: number; width: number } {
    return { x: this.leftW, width: this.cssW - this.leftW - this.rightW };
  }

  /** @internal */
  invalidate(layers: number): void {
    if (!this.removed) requestRender(this, layers);
  }

  // ---- data ----------------------------------------------------------------

  private readonly onData = (c: DataChange): void => {
    if (c.kind === "color") {
      // bar colours only: renderers patch the records; no bar, price or time moved, so plugins (studies) have nothing to follow
      for (const p of this.panes) for (const s of p.series) { s.renderer?.dataChanged(c); s.renderer2d?.dataChanged(c); }
      this.invalidate(LAYER_GL);
      return;
    }
    const t = this.time;
    const tl = this.model.timeline;
    const wasEmpty = t.end <= t.first;
    if (c.kind === "update" && c.appended && !wasEmpty) {
      // Decide with the old bounds: was the last bar on screen?
      if (!t.following) t.rightOffset -= 1;
    }
    t.first = tl.first;
    t.end = tl.end;
    if (wasEmpty && tl.length > 0) t.reset();
    for (const p of this.panes) {
      for (const s of p.series) {
        s.renderer?.dataChanged(c);
        s.renderer2d?.dataChanged(c);
        if (s.data === c.series) s.observeData(c.lo, c.hi);
      }
    }
    this.tticksKey = "";
    this.intervalCache = -1;
    for (const pl of this.plugins.values()) pl.dataChanged?.(c);
    if (c.kind !== "update") this.scheduleTable();
    this.invalidate(c.kind === "update" ? LAYER_GL | LAYER_OVERLAY : LAYER_ALL);
  };

  private placeSeries(s: Series<SeriesType>): void {
    const o = s.options();
    if (!Number.isInteger(o.pane) || o.pane < 0) throw new RangeError(`pane must be a non-negative integer, got ${o.pane}`);
    while (this.panes.length <= o.pane) {
      this.panes.push({ stretch: this.panes.length === 0 ? 3 : 1, scales: new Map(), series: [], top: 0, height: 0 });
    }
    const p = this.panes[o.pane]!;
    if (!p.scales.has(o.priceScaleId)) {
      const base = o.priceScaleId === "left" ? this.opts.leftPriceScale : o.priceScaleId === "right" ? this.opts.rightPriceScale : { ...DEFAULT_PRICE_SCALE, position: "none" as const };
      p.scales.set(o.priceScaleId, new PriceScale(o.priceScaleId, { ...base }));
    }
    p.series.push(s);
  }

  /** Drop trailing empty panes (an empty pane in the middle keeps its slot). */
  private prunePanes(): void {
    while (this.panes.length > 1 && this.panes[this.panes.length - 1]!.series.length === 0) this.panes.pop();
    for (const p of this.panes) {
      for (const id of [...p.scales.keys()]) if (!p.series.some((s) => s.options().priceScaleId === id)) p.scales.delete(id);
    }
  }

  // ---- frame ---------------------------------------------------------------

  render(layers: number): void {
    if (this.removed || this.cssW <= 0 || this.cssH <= 0) return;
    layers |= this.layout();
    if (layers & LAYER_BG) this.drawBg();
    if (layers & LAYER_GL) this.drawGL();
    if (layers & LAYER_OVERLAY) this.drawOverlay();
  }

  /** Returns layers that became dirty because the layout moved. */
  private layout(): number {
    let dirty = 0;
    const t = this.time;
    const font = this.opts.theme.fontSize;
    this.timeH = Math.round(font * 2.4);
    // Axis widths depend on labels, labels on the scale, the scale on the
    // pane width: two passes settle it (the second only when a width moved).
    for (let pass = 0; pass < 2; pass++) {
      const paneW = Math.max(1, this.cssW - this.leftW - this.rightW);
      if (t.width !== paneW) {
        t.width = paneW;
        t.clamp();
        dirty |= LAYER_ALL;
      }
      this.layoutPanes();
      t.visible(this.vis);
      let changed = false;
      for (const p of this.panes) changed = this.autoscale(p) || changed;
      if (changed) dirty |= LAYER_ALL;
      const [lw, rw] = this.axisWidths();
      if (lw === this.leftW && rw === this.rightW) break;
      this.leftW = lw;
      this.rightW = rw;
      dirty |= LAYER_ALL;
    }
    const key = `${this.vis.lo},${this.vis.hi},${t.spacing},${t.rightOffset},${t.width}`;
    if (key !== this.tticksKey) {
      this.tticksKey = key;
      const gap = this.measureText("00:00:00") + 24;
      this.tticks = timeTicks(this.model.timeline, this.tz, this.vis.lo, this.vis.hi, (i) => t.x(i), t.spacing, gap);
      dirty |= LAYER_BG;
    }
    if (t.left !== this.lastRange.from || t.right !== this.lastRange.to) {
      this.lastRange = { from: t.left, to: t.right };
      dirty |= LAYER_ALL;
      if (this.events.has("visibleRangeChange")) this.events.emit("visibleRangeChange", { from: t.left, to: t.right, source: this.viewSource });
      for (const pl of this.plugins.values()) pl.viewChanged?.();
      this.scheduleTable();
    }
    this.viewSource = "data";
    return dirty;
  }

  private layoutPanes(): void {
    const n = this.panes.length;
    const avail = this.cssH - this.timeH - SEPARATOR * Math.max(0, n - 1);
    const total = this.panes.reduce((a, p) => a + p.stretch, 0) || 1;
    let y = 0, used = 0;
    for (let i = 0; i < n; i++) {
      const p = this.panes[i]!;
      const h = i === n - 1 ? avail - used : Math.round((avail * p.stretch) / total);
      p.top = y;
      p.height = Math.max(1, h);
      used += h;
      y += h + SEPARATOR;
      for (const sc of p.scales.values()) sc.height = p.height;
    }
  }

  /** Fit every autoscaling scale of a pane to its visible series. True when a range moved. */
  private autoscale(p: Pane): boolean {
    let moved = false;
    const { lo, hi } = this.vis;
    for (const [id, sc] of p.scales) {
      if (sc.mode === "percent" || sc.mode === "indexed") this.rebase(p, id, sc);
      if (!sc.options.autoScale) continue;
      let min = Number.POSITIVE_INFINITY, max = Number.NEGATIVE_INFINITY;
      for (const s of p.series) {
        const o = s.options();
        if (!o.visible || o.priceScaleId !== id) continue;
        let a = Number.NaN, b = Number.NaN;
        if (hi >= lo) {
          s.def.autoscale(s.data, o, lo, hi, this.minmax);
          a = this.minmax[0]!;
          b = this.minmax[1]!;
        } else if (!o.autoscale) continue;
        if (o.autoscale) [a, b] = overrideRange(o.id, o.autoscale, a, b);
        if (a < min) min = a;
        if (b > max) max = b;
      }
      if (min === Number.POSITIVE_INFINITY) continue;
      const pmin = sc.min, pmax = sc.max;
      sc.fit(min, max);
      if (sc.min !== pmin || sc.max !== pmax) moved = true;
    }
    return moved;
  }

  /** Percent/indexed base: the main series' first visible value. */
  private rebase(p: Pane, id: string, sc: PriceScale): void {
    const s = this.mainSeries(p, id);
    if (!s) return;
    const o = s.options();
    for (let i = Math.max(this.vis.lo, s.data.store.first); i <= this.vis.hi; i++) {
      const v = s.def.valueAt(s.data, o, i);
      if (v && v.value !== 0) {
        sc.base = v.value;
        return;
      }
    }
  }

  private axisWidths(): [number, number] {
    // Axes stand in columns per side: column j holds each pane's j-th shown
    // scale on that side, as wide as its widest member.
    const need: Record<"left" | "right", number[]> = { left: [], right: [] };
    const gap = this.opts.theme.fontSize * 3.2;
    for (const p of this.panes) {
      for (const side of ["left", "right"] as const) {
        sideScales(p, side).forEach((sc, j) => {
          const fmt = this.formatterFor(p, sc.id);
          sc.ticks = scaleTicks(sc, fmt, gap);
          let w = 0;
          for (const tk of sc.ticks) w = Math.max(w, this.measureText(tk.label));
          for (const s of p.series) {
            const o = s.options();
            if (o.priceScaleId !== sc.id || !o.lastValueVisible) continue;
            const last = s.data.lastIndex();
            const lv = last === undefined ? undefined : s.def.valueAt(s.data, o, last);
            if (lv) w = Math.max(w, this.measureText(axisText(sc, s.formatter, lv.value)));
          }
          need[side][j] = Math.max(need[side][j] ?? 0, MIN_AXIS_W, sc.options.minWidth ?? 0, Math.ceil(w + AXIS_PAD * 2 + 4));
        });
      }
    }
    // Hysteresis: grow at once, shrink only by a margin, so a ticking price
    // does not make the panes breathe.
    const settle = (cur: number | undefined, n: number) => (cur === undefined || n > cur || n < cur - 12 ? n : cur);
    for (const side of ["left", "right"] as const) {
      this.axisCols[side] = need[side].map((n, j) => settle(this.axisCols[side][j], n));
    }
    const left = this.axisCols.left.reduce((a, b) => a + b, 0);
    const right = this.axisCols.right.reduce((a, b) => a + b, 0);
    for (const p of this.panes) {
      let x = this.cssW - right;
      sideScales(p, "right").forEach((sc, j) => {
        sc.axisX = x;
        sc.axisW = this.axisCols.right[j]!;
        x += sc.axisW;
      });
      x = left;
      sideScales(p, "left").forEach((sc, j) => {
        sc.axisW = this.axisCols.left[j]!;
        x -= sc.axisW;
        sc.axisX = x;
      });
    }
    return [left, right];
  }

  /** The series that formats a scale's axis and sets its percent/indexed base. */
  private mainSeries(p: Pane, scaleId: string): Series<SeriesType> | undefined {
    const on = p.series.filter((x) => x.options().priceScaleId === scaleId && x.options().visible);
    return on.find((x) => x.options().scaleFormat) ?? on.find((x) => x.options().priceFormat.type !== "volume") ?? on[0];
  }

  private formatterFor(p: Pane, scaleId: string): Formatter | undefined {
    return this.mainSeries(p, scaleId)?.formatter;
  }

  // ---- bg layer ----------------------------------------------------------------

  private drawBg(): void {
    const ctx = this.layers.bg, th = this.opts.theme, d = this.dpr;
    const { ox, oy } = this.layers;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.rect(ox, oy, this.devW, this.devH);
    ctx.clip();
    ctx.fillStyle = th.background;
    ctx.fillRect(ox, oy, this.devW, this.devH);
    ctx.setTransform(d, 0, 0, d, ox, oy);
    ctx.font = this.font();
    const paneX = this.leftW, paneW = this.time.width;
    const one = 1 / d;

    for (let i = 0; i < this.panes.length; i++) {
      const p = this.panes[i]!;
      // Outside regular hours: shaded runs of bars (skipped when bars are
      // sub-pixel, where a shade would only tint every column).
      if (this.sessions && this.time.spacing >= 0.5 && this.vis.hi >= this.vis.lo) {
        ctx.fillStyle = th.extendedHours;
        const tl = this.model.timeline, t = this.time, half = t.spacing / 2;
        let runStart = -1;
        for (let k = this.vis.lo; k <= this.vis.hi + 1; k++) {
          const off = k <= this.vis.hi && this.sessions.state(tl.timeAt(k)) !== "regular";
          if (off && runStart < 0) runStart = k;
          if (!off && runStart >= 0) {
            const x0 = Math.max(0, t.x(runStart) - half), x1 = Math.min(paneW, t.x(k - 1) + half);
            ctx.fillRect(paneX + x0, p.top, x1 - x0, p.height);
            runStart = -1;
          }
        }
      }
      // Grid.
      ctx.fillStyle = th.grid;
      if (this.opts.grid.vertLines) {
        for (const tk of this.tticks) {
          const x = paneX + crisp(tk.x, d) - one / 2;
          if (x >= paneX && x < paneX + paneW) ctx.fillRect(x, p.top, one, p.height);
        }
      }
      const gsc = sideScales(p, "right")[0] ?? sideScales(p, "left")[0];
      if (gsc && this.opts.grid.horzLines) for (const tk of gsc.ticks) ctx.fillRect(paneX, p.top + crisp(gsc.y(tk.price), d) - one / 2, paneW, one);
      // Primitives that draw behind the series, clipped to the pane.
      let bgPrims = false;
      for (const s of p.series) if (s.options().visible && (this.primitives.get(s)?.size ?? 0) > 0) bgPrims = true;
      if (bgPrims) {
        ctx.save();
        ctx.setTransform(d, 0, 0, d, ox + paneX * d, oy + p.top * d);
        ctx.beginPath();
        ctx.rect(0, 0, paneW, p.height);
        ctx.clip();
        for (const s of p.series) {
          const set = this.primitives.get(s);
          if (!set || !s.options().visible || !p.scales.has(s.options().priceScaleId)) continue;
          const view = this.paneView(p, s);
          for (const prim of set) {
            if (!prim.drawBackground) continue;
            ctx.save();
            prim.drawBackground(ctx, view);
            ctx.restore();
          }
        }
        ctx.restore();
        ctx.font = this.font();
      }
      // Separator above.
      if (i > 0) {
        ctx.fillStyle = th.border;
        ctx.fillRect(0, p.top - SEPARATOR, this.cssW, SEPARATOR);
      }
      // Price axes.
      for (const sc of p.scales.values()) {
        if (!axisShown(sc)) continue;
        const left = sc.options.position === "left";
        ctx.fillStyle = th.border;
        ctx.fillRect(left ? sc.axisX + sc.axisW - one : sc.axisX, p.top, one, p.height);
        ctx.fillStyle = th.textMuted;
        ctx.textBaseline = "middle";
        ctx.textAlign = left ? "right" : "left";
        for (const tk of sc.ticks) {
          const y = p.top + sc.y(tk.price);
          if (y < p.top + 6 || y > p.top + p.height - 6) continue;
          ctx.fillText(tk.label, left ? sc.axisX + sc.axisW - AXIS_PAD : sc.axisX + AXIS_PAD, y);
        }
      }
    }
    // Time axis.
    const ty = this.cssH - this.timeH;
    ctx.fillStyle = th.border;
    ctx.fillRect(0, ty, this.cssW, one);
    ctx.fillStyle = th.textMuted;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    const tl = this.model.timeline;
    for (const tk of this.tticks) {
      const x = paneX + tk.x;
      if (x < paneX + 4 || x > paneX + paneW - 4) continue;
      ctx.fillStyle = tk.weight >= 18 ? th.text : th.textMuted;
      const tt = tl.timeAt(tk.index);
      ctx.fillText(timeText(this.opts.timeLabel, "tick", tt, () => this.fmt.tick(tt, tk.weight)), x, ty + this.timeH / 2);
    }
    ctx.restore();
  }

  // ---- gl layer ------------------------------------------------------------------

  private drawGL(): void {
    const sf = this.layers.surface;
    if (!sf.begin(this.layers.ox, this.layers.oy, this.devW, this.devH)) return;
    const d = this.dpr;
    const x0 = Math.round(this.leftW * d);
    const x1 = Math.round((this.leftW + this.time.width) * d);
    for (const p of this.panes) {
      const y0 = Math.round(p.top * d);
      const y1 = Math.round((p.top + p.height) * d);
      const w = x1 - x0, h = y1 - y0;
      if (w <= 0 || h <= 0) continue;
      sf.pane({ x: x0, y: y0, width: w, height: h }, () => {
        for (const s of p.series) {
          const o = s.options();
          const sc = p.scales.get(o.priceScaleId);
          if (!o.visible || !sc || s.data.store.length === 0) continue;
          if (sf.kind === "canvas2d") {
            s.renderer2d ??= this.make2D(s);
            s.renderer2d.draw({ ctx: sf.ctx2d!, data: s.data, time: this.time, price: sc, dpr: d, width: w, height: h, lo: this.vis.lo, hi: this.vis.hi }, o);
          } else {
            const gl = sf.gl!, ctx = sf.glctx!;
            s.renderer ??= s.def.createRenderer(gl, ctx, s.data);
            const view: DrawView = { gl, ctx, data: s.data, time: this.time, price: sc, dpr: d, width: w, height: h, lo: this.vis.lo, hi: this.vis.hi };
            s.renderer.draw(view, o);
          }
        }
      });
    }
    sf.end();
    this.layers.glDrawn?.(this);
  }

  private make2D(s: Series<SeriesType>): NonNullable<Series<SeriesType>["renderer2d"]> {
    if (!s.def.createRenderer2D) throw new Error(`alphacharts: series type "${s.type}" has no Canvas2D renderer, and WebGL2 is unavailable`);
    return s.def.createRenderer2D(s.data);
  }

  private dropRenderers(): void {
    for (const p of this.panes) for (const s of p.series) s.renderer = null;
  }

  /** Which surface draws this chart's series. */
  get renderer(): SurfaceKind {
    return this.layers.surface.kind;
  }

  // ---- overlay layer --------------------------------------------------------------

  private drawOverlay(): void {
    const ctx = this.layers.overlay, th = this.opts.theme, d = this.dpr;
    const { ox, oy } = this.layers;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.rect(ox, oy, this.devW, this.devH);
    ctx.clip();
    ctx.clearRect(ox, oy, this.devW, this.devH);
    ctx.font = this.font();
    const paneX = this.leftW, paneW = this.time.width;
    const labels: { pane: Pane; sc: PriceScale; l: AxisLabel }[] = [];
    let countdownAt: { pane: Pane; sc: PriceScale; l: AxisLabel } | undefined;

    for (const p of this.panes) {
      // Pane content: last-value lines, primitives. Clipped to the pane.
      ctx.save();
      ctx.setTransform(d, 0, 0, d, ox + paneX * d, oy + p.top * d);
      ctx.beginPath();
      ctx.rect(0, 0, paneW, p.height);
      ctx.clip();
      ctx.font = this.font();
      // First, so markers, primitives and plugin drawings stay above the halo.
      if (p === this.panes[0]) drawWatermark(ctx, paneW, p.height, th, this.opts.watermark);
      for (const s of p.series) {
        const o = s.options();
        const sc = p.scales.get(o.priceScaleId);
        if (!o.visible || !sc) continue;
        const last = s.data.lastIndex();
        const lv = last === undefined ? undefined : s.def.valueAt(s.data, o, last);
        if (lv) {
          if (o.priceLineVisible) {
            const y = crisp(sc.y(lv.value), d);
            ctx.strokeStyle = lv.color;
            ctx.lineWidth = 1 / d;
            ctx.setLineDash([1, 2]);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(paneW, y);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          if (o.lastValueVisible && axisShown(sc)) {
            labels.push({ pane: p, sc, l: { price: lv.value, text: axisText(sc, s.formatter, lv.value), background: lv.color, color: contrastText(lv.color) } });
            if (o.title) this.drawTitleTag(ctx, o.title, sc, lv, p.height, paneW);
            if (!countdownAt && p === this.panes[0] && s === this.mainSeries(p, sc.id)) countdownAt = labels[labels.length - 1]!;
          }
        }
        if (s.markers().length > 0) drawMarkers(ctx, this.markerLayout(p, s, sc));
        const set = this.primitives.get(s);
        if (set && set.size > 0) {
          const view = this.paneView(p, s);
          for (const prim of set) {
            prim.draw?.(ctx, view);
            if (axisShown(sc) && prim.axisLabels) {
              for (const l of prim.axisLabels(view)) labels.push({ pane: p, sc, l });
            }
          }
        }
      }
      if (this.plugins.size > 0) {
        const view = this.pluginView(this.panes.indexOf(p));
        for (const pl of this.plugins.values()) pl.drawPane?.(ctx, view);
      }
      ctx.restore();
    }

    // Crosshair.
    const ch = this.crosshair;
    let cIndex: number | undefined;
    if (this.opts.crosshair.visible && this.opts.crosshair.mode !== "hidden" && (ch || this.syncIndex !== null)) {
      cIndex = ch ? this.time.indexAt(ch.x - paneX) : this.syncIndex!;
      const inData = cIndex >= this.time.first && cIndex <= this.time.last;
      const cx = paneX + (inData ? this.time.x(cIndex) : ch!.x - paneX);
      ctx.setTransform(d, 0, 0, d, ox, oy);
      ctx.strokeStyle = th.crosshair;
      ctx.lineWidth = 1 / d;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      const vx = crisp(cx, d);
      if (vx >= paneX && vx <= paneX + paneW) {
        ctx.moveTo(vx, 0);
        ctx.lineTo(vx, this.cssH - this.timeH);
      }
      let hy: number | undefined;
      const p = ch ? this.panes[ch.pane] : undefined;
      if (ch && p) {
        hy = p.top + this.crosshairY(p, ch.y, inData ? cIndex : undefined);
        const y = crisp(hy, d);
        ctx.moveTo(paneX, y);
        ctx.lineTo(paneX + paneW, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      if (ch && p && hy !== undefined && this.opts.crosshair.priceLabel) {
        for (const sc of p.scales.values()) {
          if (!axisShown(sc)) continue;
          const price = sc.price(hy - p.top);
          const text = axisText(sc, this.formatterFor(p, sc.id), price);
          labels.push({ pane: p, sc, l: { price, text, background: th.labelBackground, color: th.labelText } });
        }
      }
      if (inData) {
        const ct = this.model.timeline.timeAt(cIndex);
        const text = timeText(this.opts.timeLabel, "crosshair", ct, () => this.fmt.crosshair(ct, this.timeVisible()));
        const w = this.measureText(text) + 16;
        const lx = Math.max(paneX, Math.min(paneX + paneW - w, cx - w / 2));
        ctx.fillStyle = th.labelBackground;
        ctx.fillRect(lx, this.cssH - this.timeH, w, this.timeH);
        ctx.fillStyle = th.labelText;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, lx + w / 2, this.cssH - this.timeH / 2);
      }
    }

    // Axis labels last, so they sit over the axis text.
    ctx.setTransform(d, 0, 0, d, ox, oy);
    const lh = Math.round(this.opts.theme.fontSize * 1.8);
    for (const { pane, sc, l } of labels) {
      const y = pane.top + sc.y(l.price);
      if (!(y >= pane.top && y <= pane.top + pane.height)) continue;
      const left = sc.options.position === "left";
      const ax = sc.axisX, aw = sc.axisW;
      const top = Math.max(pane.top, Math.min(pane.top + pane.height - lh, y - lh / 2));
      ctx.fillStyle = l.background;
      ctx.fillRect(ax, top, aw, lh);
      ctx.fillStyle = l.color;
      ctx.textBaseline = "middle";
      ctx.textAlign = left ? "right" : "left";
      ctx.fillText(l.text, left ? ax + aw - AXIS_PAD : ax + AXIS_PAD, top + lh / 2);
    }
    // Countdown to the bar close, in a box under the main last-price label.
    const cd = countdownAt && this.opts.countdown ? this.countdownText() : null;
    if (countdownAt && cd) {
      const { pane, sc, l } = countdownAt;
      const y = pane.top + sc.y(l.price);
      const top = Math.max(pane.top, Math.min(pane.top + pane.height - lh, y - lh / 2)) + lh;
      if (top + lh <= pane.top + pane.height) {
        const left = sc.options.position === "left";
        ctx.fillStyle = l.background;
        ctx.fillRect(sc.axisX, top, sc.axisW, lh);
        ctx.fillStyle = l.color;
        ctx.textAlign = left ? "right" : "left";
        ctx.fillText(cd, left ? sc.axisX + sc.axisW - AXIS_PAD : sc.axisX + AXIS_PAD, top + lh / 2);
      }
    }
    ctx.restore();
  }

  /** The series title as a tag at the pane edge beside the axis, level with the last-value label. */
  private drawTitleTag(ctx: CanvasRenderingContext2D, title: string, sc: PriceScale, lv: { value: number; color: string }, paneH: number, paneW: number): void {
    const y = sc.y(lv.value);
    if (!(y >= 0 && y <= paneH)) return;
    const lh = Math.round(this.opts.theme.fontSize * 1.8);
    const w = Math.ceil(this.measureText(title)) + 10;
    const top = Math.max(0, Math.min(paneH - lh, y - lh / 2));
    const left = sc.options.position === "left";
    const x = left ? 0 : paneW - w;
    ctx.fillStyle = lv.color;
    ctx.fillRect(x, top, w, lh);
    ctx.fillStyle = contrastText(lv.color);
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(title, x + 5, top + lh / 2);
  }

  /** Markers of a series placed in pane px: those on the visible bars (and one bar either side, for their width). */
  private markerLayout(p: Pane, s: Series<SeriesType>, sc: PriceScale): PlacedMarker[] {
    const ms = s.markers();
    const tl = this.model.timeline;
    if (ms.length === 0 || this.vis.hi < this.vis.lo || tl.length === 0) return [];
    const t = this.time, d = s.data, ohlc = d.shape === "ohlc";
    // vis is refreshed in layout(): after a setData it can lie outside the new timeline until the next frame.
    const a = Math.max(tl.first, this.vis.lo - 1), b = Math.min(tl.end - 1, this.vis.hi + 1);
    if (a > b) return [];
    const t0 = tl.timeAt(a), t1 = tl.timeAt(b);
    return placeMarkers({
      markers: ms,
      from: markerLowerBound(ms, t0),
      to: markerLowerBound(ms, t1 + 1),
      barSpacing: t.spacing,
      fontSize: this.opts.theme.fontSize,
      textWidth: (str) => this.measureText(str),
      bar: (m) => {
        const i = tl.indexOf(m.time);
        if (i === undefined || !d.has(i)) return undefined;
        const ya = sc.y(ohlc ? d.get(i, COL_H) : d.get(i, COL_V)), yb = sc.y(ohlc ? d.get(i, COL_L) : d.get(i, COL_V));
        if (!Number.isFinite(ya) || !Number.isFinite(yb)) return undefined;
        return { x: t.x(i), yHigh: Math.min(ya, yb), yLow: Math.max(ya, yb) };
      },
    });
  }

  /** The marker (with an id) or primitive item at pane point (x, y), and the cursor it asks for. */
  private hit(pane: number, x: number, y: number): { hovered?: HoveredObject; cursor: string | null } {
    const p = this.panes[pane];
    if (!p) return { cursor: null };
    for (let k = p.series.length - 1; k >= 0; k--) {
      const s = p.series[k]!;
      const sc = p.scales.get(s.options().priceScaleId);
      if (!sc || !s.options().visible || s.markers().length === 0) continue;
      const placed = this.markerLayout(p, s, sc);
      for (let j = placed.length - 1; j >= 0; j--) {
        const b = placed[j]!.box, id = placed[j]!.marker.id;
        if (id !== undefined && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return { hovered: { kind: "marker", id }, cursor: "pointer" };
      }
    }
    for (const s of p.series) {
      const set = this.primitives.get(s);
      if (!set || !s.options().visible || !p.scales.has(s.options().priceScaleId)) continue;
      const view = this.paneView(p, s);
      for (const prim of set) {
        const r = prim.hitTest?.(x, y, view);
        if (!r) continue;
        if (typeof r === "string") return { cursor: r };
        if (typeof r.id !== "string" || r.id === "") throw new Error("alphacharts: a primitive's hitTest returned a hit without an id");
        return { hovered: { kind: "primitive", id: r.id }, cursor: r.cursor ?? null };
      }
    }
    return { cursor: null };
  }

  /** Crosshair y in a pane: the pointer, or the main series' close in magnet mode. */
  private crosshairY(p: Pane, y: number, index: number | undefined): number {
    if (this.opts.crosshair.mode !== "magnet" || index === undefined || this.crosshairSource === "sync") return y;
    const s = p.series.find((x) => x.options().visible);
    if (!s) return y;
    const sc = p.scales.get(s.options().priceScaleId);
    const v = s.def.valueAt(s.data, s.options(), index);
    return sc && v ? sc.y(v.value) : y;
  }

  private crosshairEvent(source: CrosshairEvent["source"]): CrosshairEvent {
    const ch = this.crosshair;
    if (!ch) return { source };
    const i = this.time.indexAt(ch.x - this.leftW);
    const ev: CrosshairEvent = { source, pane: ch.pane, point: { x: ch.x - this.leftW, y: ch.y } };
    if (source === "pointer" && !this.cursorOverride && !this.pluginClaims(ch.pane, ch.x - this.leftW, ch.y)) {
      const h = this.hit(ch.pane, ch.x - this.leftW, ch.y).hovered;
      if (h) ev.hovered = h;
    }
    if (i >= this.time.first && i <= this.time.last) {
      ev.index = i;
      ev.time = this.model.timeline.timeAt(i);
    }
    return ev;
  }

  /** Values under the crosshair for the screen-reader readout. */
  private announce(): void {
    const now = performance.now();
    if (now - this.lastAnnounce < 250) return;
    this.lastAnnounce = now;
    const i = this.crosshairIndex();
    if (i === undefined) return;
    const msg = this.opts.messages;
    const at = this.model.timeline.timeAt(i);
    const parts = [timeText(this.opts.timeLabel, "crosshair", at, () => this.fmt.crosshair(at, this.timeVisible()))];
    for (const p of this.panes) {
      for (const s of p.series) {
        const b = s.barAtIndex(i) as Record<string, number> | undefined;
        if (!b) continue;
        const name = s.options().title || s.type;
        parts.push(
          "open" in b
            ? msg("chart.readout.ohlc", { name, open: s.formatPrice(b.open!), high: s.formatPrice(b.high!), low: s.formatPrice(b.low!), close: s.formatPrice(b.close!) })
            : msg("chart.readout.value", { name, value: s.formatPrice(b.value!) }),
        );
      }
    }
    this.live.textContent = parts.join(", ");
  }

  private paneView(p: Pane, s: Series<SeriesType>): PaneView {
    const sc = p.scales.get(s.options().priceScaleId)!;
    const t = this.time, tl = this.model.timeline;
    return {
      width: t.width,
      height: p.height,
      dpr: this.dpr,
      lo: this.vis.lo,
      hi: this.vis.hi,
      x: (i) => t.x(i),
      y: (v) => sc.y(v),
      index: (x) => t.indexAt(x),
      price: (y) => sc.price(y),
      timeToIndex: (time) => tl.indexOf(time),
      indexToTime: (i) => tl.timeAt(i),
      timeToX: (time) => t.x(this.timeToLogical(time)),
      barSpacing: t.spacing,
      formatPrice: (v) => s.formatPrice(v),
    };
  }

  private timeVisible(): boolean {
    const v = this.opts.timeVisible;
    if (v !== "auto") return v;
    const tl = this.model.timeline;
    if (tl.length < 2) return true;
    return tl.timeAt(tl.end - 1) - tl.timeAt(tl.end - 2) < 86_400_000;
  }

  private font(): string {
    return `${this.opts.theme.fontSize}px ${this.opts.theme.fontFamily}`;
  }

  /** CSS px width of `s` in the theme font. Cached: labels repeat every frame. */
  private measureText(s: string): number {
    const font = this.font();
    if (font !== this.widthFont) {
      this.widths.clear();
      this.widthFont = font;
    }
    let w = this.widths.get(s);
    if (w === undefined) {
      const ctx = this.layers.bg;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.font = font;
      w = ctx.measureText(s).width;
      ctx.restore();
      if (this.widths.size > 4096) this.widths.clear();
      this.widths.set(s, w);
    }
    return w;
  }

  // ---- system preferences, countdown, screen-reader table -----------------------

  /** Follow OS theme/contrast (theme "auto") and reduced-motion changes. */
  private watchSystem(): void {
    if (typeof matchMedia === "undefined") return;
    for (const q of ["(prefers-color-scheme: light)", "(prefers-contrast: more)"]) {
      const m = matchMedia(q);
      m.addEventListener("change", this.onSystem);
      this.mediaQueries.push(m);
    }
  }

  private readonly onSystem = (): void => {
    if (!this.autoTheme) return;
    this.opts = { ...this.opts, theme: systemTheme() };
    for (const p of this.panes) for (const s of p.series) s.themeChanged(this.opts.theme);
    this.invalidate(LAYER_ALL);
  };

  /** @internal Kinetic scrolling is off when the user asks for reduced motion. */
  get reducedMotion(): boolean {
    return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /** @internal The action bound to a key event, if any. */
  keyAction(e: KeyboardEvent): KeyAction | undefined {
    const parts: string[] = [];
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (e.metaKey) parts.push("Meta");
    parts.push(e.key);
    const combo = parts.join("+");
    for (const [action, keys] of Object.entries(this.opts.keymap) as [KeyAction, string[]][]) {
      if (keys.includes(combo) || (!e.ctrlKey && !e.altKey && !e.metaKey && keys.includes(e.key) && !combo.startsWith("Shift+Arrow"))) return action;
    }
    return undefined;
  }

  /** Reset the view and every price scale to automatic. */
  resetChart(): void {
    for (const p of this.panes) for (const sc of p.scales.values()) sc.options = { ...sc.options, autoScale: true };
    this.viewChanged(() => this.time.reset());
  }

  private syncCountdown(): void {
    clearInterval(this.countdownTimer);
    this.countdownTimer = 0;
    if (this.opts.countdown && this.resampler) {
      this.countdownTimer = window.setInterval(() => this.invalidate(LAYER_OVERLAY), 1000);
    }
  }

  /** "mm:ss" (or "h:mm:ss", "Nd") to the close of the bar holding the last time; null when unknown. */
  private countdownText(): string | null {
    const r = this.resampler;
    const tl = this.model.timeline;
    if (!r || tl.length === 0) return null;
    const last = tl.timeAt(tl.end - 1);
    const start = r.bucketStart(last);
    // The next bucket starts at the first time past this one that maps elsewhere.
    let probe = start + 1000;
    const step = r.res.unit === "s" ? 1000 : r.res.unit === "m" ? 60_000 : r.res.unit === "h" ? 3_600_000 : 86_400_000;
    for (let i = 0; i < 400 && r.bucketStart(probe) === start; i++) probe += step * Math.max(1, Math.floor(r.res.n / 2));
    const next = r.bucketStart(probe);
    const left = Math.max(0, next - Date.now());
    if (!(next > start)) return null;
    const sec = Math.floor(left / 1000);
    if (sec >= 86_400) return this.opts.messages("chart.countdown.days", { n: Math.floor(sec / 86_400) });
    const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
    const two = (n: number) => String(n).padStart(2, "0");
    return hh > 0 ? `${hh}:${two(mm)}:${two(ss)}` : `${two(mm)}:${two(ss)}`;
  }

  /** Rebuild the screen-reader table shortly after the view or data settles. */
  private scheduleTable(): void {
    if (!this.opts.a11yTable || this.tableTimer) return;
    this.tableTimer = window.setTimeout(() => {
      this.tableTimer = 0;
      this.buildTable();
    }, 400);
  }

  private buildTable(): void {
    const s = this.panes[0]?.series.find((x) => x.options().visible);
    if (!s) return;
    if (!this.table) {
      // A table sizes to its content and ignores overflow, so the visually
      // hidden box is a wrapper div: a bare 1,900 px table made the chart root
      // scrollable, and scroll-into-view then moved content under the pointer.
      const wrap = document.createElement("div");
      wrap.style.cssText = "position:absolute;left:0;top:0;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap";
      this.table = document.createElement("table");
      wrap.appendChild(this.table);
      this.element.appendChild(wrap);
    }
    const t = this.table;
    const ohlc = s.data.shape === "ohlc";
    const msg = this.opts.messages;
    const head = (ohlc ? ["time", "open", "high", "low", "close"] as const : ["time", "value"] as const).map((k) => msg(`chart.table.${k}`));
    const rows: string[] = [];
    // The newest 200 visible bars: enough to read around, bounded DOM.
    for (let i = this.vis.hi; i >= this.vis.lo && rows.length < 200; i--) {
      const b = s.barAtIndex(i) as Record<string, number> | undefined;
      if (!b) continue;
      const cells = ohlc ? [b.open!, b.high!, b.low!, b.close!].map((v) => s.formatPrice(v)) : [s.formatPrice(b.value!)];
      rows.push(`<tr><th scope="row">${esc(this.fmt.crosshair(b.time!, this.timeVisible()))}</th>${cells.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`);
    }
    t.innerHTML = `<caption>${esc(msg("chart.table.caption", { label: this.opts.ariaLabel, name: s.options().title || s.type }))}</caption><thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody>`;
  }

  // ---- size, DPR, context -------------------------------------------------------------

  private measure(): void {
    const r = this.element.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (r.width === this.cssW && r.height === this.cssH && dpr === this.dpr) return;
    this.cssW = r.width;
    this.cssH = r.height;
    this.dpr = dpr;
    this.devW = Math.max(1, Math.round(r.width * dpr));
    this.devH = Math.max(1, Math.round(r.height * dpr));
    this.layers.fit(r.width, r.height, dpr);
    this.tticksKey = "";
    // Render synchronously so a resize never shows a stretched frame.
    this.render(LAYER_ALL);
  }

  private watchDpr(): void {
    this.dprQuery?.removeEventListener("change", this.onDpr);
    this.dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    this.dprQuery.addEventListener("change", this.onDpr);
  }

  private readonly onDpr = (): void => {
    this.watchDpr();
    this.measure();
  };

}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** Apply a series' `autoscale` override to its built-in [low, high] (NaN when empty); NaN, NaN when it contributes nothing. */
function overrideRange(id: string, fn: NonNullable<SeriesOptions<SeriesType>["autoscale"]>, low: number, high: number): [number, number] {
  const r = fn(low === low && high === high ? { low, high } : null);
  if (r === null) return [Number.NaN, Number.NaN];
  if (typeof r !== "object" || !Number.isFinite(r.low) || !Number.isFinite(r.high) || r.low > r.high) {
    throw new RangeError(`alphacharts: series "${id}" autoscale must return null or { low, high } with finite low <= high, got ${JSON.stringify(r)}`);
  }
  return [r.low, r.high];
}

/** True when a scale draws an axis. */
function axisShown(sc: PriceScale): boolean {
  return sc.options.position !== "none" && sc.options.visible;
}

/** A pane's shown scales on one side, in creation order (column order). */
function sideScales(p: Pane, side: "left" | "right"): PriceScale[] {
  const out: PriceScale[] = [];
  for (const sc of p.scales.values()) if (sc.options.position === side && sc.options.visible) out.push(sc);
  return out;
}

/** Black or white, whichever reads better on `bg`. */
function contrastText(bg: string): string {
  const c = parseColor(bg);
  const r = (c >>> 24) & 255, g = (c >>> 16) & 255, b = (c >>> 8) & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#000000" : "#ffffff";
}

