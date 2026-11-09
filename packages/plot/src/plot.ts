// The plot: DOM, canvases, pointer / keyboard / wheel input, legend, tooltip,
// exports. Layout and drawing live in panel.ts and draw.ts.

import { cssColor, DEFAULT_WATERMARK, parseColor, watchTheme } from "@alphacharts/core";
import { defaultMode, hitAt, stopsOf, type Hit, type HitMode, type Stop } from "./hit.js";
import { Fmt } from "./format.js";
import { withAlpha, type ColorScale } from "./color.js";
import { drawPanel } from "./draw.js";
import { defaultPlotMessages, type PlotMessageKey, type PlotMessages } from "./messages.js";
import { mergeExtents, prepare, type Extents, type Prepared } from "./model.js";
import { isBand, Panel, type Rect } from "./panel.js";
import { plotted, toCsv, type Column } from "./rows.js";
import type { Mark, PlotSpec, TooltipContent } from "./spec.js";
import { plotThemeFromCss, resolveTheme, type PlotTheme } from "./theme.js";
import { paddingOf, validateSpec } from "./validate.js";

/** A stale screen-reader table is rebuilt within this many ms of the first update that staled it. */
const TABLE_IDLE_MS = 1000;

export interface PlotEvents {
  /** The crosshair moved: the x of the hit (a number, or a category), or null when it left. */
  crosshair: { key: { num?: number; cat?: string } | null };
  /** The zoomed x range changed (null: the full range). */
  view: { domain: [number, number] | null };
  /** A brush selection finished. */
  brush: { x0: number; x1: number };
  /** A legend entry was toggled. */
  legend: { name: string; hidden: boolean };
  /** What the tooltip shows (null when it is hidden). */
  hover: TooltipContent | null;
  /** A draw failed (bad data found at draw time). Without a listener the error goes to console.error. */
  error: { error: unknown };
  /** The plot was disposed (sync groups drop it). */
  dispose: Record<string, never>;
}
type Handler<K extends keyof PlotEvents> = (e: PlotEvents[K]) => void;

interface Cell {
  title: string | undefined;
  prepared: Prepared;
  panel: Panel;
  stops: Stop[] | null;
}

interface LegendEntry {
  name: string;
  color: string;
  shape: "line" | "box" | "dot";
  hidden: boolean;
  rect: Rect;
}

const SR_ONLY = "position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0";
let uid = 0;

export class Plot {
  readonly element: HTMLElement;
  private spec!: PlotSpec;
  private theme!: PlotTheme;
  private fmt!: Fmt;
  private msg: PlotMessages = defaultPlotMessages;
  private cells: Cell[] = [];
  private readonly userHidden = new Map<string, boolean>();
  private view: [number, number] | null = null;

  private readonly root: HTMLDivElement;
  private readonly base: HTMLCanvasElement;
  private readonly over: HTMLCanvasElement;
  private readonly tip: HTMLDivElement;
  private readonly live: HTMLDivElement;
  private readonly tableHost: HTMLDivElement;
  private readonly hint: HTMLSpanElement;
  private ro: ResizeObserver | undefined;

  private w = 0;
  private h = 0;
  private dpr = 1;
  private autoHeight = false;
  private legend: LegendEntry[] = [];
  private bar: { scale: ColorScale; rect: Rect } | undefined;
  private raf = 0;
  private overRaf = 0;
  private disposed = false;
  private readonly decorative: boolean;
  /** The table is out of date with the spec; it is rebuilt on focus or after the updates stop. */
  private tableDirty = false;
  private tableTimer: ReturnType<typeof setTimeout> | undefined;
  /** Set by update(): the pointer's tooltip is looked up again once the new layout is drawn. */
  private restore: { had: boolean } | null = null;
  private lastPointer: { x: number; y: number } | null = null;
  private framing = false;

  private active: { cell: Cell; hit: Hit } | null = null;
  private external: { num?: number; cat?: string } | null = null;
  private lastKey: string | undefined;
  private stopIndex = -1;
  private kbCell = 0;
  private focusRing = false;
  private brushing: { cell: Cell; x0: number; x1: number } | null = null;
  private panning: { cell: Cell; x: number; domain: [number, number] } | null = null;
  private down: { x: number; y: number; moved: boolean } | null = null;
  private readonly handlers = new Map<keyof PlotEvents, Set<Handler<never>>>();
  private readonly cleanup: (() => void)[] = [];

