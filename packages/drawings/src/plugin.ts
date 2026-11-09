// DrawingsPlugin: one chart plugin that owns every drawing on a chart.
//
// - State is a DrawingStore (ordered back to front) plus a command History;
//   every change, API or pointer, goes through a Command with an exact inverse.
// - Tools are plain ToolDefs passed in by the integrator, so unused tools stay
//   out of the bundle.
// - Drawing, hit-testing, box selection and edit handles are generic over the
//   pixel Shapes a tool returns.
// - Interaction: a tool is "armed" with setTool(); otherwise a press on a
//   drawing selects/moves it, a press on a handle edits it, and a press on
//   empty space is left to the chart (pan) unless Shift starts a box select.
//   While the plugin consumes a press the chart does not pan.
// - A tool that throws (bad props, missing bars) is reported through
//   onError once per distinct message and skipped; the rest keep drawing.

import type { ChartPlugin, LayoutStore, PluginApi, PluginPaneView, PluginPointer } from "@alphacharts/core";
import { resolveColor } from "@alphacharts/core";
import { Emitter } from "./emitter.js";
import { dist } from "./geometry.js";
import { AddCommand, BatchCommand, clone, DrawingStore, History, PatchCommand, RemoveCommand, ReorderCommand, type Command } from "./history.js";
import { declutter, drawShapes, shapeDistance, shapeInRect } from "./shapes.js";
import type { BarSource } from "./source.js";
import { TemplateStore } from "./templates.js";
import { DEFAULT_STYLE, SCHEMA_VERSION, type Anchor, type Drawing, type DrawingStyle, type DrawingsState, type Shape, type ToolCtx, type ToolDef } from "./types.js";

export type MagnetMode = "off" | "weak" | "strong";

export interface DrawingsOptions {
  tools: readonly ToolDef[];
  /** Plugin id (key in layout JSON). Default "drawings". */
  id?: string;
  /** Bars of the main series: needed by bar-reading tools, bar counts and the magnet. */
  source?: BarSource;
  /** Current chart interval in ms (for per-interval visibility); default: the source's. */
  interval?: number;
  magnet?: MagnetMode;
  /**
   * More prices the magnet may snap to at a bar, beside its open, high, low and close: the values of an indicator drawn on
   * the price pane, for example. Asked with the time of the nearest bar; return nothing for none. Only read while the
   * magnet is weak or strong.
   */
  snapValues?: (barTime: number) => readonly number[];
  /**
   * Orders this plugin's undo history against another history the host keeps (indicators added and removed): a function
   * that returns a larger number each time it is called. `nextUndoAt` and `nextRedoAt` then say which history to take from.
   */
  clock?: () => number;
  /** Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z or Y call these instead of the plugin's own `undo` and `redo` (the host's history spans more than drawings). */
  onUndo?: () => boolean;
  onRedo?: () => boolean;
  /** Stay in the tool after a drawing is finished. */
  continuous?: boolean;
  /**
   * Display only, for drawings the host places by code: the plugin never takes a pointer press, key or cursor, so
   * nothing it draws can be hit, selected, moved or deleted, and the chart (pan, zoom, its own handles above it)
   * gets every event as if no drawing were there. `setTool` throws. `add`, `update`, `remove` and `fromJSON` still work.
   */
  readOnly?: boolean;
  /** Templates and favourites storage. */
  store?: LayoutStore;
  /** A tool failed to draw or a gesture produced an invalid drawing. Default: console.error. */
  onError?: (error: Error, drawing: Drawing | null) => void;
}

export interface DrawingsEvents {
  created: Drawing;
  changed: Drawing;
  removed: Drawing;
  selected: string[];
  tool: string | null;
  history: { canUndo: boolean; canRedo: boolean };
}

export interface NewDrawing {
  tool: string;
  anchors?: Anchor[];
  pane?: number;
  id?: string;
  style?: Partial<DrawingStyle>;
  props?: Record<string, unknown>;
  locked?: boolean;
  hidden?: boolean;
  intervals?: number[] | null;
}

export type DrawingPatch = Partial<Pick<Drawing, "anchors" | "locked" | "hidden" | "intervals">> & {
  style?: Partial<DrawingStyle>;
  props?: Record<string, unknown>;
};

/** Pixels the pointer must travel before a press-release counts as a drag. */
export const DRAG_SLOP = 4;
/** Hit tolerance in CSS px by pointer type. */
export const TOLERANCE: Record<string, number> = { mouse: 5, pen: 8, touch: 14 };
/** Weak magnet radius in CSS px. */
export const WEAK_MAGNET_PX = 16;
/** Duplicate offsets a copy by this many bars in time (never in price). */
export const DUPLICATE_BARS = 5;

type Drag =
  | { kind: "move"; pane: number; start: { x: number; y: number }; before: Drawing[]; startAnchors: Map<string, Anchor[]>; startScreen: Map<string, { fx: number; fy: number }>; moved: boolean; clickOnly: { id: string; shift: boolean } | null }
  | { kind: "handle"; pane: number; id: string; index: number; before: Drawing; moved: boolean }
  | { kind: "box"; pane: number; x0: number; y0: number; x1: number; y1: number };

interface Creating {
  def: ToolDef;
  pane: number;
  anchors: Anchor[];
  /** Pointer position (snapped) for the rubber-band anchor. */
  pointer: Anchor | null;
  /** The press that began the drawing has not been released yet. */
  fresh: boolean;
  downPx: { x: number; y: number };
  lastPx: { x: number; y: number };
  screenPos: { fx: number; fy: number } | null;
}

export class DrawingsPlugin implements ChartPlugin {
  readonly id: string;
  readonly events = new Emitter<DrawingsEvents>();
  private loading = false;
  /**
   * True while `fromJSON` emits its `removed` / `created` events: they describe
   * a layout being loaded, not something the user drew or deleted, so a listener
   * that mirrors drawings elsewhere (a sync between charts) must not act on them.
   */
  get restoring(): boolean {
    return this.loading;
  }
  readonly templates: TemplateStore | null;

