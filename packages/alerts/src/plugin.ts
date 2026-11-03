// AlertsPlugin: the chart side of alerts.
//
// Ticks come from the integrator (`tick()`), as they do for a backend; all
// semantics live in AlertEvaluator, so the chart and a server re-evaluating
// the saved definitions cannot disagree. The plugin adds what only a chart
// has: drawing-based alerts that follow their drawing, lines at the alert
// prices, markers where alerts fired, and layout persistence.

import type { ChartPlugin, PluginApi, PluginPaneView } from "@alphacharts/core";
import type { BarSource, Drawing } from "@alphacharts/drawings";
import type { EvalEnv } from "./conditions.js";
import { AlertEvaluator, type AlertRuntime } from "./evaluator.js";
import { linePrice } from "./lines.js";
import { ALERTS_VERSION, type AlertDefinition, type AlertStatus, type AlertTrigger, type CrossOp, type DrawingGeometry, type Tick, type TriggerOptions } from "./types.js";

export interface AlertsOptions {
  id?: string;
  /** The drawings plugin (or anything with `get`) that drawing-based alerts watch. */
  drawings?: { get(id: string): Drawing | undefined };
  /** Gives drawing lines their on-chart (bar-index) geometry; without it lines are straight in time. */
  source?: BarSource;
  indicators?: EvalEnv["indicators"];
  /** Called for every trigger, before the "trigger" event. */
  onTrigger?: (t: AlertTrigger) => void;
  /** Alert state problems (a watched drawing was deleted). Default: console.error. */
  onError?: (e: Error) => void;
  /** Fired-alert markers kept on the chart. */
  maxMarkers?: number;
}

export interface AlertsEvents {
  trigger: AlertTrigger;
  status: { id: string; status: AlertStatus };
}

export interface SavedAlerts {
  version: typeof ALERTS_VERSION;
  alerts: Array<{ definition: AlertDefinition; status: AlertStatus; runtime?: AlertRuntime }>;
}

type Listener<K extends keyof AlertsEvents> = (e: AlertsEvents[K]) => void;

export class AlertsPlugin implements ChartPlugin {
  readonly id: string;
  private api: PluginApi | null = null;
  private readonly ev: AlertEvaluator;
  private readonly listeners: { [K in keyof AlertsEvents]: Set<Listener<K>> } = { trigger: new Set(), status: new Set() };
  private markers: AlertTrigger[] = [];
  private readonly lastStatus = new Map<string, AlertStatus>();
  private readonly reported = new Set<string>();
  /** Alerts stopped because their drawing's geometry was unusable on the current scale; retried on every sync. */
  private readonly geomFailed = new Set<string>();

  constructor(private readonly options: AlertsOptions = {}) {
    this.id = options.id ?? "alerts";
    const src = options.source;
    this.ev = new AlertEvaluator([], { ...(options.indicators ? { indicators: options.indicators } : {}), ...(src ? { logical: (t: number) => src.logical(t) } : {}) });
  }

  on<K extends keyof AlertsEvents>(type: K, fn: Listener<K>): () => void {
    this.listeners[type].add(fn);
    return () => this.listeners[type].delete(fn);
  }

  private emit<K extends keyof AlertsEvents>(type: K, e: AlertsEvents[K]): void {
    for (const fn of [...this.listeners[type]]) fn(e);
  }

  install(api: PluginApi): void {
    // Without the scale mode a log-scale line would silently be watched in price: refuse rather than guess.
    if (!api.paneView(0).priceScaleMode) throw new Error("alerts: this chart's plugin view does not report the price scale mode (PluginPaneView.priceScaleMode); update @alphacharts/core");
    this.api = api;
  }

  uninstall(): void {
    this.api = null;
  }

  // ---- alerts ---------------------------------------------------------------------

  add(def: AlertDefinition): void {
    this.ev.add(def);
    this.lastStatus.set(def.id, "active");
    this.api?.requestRender();
  }

  remove(id: string): void {
    this.ev.remove(id);
    this.lastStatus.delete(id);
    this.api?.requestRender();
  }

  list(): Array<{ definition: AlertDefinition; status: AlertStatus }> {
    return this.ev.definitions().map((definition) => ({ definition, status: this.ev.status(definition.id) }));
  }

  status(id: string): AlertStatus {
    return this.ev.status(id);
  }