  constructor(host: HTMLElement, spec: PlotSpec) {
    if (typeof document === "undefined") throw new Error("alphacharts: createPlot needs a DOM");
    this.element = host;
    this.decorative = spec.decorative === true;
    this.root = document.createElement("div");
    this.root.className = "ac-plot";
    if (this.decorative) this.root.setAttribute("aria-hidden", "true");
    else {
      this.root.tabIndex = 0;
      this.root.setAttribute("role", "group");
      this.root.setAttribute("aria-roledescription", "chart");
    }
    this.root.style.cssText = "position:relative;width:100%;height:100%;overflow:hidden;outline:none;user-select:none;-webkit-user-select:none;";
    const layer = (): HTMLCanvasElement => {
      const c = document.createElement("canvas");
      c.setAttribute("aria-hidden", "true");
      c.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;";
      return c;
    };
    this.base = layer();
    this.over = layer();
    this.tip = document.createElement("div");
    this.tip.setAttribute("role", "tooltip");
    this.tip.style.cssText = "position:absolute;left:0;top:0;display:none;pointer-events:none;z-index:2;box-sizing:border-box;max-width:260px;padding:6px 8px;border-radius:4px;font:12px/1.35 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.25);white-space:nowrap;";
    this.live = document.createElement("div");
    this.live.setAttribute("aria-live", "polite");
    this.live.style.cssText = SR_ONLY;
    this.tableHost = document.createElement("div");
    this.tableHost.style.cssText = SR_ONLY;
    this.hint = document.createElement("span");
    this.hint.id = `ac-plot-hint-${++uid}`;
    this.hint.style.cssText = SR_ONLY;
    if (this.decorative) this.root.append(this.base, this.over, this.tip);
    else {
      this.root.setAttribute("aria-describedby", this.hint.id);
      this.root.append(this.base, this.over, this.tip, this.live, this.hint, this.tableHost);
    }
    host.appendChild(this.root);

    try {
      this.bind();
      this.setSpec(spec, true);
      if (typeof ResizeObserver !== "undefined") {
        this.ro = new ResizeObserver(() => this.resize());
        this.ro.observe(host);
      }
      this.resize();
    } catch (e) {
      // A rejected spec must not leave a div and document listeners behind: the caller has no handle to dispose.
      this.dispose();
      throw e;
    }
  }

  // ---- public API -------------------------------------------------------

  /** Replace the spec. Legend toggles and the zoom survive when the series and x axis still exist. */
  update(spec: PlotSpec): void {
    this.assertLive();
    this.setSpec(spec, false);
    this.resize();
  }