  private api: PluginApi | null = null;
  private readonly tools = new Map<string, ToolDef>();
  private readonly store = new DrawingStore();
  private readonly history: History;
  private readonly selected = new Set<string>();
  private hover: string | null = null;
  private tool: string | null = null;
  private creating: Creating | null = null;
  private drag: Drag | null = null;
  private clipboard: Drawing[] = [];
  private nextId = 1;
  private last: { pane: number; x: number; y: number; time: number; price: number; pointerType: string } | null = null;
  private source: BarSource | null;
  private intervalMs: number | null;
  private magnetMode: MagnetMode;
  private readonly continuous: boolean;
  private readonly onError: (e: Error, d: Drawing | null) => void;
  private readonly reported = new Set<string>();
  private measureCanvas: CanvasRenderingContext2D | null | undefined;

  constructor(private readonly options: DrawingsOptions) {
    this.history = new History(this.store, 500, options.clock);
    this.id = options.id ?? "drawings";
    for (const t of options.tools) {
      if (this.tools.has(t.id)) throw new Error(`drawings: tool "${t.id}" registered twice`);
      this.tools.set(t.id, t);
    }
    this.source = options.source ?? null;
    this.intervalMs = options.interval ?? null;
    this.magnetMode = options.magnet ?? "off";
    this.continuous = options.continuous ?? false;
    this.templates = options.store ? new TemplateStore(options.store) : null;
    this.onError = options.onError ?? ((e, d) => console.error(`alphacharts drawings${d ? ` (${d.tool} ${d.id})` : ""}:`, e));
  }

  // ---- plugin lifecycle ---------------------------------------------------------

  install(api: PluginApi): void {
    this.api = api;
  }

  uninstall(): void {
    this.api = null;
    this.creating = null;
    this.drag = null;
  }

  dataChanged(): void {
    this.api?.requestRender();
  }

  viewChanged(): void {
    // The overlay redraws with the view; nothing is cached in pixels.
  }

  // ---- configuration ------------------------------------------------------------

  toolDef(id: string): ToolDef {
    const t = this.tools.get(id);
    if (!t) throw new Error(`drawings: unknown tool "${id}" (registered: ${[...this.tools.keys()].join(", ") || "none"})`);
    return t;
  }

  toolIds(): string[] {
    return [...this.tools.keys()];
  }

  setSource(source: BarSource | null): void {
    this.source = source;
    this.render();
  }

  /** Current chart interval in ms; drawings with `intervals` show only when it is listed. */
  setInterval(ms: number | null): void {
    if (ms !== null && !(ms > 0)) throw new RangeError(`drawings: interval must be positive, got ${ms}`);
    this.intervalMs = ms;
    this.render();
  }

  setMagnet(mode: MagnetMode): void {
    this.magnetMode = mode;
  }

  magnet(): MagnetMode {
    return this.magnetMode;
  }

  // ---- reading state ------------------------------------------------------------

  list(): Drawing[] {
    return this.store.list.map(clone);
  }

  get(id: string): Drawing | undefined {
    const d = this.store.get(id);
    return d ? clone(d) : undefined;
  }

  selection(): string[] {
    return [...this.selected];
  }