  /**
   * Alert when price crosses (or enters/exits) a drawing's line. The alert
   * keeps the drawing's geometry and follows it when it is moved.
   */
  addDrawingAlert(o: { id: string; drawingId: string; line: string; op: CrossOp | "enteringChannel" | "exitingChannel"; trigger: TriggerOptions; label?: string; expiresAt?: number | null }): AlertDefinition {
    const g = this.geometryOf(o.drawingId);
    const def: AlertDefinition = {
      id: o.id, condition: { type: "drawing", drawing: g, line: o.line, op: o.op }, trigger: o.trigger,
      ...(o.label !== undefined ? { label: o.label } : {}), ...(o.expiresAt !== undefined ? { expiresAt: o.expiresAt } : {}),
    };
    this.add(def);
    return def;
  }

  private geometryOf(drawingId: string): DrawingGeometry {
    const d = this.options.drawings?.get(drawingId);
    if (d && d.pane !== 0) throw new Error(`alerts: drawing "${drawingId}" is on pane ${d.pane}; only the main price pane (0) can carry price alerts`);
    if (!d) throw new Error(`alerts: no drawing "${drawingId}"${this.options.drawings ? "" : " (pass `drawings` to AlertsPlugin)"}`);
    // The drawing is straight in pixels: on a log scale that is not straight in price. Percent and indexed scales are affine in price. Without
    // an installed chart there is no scale to ask, and the geometry is the plain price one.
    const log = this.api?.paneView(0).priceScaleMode?.() === "log";
    return { id: d.id, tool: d.tool, anchors: d.anchors.map((a) => ({ time: a.time, price: a.price })), extendLeft: d.style.extendLeft, extendRight: d.style.extendRight, ...(log ? { scale: "log" as const } : {}) };
  }

  /** Re-read the geometry of watched drawings; an alert whose drawing is gone becomes orphaned. */
  private syncDrawings(): void {
    for (const def of this.ev.definitions()) {
      const c = def.condition;
      if (c.type !== "drawing" || this.ev.status(def.id) === "orphaned") continue;
      let g: DrawingGeometry;
      try {
        g = this.geometryOf(c.drawing.id);
      } catch (e) {
        this.ev.setStatus(def.id, "orphaned");
        this.report(`orphan:${def.id}`, new Error(`alerts: alert "${def.id}" watches drawing "${c.drawing.id}", which no longer exists`));
        continue;
      }
      if (JSON.stringify(g) === JSON.stringify(c.drawing) && !this.geomFailed.has(def.id)) continue;
      try {
        this.ev.update({ ...def, condition: { ...c, drawing: g } });
        if (this.geomFailed.delete(def.id)) {
          this.ev.setStatus(def.id, "active");
          this.reported.delete(`geom:${def.id}`);
        }
      } catch (e) {
        // E.g. the scale was switched to log under an anchor at price <= 0: the line has no price to watch.
        this.ev.setStatus(def.id, "error");
        this.geomFailed.add(def.id);
        this.report(`geom:${def.id}`, new Error(`alerts: alert "${def.id}" stopped: ${(e as Error).message}`));
      }
    }
  }

  private report(key: string, e: Error): void {
    if (this.reported.has(key)) return;
    this.reported.add(key);
    (this.options.onError ?? ((x) => console.error(x)))(e);
  }

  /** Feed one tick. Returns the triggers it caused (also delivered to onTrigger and "trigger" listeners). */
  tick(t: Tick): AlertTrigger[] {
    const src = this.options.source;
    if (src && src.length > 0) {
      // Line positions come from the bar sequence: a bar the source does not hold would be extrapolated, and a backend could not reproduce that.
      const [lo, hi] = src.range(t.bar, t.bar);
      if (hi <= lo) throw new RangeError(`alerts: tick bar ${t.bar} is not a bar of the source; append the bar to the source before ticking it`);
    }
    this.syncDrawings();
    const out = this.ev.tick(t);
    for (const { definition } of this.list()) {
      const e = this.ev.error(definition.id);
      if (e) this.report(`err:${definition.id}`, new Error(`alerts: alert "${definition.id}" stopped: ${e}`));
    }
    return this.deliver(out);
  }

  /** A new tick series begins (another symbol or interval): see `AlertEvaluator.resetClock`. The fired-alert markers belonged to the old bars and go. */
  resetClock(o: { keepTriggerBars?: boolean } = {}): void {
    this.ev.resetClock(o);
    this.markers = [];
    this.api?.requestRender();
  }

  closeBar(time: number): AlertTrigger[] {
    return this.deliver(this.ev.closeBar(time));
  }