  on<K extends keyof PlotEvents>(type: K, fn: Handler<K>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn as Handler<never>);
    return () => set!.delete(fn as Handler<never>);
  }

  /** The zoomed x range, or null for the full range. */
  getView(): [number, number] | null {
    return this.view ? [...this.view] : null;
  }

  /** Zoom to an x range (continuous x axes), or null to reset. `silent` skips the event (used by sync). */
  setView(domain: readonly [number, number] | null, silent = false): void {
    if (this.disposed && silent) return; // a sync group may still hold a plot that was just disposed
    this.assertLive();
    if (domain !== null && !(domain[0] < domain[1])) throw new RangeError(`alphacharts: view [${domain[0]}, ${domain[1]}] must increase`);
    const same = (this.view === null && domain === null) || (this.view !== null && domain !== null && this.view[0] === domain[0] && this.view[1] === domain[1]);
    if (same) return;
    this.view = domain ? [domain[0], domain[1]] : null;
    this.invalidateStops();
    this.schedule();
    if (!silent) this.emit("view", { domain: this.getView() });
  }

  /** Show or hide a series by name, as the legend does. */
  toggleSeries(name: string, hidden?: boolean): void {
    this.assertLive();
    const now = this.isHidden(name);
    const next = hidden ?? !now;
    if (next === now) return;
    const prev = this.userHidden.get(name);
    this.userHidden.set(name, next);
    try {
      this.cells = this.compile(this.spec, this.theme, this.fmt, this.msg, new Map()).cells;
    } catch (e) {
      if (prev === undefined) this.userHidden.delete(name);
      else this.userHidden.set(name, prev);
      throw e;
    }
    this.active = null;
    this.stopIndex = -1;
    this.tableDirty = true;
    this.ensureTable();
    this.live.textContent = this.msg(next ? "plot.announce.hidden" : "plot.announce.shown", { name });
    this.emit("legend", { name, hidden: next });
    this.resize();
  }

  /** Put the crosshair at an x from another plot (null clears it). Does not emit `crosshair`. */
  crosshairTo(key: { num?: number; cat?: string } | null): void {
    if (this.disposed) return;
    this.external = key;
    if (key === null) {
      if (!this.pointerInside) this.setActive(null, true);
      return;
    }
    const cell = this.cells[0];
    if (!cell) return;
    const p = cell.panel;
    let px = NaN;
    if (key.cat !== undefined && isBand(p.sx) && p.sx.has(key.cat)) px = p.sx.center(key.cat);
    else if (key.num !== undefined && !isBand(p.sx)) px = p.sx.map(key.num);
    if (!(px === px) || px < p.area.x || px > p.area.x + p.area.w) {
      this.setActive(null, true);
      return;
    }
    const py = p.area.y + p.area.h / 2;
    const hit = hitAt(p, px, py, this.modeOf(cell), true) ?? { title: "", rows: [], x: px, y: py, snapX: px, dots: [] };
    this.setActive({ cell, hit }, true);
  }

  /** CSV of the data actually plotted (visible series, as given). */
  exportCsv(): string {
    this.assertLive();
    return toCsv(plotted(this.cells));
  }

  /** The chart as a PNG at `scale` times its CSS size (default: the device pixel ratio). */
  exportPng(opts: { scale?: number } = {}): Promise<Blob> {
    this.assertLive();
    if (!(this.w > 0 && this.h > 0)) return Promise.reject(new Error("alphacharts: exportPng on a plot with no size"));
    const scale = opts.scale ?? this.dpr;
    if (!(scale > 0)) return Promise.reject(new RangeError(`alphacharts: exportPng scale ${scale} must be positive`));
    const c = document.createElement("canvas");
    c.width = Math.round(this.w * scale);
    c.height = Math.round(this.h * scale);
    const ctx = c.getContext("2d");
    if (!ctx) return Promise.reject(new Error("alphacharts: no 2D context for the export"));
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    this.paint(ctx, scale);
    return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("alphacharts: PNG encoding failed"))), "image/png"));
  }

  /** Draw now instead of on the next frame (tests, screenshots). */
  flush(): void {
    this.assertLive();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.renderBase();
    this.renderOverlay();
  }

  /** The current tooltip content, for hosts that draw their own. */
  hover(): TooltipContent | null {
    return this.active && this.active.hit.rows.length ? withIndex({ title: this.active.hit.title, rows: this.active.hit.rows }) : null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.emit("dispose", {});
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.overRaf) cancelAnimationFrame(this.overRaf);
    clearTimeout(this.tableTimer);
    this.ro?.disconnect();
    this.unwatchPage?.();
    this.unwatchPage = null;
    for (const f of this.cleanup) f();
    this.root.remove();
    this.handlers.clear();
  }

  // ---- setup --------------------------------------------------------------

  private unwatchPage: (() => void) | null = null;

  /** Theme "inherit": read the page's variables again whenever a class, style or theme attribute above the plot, or the OS scheme, changes. */
  private followPage(on: boolean): void {
    if (!on) {
      this.unwatchPage?.();
      this.unwatchPage = null;
      return;
    }
    // From the host element up: the plot writes its own root's style on every resize, which is not a theme change.
    this.unwatchPage ??= watchTheme(this.root.parentElement ?? this.root, () => {
      if (this.disposed || this.spec.theme !== "inherit") return;
      this.setSpec(this.spec, false);
      this.resize();
    });
  }

  private assertLive(): void {
    if (this.disposed) throw new Error("alphacharts: the plot is disposed");
  }

  private emit<K extends keyof PlotEvents>(type: K, e: PlotEvents[K]): void {
    const set = this.handlers.get(type);
    if (set) for (const fn of [...set]) (fn as Handler<K>)(e);
  }

  private isHidden(name: string, spec: PlotSpec = this.spec): boolean {
    const u = this.userHidden.get(name);
    if (u !== undefined) return u;
    return this.allMarks(spec).some((m) => m.name === name && m.hidden === true);
  }

  private allMarks(s: PlotSpec): Mark[] {
    return [...s.marks, ...(s.facets ? s.facets.cells.flatMap((c) => c.marks) : [])];
  }

  /** Everything derived from a spec, computed without touching the plot: a spec that throws leaves the old state. */
  private compile(spec: PlotSpec, theme: PlotTheme, fmt: Fmt, msg: PlotMessages, colors: Map<string, string>): { cells: Cell[] } {
    const hidden = new Set(this.allMarks(spec).filter((m) => m.name !== undefined && this.isHidden(m.name, spec)).map((m) => m.name!));
    const watermark = { ...DEFAULT_WATERMARK, ...spec.watermark };
    const mk = (marks: readonly Mark[], title: string | undefined, first: boolean): Cell => {
      const prepared = prepare({ marks, scales: spec.scales, theme, hidden, colors });
      const panel = new Panel({ prepared, theme, fmt, scales: spec.scales, axes: spec.axes, msg, title, padding: paddingOf(spec), watermark: first ? watermark : undefined });
      return { title, prepared, panel, stops: null };
    };
    return { cells: spec.facets ? spec.facets.cells.map((c, i) => mk([...c.marks, ...spec.marks], c.title, i === 0)) : [mk(spec.marks, undefined, true)] };
  }

  private setSpec(spec: PlotSpec, first: boolean): void {
    validateSpec(spec);
    if (!first && (spec.decorative === true) !== this.decorative) throw new TypeError("alphacharts: decorative cannot change after the plot is created (it decides which elements and listeners exist)");
    const theme = spec.theme === "inherit" ? plotThemeFromCss(this.root) : resolveTheme(spec.theme);
    const msg = spec.messages ?? defaultPlotMessages;
    const timeAxis = spec.scales?.x?.type === "time";
    if (timeAxis && spec.timeZone === undefined) throw new TypeError('alphacharts: a time x axis needs spec.timeZone (an IANA name such as "Asia/Kolkata", or "UTC"): there is no safe default');
    const fmt = new Fmt(spec.locale, spec.timeZone ?? "UTC");
    const colors = new Map<string, string>();
    const { cells } = this.compile(spec, theme, fmt, msg, colors);
    // Committed only now: nothing above changed the plot.
    const prevKind = this.cells[0]?.prepared.xKind;
    // update(): keep what the pointer is over. The layout is not known until the frame, so the lookup waits for it.
    if (!first) this.restore = { had: this.active !== null };
    this.spec = spec;
    this.theme = theme;
    this.followPage(spec.theme === "inherit");
    this.fmt = fmt;
    this.msg = msg;
    this.cells = cells;
    this.active = null;
    this.stopIndex = -1;
    if (!this.decorative) {
      this.root.setAttribute("aria-label", spec.title ?? msg("plot.ariaLabel"));
      this.root.setAttribute("aria-roledescription", msg("plot.roleDescription"));
      this.hint.textContent = msg("plot.keyboardHint");
    }
    const it = spec.interactions;
    this.root.style.touchAction = it?.brush || it?.zoom ? "none" : "";
    this.root.style.cursor = it?.brush ? "crosshair" : "";
    this.root.style.background = theme.background;
    this.tip.style.background = theme.tooltipBackground;
    this.tip.style.color = theme.tooltipText;
    this.tip.style.border = `1px solid ${theme.border}`;
    this.tip.style.fontFamily = theme.fontFamily;
    if (first) {
      this.tableDirty = true;
      this.ensureTable();
    } else this.markTableDirty();
    if (!first && prevKind !== cells[0]?.prepared.xKind) this.view = null;
  }

  /** The table is stale: refresh it at most TABLE_IDLE_MS from now (however fast updates arrive), or when the plot gains focus. */
  private markTableDirty(): void {
    if (this.decorative) return;
    this.tableDirty = true;
    this.tableTimer ??= setTimeout(() => this.ensureTable(), TABLE_IDLE_MS);
  }

  private ensureTable(): void {
    if (!this.tableDirty || this.disposed) return;
    this.tableDirty = false;
    clearTimeout(this.tableTimer);
    this.tableTimer = undefined;
    this.buildTable();
  }

  private buildTable(): void {
    if (this.decorative) return;
    const max = this.spec.maxTableRows ?? 500;
    const data = plotted(this.cells, max + 1);
    const host = this.tableHost;
    host.textContent = "";
    const table = document.createElement("table");
    const cap = document.createElement("caption");
    cap.textContent = this.msg("plot.table.caption", { title: this.spec.title ?? this.msg("plot.ariaLabel") }) + (data.rows.length > max ? ` ${this.msg("plot.table.truncated", { shown: max })}` : "");
    table.appendChild(cap);
    const names: Record<Column, PlotMessageKey> = {
      facet: "plot.table.group", mark: "plot.table.mark", series: "plot.table.series", x: "plot.table.x", x1: "plot.table.x1",
      y: "plot.table.y", y0: "plot.table.y0", open: "plot.table.open", high: "plot.table.high", low: "plot.table.low", close: "plot.table.close", size: "plot.table.size", value: "plot.table.value", label: "plot.table.label", state: "plot.table.state",
    };
    const head = table.createTHead().insertRow();
    for (const c of data.columns) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = this.msg(names[c]);
      head.appendChild(th);
    }
    const body = table.createTBody();
    for (const r of data.rows.slice(0, max)) {
      const tr = body.insertRow();
      for (const c of data.columns) tr.insertCell().textContent = r[c] ?? "";
    }
    // A <table> ignores overflow:hidden, so the visually hidden wrapper is the div around it.
    host.appendChild(table);
  }

  private bind(): void {
    const on = <T extends Event>(t: EventTarget, type: string, fn: (e: T) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => t.removeEventListener(type, fn as EventListener, opts));
    };
    const r = this.root;
    on<PointerEvent>(r, "pointermove", (e) => this.onMove(e));
    on<PointerEvent>(r, "pointerleave", () => {
      this.pointerInside = false;
      this.lastPointer = null;
      if (!this.brushing && !this.panning) this.setActive(null, false);
    });
    on<PointerEvent>(r, "pointerdown", (e) => this.onDown(e));
    on<PointerEvent>(r, "pointerup", (e) => this.onUp(e));
    on<PointerEvent>(r, "pointercancel", () => {
      this.brushing = this.panning = this.down = null;
      this.scheduleOverlay();
    });
    on<WheelEvent>(r, "wheel", (e) => this.onWheel(e), { passive: false });
    on<MouseEvent>(r, "dblclick", () => {
      if (this.view) {
        this.setView(null);
        this.live.textContent = this.msg("plot.announce.zoomReset");
      }
    });
    if (this.decorative) return; // not focusable: no keyboard, focus ring or document listeners
    on<KeyboardEvent>(r, "keydown", (e) => this.onKey(e));
    on<FocusEvent>(r, "focus", () => {
      this.focusRing = this.keyboardFocus;
      this.ensureTable();
      this.scheduleOverlay();
    });
    on<FocusEvent>(r, "blur", () => {
      this.focusRing = false;
      this.scheduleOverlay();
    });
    on<PointerEvent>(r, "pointerdown", () => {
      this.keyboardFocus = false;
    }, { capture: true });
    on<KeyboardEvent>(r, "keyup", () => {
      this.keyboardFocus = true;
    }, { capture: true });
    // Tab into the plot is a keyboard focus: mark it before the focus event.
    on<KeyboardEvent>(r.ownerDocument, "keydown", (e) => {
      if (e.key === "Tab") this.keyboardFocus = true;
    }, { capture: true });
  }

  private pointerInside = false;
  private keyboardFocus = false;

  // ---- size and scheduling --------------------------------------------------

  private resize(): void {
    if (this.disposed) return;
    const host = this.element;
    const w = this.spec.width ?? host.clientWidth;
    let h: number;
    if (this.spec.height !== undefined) h = this.spec.height;
    else if (this.autoHeight) h = Math.round(w / 2);
    else {
      h = host.clientHeight;
      // Neither the spec nor the container gives a height: 2:1.
      if (h === 0 && w > 0) {
        this.autoHeight = true;
        h = Math.round(w / 2);
      }
    }
    this.root.style.height = this.spec.height !== undefined || this.autoHeight ? `${h}px` : "100%";
    this.root.style.width = this.spec.width !== undefined ? `${w}px` : "100%";
    this.w = w;
    this.h = h;
    this.invalidateStops();
    if (w > 0 && h > 0) this.schedule();
  }

  private schedule(): void {
    if (this.raf || this.disposed) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.guard(() => {
        this.renderBase();
        this.renderOverlay();
      });
    });
  }

  private scheduleOverlay(): void {
    if (this.framing || this.overRaf || this.raf || this.disposed) return;
    this.overRaf = requestAnimationFrame(() => {
      this.overRaf = 0;
      this.guard(() => this.renderOverlay());
    });
  }

  /** Errors in a frame callback cannot reach the caller: they go to the `error` event, or the console without one. */
  private guard(fn: () => void): void {
    try {
      fn();
    } catch (error) {
      if (this.handlers.get("error")?.size) this.emit("error", { error });
      else console.error(error);
    }
  }

  private invalidateStops(): void {
    for (const c of this.cells) c.stops = null;
  }

  // ---- rendering ----------------------------------------------------------------

  private sizeCanvas(c: HTMLCanvasElement): CanvasRenderingContext2D {
    const dpr = (typeof devicePixelRatio === "number" && devicePixelRatio > 0) ? devicePixelRatio : 1;
    this.dpr = dpr;
    const bw = Math.round(this.w * dpr), bh = Math.round(this.h * dpr);
    if (c.width !== bw) c.width = bw;
    if (c.height !== bh) c.height = bh;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("alphacharts: no 2D canvas context");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  private renderBase(): void {
    if (this.disposed || !(this.w > 0 && this.h > 0)) return;
    const ctx = this.sizeCanvas(this.base);
    ctx.clearRect(0, 0, this.w, this.h);
    this.paint(ctx, this.dpr);
    this.invalidateStops();
    this.restoreHover();
  }

  /** After update(): the tooltip under the pointer, looked up in the new layout (or the synced crosshair, which the update dropped). */
  private restoreHover(): void {
    const r = this.restore;
    if (!r) return;
    this.restore = null;
    this.framing = true; // the overlay is drawn right after this frame's base
    try {
      // The pointer as it is now: it may have left, or be brushing, since the update.
      const ptr = this.pointerInside && !this.brushing && !this.panning ? this.lastPointer : null;
      if (ptr) {
        const cell = this.cellAt(ptr.x, ptr.y);
        const snap = typeof this.spec.tooltip === "object" ? this.spec.tooltip.snap !== false : true;
        const hit = cell ? hitAt(cell.panel, ptr.x, ptr.y, this.modeOf(cell), snap) : null;
        if (hit && cell) this.setActive({ cell, hit }, false);
        else if (r.had) this.setActive(null, false);
      } else if (this.external) this.crosshairTo(this.external);
      else if (r.had) this.setActive(null, false);
    } finally {
      this.framing = false;
    }
  }

  /** Layout and draw everything but the overlay, onto `ctx` (CSS px, scaled by dpr). */
  private paint(ctx: CanvasRenderingContext2D, dpr: number): void {
    const th = this.theme;
    ctx.fillStyle = th.background;
    ctx.fillRect(0, 0, this.w, this.h);
    const area = this.layoutLegend(ctx);
    const cells = this.cells;
    const f = this.spec.facets;
    if (!f) {
      cells[0]!.panel.layout(ctx, area, { view: this.view, xLabels: true, yLabels: true });
    } else {
      const cols = Math.max(1, f.columns ?? Math.ceil(Math.sqrt(cells.length)));
      const rows = Math.ceil(cells.length / cols);
      const gap = f.gap ?? 12;
      const cw = (area.w - gap * (cols - 1)) / cols, ch = (area.h - gap * (rows - 1)) / rows;
      const shareX = f.shareX ?? true, shareY = f.shareY ?? true;
      const exts: Extents[] = cells.map((c) => c.panel.computeExtents(this.view));
      const merged = mergeExtents(exts);
      cells.forEach((c, i) => {
        const col = i % cols, row = Math.floor(i / cols);
        const rect = { x: area.x + col * (cw + gap), y: area.y + row * (ch + gap), w: cw, h: ch };
        const ext = shareX && shareY ? merged : shareX ? { ...exts[i]!, x: merged.x, xCats: merged.xCats } : shareY ? { ...exts[i]!, y: merged.y, y2: merged.y2, yCats: merged.yCats, zero: merged.zero } : undefined;
        c.panel.layout(ctx, rect, { view: this.view, xLabels: !shareX || row === rows - 1 || i + cols >= cells.length, yLabels: !shareY || col === 0, ext });
      });
    }
    for (const c of cells) drawPanel(c.panel, ctx, dpr);
    this.drawLegend(ctx);
  }

  /** Legend entries and colour bar, placed top or bottom; returns the rectangle left for the panels. */
  private layoutLegend(ctx: CanvasRenderingContext2D): Rect {
    const th = this.theme, lg = this.spec.legend;
    this.legend = [];
    this.bar = undefined;
    const full: Rect = { x: 0, y: 0, w: this.w, h: this.h };
    if (lg === false) return full;
    const entries: { name: string; color: string; shape: LegendEntry["shape"] }[] = [];
    for (const c of this.cells) {
      for (const m of c.prepared.marks) {
        if (m.name === undefined || m.mark.legend === false || entries.some((e) => e.name === m.name)) continue;
        if (m.type === "rule" || m.type === "band" || m.type === "text" || m.type === "treemap" || m.type === "heatmap") continue;
        entries.push({ name: m.name, color: m.type === "bar" && m.sign ? m.sign.positive : m.color, shape: m.type === "line" ? "line" : m.type === "scatter" ? "dot" : "box" });
      }
    }
    let scale: ColorScale | undefined;
    for (const c of this.cells) for (const s of c.panel.colors.values()) scale ??= s;
    const show = lg?.show ?? (entries.length >= 2);
    if (!show) entries.length = 0;
    if (entries.length === 0 && !scale) return full;
    const bottom = lg?.position === "bottom";
    const font = `${th.fontSize}px ${th.fontFamily}`;
    ctx.font = font;
    const rowH = 18;
    const barW = scale ? 140 : 0;
    const maxX = this.w - 8 - (scale ? barW + 12 : 0);
    let x = 8, row = 0;
    for (const e of entries) {
      const w = 16 + ctx.measureText(e.name).width + 14;
      if (x + w > maxX && x > 8) {
        x = 8;
        row++;
      }
      this.legend.push({ ...e, hidden: this.isHidden(e.name), rect: { x, y: 4 + row * rowH, w: w - 4, h: rowH } });
      x += w;
    }
    const rows = entries.length ? row + 1 : 1;
    const hgt = rows * rowH + 8;
    const top = bottom ? this.h - hgt : 0;
    for (const e of this.legend) e.rect.y += top;
    if (scale) this.bar = { scale, rect: { x: this.w - barW - 8, y: top + 6, w: barW, h: 8 } };
    return bottom ? { x: 0, y: 0, w: this.w, h: this.h - hgt } : { x: 0, y: hgt, w: this.w, h: this.h - hgt };
  }

  private drawLegend(ctx: CanvasRenderingContext2D): void {
    const th = this.theme;
    ctx.save();
    ctx.font = `${th.fontSize}px ${th.fontFamily}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    for (const e of this.legend) {
      const cy = e.rect.y + e.rect.h / 2;
      ctx.globalAlpha = e.hidden ? 0.35 : 1;
      ctx.fillStyle = ctx.strokeStyle = e.color;
      if (e.shape === "line") {
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(e.rect.x, cy);
        ctx.lineTo(e.rect.x + 12, cy);
        ctx.stroke();
      } else if (e.shape === "dot") {
        ctx.beginPath();
        ctx.arc(e.rect.x + 6, cy, 4, 0, Math.PI * 2);
        ctx.fill();
      } else ctx.fillRect(e.rect.x, cy - 5, 12, 10);
      ctx.fillStyle = e.hidden ? th.textMuted : th.text;
      ctx.fillText(e.name, e.rect.x + 16, cy);
      if (e.hidden) {
        const tw = ctx.measureText(e.name).width;
        ctx.strokeStyle = th.textMuted;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(e.rect.x + 16, cy);
        ctx.lineTo(e.rect.x + 16 + tw, cy);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    if (this.bar) {
      const { scale, rect } = this.bar;
      const g = ctx.createLinearGradient(rect.x, 0, rect.x + rect.w, 0);
      for (let i = 0; i <= 8; i++) g.addColorStop(i / 8, scale.map(scale.valueAt(i / 8)));
      ctx.fillStyle = g;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.fillStyle = th.textMuted;
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      ctx.fillText(this.fmt.value(scale.domain[0]), rect.x, rect.y + rect.h + 2);
      ctx.textAlign = "right";
      ctx.fillText(this.fmt.value(scale.domain[1]), rect.x + rect.w, rect.y + rect.h + 2);
    }
    ctx.restore();
  }

  private renderOverlay(): void {
    if (this.disposed || !(this.w > 0 && this.h > 0)) return;
    const ctx = this.sizeCanvas(this.over);
    ctx.clearRect(0, 0, this.w, this.h);
    const th = this.theme;
    const a = this.active;
    const ci = this.spec.interactions?.crosshair !== false;
    if (a) {
      const area = a.cell.panel.area;
      const { hit } = a;
      ctx.save();
      ctx.beginPath();
      ctx.rect(area.x, area.y, area.w, area.h);
      ctx.clip();
      if (hit.rect) {
        ctx.fillStyle = withAlpha(th.text, 0.08);
        ctx.fillRect(hit.rect.x, hit.rect.y, hit.rect.w, hit.rect.h);
        ctx.strokeStyle = th.text;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(hit.rect.x + 0.75, hit.rect.y + 0.75, hit.rect.w - 1.5, hit.rect.h - 1.5);
      }
      if (ci) {
        ctx.strokeStyle = th.crosshair;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        if (hit.snapX !== undefined) {
          const x = Math.round(hit.snapX * this.dpr) / this.dpr + 0.5 / this.dpr;
          ctx.moveTo(x, area.y);
          ctx.lineTo(x, area.y + area.h);
        }
        if (hit.snapY !== undefined) {
          const y = Math.round(hit.snapY * this.dpr) / this.dpr + 0.5 / this.dpr;
          ctx.moveTo(area.x, y);
          ctx.lineTo(area.x + area.w, y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
      for (const d of hit.dots) {
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(d.color, 0.25);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(d.x, d.y, Math.min(d.r, 4), 0, Math.PI * 2);
        ctx.fillStyle = d.color;
        ctx.fill();
        ctx.strokeStyle = th.background;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.restore();
    }
    if (this.brushing) {
      const area = this.brushing.cell.panel.area;
      const x0 = Math.min(this.brushing.x0, this.brushing.x1), x1 = Math.max(this.brushing.x0, this.brushing.x1);
      ctx.fillStyle = withAlpha(th.accent, 0.15);
      ctx.fillRect(x0, area.y, x1 - x0, area.h);
      ctx.strokeStyle = th.accent;
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, area.y + 0.5, x1 - x0, area.h - 1);
    }
    if (this.focusRing) {
      ctx.strokeStyle = th.accent;
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, this.w - 2, this.h - 2);
    }
  }

  // ---- hover ------------------------------------------------------------------------

  private modeOf(cell: Cell): HitMode {
    const t = this.spec.tooltip;
    if (t === false) return "none";
    return t?.mode ?? defaultMode(cell.panel);
  }

  private cellAt(x: number, y: number): Cell | undefined {
    return this.cells.find((c) => x >= c.panel.rect.x && x <= c.panel.rect.x + c.panel.rect.w && y >= c.panel.rect.y && y <= c.panel.rect.y + c.panel.rect.h);
  }

  private local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.root.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private setActive(a: { cell: Cell; hit: Hit } | null, fromOutside: boolean): void {
    this.active = a;
    this.showTip();
    this.scheduleOverlay();
    if (!fromOutside) {
      const key = a?.hit.key ?? null;
      const id = key ? (key.cat !== undefined ? `c:${key.cat}` : `n:${key.num}`) : "";
      if (id !== this.lastKey) {
        this.lastKey = id;
        this.emit("crosshair", { key });
      }
    }
  }

  private showTip(): void {
    const a = this.active;
    const tip = this.tip;
    const off = this.spec.tooltip === false;
    if (!a || off || a.hit.rows.length === 0) {
      tip.style.display = "none";
      this.emit("hover", null);
      return;
    }
    let content: TooltipContent = withIndex({ title: a.hit.title, rows: a.hit.rows });
    const fmt = typeof this.spec.tooltip === "object" ? this.spec.tooltip.format : undefined;
    if (fmt) content = fmt(content);
    tip.textContent = "";
    if (content.title) {
      const t = document.createElement("div");
      t.style.cssText = "font-weight:600;margin-bottom:3px;";
      t.textContent = content.title;
      tip.appendChild(t);
    }
    for (const r of content.rows) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:6px;";
      const sw = document.createElement("span");
      sw.style.cssText = "display:inline-block;width:8px;height:8px;border-radius:2px;flex:none;";
      // Through the CSSOM, and only a colour the library can read: a spec string never becomes CSS text.
      sw.style.backgroundColor = cssColor(parseColor(r.color));
      const nm = document.createElement("span");
      nm.style.cssText = `color:${this.theme.textMuted};`;
      nm.textContent = r.name;
      const val = document.createElement("span");
      val.style.cssText = "margin-left:auto;padding-left:12px;font-variant-numeric:tabular-nums;";
      val.textContent = r.value;
      row.append(sw, nm, val);
      tip.appendChild(row);
    }
    tip.style.display = "block";
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = a.hit.x + 14, y = a.hit.y + 14;
    if (x + tw > this.w - 4) x = a.hit.x - tw - 14;
    if (y + th > this.h - 4) y = this.h - th - 4;
    tip.style.transform = `translate(${Math.max(4, Math.round(x))}px,${Math.max(4, Math.round(y))}px)`;
    this.emit("hover", content);
  }

  /** Input arriving before the pending frame would read panels that are not laid out yet: draw first. */
  private settle(): void {
    if (this.raf) this.guard(() => this.flush());
  }

  private onMove(e: PointerEvent): void {
    this.settle();
    const { x, y } = this.local(e);
    this.pointerInside = true;
    this.lastPointer = { x, y };
    if (this.brushing) {
      const a = this.brushing.cell.panel.area;
      this.brushing.x1 = Math.min(a.x + a.w, Math.max(a.x, x));
      if (this.down && Math.abs(x - this.down.x) > 3) this.down.moved = true;
      this.scheduleOverlay();
      return;
    }
    if (this.panning) {
      const p = this.panning.cell.panel;
      if (this.down && Math.abs(x - this.down.x) > 3) this.down.moved = true;
      if (!isBand(p.sx)) {
        const per = (this.panning.domain[1] - this.panning.domain[0]) / p.area.w;
        const d = (this.panning.x - x) * per;
        this.setView(this.clampView([this.panning.domain[0] + d, this.panning.domain[1] + d], p));
      }
      return;
    }
    const cell = this.cellAt(x, y);
    if (!cell) {
      this.setActive(null, false);
      return;
    }
    const snap = typeof this.spec.tooltip === "object" ? this.spec.tooltip.snap !== false : true;
    const hit = hitAt(cell.panel, x, y, this.modeOf(cell), snap);
    this.stopIndex = -1;
    this.setActive(hit ? { cell, hit } : null, false);
  }

  // ---- brush, pan, zoom -----------------------------------------------------------------

  private continuousX(cell: Cell): boolean {
    return !cell.prepared.noAxes && !isBand(cell.panel.sx);
  }

  private fullX(cell: Cell): [number, number] | null {
    const e = cell.panel.computeExtents(null);
    cell.panel.computeExtents(this.view);
    return e.x ? [e.x[0], e.x[1]] : null;
  }

  private clampView(v: [number, number], p: Panel): [number, number] | null {
    const cell = this.cells.find((c) => c.panel === p);
    const full = cell ? this.fullX(cell) : null;
    if (!full) return v;
    const span = v[1] - v[0];
    if (span >= full[1] - full[0]) return null;
    let lo = v[0];
    if (lo < full[0]) lo = full[0];
    if (lo + span > full[1]) lo = full[1] - span;
    return [lo, lo + span];
  }

  private onDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.settle();
    const { x, y } = this.local(e);
    this.down = { x, y, moved: false };
    const cell = this.cellAt(x, y);
    const it = this.spec.interactions;
    if (!cell || !cell.panel.contains(x, y) || !this.continuousX(cell)) return;
    if (it?.brush) {
      this.brushing = { cell, x0: x, x1: x };
      this.root.setPointerCapture(e.pointerId);
    } else if (it?.zoom && this.view) {
      this.panning = { cell, x, domain: [this.view[0], this.view[1]] };
      this.root.setPointerCapture(e.pointerId);
    }
  }

  private onUp(e: PointerEvent): void {
    const { x, y } = this.local(e);
    const down = this.down;
    this.down = null;
    if (this.root.hasPointerCapture?.(e.pointerId)) this.root.releasePointerCapture(e.pointerId);
    if (this.brushing) {
      const b = this.brushing;
      this.brushing = null;
      if (Math.abs(b.x1 - b.x0) >= 4 && !isBand(b.cell.panel.sx)) {
        const s = b.cell.panel.sx;
        const lo = s.invert(Math.min(b.x0, b.x1)), hi = s.invert(Math.max(b.x0, b.x1));
        this.emit("brush", { x0: lo, x1: hi });
        this.setView([lo, hi]);
        this.setActive(null, false);
      }
      this.scheduleOverlay();
      return;
    }
    if (this.panning) {
      this.panning = null;
      return;
    }
    if (down && !down.moved) {
      const entry = this.legend.find((l) => x >= l.rect.x && x <= l.rect.x + l.rect.w && y >= l.rect.y && y <= l.rect.y + l.rect.h);
      if (entry) this.toggleSeries(entry.name);
    }
  }

  private onWheel(e: WheelEvent): void {
    if (!this.spec.interactions?.zoom) return;
    this.settle();
    const { x, y } = this.local(e);
    const cell = this.cellAt(x, y);
    if (!cell || !this.continuousX(cell) || !cell.panel.contains(x, y)) return;
    e.preventDefault();
    const p = cell.panel;
    const s = p.sx;
    if (isBand(s)) return;
    const [lo, hi] = this.view ?? s.domain;
    const anchor = s.invert(x);
    const f = Math.exp(Math.max(-200, Math.min(200, e.deltaY)) * 0.0015);
    this.setView(this.clampView([anchor - (anchor - lo) * f, anchor + (hi - anchor) * f], p));
  }

  // ---- keyboard -------------------------------------------------------------------------------

  private stopsOfCell(cell: Cell): Stop[] {
    if (!cell.stops) cell.stops = stopsOf(cell.panel, this.modeOf(cell), true);
    return cell.stops;
  }

  private goto(cell: Cell, i: number): void {
    const stops = this.stopsOfCell(cell);
    if (stops.length === 0) return;
    this.stopIndex = Math.max(0, Math.min(stops.length - 1, i));
    const hit = stops[this.stopIndex]!.hit();
    this.setActive(hit ? { cell, hit } : null, false);
    if (hit) this.live.textContent = `${hit.title}: ${hit.rows.map((r) => `${r.name} ${r.value}`).join(", ")}`;
  }

  private onKey(e: KeyboardEvent): void {
    if (this.spec.interactions?.keyboard === false || e.altKey || e.ctrlKey || e.metaKey) return;
    this.settle();
    const cell = this.cells[Math.min(this.kbCell, this.cells.length - 1)];
    if (!cell) return;
    const k = e.key;
    const stops = this.stopsOfCell(cell);
    let handled = true;
    // Where the arrows start from: the stop nearest the current hit.
    if (this.stopIndex < 0 && this.active && stops.length) {
      const a = this.active.hit;
      let best = 0, bd = Infinity;
      stops.forEach((s, i) => {
        const d = Math.hypot(s.x - (a.snapX ?? a.x), s.y - (a.snapY ?? a.y));
        if (d < bd) [best, bd] = [i, d];
      });
      this.stopIndex = best;
    }
    const columns = cell.prepared.marks.find((m) => m.type === "heatmap");
    const rowLen = columns && columns.type === "heatmap" ? new Set(columns.xc).size : 1;
    switch (k) {
      case "ArrowRight": this.goto(cell, this.stopIndex < 0 ? 0 : this.stopIndex + 1); break;
      case "ArrowLeft": this.goto(cell, this.stopIndex < 0 ? stops.length - 1 : this.stopIndex - 1); break;
      case "ArrowDown": this.goto(cell, this.stopIndex < 0 ? 0 : this.stopIndex + rowLen); break;
      case "ArrowUp": this.goto(cell, this.stopIndex < 0 ? stops.length - 1 : this.stopIndex - rowLen); break;
      case "Home": this.goto(cell, 0); break;
      case "End": this.goto(cell, stops.length - 1); break;
      case "PageDown": this.kbCell = Math.min(this.cells.length - 1, this.kbCell + 1); this.stopIndex = -1; break;
      case "PageUp": this.kbCell = Math.max(0, this.kbCell - 1); this.stopIndex = -1; break;
      case "Escape":
        this.stopIndex = -1;
        this.setActive(null, false);
        break;
      case "+": case "=": case "-": case "_": {
        if (!this.spec.interactions?.zoom || !this.continuousX(cell) || isBand(cell.panel.sx)) {
          handled = false;
          break;
        }
        const [lo, hi] = this.view ?? cell.panel.sx.domain;
        const mid = (lo + hi) / 2, half = ((hi - lo) / 2) * (k === "+" || k === "=" ? 0.7 : 1 / 0.7);
        this.setView(this.clampView([mid - half, mid + half], cell.panel));
        break;
      }
      default:
        if (/^[1-9]$/.test(k) && this.legend[Number(k) - 1]) this.toggleSeries(this.legend[Number(k) - 1]!.name);
        else handled = false;
    }
    if (handled) e.preventDefault();
  }
}

/** The content with the index of its first datum row, for hosts that look the datum up. */
function withIndex(c: TooltipContent): TooltipContent {
  const i = c.rows.find((r) => r.index !== undefined)?.index;
  return i === undefined ? c : { ...c, index: i };
}

/** Create a plot in `el`. The element needs a size (CSS), or the spec gives width and height. */
export function createPlot(el: HTMLElement, spec: PlotSpec): Plot {
  return new Plot(el, spec);
}