  activeTool(): string | null {
    return this.tool;
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  // ---- mutation (every path is a Command) ------------------------------------

  private newId(): string {
    let id: string;
    do id = `d${this.nextId++}`;
    while (this.store.get(id));
    return id;
  }

  private build(spec: NewDrawing, anchors: Anchor[], fromView: PluginPaneView | null): Drawing {
    const def = this.toolDef(spec.tool);
    const dflt = def.defaults();
    const d: Drawing = {
      id: spec.id ?? this.newId(),
      tool: spec.tool,
      pane: spec.pane ?? 0,
      anchors: anchors.map((a) => ({ time: a.time, price: a.price })),
      style: { ...DEFAULT_STYLE, ...dflt.style, ...spec.style },
      props: { ...clone(dflt.props ?? {}), ...clone(spec.props ?? {}) },
      locked: spec.locked ?? false,
      hidden: spec.hidden ?? false,
      intervals: spec.intervals ?? null,
    };
    if (def.onCreate && fromView) def.onCreate(d, this.ctxFor(fromView));
    return d;
  }

  /** Throws with context unless `d` is a valid drawing of a registered tool. */
  validate(d: Drawing): void {
    const def = this.toolDef(d.tool);
    if (typeof d.id !== "string" || !d.id) throw new TypeError("drawings: a drawing needs a string id");
    if (!Number.isInteger(d.pane) || d.pane < 0) throw new RangeError(`drawings: ${d.tool} "${d.id}" has invalid pane ${d.pane}`);
    if (!Array.isArray(d.anchors)) throw new TypeError(`drawings: ${d.tool} "${d.id}" anchors must be an array`);
    if (def.variable ? d.anchors.length < def.anchors : d.anchors.length !== def.anchors) {
      throw new RangeError(`drawings: ${d.tool} "${d.id}" needs ${def.variable ? "at least " : ""}${def.anchors} anchors, got ${d.anchors.length}`);
    }
    d.anchors.forEach((a, i) => {
      if (typeof a?.time !== "number" || typeof a?.price !== "number" || !Number.isFinite(a.time) || !Number.isFinite(a.price)) {
        throw new TypeError(`drawings: ${d.tool} "${d.id}" anchor ${i} must be {time, price} with finite numbers`);
      }
    });
    for (const k of Object.keys(DEFAULT_STYLE) as Array<keyof DrawingStyle>) {
      if (typeof d.style?.[k] !== typeof DEFAULT_STYLE[k] && !(k === "fill" && (d.style?.fill === null || typeof d.style?.fill === "string"))) {
        throw new TypeError(`drawings: ${d.tool} "${d.id}" style.${k} has the wrong type`);
      }
    }
    if (d.intervals !== null && (!Array.isArray(d.intervals) || d.intervals.some((x) => !(x > 0)))) throw new TypeError(`drawings: ${d.tool} "${d.id}" intervals must be null or positive numbers`);
    if (def.needsSource && !this.source) throw new Error(`drawings: ${d.tool} needs a BarSource; pass \`source\` to DrawingsPlugin`);
    if (def.screen) {
      if (typeof d.props.fx !== "number" || typeof d.props.fy !== "number") throw new TypeError(`drawings: ${d.tool} "${d.id}" needs numeric props fx and fy`);
    }
    def.validate?.(d);
  }

  /** Create a drawing; returns a copy. Throws when invalid. */
  add(spec: NewDrawing): Drawing {
    const view = this.api && (spec.pane ?? 0) < this.api.paneCount ? this.api.paneView(spec.pane ?? 0) : null;
    const d = this.build(spec, spec.anchors ?? [], view);
    if (this.store.get(d.id)) throw new Error(`drawings: id "${d.id}" is already used`);
    this.validate(d);
    this.exec(new AddCommand(d, this.store.list.length));
    return clone(d);
  }

  /**
   * Create several drawings as one undo step. Every spec is built and validated first, so either all are added or none is
   * (nothing reaches the history, the events or the redo stack on a refusal). Returns copies.
   */
  addMany(specs: readonly NewDrawing[]): Drawing[] {
    const adds: Command[] = [];
    const made: Drawing[] = [];
    const ids = new Set<string>();
    let at = this.store.list.length;
    for (const [i, spec] of specs.entries()) {
      try {
        const view = this.api && (spec.pane ?? 0) < this.api.paneCount ? this.api.paneView(spec.pane ?? 0) : null;
        const d = this.build(spec, spec.anchors ?? [], view);
        if (this.store.get(d.id) || ids.has(d.id)) throw new Error(`id "${d.id}" is already used`);
        this.validate(d);
        ids.add(d.id);
        adds.push(new AddCommand(d, at++));
        made.push(d);
      } catch (e) {
        throw new Error(`drawings: addMany: drawing ${i + 1} of ${specs.length} is invalid: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
      }
    }
    if (adds.length) this.exec(new BatchCommand("add", adds));
    return made.map(clone);
  }

  /** Change a drawing (programmatic: locks do not apply). */
  update(id: string, patch: DrawingPatch): Drawing {
    const before = clone(this.store.require(id));
    const after = this.applyPatch(before, patch);
    this.validate(after);
    this.exec(new PatchCommand("update", [before], [after]));
    return clone(after);
  }

  private applyPatch(d: Drawing, patch: DrawingPatch): Drawing {
    const out = clone(d);
    if (patch.anchors) out.anchors = patch.anchors.map((a) => ({ time: a.time, price: a.price }));
    if (patch.style) out.style = { ...out.style, ...patch.style };
    if (patch.props) out.props = { ...out.props, ...clone(patch.props) };
    if (patch.locked !== undefined) out.locked = patch.locked;
    if (patch.hidden !== undefined) out.hidden = patch.hidden;
    if (patch.intervals !== undefined) out.intervals = patch.intervals;
    return out;
  }

  /** Update several drawings as one undo step. */
  updateMany(ids: readonly string[], patch: DrawingPatch): void {
    const before = ids.map((i) => clone(this.store.require(i)));
    const after = before.map((b) => this.applyPatch(b, patch));
    after.forEach((a) => this.validate(a));
    this.exec(new PatchCommand("update", before, after));
  }

  remove(ids: readonly string[]): void {
    if (ids.length === 0) return;
    const entries = ids.map((id) => ({ d: this.store.require(id), at: this.store.list.indexOf(this.store.require(id)) }));
    this.exec(new RemoveCommand(entries));
  }

  clear(): void {
    this.remove(this.store.list.map((d) => d.id));
  }

  private exec(cmd: Command, how: "run" | "undo" | "redo" = "run"): void {
    // A drag holds snapshots of the state it started from: abandon it before the state changes under it.
    if (this.drag) this.cancelDrag();
    const snap = (ids: readonly string[]) => new Map(ids.map((i) => [i, this.store.get(i) ? JSON.stringify(this.store.get(i)) : undefined] as const));
    const before = snap(cmd.ids);
    if (how === "run") this.history.run(cmd);
    else if (how === "undo") this.history.undo();
    else this.history.redo();
    const after = snap(cmd.ids);
    for (const id of cmd.ids) {
      const b = before.get(id), a = after.get(id);
      if (b === undefined && a !== undefined) this.events.emit("created", JSON.parse(a) as Drawing);
      else if (b !== undefined && a === undefined) this.events.emit("removed", JSON.parse(b) as Drawing);
      else if (a !== undefined && a !== b) this.events.emit("changed", JSON.parse(a) as Drawing);
    }
    this.afterMutation();
  }

  private afterMutation(): void {
    let dropped = false;
    for (const id of [...this.selected]) if (!this.store.get(id)) (this.selected.delete(id), (dropped = true));
    if (this.hover && !this.store.get(this.hover)) this.hover = null;
    if (dropped) this.events.emit("selected", this.selection());
    this.events.emit("history", { canUndo: this.history.canUndo, canRedo: this.history.canRedo });
    this.render();
  }

  /** When the drawing change `undo` would take back was made, by `options.clock`; null when there is none. */
  nextUndoAt(): number | null {
    return this.peekUndo()?.doneAt ?? null;
  }

  /** When the drawing change `redo` would put back was last undone; null when there is none. */
  nextRedoAt(): number | null {
    return this.peekRedo()?.undoneAt ?? null;
  }

  undo(): boolean {
    const top = this.peekUndo();
    if (!top) return false;
    this.exec(top, "undo");
    return true;
  }

  redo(): boolean {
    const top = this.peekRedo();
    if (!top) return false;
    this.exec(top, "redo");
    return true;
  }

  // History does not expose its stacks; wrap to learn the command before applying it.
  private peekUndo(): Command | undefined {
    return (this.history as unknown as { undoStack: Command[] }).undoStack.at(-1);
  }
  private peekRedo(): Command | undefined {
    return (this.history as unknown as { redoStack: Command[] }).redoStack.at(-1);
  }

  // ---- selection ------------------------------------------------------------------

  select(ids: readonly string[]): void {
    for (const id of ids) this.store.require(id);
    const same = ids.length === this.selected.size && ids.every((i) => this.selected.has(i));
    if (same) return;
    this.selected.clear();
    for (const id of ids) this.selected.add(id);
    this.events.emit("selected", this.selection());
    this.render();
  }

  selectAll(): void {
    this.select(this.store.list.filter((d) => !d.hidden).map((d) => d.id));
  }

  setTool(id: string | null): void {
    if (id !== null && this.options.readOnly) throw new Error("drawings: a read-only plugin takes no tool");
    if (id !== null) this.toolDef(id);
    this.creating = null;
    if (this.tool === id) return;
    this.tool = id;
    if (id !== null) this.select([]);
    this.events.emit("tool", id);
    this.render();
  }

  /** The anchor (time, price) under a pane pixel: for creating drawings from code at screen positions. */
  anchorAt(pane: number, x: number, y: number): Anchor {
    if (!this.api) throw new Error("drawings: the plugin is not installed on a chart");
    const v = this.api.paneView(pane);
    return { time: v.xToTime(x), price: v.yToPrice(y) };
  }

  /** Pane pixel of an anchor. */
  pixelOf(pane: number, a: Anchor): { x: number; y: number } {
    if (!this.api) throw new Error("drawings: the plugin is not installed on a chart");
    const v = this.api.paneView(pane);
    return { x: v.timeToX(a.time), y: v.priceToY(a.price) };
  }

  // ---- order, clipboard -----------------------------------------------------------

  private reorder(ids: readonly string[], f: (order: string[], sel: Set<string>) => string[]): void {
    const before = this.store.list.map((d) => d.id);
    const after = f([...before], new Set(ids));
    if (after.every((id, i) => id === before[i])) return;
    this.exec(new ReorderCommand(before, after));
  }

  bringToFront(ids: readonly string[] = this.selection()): void {
    this.reorder(ids, (o, s) => [...o.filter((i) => !s.has(i)), ...o.filter((i) => s.has(i))]);
  }

  sendToBack(ids: readonly string[] = this.selection()): void {
    this.reorder(ids, (o, s) => [...o.filter((i) => s.has(i)), ...o.filter((i) => !s.has(i))]);
  }

  /** Move each selected drawing one step up past the nearest unselected one. */
  bringForward(ids: readonly string[] = this.selection()): void {
    this.reorder(ids, (o, s) => {
      for (let i = o.length - 2; i >= 0; i--) if (s.has(o[i]!) && !s.has(o[i + 1]!)) [o[i], o[i + 1]] = [o[i + 1]!, o[i]!];
      return o;
    });
  }

  sendBackward(ids: readonly string[] = this.selection()): void {
    this.reorder(ids, (o, s) => {
      for (let i = 1; i < o.length; i++) if (s.has(o[i]!) && !s.has(o[i - 1]!)) [o[i], o[i - 1]] = [o[i - 1]!, o[i]!];
      return o;
    });
  }

  /** Copy the selection (or `ids`) to the plugin's clipboard; returns the copies. */
  copy(ids: readonly string[] = this.selection()): Drawing[] {
    this.clipboard = ids.map((i) => clone(this.store.require(i)));
    return clone(this.clipboard);
  }

  /**
   * Paste the clipboard as new drawings (one undo step) and select them. With
   * `at`, the first copy's first anchor lands there and the others keep their
   * offsets; without, the copies sit exactly on the originals.
   */
  paste(at?: { time: number; price: number }): Drawing[] {
    if (this.clipboard.length === 0) return [];
    const ref = this.clipboard.find((d) => d.anchors.length > 0)?.anchors[0];
    const dt = at && ref ? at.time - ref.time : 0, dp = at && ref ? at.price - ref.price : 0;
    return this.pasteShifted(dt, dp);
  }

  /** Copy + paste the selection shifted by DUPLICATE_BARS bars in time (price unchanged). */
  duplicate(): Drawing[] {
    if (this.selected.size === 0) return [];
    const bar = this.barMs();
    this.copy();
    return this.pasteShifted(DUPLICATE_BARS * bar, 0);
  }

  private barMs(): number {
    const v = this.intervalMs ?? (this.source && this.source.length > 1 ? this.source.interval : null);
    if (v === null) throw new Error("drawings: the bar interval is unknown; pass `interval` or a `source` with two bars");
    return v;
  }

  private pasteShifted(dt: number, dp: number): Drawing[] {
    const adds: Command[] = [];
    const made: Drawing[] = [];
    let at = this.store.list.length;
    for (const src of this.clipboard) {
      const d = clone(src);
      d.id = this.newId();
      d.locked = false;
      d.anchors = d.anchors.map((a) => ({ time: a.time + dt, price: a.price + dp }));
      this.validate(d);
      adds.push(new AddCommand(d, at++));
      made.push(d);
    }
    this.exec(new BatchCommand("paste", adds));
    this.select(made.map((d) => d.id));
    return clone(made);
  }

  // ---- templates -------------------------------------------------------------------

  /** Save a drawing's style as a named template for its tool. */
  async saveTemplate(id: string, name: string): Promise<void> {
    if (!this.templates) throw new Error("drawings: pass `store` to DrawingsPlugin to keep templates");
    await this.templates.save(name, this.store.require(id));
  }

  /** Apply a saved template's style and props to drawings of that tool (one undo step). */
  async applyTemplate(ids: readonly string[], name: string): Promise<void> {
    if (!this.templates) throw new Error("drawings: pass `store` to DrawingsPlugin to keep templates");
    const tools = new Set(ids.map((i) => this.store.require(i).tool));
    if (tools.size !== 1) throw new Error("drawings: a template applies to drawings of one tool");
    const t = await this.templates.load([...tools][0]!, name);
    this.updateMany(ids, { style: t.style, props: t.props });
  }

  // ---- persistence -----------------------------------------------------------------

  toJSON(): DrawingsState {
    return { version: SCHEMA_VERSION, drawings: this.list() };
  }

  /** Throws what `fromJSON(state)` would, changing nothing (the core's `restoreState` calls it before it replaces anything). */
  validateState(state: unknown): void {
    this.parseState(state);
  }

  private parseState(state: unknown): Drawing[] {
    if (typeof state !== "object" || state === null) throw new TypeError("drawings: saved state must be an object");
    const s = state as Partial<DrawingsState>;
    if (typeof s.version !== "number" || !Number.isInteger(s.version) || s.version < 1) throw new TypeError(`drawings: invalid saved version ${String(s.version)}`);
    if (s.version > SCHEMA_VERSION) throw new RangeError(`drawings: saved version ${s.version} is newer than this library understands (${SCHEMA_VERSION})`);
    if (!Array.isArray(s.drawings)) throw new TypeError("drawings: saved state has no drawings array");
    const ids = new Set<string>();
    const next = s.drawings.map((raw) => {
      const d = clone(raw as Drawing);
      this.validate(d);
      if (ids.has(d.id)) throw new Error(`drawings: saved state repeats id "${d.id}"`);
      ids.add(d.id);
      return d;
    });
    return next;
  }

  fromJSON(state: unknown): void {
    const next = this.parseState(state);
    const gone = this.store.list.map(clone);
    this.store.clear();
    next.forEach((d, i) => this.store.insert(d, i));
    for (const d of next) {
      const n = /^d(\d+)$/.exec(d.id);
      if (n) this.nextId = Math.max(this.nextId, Number(n[1]) + 1);
    }
    this.history.clear();
    this.selected.clear();
    this.creating = null;
    this.drag = null;
    this.hover = null;
    this.loading = true;
    try {
      gone.forEach((d) => this.events.emit("removed", d));
      next.forEach((d) => this.events.emit("created", clone(d)));
    } finally {
      this.loading = false;
    }
    this.events.emit("selected", []);
    this.events.emit("history", { canUndo: false, canRedo: false });
    this.render();
  }

  // ---- geometry helpers ---------------------------------------------------------------

  private render(): void {
    this.api?.requestRender();
  }

  private report(e: unknown, d: Drawing | null): void {
    const err = e instanceof Error ? e : new Error(String(e));
    const key = `${d?.id ?? ""}:${err.message}`;
    if (this.reported.has(key)) return;
    this.reported.add(key);
    this.onError(err, d ? clone(d) : null);
  }

  private measure = (t: string, f: string): number => {
    if (this.measureCanvas === undefined) {
      this.measureCanvas = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
    }
    const c = this.measureCanvas;
    if (!c) return t.length * parseFloat(f.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? "12") * 0.6;
    c.font = f;
    return c.measureText(t).width;
  };

  private sourceInterval(): number | null {
    return this.intervalMs ?? (this.source && this.source.length > 1 ? this.source.interval : null);
  }

  private ctxFor(v: PluginPaneView): ToolCtx {
    return {
      W: v.width, H: v.height, dpr: v.dpr,
      X: (t) => v.timeToX(t), Y: (p) => v.priceToY(p), T: (x) => v.xToTime(x), P: (y) => v.yToPrice(y),
      fmt: (p) => v.formatPrice(p),
      source: this.source,
      interval: this.sourceInterval(),
    };
  }

  private visible(d: Drawing): boolean {
    if (d.hidden) return false;
    if (d.intervals === null) return true;
    const iv = this.intervalMs;
    if (iv === null) {
      this.report(new Error("the chart interval is unknown (call setInterval); drawings limited to intervals are shown on every interval"), d);
      return true;
    }
    return d.intervals.includes(iv);
  }

  private shapesOf(d: Drawing, c: ToolCtx): Shape[] {
    try {
      return this.toolDef(d.tool).shapes(d, c);
    } catch (e) {
      this.report(e, d);
      return [];
    }
  }

  private handlePoints(d: Drawing, c: ToolCtx): Array<{ x: number; y: number }> {
    const def = this.toolDef(d.tool);
    if (def.noHandles || d.locked) return [];
    if (def.screen) return [{ x: (d.props.fx as number) * c.W, y: (d.props.fy as number) * c.H }];
    try {
      return def.handlePoints ? def.handlePoints(d, c) : d.anchors.map((a) => ({ x: c.X(a.time), y: c.Y(a.price) }));
    } catch (e) {
      this.report(e, d);
      return [];
    }
  }

  private tolerance(type?: string): number {
    return TOLERANCE[type ?? this.last?.pointerType ?? "mouse"] ?? TOLERANCE.mouse!;
  }

  /**
   * What is under a pane point: a handle of a selected drawing first (topmost
   * selected wins), else the topmost visible drawing within `tol` px.
   */
  hitTest(pane: number, x: number, y: number, tol = this.tolerance()): { id: string; handle: number | null } | null {
    if (!this.api) throw new Error("drawings: the plugin is not installed on a chart");
    const view = this.api.paneView(pane);
    const c = this.ctxFor(view);
    const list = this.store.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i]!;
      if (d.pane !== pane || !this.selected.has(d.id) || d.locked) continue;
      const hp = this.handlePoints(d, c);
      for (let h = 0; h < hp.length; h++) if (dist(x, y, hp[h]!.x, hp[h]!.y) <= tol + 3) return { id: d.id, handle: h };
    }
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i]!;
      if (d.pane !== pane || !this.visible(d)) continue;
      for (const s of this.shapesOf(d, c)) {
        if (shapeDistance(s, x, y, c.W, c.H, d.style, this.measure) <= tol) return { id: d.id, handle: null };
      }
    }
    return null;
  }

  /** Snap a pointer position to the nearest bar's O/H/L/C according to the magnet mode. */
  snap(e: Pick<PluginPointer, "pane" | "x" | "y" | "time" | "price">): Anchor {
    const raw = { time: e.time, price: e.price };
    if (this.magnetMode === "off" || !this.source || this.source.length === 0 || e.pane !== 0 || !this.api) return raw;
    const v = this.api.paneView(0);
    const bar = this.source.nearest(e.time);
    if (!bar) return raw;
    const bx = v.timeToX(bar.time);
    let best: { price: number; d: number } | null = null;
    for (const p of [bar.open, bar.high, bar.low, bar.close, ...(this.options.snapValues?.(bar.time) ?? [])]) {
      if (!Number.isFinite(p)) continue;
      const d = Math.abs(v.priceToY(p) - e.y);
      if (!best || d < best.d) best = { price: p, d };
    }
    if (!best) return raw;
    if (this.magnetMode === "weak" && (best.d > WEAK_MAGNET_PX || Math.abs(bx - e.x) > WEAK_MAGNET_PX)) return raw;
    return { time: bar.time, price: best.price };
  }

  // ---- drawing ------------------------------------------------------------------------

  /** A colour, or a colour slot as the chart's theme draws it. */
  private readonly resolveColor = (c: string): string => (this.api ? resolveColor(c, this.api.theme) : c);

  drawPane(ctx: CanvasRenderingContext2D, view: PluginPaneView): void {
    const c = this.ctxFor(view);
    const frame: Array<{ d: Drawing; shapes: Shape[] }> = [];
    for (const d of this.store.list) if (d.pane === view.pane && this.visible(d)) frame.push({ d, shapes: this.shapesOf(d, c) });
    // the price labels of levels close together give way to one another (a shape of this frame only)
    const labels: Array<{ s: Extract<Shape, { k: "text" }>; style: DrawingStyle }> = [];
    for (const { d, shapes } of frame) for (const s of shapes) if (s.k === "text" && s.stack) labels.push({ s, style: d.style });
    if (labels.length > 1) declutter(labels, this.measure);
    for (const { d, shapes } of frame) {
      const sel = this.selected.has(d.id);
      drawShapes(ctx, shapes, d.style, c.W, c.H, { widthBoost: sel || d.id === this.hover ? 0.5 : 0, resolve: this.resolveColor });
    }
    for (const d of this.store.list) {
      if (d.pane !== view.pane || !this.selected.has(d.id) || !this.visible(d)) continue;
      for (const p of this.handlePoints(d, c)) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = this.resolveColor(d.style.color);
        ctx.stroke();
      }
    }
    const cr = this.creating;
    if (cr && cr.pane === view.pane) {
      const d = this.previewDrawing(cr);
      if (d) {
        ctx.save();
        drawShapes(ctx, this.shapesOf(d, c), d.style, c.W, c.H, { resolve: this.resolveColor });
        ctx.restore();
        for (const a of cr.anchors) {
          ctx.beginPath();
          ctx.arc(c.X(a.time), c.Y(a.price), 3.5, 0, Math.PI * 2);
          ctx.fillStyle = this.resolveColor(d.style.color);
          ctx.fill();
        }
      }
    }
    const b = this.drag;
    if (b?.kind === "box" && b.pane === view.pane) {
      ctx.save();
      ctx.strokeStyle = "#8a8a8a";
      ctx.fillStyle = "rgba(138,138,138,0.12)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.fillRect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
      ctx.strokeRect(Math.min(b.x0, b.x1) + 0.5, Math.min(b.y0, b.y1) + 0.5, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
      ctx.restore();
    }
  }

  /** The drawing being created, with the rubber-band anchor filling the rest. */
  private previewDrawing(cr: Creating): Drawing | null {
    const def = cr.def;
    const anchors = [...cr.anchors];
    if (def.screen) {
      if (!cr.screenPos) return null;
    } else {
      const p = cr.pointer ?? anchors[anchors.length - 1];
      if (!p) return null;
      if (def.gesture === "freehand") {
        if (anchors.length < 2) return null;
      } else if (def.variable) {
        anchors.push(p);
        if (anchors.length < def.anchors) while (anchors.length < def.anchors) anchors.push(p);
      } else {
        while (anchors.length < def.anchors) anchors.push(p);
      }
    }
    const d = this.build({ tool: def.id, pane: cr.pane, id: "__preview__", ...(cr.screenPos ? { props: cr.screenPos } : {}) }, anchors, null);
    this.constrainAll(d);
    return d;
  }

  private constrainAll(d: Drawing): void {
    const def = this.toolDef(d.tool);
    if (def.constrain) for (let i = 0; i < d.anchors.length; i++) def.constrain(d, i);
  }

  // ---- pointer -------------------------------------------------------------------------

  pointer(e: PluginPointer): boolean {
    if (this.options.readOnly) return false;
    this.last = { pane: e.pane, x: e.x, y: e.y, time: e.time, price: e.price, pointerType: e.pointerType };
    switch (e.type) {
      case "down": return this.onDown(e);
      case "move": return this.onMove(e);
      case "up": return this.onUp(e);
      case "click": return this.onClick(e);
      case "dblclick": return this.onDouble(e);
      case "leave":
        if (this.hover) {
          this.hover = null;
          this.render();
        }
        return false;
    }
  }

  private onDown(e: PluginPointer): boolean {
    if (this.creating) return true;
    if (this.tool) return this.beginCreate(e);
    const hit = this.hitTest(e.pane, e.x, e.y, this.tolerance(e.pointerType));
    if (!hit) {
      if (e.shiftKey) {
        this.drag = { kind: "box", pane: e.pane, x0: e.x, y0: e.y, x1: e.x, y1: e.y };
        return true;
      }
      return false;
    }
    const d = this.store.require(hit.id);
    if (hit.handle !== null) {
      this.drag = { kind: "handle", pane: e.pane, id: d.id, index: hit.handle, before: clone(d), moved: false };
      return true;
    }
    let clickOnly: { id: string; shift: boolean } | null = null;
    if (e.shiftKey) {
      if (this.selected.has(d.id)) clickOnly = { id: d.id, shift: true };
      else this.select([...this.selected, d.id]);
    } else if (!this.selected.has(d.id)) this.select([d.id]);
    else if (this.selected.size > 1) clickOnly = { id: d.id, shift: false };
    const movers = [...this.selected].map((id) => this.store.require(id)).filter((m) => !m.locked && m.pane === e.pane);
    this.drag = {
      kind: "move", pane: e.pane, start: { x: e.x, y: e.y }, before: movers.map(clone),
      startAnchors: new Map(movers.map((m) => [m.id, clone(m.anchors)])),
      startScreen: new Map(movers.filter((m) => this.toolDef(m.tool).screen).map((m) => [m.id, { fx: m.props.fx as number, fy: m.props.fy as number }])),
      moved: false, clickOnly,
    };
    return true;
  }

  private beginCreate(e: PluginPointer): boolean {
    const def = this.toolDef(this.tool!);
    const a = this.snap(e);
    const view = this.api!.paneView(e.pane);
    this.creating = {
      def, pane: e.pane, anchors: def.screen ? [] : [a], pointer: a, fresh: true,
      downPx: { x: e.x, y: e.y }, lastPx: { x: e.x, y: e.y },
      screenPos: def.screen ? { fx: e.x / view.width, fy: e.y / view.height } : null,
    };
    this.render();
    return true;
  }

  private onMove(e: PluginPointer): boolean {
    const cr = this.creating;
    if (cr) {
      if (e.pane !== cr.pane) return true;
      cr.pointer = this.snap(e);
      if (cr.screenPos) cr.screenPos = { fx: e.x / this.api!.paneView(cr.pane).width, fy: e.y / this.api!.paneView(cr.pane).height };
      if (cr.def.gesture === "freehand" && cr.fresh && (e.buttons & 1)) {
        if (dist(e.x, e.y, cr.lastPx.x, cr.lastPx.y) >= 3) {
          cr.anchors.push(cr.pointer);
          cr.lastPx = { x: e.x, y: e.y };
        }
      }
      this.render();
      return true;
    }
    const d = this.drag;
    if (d) {
      if (d.kind === "box") {
        d.x1 = e.x;
        d.y1 = e.y;
      } else if (d.kind === "move") this.dragMove(d, e);
      else this.dragHandle(d, e);
      this.render();
      return true;
    }
    if (this.tool) return false;
    const hit = this.hitTest(e.pane, e.x, e.y, this.tolerance(e.pointerType));
    const id = hit?.id ?? null;
    if (id !== this.hover) {
      this.hover = id;
      this.render();
    }
    return false;
  }

  private dragMove(d: Extract<Drag, { kind: "move" }>, e: PluginPointer): void {
    const dx = e.x - d.start.x, dy = e.y - d.start.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
    d.moved = true;
    const v = this.api!.paneView(d.pane);
    for (const b of d.before) {
      const cur = this.store.require(b.id);
      const def = this.toolDef(b.tool);
      if (def.screen) {
        const s0 = d.startScreen.get(b.id)!;
        cur.props.fx = s0.fx + dx / v.width;
        cur.props.fy = s0.fy + dy / v.height;
        continue;
      }
      const a0 = d.startAnchors.get(b.id)!;
      // Move in pixels so the shape keeps its on-screen form across non-trading gaps.
      cur.anchors = a0.map((a) => ({ time: v.xToTime(v.timeToX(a.time) + dx), price: v.yToPrice(v.priceToY(a.price) + dy) }));
    }
  }

  private dragHandle(d: Extract<Drag, { kind: "handle" }>, e: PluginPointer): void {
    const cur = this.store.require(d.id);
    const def = this.toolDef(cur.tool);
    if (def.screen) return;
    d.moved = true;
    const a = this.snap(e);
    cur.anchors[d.index] = { time: a.time, price: a.price };
    def.constrain?.(cur, d.index);
  }

  private onUp(e: PluginPointer): boolean {
    const cr = this.creating;
    if (cr) return this.upCreate(cr, e);
    const d = this.drag;
    if (!d) return false;
    this.drag = null;
    if (d.kind === "box") {
      this.finishBox(d);
      return true;
    }
    if (d.kind === "handle") {
      const cur = this.store.require(d.id);
      if (d.moved && JSON.stringify(cur) !== JSON.stringify(d.before)) {
        try {
          this.validate(cur);
        } catch (err) {
          Object.assign(cur, d.before);
          this.report(err, cur);
          this.render();
          return true;
        }
        this.history.record(new PatchCommand("edit", [d.before], [clone(cur)]));
        this.events.emit("changed", clone(cur));
        this.events.emit("history", { canUndo: true, canRedo: false });
      }
      this.render();
      return true;
    }
    if (d.moved) {
      const after = d.before.map((b) => clone(this.store.require(b.id)));
      this.history.record(new PatchCommand("move", d.before, after));
      after.forEach((a) => this.events.emit("changed", a));
      this.events.emit("history", { canUndo: true, canRedo: false });
    } else if (d.clickOnly) {
      if (d.clickOnly.shift) this.select([...this.selected].filter((i) => i !== d.clickOnly!.id));
      else this.select([d.clickOnly.id]);
    }
    this.render();
    return true;
  }

  private finishBox(b: Extract<Drag, { kind: "box" }>): void {
    const view = this.api!.paneView(b.pane);
    const c = this.ctxFor(view);
    const ids: string[] = [];
    for (const d of this.store.list) {
      if (d.pane !== b.pane || !this.visible(d)) continue;
      if (this.shapesOf(d, c).some((s) => shapeInRect(s, b.x0, b.y0, b.x1, b.y1, c.W, c.H))) ids.push(d.id);
    }
    this.select(ids);
  }

  /** Select every visible drawing of a pane with a point inside the rectangle (CSS px). */
  selectInRect(pane: number, x0: number, y0: number, x1: number, y1: number): string[] {
    if (!this.api) throw new Error("drawings: the plugin is not installed on a chart");
    this.finishBox({ kind: "box", pane, x0, y0, x1, y1 });
    return this.selection();
  }

  private upCreate(cr: Creating, e: PluginPointer): boolean {
    if (e.pane !== cr.pane) return true;
    const a = this.snap(e);
    cr.pointer = a;
    const def = cr.def;
    if (def.gesture === "single") {
      this.commit(cr);
      return true;
    }
    if (def.gesture === "freehand") {
      if (cr.anchors.length >= 2) this.commit(cr);
      else this.cancelCreate();
      return true;
    }
    if (cr.fresh) {
      cr.fresh = false;
      if (dist(cr.downPx.x, cr.downPx.y, e.x, e.y) > DRAG_SLOP) cr.anchors.push(a);
    } else {
      cr.anchors.push(a);
    }
    if (!def.variable && cr.anchors.length >= def.anchors) this.commit(cr);
    else this.render();
    return true;
  }

  private onClick(_e: PluginPointer): boolean {
    if (this.creating || this.tool) return true;
    // A click that no drawing took (the press was not consumed): clear the selection.
    if (this.selected.size > 0) this.select([]);
    return false;
  }

  private onDouble(_e: PluginPointer): boolean {
    const cr = this.creating;
    if (!cr || !cr.def.variable) return false;
    // The two clicks of a double click each placed an anchor on the same spot.
    const n = cr.anchors.length;
    if (n >= 2) {
      const p = cr.anchors[n - 1]!, q = cr.anchors[n - 2]!;
      const v = this.api!.paneView(cr.pane);
      if (dist(v.timeToX(p.time), v.priceToY(p.price), v.timeToX(q.time), v.priceToY(q.price)) <= DRAG_SLOP) cr.anchors.pop();
    }
    this.finishVariable(cr);
    return true;
  }

  private finishVariable(cr: Creating): void {
    if (cr.anchors.length >= cr.def.anchors) this.commit(cr);
    else this.cancelCreate();
  }

  cancelCreate(): void {
    this.creating = null;
    this.render();
  }

  private commit(cr: Creating): void {
    this.creating = null;
    const def = cr.def;
    let anchors = cr.anchors;
    if (def.gesture === "single" && !def.screen) anchors = [cr.pointer ?? anchors[0]!];
    try {
      const view = this.api!.paneView(cr.pane);
      const d = this.build({ tool: def.id, pane: cr.pane, ...(cr.screenPos ? { props: cr.screenPos } : {}) }, anchors, view);
      this.constrainAll(d);
      this.validate(d);
      this.exec(new AddCommand(d, this.store.list.length));
      if (!this.continuous) {
        this.tool = null;
        this.events.emit("tool", null);
      }
      this.select([d.id]);
    } catch (err) {
      this.report(err, null);
      this.render();
    }
  }

  cursor(pane: number, x: number, y: number): string | null {
    if (this.options.readOnly) return null;
    if (this.tool || this.creating) return "crosshair";
    if (this.drag) return this.drag.kind === "move" ? "move" : "pointer";
    if (!this.api) return null;
    const hit = this.hitTest(pane, x, y);
    if (!hit) return null;
    return hit.handle !== null ? "pointer" : this.store.require(hit.id).locked ? "default" : "move";
  }

  // ---- keyboard -------------------------------------------------------------------------

  key(e: KeyboardEvent): boolean {
    if (this.options.readOnly) return false;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key;
    if (k === "Escape") {
      if (this.drag) {
        this.cancelDrag();
        return true;
      }
      if (this.creating) {
        this.cancelCreate();
        return true;
      }
      if (this.tool) {
        this.setTool(null);
        return true;
      }
      if (this.selected.size) {
        this.select([]);
        return true;
      }
      return false;
    }
    if (k === "Enter" && this.creating?.def.variable) {
      this.finishVariable(this.creating);
      return true;
    }
    if (k === "Delete" || k === "Backspace") {
      const ids = [...this.selected].filter((id) => !this.store.require(id).locked);
      if (ids.length === 0) return false;
      this.remove(ids);
      return true;
    }
    if (mod && (k === "z" || k === "Z")) return e.shiftKey ? (this.options.onRedo ?? (() => this.redo()))() : (this.options.onUndo ?? (() => this.undo()))();
    if (mod && (k === "y" || k === "Y")) return (this.options.onRedo ?? (() => this.redo()))();
    if (mod && (k === "c" || k === "C")) {
      if (this.selected.size === 0) return false;
      this.copy();
      return true;
    }
    if (mod && (k === "v" || k === "V")) {
      if (this.clipboard.length === 0) return false;
      this.paste(this.last ? { time: this.last.time, price: this.last.price } : undefined);
      return true;
    }
    if (mod && (k === "d" || k === "D")) {
      if (this.selected.size === 0) return false;
      this.duplicate();
      return true;
    }
    return false;
  }

  private cancelDrag(): void {
    const d = this.drag;
    this.drag = null;
    if (!d || d.kind === "box") return this.render();
    if (d.kind === "handle") Object.assign(this.store.require(d.id), clone(d.before));
    else for (const b of d.before) Object.assign(this.store.require(b.id), clone(b));
    this.render();
  }
}