  private deliver(ts: AlertTrigger[]): AlertTrigger[] {
    for (const t of ts) {
      this.markers.push(t);
      this.options.onTrigger?.(t);
      this.emit("trigger", t);
    }
    const max = this.options.maxMarkers ?? 50;
    if (this.markers.length > max) this.markers = this.markers.slice(-max);
    for (const { definition } of this.list()) {
      const s = this.ev.status(definition.id);
      if (this.lastStatus.get(definition.id) !== s) {
        this.lastStatus.set(definition.id, s);
        this.emit("status", { id: definition.id, status: s });
      }
    }
    if (ts.length) this.api?.requestRender();
    return ts;
  }

  // ---- persistence ---------------------------------------------------------------------

  toJSON(): SavedAlerts {
    const rt = new Map(this.ev.runtime().map((r) => [r.id, r]));
    return { version: ALERTS_VERSION, alerts: this.list().map((a) => ({ ...a, runtime: rt.get(a.definition.id)! })) };
  }

  /** Throws what `fromJSON(state)` would, changing nothing (the core's `restoreState` calls it before it replaces anything). */
  validateState(state: unknown): void {
    this.parseState(state);
  }

  private parseState(state: unknown): NonNullable<Partial<SavedAlerts>["alerts"]> {
    if (typeof state !== "object" || state === null) throw new TypeError("alerts: saved state must be an object");
    const s = state as Partial<SavedAlerts>;
    if (typeof s.version !== "number" || !Number.isInteger(s.version) || s.version < 1) throw new TypeError(`alerts: invalid saved version ${String(s.version)}`);
    if (s.version > ALERTS_VERSION) throw new RangeError(`alerts: saved version ${s.version} is newer than this library understands (${ALERTS_VERSION})`);
    if (!Array.isArray(s.alerts)) throw new TypeError("alerts: saved state has no alerts array");
    // Build into a scratch evaluator first: nothing is replaced if any alert is invalid.
    const scratch = new AlertEvaluator([], this.envForCheck());
    for (const a of s.alerts) {
      if (!["active", "triggered", "expired", "orphaned", "error"].includes(a.status)) throw new RangeError(`alerts: invalid saved status ${String(a.status)}`);
      scratch.add(a.definition, a.status);
    }
    return s.alerts;
  }

  fromJSON(state: unknown): void {
    const saved = this.parseState(state);
    for (const { definition } of this.list()) this.remove(definition.id);
    for (const a of saved) {
      this.ev.add(a.definition, a.status, a.runtime);
      this.lastStatus.set(a.definition.id, a.status);
    }
    this.markers = [];
    this.api?.requestRender();
  }

  private envForCheck(): EvalEnv {
    return this.options.indicators ? { indicators: this.options.indicators } : {};
  }

  // ---- drawing -------------------------------------------------------------------------

  drawPane(ctx: CanvasRenderingContext2D, view: PluginPaneView): void {
    if (view.pane !== 0) return;
    ctx.save();
    ctx.font = "11px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
    ctx.textBaseline = "bottom";
    ctx.textAlign = "left";
    const level = (price: number, label: string, color: string) => {
      const y = Math.round(view.priceToY(price)) + 0.5;
      if (y < 0 || y > view.height) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(view.width, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.fillText(label, 6, y - 2);
    };
    for (const { definition: d, status } of this.list()) {
      if (status !== "active") continue;
      const c = d.condition;
      const color = "#f7a600";
      const name = d.label ?? d.id;
      if (c.type === "crossing" || c.type === "greaterThan" || c.type === "lessThan") level(c.price, `alert ${name} ${view.formatPrice(c.price)}`, color);
      else if (c.type === "enteringChannel" || c.type === "exitingChannel") {
        level(c.low, `alert ${name} low ${view.formatPrice(c.low)}`, color);
        level(c.high, `alert ${name} high ${view.formatPrice(c.high)}`, color);
      } else if (c.type === "drawing") {
        const t = view.xToTime(view.width - 24);
        const lg = this.options.source ? (x: number) => this.options.source!.logical(x) : undefined;
        const p = linePrice(c.drawing, c.line, t, lg);
        if (p !== undefined) {
          const y = view.priceToY(p);
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.moveTo(view.width - 24, y - 5);
          ctx.lineTo(view.width - 19, y);
          ctx.lineTo(view.width - 24, y + 5);
          ctx.lineTo(view.width - 29, y);
          ctx.closePath();
          ctx.fill();
        }
      }
    }
    for (const m of this.markers) {
      const x = view.timeToX(m.bar), y = view.priceToY(m.price);
      ctx.fillStyle = "#f7a600";
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 5, y + 10);
      ctx.lineTo(x + 5, y + 10);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** An indicator function over a series: the value of the bar the tick belongs to. */
export function seriesIndicator(series: { barAt(time: number): { value: number } | undefined }): (t: Tick) => number | undefined {
  return (t) => series.barAt(t.bar)?.value;
}
