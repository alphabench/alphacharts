// The application controller: the grid of charts (a core Dashboard), the
// active chart, sync, theme, locale, layouts and templates, the dialog and
// menu state the Preact shell renders, and every action a control can fire.
// The Preact components hold no state of their own beyond what they edit;
// they read this object and call it.

import {
  Dashboard, LocalStorageStore, MemoryStore, SyncGroup, registerSeriesType, type Chart, type LayoutStore, type Theme,
} from "@alphacharts/core";
import { allTools, type Drawing, type MagnetMode, type ToolDef } from "@alphacharts/drawings";
import { createI18n, createI18nAsync, dir, type I18n, type MessageKey, type MessageValues } from "@alphacharts/i18n";
import { registerAllChartTypes } from "@alphacharts/chart-types";
import type { AlertTrigger, Condition, TriggerOptions } from "@alphacharts/alerts";
import { registerStudies, type InputValue, type StudyDef } from "@alphacharts/indicators";
import { Emitter } from "../emitter.js";
import { CHART_TYPES, chartTypeDef, isChartType, type ChartTypeId } from "../model/chartTypes.js";
import { GRID_PRESETS, cellStyle, gridPreset, gridStyle, type GridPreset } from "../model/grids.js";
import { DEFAULT_FAVOURITE_INTERVALS, intervalId, isIntraday, normalizeInterval, sortIntervals } from "../model/intervals.js";
import { decimalsOf } from "../model/chartTypes.js";
import { NamedStore, PrefsStore, pushRecent, toggled, type Prefs, EMPTY_PREFS } from "../model/persistence.js";
import { TOOL_GROUPS, toolGroups } from "../model/tools.js";
import { buildCatalogue, type CatalogueEntry, type StudyFamily } from "../model/studies.js";
import { isDark, resolveTheme, themeVars } from "../theme.js";
import { sameTheme, watchTheme } from "@alphacharts/core";
import { DEFAULT_FEATURES, type ChartAppOptions, type Features, type SymbolInfo, type SyncKey, type ThemeName, type ScriptDiagnostic, type AnalysisEntry } from "../types.js";
import { ChartInstance, type InstanceHost, type InstanceState } from "./instance.js";

void registerSeriesType;

export type Key = MessageKey;
export type Dialog =
  | { kind: "symbol"; purpose: "change" | "compare" }
  | { kind: "indicators" }
  | { kind: "study"; id: string }
  | { kind: "settings"; tab?: string }
  | { kind: "drawing"; id: string }
  | { kind: "alert"; prefill?: AlertPrefill; editId?: string }
  | { kind: "alerts" }
  | { kind: "layouts" }
  | { kind: "objects" }
  | { kind: "templates" }
  | { kind: "interval" }
  | { kind: "confirm"; message: string; confirmLabel: string; danger?: boolean; onConfirm: () => void }
  | { kind: "prompt"; title: string; label: string; value: string; onSubmit: (v: string) => void | Promise<void> };

export interface AlertPrefill {
  kind?: "price" | "indicator" | "drawing";
  price?: number;
  drawingId?: string;
  studyId?: string;
}

export interface MenuItem {
  id: string;
  label: string;
  /** Right-aligned hint (a price, a shortcut). */
  hint?: string;
  /** An icon name (see `icons`) drawn before the label. */
  icon?: string;
  checked?: boolean;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
  /** A header row, not selectable. */
  heading?: boolean;
  onSelect?: () => void;
  submenu?: MenuItem[];
}

export interface MenuSpec {
  label: string;
  /** Viewport px of the pointer, or the element to hang under. */
  at: { x: number; y: number } | HTMLElement;
  items: MenuItem[];
  /** The element focus returns to when the menu closes. */
  returnFocus: HTMLElement | null;
}

/** The `styles` and `stylesheet` options, checked once so a wrong value fails at creation, not as an unstyled shell. */
export function checkStyles(o: Pick<ChartAppOptions, "styles" | "stylesheet">): void {
  const sheet = o.stylesheet ?? "default";
  if (sheet !== "default" && sheet !== "none") throw new TypeError(`alphacharts/ui: stylesheet is "${String(sheet)}"; it is "default" or "none"`);
  const extra = o.styles === undefined ? [] : typeof o.styles === "string" ? [o.styles] : o.styles;
  if (!Array.isArray(extra) || extra.some((x) => typeof x !== "string")) throw new TypeError("alphacharts/ui: styles is a CSS string or an array of them");
  if (sheet === "none" && extra.every((x) => x.trim() === "")) throw new TypeError('alphacharts/ui: stylesheet "none" drops the built-in styles, so styles must carry yours (a copy of @alphacharts/ui/styles.css)');
}

export interface Toast {
  id: number;
  kind: "info" | "error" | "alert";
  text: string;
}

export interface AlertLogEntry {
  time: number;
  symbol: string;
  alertId: string;
  label: string | undefined;
  price: number;
  /** The price as the firing chart's own price format writes it. */
  priceText: string;
  condition: string;
}

export interface LayoutBody {
  grid: string;
  active: number;
  sync: Record<SyncKey, boolean>;
  theme: ThemeName;
  customTheme: Partial<Theme> | null;
  charts: InstanceState[];
}

const AUTOSAVE_VERSION = 1;
interface AutosaveEnvelope {
  version: typeof AUTOSAVE_VERSION;
  savedAt: number;
  body: LayoutBody;
}

/** The autosave as stored: an envelope with a version, or (written before there was one) the bare layout body. Anything else is refused, not guessed at. */
function readAutosave(raw: unknown): LayoutBody {
  const r = raw as Partial<AutosaveEnvelope> & Partial<LayoutBody>;
  if (typeof r !== "object" || r === null) throw new TypeError("autosave: saved state must be an object");
  if (r.version === undefined && Array.isArray(r.charts)) return r as LayoutBody;
  if (r.version !== AUTOSAVE_VERSION) throw new RangeError(`autosave: version ${String(r.version)} is not understood`);
  if (typeof r.body !== "object" || r.body === null) throw new TypeError("autosave: no layout in the saved state");
  return r.body;
}

export interface TemplateBody {
  chartType: ChartTypeId;
  typeParams: InstanceState["typeParams"];
  styles: InstanceState["styles"];
  studies: InstanceState["studies"];
}

export interface AppEvents {
  /** Anything the UI shows changed. */
  change: void;
  symbol: { index: number; symbol: string };
  interval: { index: number; interval: string };
  alert: AlertTrigger & { symbol: string };
  error: Error;
}

const DEFAULT_SYNC: Record<SyncKey, boolean> = { symbol: false, interval: false, crosshair: true, time: true, drawings: false };
const COMPACT_WIDTH = 720;

/** The core scheduler's series (WebGL) layer bit. */

export class ChartApp implements InstanceHost {
  readonly events = new Emitter<AppEvents>();
  readonly features: Features;
  readonly feed: ChartAppOptions["datafeed"];
  readonly store: LayoutStore;
  readonly tools: readonly ToolDef[];
  readonly prefsStore: PrefsStore;
  readonly layouts: NamedStore<LayoutBody>;
  readonly templates: NamedStore<TemplateBody>;
  /** "My scripts": the scripts the user saved, by name, in the app's storage. */
  readonly scripts: NamedStore<{ code: string }>;
  i18n!: I18n;
  prefs: Prefs = EMPTY_PREFS;

  instances: ChartInstance[] = [];
  active = 0;
  gridId: string;
  sync: Record<SyncKey, boolean> = { ...DEFAULT_SYNC };
  themeName: ThemeName;
  customTheme: Partial<Theme> | null = null;
  theme!: Theme;
  magnetMode: MagnetMode = "off";
  keepDrawing = false;
  compact = false;
  dialogs: Dialog[] = [];
  menu: MenuSpec | null = null;
  toasts: Toast[] = [];
  alertLog: AlertLogEntry[] = [];
  liveText = "";
  layoutName: string | null = null;
  autosave = false;
  /** What the legend shows (Settings, Status line). */
  legendOpts = { symbol: true, ohlc: true, change: true, volume: true, studyValues: true, studyInputs: true };
  alertDefaults: { mode: TriggerOptions["mode"] } = { mode: "once" };
  readonly toolGroups: ReturnType<typeof toolGroups>;
  scriptOpen = false;
  /** Bumps when the panel text is replaced from outside, so the panel remounts on it. */
  scriptEpoch = 0;
  scriptCode = "";
  scriptDiagnostics: ScriptDiagnostic[] = [];
  catalogue: CatalogueEntry[] | null = null;
  catalogueError: Error | null = null;
  fullscreen = false;
  ready: Promise<void>;
  /** Set when the shell is built: the element the grid is mounted into. */
  gridEl: HTMLElement | null = null;
  cells: HTMLElement[] = [];
  legendRoots: HTMLElement[] = [];

  private dashboard: Dashboard | null = null;
  private syncGroup: SyncGroup | null = null;
  private studyDefs: StudyDef[] | null = null;
  private toastSeq = 0;
  private autosaveTimer = 0;
  /**
   * Set when the saved workspace could not be restored: the autosave must not
   * replace it with the default chart that took its place, so nothing is
   * written until the user changes something themselves.
   */
  private autosaveSuspended = false;
  private syncingDrawings = false;
  private readonly syncCopies = new Map<string, string>();
  private lastToolMemo: string | null = null;
  private mql: MediaQueryList | null = null;
  private resizeObs: ResizeObserver | null = null;
  private offs: Array<() => void> = [];
  private destroyed = false;
  private readonly bump: () => void;

  constructor(readonly host: HTMLElement, readonly options: ChartAppOptions) {
    // A Run button that cannot run is worse than no panel: refuse the half pair.
    if (options.assistant && !options.scriptRunner) throw new Error("alphacharts/ui: assistant needs scriptRunner (createScriptRunAdapter from @alphacharts/script)");
    if (options.scriptEditor && !options.scriptRunner) throw new Error("alphacharts/ui: scriptEditor needs scriptRunner (createScriptRunAdapter from @alphacharts/script)");
    checkStyles(options);
    this.features = { ...DEFAULT_FEATURES, ...options.features };
    this.feed = options.datafeed;
    this.store = options.storage ?? new MemoryStore();
    this.tools = options.tools ?? allTools;
    this.toolGroups = toolGroups(this.tools);
    this.prefsStore = new PrefsStore(this.store);
    this.layouts = new NamedStore<LayoutBody>(this.store, "layout");
    this.templates = new NamedStore<TemplateBody>(this.store, "template");
    this.scripts = new NamedStore<{ code: string }>(this.store, "script");
    this.gridId = options.layout ?? "1";
    gridPreset(this.gridId);
    const th = options.theme ?? "inherit";
    if (typeof th === "string") this.themeName = th;
    else (this.themeName = "custom", (this.customTheme = th));
    this.resolveTheme();
    this.studyDefs = options.studies ? [...options.studies] : null;
    this.bump = () => this.events.emit("change", undefined);
    registerAllChartTypes();
    this.ready = this.init();
  }

  // ---- startup -------------------------------------------------------------------

  private async init(): Promise<void> {
    const locale = this.options.locale ?? "en";
    this.i18n = locale === "en" ? createI18n({ locale: "en" }) : await createI18nAsync({ locale });
    this.prefs = await this.prefsStore.get();
    this.autosave = (await this.store.load("ui/autosave-on")) === true;
    this.applyLocaleToHost();
    this.i18n.on("localeChange", () => this.localeApplied());
    this.mql = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: light)") : null;
    const onScheme = () => {
      if (this.themeName === "auto") this.pageThemeChanged();
    };
    this.mql?.addEventListener("change", onScheme);
    this.offs.push(() => this.mql?.removeEventListener("change", onScheme));
    // "inherit" follows the page: its class, style or theme attributes (shadcn toggles `.dark` on the document) and the OS scheme.
    this.offs.push(watchTheme(this.host, () => { if (this.themeName === "inherit") this.pageThemeChanged(); }));
    this.resizeObs = new ResizeObserver(() => this.measureHost());
    this.resizeObs.observe(this.host);
    this.offs.push(() => this.resizeObs?.disconnect());
    this.measureHost();
    document.addEventListener("fullscreenchange", this.onFullscreen);
    this.offs.push(() => document.removeEventListener("fullscreenchange", this.onFullscreen));
    if (this.options.studies) registerStudies(this.options.studies);
    this.bump();
  }

  t(key: Key, values?: MessageValues): string {
    return this.i18n.t(key, values);
  }

  private measureHost(): void {
    const c = this.host.clientWidth > 0 && this.host.clientWidth < COMPACT_WIDTH;
    if (c !== this.compact) {
      this.compact = c;
      this.bump();
    }
  }

  private onFullscreen = (): void => {
    this.fullscreen = document.fullscreenElement === this.host;
    this.bump();
  };

  /** Called by the shell once the grid element is in the document. */
  attachGrid(el: HTMLElement): void {
    if (this.gridEl === el) return;
    this.gridEl = el;
    this.dashboard = new Dashboard(el, {});
    const saved = this.autosave ? this.store.load("ui/autosave") : Promise.resolve(undefined);
    let raw: unknown;
    void saved
      .then((body) => {
        raw = body;
        if (this.destroyed) return;
        if (body !== undefined) this.applyLayout(readAutosave(body));
        else this.buildGrid(gridPreset(this.gridId), [{ symbol: this.options.symbol, interval: this.options.interval, chartType: "candles" }]);
      })
      .catch((e) => {
        this.autosaveSuspended = true;
        // Keep what could not be restored under its own key, so the next autosave cannot be the end of it.
        if (raw !== undefined) void this.store.save("ui/autosave-rejected", { savedAt: Date.now(), payload: raw }).catch((x) => this.report(x));
        this.report(e);
        if (this.instances.length === 0) this.buildGrid(gridPreset(this.gridId), [{ symbol: this.options.symbol, interval: this.options.interval, chartType: "candles" }]);
      });
  }

  // ---- InstanceHost ----------------------------------------------------------------

  studyDef(id: string): StudyDef {
    const d = this.studyDefs?.find((s) => s.id === id);
    if (!d) throw new Error(`study "${id}" is not loaded`);
    return d;
  }

  async ensureStudies(): Promise<void> {
    await this.loadCatalogue();
  }

  report(e: unknown): void {
    const err = e instanceof Error ? e : new Error(String(e));
    this.toast("error", `${this.t("error.generic")}: ${err.message}`);
    this.options.onError?.(err);
    this.events.emit("error", err);
  }

  alertFired(inst: ChartInstance, t: AlertTrigger): void {
    const priceText = inst.priceText(t.price);
    const entry: AlertLogEntry = { time: t.time, symbol: inst.symbol, alertId: t.alertId, label: t.label, price: t.price, priceText, condition: t.condition };
    this.alertLog = [entry, ...this.alertLog].slice(0, 200);
    const msg = this.t("alerts.triggered", { message: this.t("alerts.message.default", { symbol: inst.symbol, condition: this.t(`alerts.condition.${this.conditionKey(t.condition)}` as Key), value: priceText }) });
    this.toast("alert", t.label ? `${t.label}: ${msg}` : msg);
    this.options.onAlert?.({ ...t, symbol: inst.symbol });
    this.events.emit("alert", { ...t, symbol: inst.symbol });
    this.bump();
  }

  private conditionKey(c: string): string {
    return c === "indicator" || c === "drawing" || c === "moving" ? "crossing" : c;
  }

  magnet(): MagnetMode {
    return this.magnetMode;
  }

  /** "Snap to indicators": the magnet also takes the values of indicators drawn on the price pane. */
  snapToIndicators = false;
  snapIndicators(): boolean {
    return this.snapToIndicators;
  }

  setSnapToIndicators(on: boolean): void {
    this.snapToIndicators = on;
    this.announce(this.t(on ? "drawing.snapIndicators.on" : "drawing.snapIndicators.off"));
    this.bump();
  }

  hostTheme(): Theme {
    return this.theme;
  }

  // ---- theme and locale -----------------------------------------------------------------

  private resolveTheme(): void {
    this.theme = resolveTheme(this.themeName, this.customTheme, this.theme ?? undefined, this.host);
  }

  private chartTheme(): Theme | ThemeName {
    // The shell resolves "inherit" and the named presets itself (one place), and hands the chart a finished theme.
    return this.themeName === "auto" ? "auto" : this.theme;
  }

  private applyTheme(): void {
    this.resolveTheme();
    this.pushTheme();
    this.userChanged();
  }

  /**
   * The page changed under "inherit" (or the OS under "auto"): not the user's act, so it neither lifts a suspended autosave
   * nor saves; and a class or style change that left the variables as they were does nothing at all.
   */
  private pageThemeChanged(): void {
    const prev = this.theme;
    this.resolveTheme();
    if (prev && sameTheme(prev, this.theme)) return;
    this.pushTheme();
  }

  private pushTheme(): void {
    for (const i of this.instances) {
      i.chart.applyOptions({ theme: this.chartTheme() as never });
      i.themeChanged();
    }
    this.bump();
  }

  setTheme(name: ThemeName, custom?: Partial<Theme>): void {
    if (name === "custom") this.customTheme = { ...(this.customTheme ?? {}), ...(custom ?? {}) };
    this.themeName = name;
    this.applyTheme();
    this.announce(this.t("a11y.themeChanged", { theme: this.themeLabel(name) }));
  }

  themeLabel(n: ThemeName): string {
    return n === "inherit" ? this.t("toolbar.theme.inherit") : n === "dark" ? this.t("toolbar.theme.dark") : n === "light" ? this.t("toolbar.theme.light") : n === "high-contrast" ? this.t("toolbar.theme.highContrast") : n === "auto" ? this.t("toolbar.theme.auto") : this.t("ui.theme.custom");
  }

  vars(): Record<string, string> {
    return themeVars(this.theme, this.themeName);
  }

  /** "dark" or "light", by the resolved theme's background: the stylesheet's few mode-specific recipes key on it. */
  get mode(): "dark" | "light" {
    return isDark(this.theme) ? "dark" : "light";
  }

  async setLocale(locale: string): Promise<void> {
    await this.i18n.setLocale(locale);
  }

  private applyLocaleToHost(): void {
    this.host.setAttribute("lang", this.i18n.locale);
    this.host.setAttribute("dir", this.options.dir ?? dir(this.i18n.locale));
  }

  private localeApplied(): void {
    this.applyLocaleToHost();
    for (const i of this.instances) i.chart.applyOptions({ locale: this.i18n.locale, messages: this.i18n.chartMessages });
    this.announce(this.t("a11y.localeChanged", { language: this.i18n.locale }));
    this.bump();
  }

  get locale(): string {
    return this.i18n.locale;
  }

  // ---- grid ---------------------------------------------------------------------------------

  get current(): ChartInstance {
    const i = this.instances[this.active];
    if (!i) throw new Error("the chart grid is not ready");
    return i;
  }

  get hasCurrent(): boolean {
    return this.instances[this.active] !== undefined;
  }

  private buildGrid(preset: GridPreset, seeds: Array<{ symbol: string; interval: string; chartType: ChartTypeId }>): void {
    const grid = this.gridEl;
    if (!grid || !this.dashboard) throw new Error("the grid element is not attached");
    this.gridId = preset.id;
    for (const [k, v] of Object.entries(gridStyle(preset))) grid.style.setProperty(k, v);
    // Grow or shrink to the preset's chart count; existing charts keep their state.
    while (this.instances.length > preset.charts) this.destroyChart(this.instances.length - 1);
    for (let i = this.instances.length; i < preset.charts; i++) {
      const seed = seeds[i] ?? seeds[seeds.length - 1] ?? this.instances[this.active]?.toJSON() ?? { symbol: this.options.symbol, interval: this.options.interval, chartType: "candles" as ChartTypeId };
      this.createChart(i, seed.symbol, seed.interval, seed.chartType);
    }
    this.cells.forEach((c, i) => {
      const area = cellStyle(preset, i);
      if (area) c.style.setProperty("grid-area", area);
      else c.style.removeProperty("grid-area");
    });
    if (this.active >= preset.charts) this.active = 0;
    this.rebuildSync();
    this.refreshActive();
    requestAnimationFrame(() => this.instances.forEach((i) => i.chart.remeasure()));
    this.bump();
  }

  private createChart(index: number, symbol: string, interval: string, chartType: ChartTypeId): void {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.dataset.cell = String(index);
    const overlay = document.createElement("div");
    overlay.className = "cell-overlay";
    const legend = document.createElement("div");
    legend.className = "legend-root";
    overlay.appendChild(legend);
    this.gridEl!.insertBefore(cell, this.gridEl!.querySelector("canvas"));
    // The chart keeps its time axis left-to-right in every locale (see the i18n README).
    cell.setAttribute("dir", "ltr");
    const chart = this.dashboard!.addChart(cell, {
      theme: this.chartTheme() as never, locale: this.i18n.locale, messages: this.i18n.chartMessages, timeZone: this.options.timeZone ?? "UTC",
      ariaLabel: this.t("a11y.paneLabel", { index: index + 1, count: this.instances.length + 1 }),
    });
    cell.appendChild(overlay);
    const inst = new ChartInstance(chart, this, { symbol, interval, chartType: chartType });
    this.instances[index] = inst;
    this.cells[index] = cell;
    this.legendRoots[index] = legend;
    cell.addEventListener("pointerdown", () => this.setActive(index), true);
    cell.addEventListener("focusin", () => this.setActive(index));
    cell.addEventListener("contextmenu", (e) => this.onContext(index, e));
    inst.events.on("change", () => {
      // A script is a study over time bars; an event-based type removes them, and the panel says so rather than showing a script that is not running.
      if (this.scriptRun?.instance === inst && inst.ordinal) {
        this.scriptRun.remove();
        this.scriptRun = null;
        this.setScriptDiagnostics([{ line: 1, column: 1, from: 0, to: 0, message: this.t("ui.script.ordinal"), severity: "warning" }]);
      }
      this.bump();
      this.scheduleAutosave();
    });
    inst.events.on("drawing", (e) => {
      this.userChanged(); // drawing is the user's work: it ends a suspended autosave
      this.onDrawingEvent(index, e.kind, e.drawing);
      if (e.kind === "created") this.afterDrawingCreated(index);
    });
  }

  private destroyChart(index: number): void {
    // The script's study lives on this chart: take it off before the chart goes.
    if (this.scriptRun && this.scriptRun.instance === this.instances[index]) {
      this.scriptRun.remove();
      this.scriptRun = null;
    }
    this.instances[index]?.dispose();
    this.cells[index]?.remove();
    this.instances.splice(index, 1);
    this.cells.splice(index, 1);
    this.legendRoots.splice(index, 1);
  }

  setActive(index: number): void {
    if (index === this.active || !this.instances[index]) return;
    this.active = index;
    this.refreshActive();
    this.bump();
  }

  private refreshActive(): void {
    this.cells.forEach((c, i) => c.classList.toggle("active", i === this.active && this.instances.length > 1));
  }

  setLayout(id: string): void {
    if (!this.features.multiChart && id !== "1") throw new Error("multi-chart layouts are turned off");
    const preset = gridPreset(id);
    const cur = this.current.toJSON();
    this.buildGrid(preset, [{ symbol: cur.symbol, interval: cur.interval, chartType: cur.chartType }]);
    this.announce(this.t("layout.charts", { count: preset.charts }));
    this.userChanged();
  }

  get presets(): readonly GridPreset[] {
    return GRID_PRESETS;
  }

  // ---- sync -----------------------------------------------------------------------------------

  private rebuildSync(): void {
    for (const i of this.instances) this.syncGroup?.remove(i.chart);
    this.syncGroup = null;
    if ((this.sync.crosshair || this.sync.time) && this.instances.length > 1) {
      const g = new SyncGroup({ time: this.sync.time, crosshair: this.sync.crosshair });
      for (const i of this.instances) g.add(i.chart);
      this.syncGroup = g;
    }
  }

  setSync(key: SyncKey, on: boolean): void {
    this.sync = { ...this.sync, [key]: on };
    if (key === "crosshair" || key === "time") this.rebuildSync();
    if (on && key === "symbol") for (const i of this.instances) i.setSymbol(this.current.symbol);
    if (on && key === "interval") for (const i of this.instances) i.setInterval(this.current.interval);
    this.userChanged();
    this.bump();
  }

  private onDrawingEvent(index: number, kind: "created" | "changed" | "removed", d: Drawing): void {
    if (!this.sync.drawings || this.syncingDrawings || index !== this.active) return;
    this.syncingDrawings = true;
    try {
      for (const [i, other] of this.instances.entries()) {
        if (i === index || other.symbol !== this.instances[index]!.symbol || !other.drawings) continue;
        const p = other.drawings;
        // Each plugin numbers its own ids, so a copy gets its own id; only copies this sync made are ever touched.
        const key = `${index}|${d.id}|${i}`;
        const copy = this.syncCopies.get(key);
        if (kind === "created") this.syncCopies.set(key, p.add({ tool: d.tool, anchors: d.anchors, pane: d.pane, style: d.style, props: d.props, locked: d.locked, hidden: d.hidden, intervals: d.intervals }).id);
        else if (copy === undefined || !p.get(copy)) continue;
        else if (kind === "removed") (p.remove([copy]), this.syncCopies.delete(key));
        else p.update(copy, { anchors: d.anchors, style: d.style, props: d.props, locked: d.locked, hidden: d.hidden, intervals: d.intervals });
      }
    } catch (e) {
      this.report(e);
    } finally {
      this.syncingDrawings = false;
    }
  }

  // ---- symbol, interval, chart type -------------------------------------------------------------------

  setSymbol(symbol: string, index = this.active): void {
    const targets = this.sync.symbol ? this.instances : [this.instances[index]!];
    for (const i of targets) i.setSymbol(symbol);
    void this.rememberSymbol(symbol);
    this.events.emit("symbol", { index, symbol });
    this.announce(this.t("a11y.symbolChanged", { symbol }));
    this.userChanged();
    this.bump();
  }

  private async rememberSymbol(symbol: string): Promise<void> {
    try {
      this.prefs = await this.prefsStore.update((p) => ({ ...p, recentSymbols: pushRecent(p.recentSymbols, symbol) }));
      this.bump();
    } catch (e) {
      this.report(e);
    }
  }

  setInterval(interval: string, index = this.active): void {
    const n = normalizeInterval(interval);
    const targets = this.sync.interval ? this.instances : [this.instances[index]!];
    for (const i of targets) i.setInterval(n);
    this.events.emit("interval", { index, interval: n });
    this.announce(this.t("interval.changed", { interval: this.intervalLabel(n) }));
    this.userChanged();
    this.bump();
  }

  /** "5m" -> the localized short label ("5m", "5 मि" ...). */
  intervalLabel(i: string): string {
    const m = /^(\d+)([smhDWM])$/.exec(i);
    if (!m) return i;
    const key = { s: "second", m: "minute", h: "hour", D: "day", W: "week", M: "month" }[m[2] as "s"]!;
    return this.t(`interval.short.${key}` as Key, { count: Number(m[1]) });
  }

  setChartType(id: ChartTypeId, index = this.active): void {
    try {
      this.instances[index]!.setChartType(id);
      this.announce(this.t("chartType.changed", { type: this.chartTypeLabel(id) }));
    } catch (e) {
      this.report(e);
    }
    this.userChanged();
    this.bump();
  }

  chartTypeLabel(id: ChartTypeId): string {
    return this.t(chartTypeDef(id).key as Key);
  }

  availableChartTypes() {
    return CHART_TYPES.filter((c) => !c.needsTrades || this.feed.getTrades !== undefined);
  }

  // ---- favourites and recents ------------------------------------------------------------------------------

  favouriteIntervals(): string[] {
    return this.prefs.favouriteIntervals.length ? this.prefs.favouriteIntervals : [...DEFAULT_FAVOURITE_INTERVALS];
  }

  async toggleFavourite(kind: "favouriteIntervals" | "favouriteStudies" | "favouriteChartTypes" | "favouriteTools", item: string): Promise<void> {
    try {
      this.prefs = await this.prefsStore.update((p) => {
        const base = kind === "favouriteIntervals" && p.favouriteIntervals.length === 0 ? [...DEFAULT_FAVOURITE_INTERVALS] : p[kind];
        return { ...p, [kind]: kind === "favouriteIntervals" ? sortIntervals(toggled(base, item)) : toggled(base, item) };
      });
      this.bump();
    } catch (e) {
      this.report(e);
    }
  }

  async addCustomInterval(interval: string): Promise<void> {
    const n = normalizeInterval(interval);
    try {
      this.prefs = await this.prefsStore.update((p) => (p.customIntervals.includes(n) ? p : { ...p, customIntervals: sortIntervals([...p.customIntervals, n]) }));
    } catch (e) {
      this.report(e);
    }
    this.setInterval(n);
  }

  async rememberTool(tool: string): Promise<void> {
    const g = this.toolGroups.find((x) => x.tools.includes(tool));
    if (!g || this.prefs.lastTool[g.id] === tool) return;
    try {
      this.prefs = await this.prefsStore.update((p) => ({ ...p, lastTool: { ...p.lastTool, [g.id]: tool } }));
      this.bump();
    } catch (e) {
      this.report(e);
    }
  }

  // ---- search ------------------------------------------------------------------------------------------------

  async search(query: string, signal: AbortSignal): Promise<SymbolInfo[]> {
    if (!this.feed.searchSymbols) throw new Error("the datafeed has no searchSymbols");
    return this.feed.searchSymbols(query, signal);
  }

  get canSearch(): boolean {
    return this.feed.searchSymbols !== undefined;
  }

  // ---- studies catalogue ----------------------------------------------------------------------------------------

  async loadCatalogue(): Promise<CatalogueEntry[]> {
    if (this.catalogue) return this.catalogue;
    try {
      if (!this.studyDefs) {
        const m = await import("@alphacharts/indicators/all");
        m.registerAllStudies();
        this.studyDefs = [...m.ALL_STUDIES];
      }
      this.catalogue = buildCatalogue(this.studyDefs, (f) => this.familyLabel(f));
      this.bump();
      return this.catalogue;
    } catch (e) {
      this.catalogueError = e instanceof Error ? e : new Error(String(e));
      this.report(e);
      throw e;
    }
  }

  familyLabel(f: StudyFamily): string {
    return this.t(`ui.family.${f}` as Key);
  }

  toolLabel(id: string): string {
    // A host's own tool has no catalogue key: it names itself.
    if (!TOOL_GROUPS.some((g) => g.tools.includes(id))) return this.tools.find((x) => x.id === id)?.label ?? id;
    return this.t(`ui.tool.${id}` as Key);
  }

  addStudy(def: StudyDef, inputs: Record<string, InputValue> = {}): void {
    try {
      const study = this.current.addStudy(def, inputs);
      this.current.recordStudyAction(study.id, null);
      this.announce(this.t("indicators.added", { name: def.name }));
    } catch (e) {
      this.report(new Error(this.t("indicators.error", { name: def.name, reason: e instanceof Error ? e.message : String(e) })));
    }
    this.userChanged();
  }

  removeStudy(id: string): void {
    const s = this.current.studies().find((x) => x.study.id === id);
    const state = s ? this.current.studyState(id) : null;
    this.current.removeStudy(id);
    if (s && state) this.current.recordStudyAction(id, state);
    if (s) this.announce(this.t("indicators.removed", { name: s.study.def.name }));
    this.userChanged();
  }

  // ---- drawings ---------------------------------------------------------------------------------------------------

  get analysisOn(): boolean {
    return this.hasCurrent && !this.current.ordinal;
  }

  activeTool(): string | null {
    return this.hasCurrent ? this.current.drawings?.activeTool() ?? null : null;
  }

  selectTool(id: string | null): void {
    const d = this.current.drawings;
    if (!d) {
      this.report(new Error(this.t("ui.ordinal.disabled")));
      return;
    }
    d.setTool(id);
    this.lastToolMemo = id;
    if (id) void this.rememberTool(id);
    this.bump();
  }

  private afterDrawingCreated(index: number): void {
    if (!this.keepDrawing || index !== this.active || !this.lastToolMemo) return;
    const tool = this.lastToolMemo;
    queueMicrotask(() => {
      const d = this.instances[index]?.drawings;
      if (d && d.activeTool() === null) d.setTool(tool);
      this.bump();
    });
  }

  setMagnet(m: MagnetMode): void {
    this.magnetMode = m;
    for (const i of this.instances) i.drawings?.setMagnet(m);
    this.bump();
  }

  setKeepDrawing(on: boolean): void {
    this.keepDrawing = on;
    this.bump();
  }

  private allDrawings(): Drawing[] {
    return this.hasCurrent ? this.current.drawingList() : [];
  }

  get allLocked(): boolean {
    const l = this.allDrawings();
    return l.length > 0 && l.every((d) => d.locked);
  }

  get allHidden(): boolean {
    const l = this.allDrawings();
    return l.length > 0 && l.every((d) => d.hidden);
  }

  toggleLockAll(): void {
    const d = this.current.drawings;
    if (!d) return;
    const lock = !this.allLocked;
    const ids = d.list().map((x) => x.id);
    if (ids.length) d.updateMany(ids, { locked: lock });
    this.bump();
  }

  toggleHideAll(): void {
    const d = this.current.drawings;
    if (!d) return;
    const hide = !this.allHidden;
    const ids = d.list().map((x) => x.id);
    if (ids.length) d.updateMany(ids, { hidden: hide });
    this.announce(this.t(hide ? "drawing.hideAll" : "drawing.showAll"));
    this.bump();
  }

  // ---- cursor, indicator visibility, objects -------------------------------------------------------------------------------------------

  /** "cross": the crosshair follows the pointer; "arrow": the plain pointer, no crosshair lines. Read from the chart, so a restored layout shows its own. */
  get cursorMode(): "cross" | "arrow" {
    return this.hasCurrent && !this.current.chart.options().crosshair.visible ? "arrow" : "cross";
  }

  setCursorMode(mode: "cross" | "arrow"): void {
    for (const i of this.instances) i.chart.applyOptions({ crosshair: { ...i.chart.options().crosshair, visible: mode === "cross" } });
    this.announce(this.t(mode === "cross" ? "cursor.cross" : "cursor.arrow"));
    this.userChanged();
    this.bump();
  }

  get allIndicatorsHidden(): boolean {
    if (!this.hasCurrent) return false;
    const s = this.current.studies();
    return s.length > 0 && s.every((x) => x.userHidden);
  }

  toggleHideIndicators(): void {
    const i = this.current;
    const hide = !this.allIndicatorsHidden;
    for (const s of i.studies()) i.setStudyHidden(s.study.id, hide);
    this.announce(this.t(hide ? "indicators.hideAll" : "indicators.showAll"));
    this.userChanged();
    this.bump();
  }

  /** Remove every drawing made with `tool` (one undo step). */
  removeDrawingsOfTool(tool: string): void {
    const p = this.current.drawings;
    if (!p) return;
    const ids = p.list().filter((d) => d.tool === tool).map((d) => d.id);
    if (ids.length) p.remove(ids);
  }

  removeAllDrawings(): void {
    const n = this.allDrawings().length;
    if (n === 0) return;
    this.confirm(this.t("drawing.removeAll.confirm", { count: n }), this.t("common.remove"), () => this.current.drawings?.clear(), true);
  }

  /** Undo takes back the last change made to the chart, a study's or a drawing's. */
  undo(): boolean {
    const done = this.current.undoLatest();
    this.announce(this.t(done ? "history.undone" : "history.nothingToUndo", { action: "" }).trim());
    this.userChanged();
    this.bump();
    return done;
  }

  /** Redo puts back the change undone last. */
  redo(): boolean {
    const done = this.current.redoLatest();
    this.announce(this.t(done ? "history.redone" : "history.nothingToRedo", { action: "" }).trim());
    this.userChanged();
    this.bump();
    return done;
  }

  undoRequested(): boolean {
    return this.undo();
  }

  redoRequested(): boolean {
    return this.redo();
  }

  get canUndo(): boolean {
    return this.hasCurrent && this.current.canUndoAny;
  }

  get canRedo(): boolean {
    return this.hasCurrent && this.current.canRedoAny;
  }

  // ---- alerts -----------------------------------------------------------------------------------------------------------

  addPriceAlert(condition: Condition, trigger: TriggerOptions, o: { label?: string; expiresAt?: number | null } = {}): void {
    try {
      this.current.addAlert(condition, trigger, o);
      this.toast("info", this.t("alerts.created", { symbol: this.current.symbol }));
      this.announce(this.t("alerts.created", { symbol: this.current.symbol }));
    } catch (e) {
      this.report(new Error(this.t("alerts.error", { reason: e instanceof Error ? e.message : String(e) })));
    }
    this.userChanged();
  }

  // ---- dialogs and menus ----------------------------------------------------------------------------------------------------

  openDialog(d: Dialog): void {
    this.menu = null;
    this.dialogs = [...this.dialogs, d];
    this.bump();
  }

  closeDialog(): void {
    this.dialogs = this.dialogs.slice(0, -1);
    this.bump();
  }

  closeAllDialogs(): void {
    this.dialogs = [];
    this.bump();
  }

  /** Open a menu; opening it again from the element it is anchored to closes it (a trigger toggles its menu). */
  openMenu(m: MenuSpec): void {
    if (this.menu && m.at instanceof HTMLElement && this.menu.at === m.at) return this.closeMenu();
    this.menu = m;
    this.bump();
  }

  closeMenu(): void {
    if (!this.menu) return;
    const f = this.menu.returnFocus;
    this.menu = null;
    this.bump();
    f?.focus({ preventScroll: true });
  }

  confirm(message: string, confirmLabel: string, onConfirm: () => void, danger = false): void {
    this.openDialog({ kind: "confirm", message, confirmLabel, danger, onConfirm });
  }

  toast(kind: Toast["kind"], text: string): void {
    const id = ++this.toastSeq;
    this.toasts = [...this.toasts, { id, kind, text }].slice(-4);
    if (kind !== "error") setTimeout(() => this.dismissToast(id), 6000);
    this.announce(text);
    this.bump();
  }

  dismissToast(id: number): void {
    if (!this.toasts.some((t) => t.id === id)) return;
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.bump();
  }

  announce(text: string): void {
    // A repeated message must still be read: alternate a trailing no-width mark.
    this.liveText = this.liveText === text ? `${text}​` : text;
    this.bump();
  }

  // ---- context menu -----------------------------------------------------------------------------------------------------------

  private onContext(index: number, e: MouseEvent): void {
    e.preventDefault();
    this.setActive(index);
    const inst = this.instances[index]!;
    const rect = inst.chart.element.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const region = inst.chart.region(x, y);
    const at = { x: e.clientX, y: e.clientY };
    const items = this.contextItems(inst, region, x, y);
    this.openMenu({ label: this.t("a11y.menu", { name: this.t("ui.menu.context") }), at, items, returnFocus: inst.chart.element });
  }

  private contextItems(inst: ChartInstance, region: ReturnType<Chart["region"]>, x: number, y: number): MenuItem[] {
    const t = (k: Key, v?: MessageValues) => this.t(k, v);
    const chart = inst.chart;
    if (region.kind === "priceAxis") {
      const sc = chart.priceScale(region.scaleId, region.pane);
      const o = sc.options();
      const set = (p: Parameters<typeof sc.applyOptions>[0]) => () => (sc.applyOptions(p), this.bump());
      return [
        { id: "auto", label: t("settings.priceScale.autoScale"), checked: o.autoScale, onSelect: set({ autoScale: !o.autoScale }) },
        { id: "invert", label: t("settings.priceScale.invert"), checked: o.invert, onSelect: set({ invert: !o.invert }) },
        { id: "sep1", label: "", separator: true },
        ...(["linear", "log", "percent", "indexed"] as const).map((m) => ({ id: `mode-${m}`, label: t(`settings.priceScale.mode.${m === "linear" ? "linear" : m}` as Key), checked: o.mode === m, onSelect: set({ mode: m }) })),
        { id: "sep2", label: "", separator: true },
        { id: "left", label: `${t("ui.scale.moveTo")} ${t("settings.priceScale.position.left")}`, disabled: o.position === "left", onSelect: set({ position: "left" }) },
        { id: "right", label: `${t("ui.scale.moveTo")} ${t("settings.priceScale.position.right")}`, disabled: o.position === "right", onSelect: set({ position: "right" }) },
        { id: "fit", label: t("menu.scale.autoFit"), onSelect: () => (chart.resetPriceScale(region.pane, region.scaleId), set({ autoScale: true })()) },
      ];
    }
    if (region.kind === "timeAxis") {
      const tz = chart.options().timeZone;
      const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const zones = [...new Set(["UTC", this.options.timeZone ?? "UTC", local])];
      return [
        { id: "latest", label: t("toolbar.scrollToLatest"), onSelect: () => chart.timeScale.scrollToLatest() },
        { id: "fit", label: t("ui.view.fit"), onSelect: () => chart.timeScale.fitContent() },
        { id: "reset", label: t("toolbar.resetView"), onSelect: () => chart.timeScale.reset() },
        { id: "sep", label: "", separator: true },
        { id: "tz", label: t("toolbar.timeZone"), heading: true },
        ...zones.map((z) => ({ id: `tz-${z}`, label: z === "UTC" ? t("format.timeZone.utc") : z === local ? t("format.timeZone.local", { zone: z }) : z, checked: tz === z, onSelect: () => (this.setTimeZone(z)) })),
      ];
    }
    const d = inst.drawings;
    if (region.kind === "pane" && d) {
      const hit = d.hitTest(region.pane, region.x, region.y);
      if (hit) {
        const drawing = d.get(hit.id)!;
        if (!d.selection().includes(hit.id)) d.select([hit.id]);
        return this.drawingItems(inst, drawing);
      }
    }
    if (region.kind === "pane") {
      const sr = this.seriesHit(inst, region.pane, region.y);
      if (sr) return sr;
      const price = d ? d.anchorAt(region.pane, region.x, region.y).price : undefined;
      const fp = price === undefined ? "" : (inst.main ?? inst.displaySeries[0])?.formatPrice(price) ?? String(price);
      const items: MenuItem[] = [
        { id: "reset", label: t("menu.chart.reset"), onSelect: () => chart.resetChart() },
      ];
      if (price !== undefined && inst.alerts && this.features.alerts) {
        items.push({ id: "alert", label: t("menu.chart.addAlert", { price: fp }), onSelect: () => this.openDialog({ kind: "alert", prefill: { kind: "price", price } }) });
      }
      if (price !== undefined && d && this.features.drawings) {
        items.push({ id: "hline", label: t("menu.chart.drawHorizontal", { price: fp }), onSelect: () => this.addHorizontalLine(price) });
      }
      if (price !== undefined) items.push({ id: "copy", label: t("menu.chart.copyPrice", { price: fp }), onSelect: () => void this.copyText(fp) });
      if (inst.studies().length) items.push({ id: "rmstudies", label: t("menu.chart.removeIndicators"), onSelect: () => [...inst.studies()].forEach((s) => this.removeStudy(s.study.id)) });
      if (this.features.settings) items.push({ id: "sep", label: "", separator: true }, { id: "settings", label: t("menu.chart.settings"), onSelect: () => this.openDialog({ kind: "settings" }) });
      void x; void y;
      return items;
    }
    return [{ id: "reset", label: t("menu.chart.reset"), onSelect: () => chart.resetChart() }];
  }

  private seriesHit(inst: ChartInstance, pane: number, y: number): MenuItem[] | null {
    // A study's lines sit on the pane they were drawn in: a click within a few pixels of one of its last values is a hit on the study.
    for (const s of inst.studies()) {
      const out = s.study.series().find((x) => x.options().pane === pane);
      if (!out) continue;
      const last = Object.values(s.study.lastValues()).find((v) => v !== undefined);
      if (last === undefined) continue;
      const py = inst.drawings?.pixelOf(pane, { time: inst.raw.at(inst.raw.length - 1).time, price: last }).y;
      if (py !== undefined && Math.abs(py - y) < 6) return this.studyItems(inst, s.study.id);
    }
    return null;
  }

  studyItems(inst: ChartInstance, id: string): MenuItem[] {
    const s = inst.studies().find((x) => x.study.id === id)!;
    return [
      { id: "settings", label: this.t("menu.series.settings"), onSelect: () => this.openDialog({ kind: "study", id }) },
      { id: "hide", label: s.userHidden ? this.t("common.show") : this.t("menu.series.hide"), onSelect: () => inst.setStudyHidden(id, !s.userHidden) },
      { id: "alert", label: this.t("alerts.create"), disabled: !this.features.alerts, onSelect: () => this.openDialog({ kind: "alert", prefill: { kind: "indicator", studyId: id } }) },
      { id: "sep", label: "", separator: true },
      { id: "remove", label: this.t("menu.series.remove"), danger: true, onSelect: () => this.removeStudy(id) },
    ];
  }

  drawingItems(inst: ChartInstance, d: Drawing): MenuItem[] {
    const p = inst.drawings!;
    const t = (k: Key, v?: MessageValues) => this.t(k, v);
    const canAlert = this.features.alerts && ["trendLine", "ray", "extendedLine", "infoLine", "horizontalLine", "horizontalRay", "parallelChannel"].includes(d.tool);
    return [
      { id: "settings", label: t("menu.drawing.settings"), onSelect: () => this.openDialog({ kind: "drawing", id: d.id }) },
      { id: "clone", label: t("drawing.clone"), onSelect: () => (p.select([d.id]), p.copy([d.id]), p.duplicate()) },
      { id: "sep1", label: "", separator: true },
      { id: "front", label: t("drawing.bringToFront"), onSelect: () => p.bringToFront([d.id]) },
      { id: "forward", label: t("ui.drawing.forward"), onSelect: () => p.bringForward([d.id]) },
      { id: "backward", label: t("ui.drawing.backward"), onSelect: () => p.sendBackward([d.id]) },
      { id: "back", label: t("drawing.sendToBack"), onSelect: () => p.sendToBack([d.id]) },
      { id: "sep2", label: "", separator: true },
      { id: "lock", label: d.locked ? t("common.unlock") : t("common.lock"), onSelect: () => p.update(d.id, { locked: !d.locked }) },
      { id: "hide", label: d.hidden ? t("common.show") : t("common.hide"), onSelect: () => p.update(d.id, { hidden: !d.hidden }) },
      { id: "template", label: t("menu.drawing.template"), onSelect: () => this.openDialog({ kind: "drawing", id: d.id }) },
      ...(canAlert ? [{ id: "alert", label: t("alerts.create"), onSelect: () => this.openDialog({ kind: "alert", prefill: { kind: "drawing", drawingId: d.id } }) }] : []),
      { id: "sep3", label: "", separator: true },
      ...(p.list().filter((x) => x.tool === d.tool).length > 1 ? [{ id: "deleteType", label: t("drawing.removeAllOfTool", { tool: this.toolLabel(d.tool) }), danger: true, onSelect: () => this.removeDrawingsOfTool(d.tool) }] : []),
      { id: "delete", label: t("common.delete"), danger: true, onSelect: () => p.remove([d.id]) },
    ];
  }

  addHorizontalLine(price: number): void {
    const inst = this.current;
    if (!inst.drawings || inst.raw.length === 0) return;
    const t = inst.raw.at(inst.raw.length - 1).time;
    inst.drawings.add({ tool: "horizontalLine", anchors: [{ time: t, price }] });
  }

  async copyText(text: string): Promise<void> {
    try {
      if (!navigator.clipboard) throw new Error(this.t("error.unsupported"));
      await navigator.clipboard.writeText(text);
    } catch (e) {
      this.report(e);
    }
  }

  setTimeZone(tz: string): void {
    for (const i of this.instances) i.chart.applyOptions({ timeZone: tz });
    this.userChanged();
    this.bump();
  }

  // ---- snapshot, fullscreen -----------------------------------------------------------------------------------------------------------

  /** A PNG of the active chart composed from the dashboard's three canvases, cropped to its cell. */
  async snapshot(): Promise<Blob> {
    const inst = this.current;
    const grid = this.gridEl!;
    const canvases = [...grid.querySelectorAll<HTMLCanvasElement>(":scope > canvas")];
    if (canvases.length !== 3) throw new Error(`expected the dashboard's 3 canvases, found ${canvases.length}`);
    // Draw synchronously: a WebGL canvas is only readable in the task that rendered it.
    inst.chart.render(7);
    const gr = grid.getBoundingClientRect(), cr = this.cells[this.active]!.getBoundingClientRect();
    const k = canvases[0]!.width / gr.width;
    const sx = Math.round((cr.left - gr.left) * k), sy = Math.round((cr.top - gr.top) * k);
    const w = Math.round(cr.width * k), h = Math.round(cr.height * k);
    // A header with what the DOM legend shows (symbol, interval, the last bar's values, the indicators): the canvases do not hold it.
    const head = this.options.snapshotHeader === false ? 0 : Math.round(this.snapshotHeaderHeight() * k);
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h + head;
    const ctx = out.getContext("2d");
    if (!ctx) throw new Error(this.t("error.unsupported"));
    if (head > 0) this.drawSnapshotHeader(ctx, w, head, k);
    ctx.save();
    ctx.translate(0, head);
    for (const c of canvases) ctx.drawImage(c, sx, sy, w, h, 0, 0, w, h);
    ctx.restore();
    return new Promise<Blob>((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error("the canvas produced no PNG"))), "image/png"));
  }

  private snapshotHeaderHeight(): number {
    return Math.round(this.theme.fontSize * 3.2);
  }

  /** The text lines of the snapshot header: the title with the time of the last bar, and the last bar's values with the indicators' names. */
  snapshotHeaderText(): { title: string; when: string; values: Array<{ text: string; color: "up" | "down" | "muted" | "text" }> } {
    const inst = this.current;
    const title = `${inst.symbol} · ${this.intervalLabel(inst.interval)}`;
    const n = inst.raw.length;
    if (n === 0) return { title, when: "", values: [] };
    const last = inst.raw.at(n - 1), prev = n > 1 ? inst.raw.at(n - 2) : null;
    const dec = decimalsOf(inst.minMove);
    const f = (v: number) => v.toFixed(dec);
    const when = new Intl.DateTimeFormat(this.i18n.locale, { dateStyle: "medium", timeStyle: isIntraday(inst.interval) ? "short" : undefined, timeZone: this.options.timeZone ?? "UTC" }).format(last.time);
    const up = last.close >= last.open;
    const values: Array<{ text: string; color: "up" | "down" | "muted" | "text" }> = [{ text: `O ${f(last.open)}  H ${f(last.high)}  L ${f(last.low)}  C ${f(last.close)}`, color: up ? "up" : "down" }];
    if (prev && prev.close !== 0) {
      const d = last.close - prev.close;
      values.push({ text: `${d >= 0 ? "+" : "−"}${f(Math.abs(d))} (${d >= 0 ? "+" : "−"}${Math.abs((d / prev.close) * 100).toFixed(2)}%)`, color: d >= 0 ? "up" : "down" });
    }
    const names = inst.studies().filter((s) => !s.userHidden).map((s) => s.study.def.name);
    if (names.length) values.push({ text: names.slice(0, 4).join(" · ") + (names.length > 4 ? ` +${names.length - 4}` : ""), color: "muted" });
    return { title, when, values };
  }

  private drawSnapshotHeader(ctx: CanvasRenderingContext2D, w: number, head: number, k: number): void {
    const th = this.theme, pad = Math.round(10 * k), fs = th.fontSize * k;
    const { title, when, values } = this.snapshotHeaderText();
    ctx.fillStyle = th.background;
    ctx.fillRect(0, 0, w, head);
    ctx.fillStyle = th.border;
    ctx.fillRect(0, head - Math.max(1, Math.round(k)), w, Math.max(1, Math.round(k)));
    ctx.textBaseline = "middle";
    ctx.font = `600 ${fs * 1.15}px ${th.fontFamily}`;
    ctx.fillStyle = th.text;
    ctx.textAlign = "left";
    ctx.fillText(title, pad, head * 0.32);
    ctx.font = `${fs * 0.9}px ${th.fontFamily}`;
    ctx.fillStyle = th.textMuted;
    ctx.textAlign = "right";
    ctx.fillText(when, w - pad, head * 0.32);
    ctx.textAlign = "left";
    ctx.font = `${fs * 0.95}px ${th.fontFamily}`;
    let x = pad;
    for (const v of values) {
      ctx.fillStyle = v.color === "up" ? th.up : v.color === "down" ? th.down : v.color === "muted" ? th.textMuted : th.text;
      ctx.fillText(v.text, x, head * 0.72);
      x += ctx.measureText(v.text).width + 16 * k;
    }
  }

  /**
   * Copy the chart image to the clipboard, ready to paste into a post or a message. The image is made while the clipboard
   * request is open (Safari needs the request made in the click itself), so call this straight from a click handler.
   * A host's `onSnapshot` gets the PNG instead (with "copy"), for pages that cannot reach the clipboard.
   */
  async copySnapshot(): Promise<void> {
    try {
      if (this.options.onSnapshot) {
        this.options.onSnapshot(await this.snapshot(), "copy");
        return;
      }
      const clip = navigator.clipboard;
      if (!clip || typeof clip.write !== "function" || typeof ClipboardItem === "undefined") throw new Error(this.t("snapshot.copy.unsupported"));
      await clip.write([new ClipboardItem({ "image/png": this.snapshot() })]);
      this.toast("info", this.t("snapshot.copied"));
    } catch (e) {
      // A blocked clipboard (no permission, an insecure page) is the user's to know about, with the way out.
      this.report(e instanceof DOMException ? new Error(`${this.t("snapshot.copy.blocked")} (${e.name})`) : e);
    }
  }

  async takeSnapshot(): Promise<void> {
    try {
      const png = await this.snapshot();
      if (this.options.onSnapshot) {
        this.options.onSnapshot(png, "download");
        return;
      }
      const url = URL.createObjectURL(png);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${this.current.symbol.replace(/[^\w.-]+/g, "_")}-${this.current.interval}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      this.report(e);
    }
  }

  async toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement === this.host) await document.exitFullscreen();
      else {
        if (!this.host.requestFullscreen) throw new Error(this.t("error.unsupported"));
        await this.host.requestFullscreen();
      }
    } catch (e) {
      this.report(e);
    }
  }

  // ---- layouts and templates --------------------------------------------------------------------------------------------------------------

  layoutBody(): LayoutBody {
    return {
      grid: this.gridId, active: this.active, sync: { ...this.sync }, theme: this.themeName, customTheme: this.customTheme ? { ...this.customTheme } : null,
      charts: this.instances.map((i) => i.toJSON()),
    };
  }

  applyLayout(body: LayoutBody): void {
    gridPreset(body.grid);
    if (!Array.isArray(body.charts) || body.charts.length === 0) throw new TypeError("layout has no charts");
    this.sync = { ...DEFAULT_SYNC, ...body.sync };
    this.themeName = body.theme;
    this.customTheme = body.customTheme;
    this.resolveTheme();
    const preset = gridPreset(body.grid);
    const seeds = body.charts.map((c) => ({ symbol: c.symbol, interval: c.interval, chartType: "candles" as ChartTypeId }));
    this.buildGrid(preset, seeds);
    this.instances.forEach((inst, i) => {
      const s = body.charts[i];
      if (s) inst.fromJSON(s);
      inst.chart.applyOptions({ theme: this.chartTheme() as never });
    });
    this.active = Math.min(body.active, this.instances.length - 1);
    this.refreshActive();
    this.bump();
  }

  async saveLayout(name: string): Promise<void> {
    try {
      await this.layouts.save(name, this.layoutBody());
      this.layoutName = name.trim();
      this.toast("info", this.t("layout.saved", { name: this.layoutName }));
    } catch (e) {
      this.report(new Error(this.t("error.storage") + ": " + (e instanceof Error ? e.message : String(e))));
    }
  }

  async loadLayout(name: string): Promise<void> {
    try {
      const doc = await this.layouts.load(name);
      this.applyLayout(doc.body);
      this.layoutName = doc.name;
      this.toast("info", this.t("layout.loaded", { name: doc.name }));
    } catch (e) {
      this.report(new Error(this.t("layout.error", { reason: e instanceof Error ? e.message : String(e) })));
    }
  }

  async setAutosave(on: boolean): Promise<void> {
    this.autosave = on;
    this.autosaveSuspended = false;
    try {
      await this.store.save("ui/autosave-on", on);
      if (on) await this.writeAutosave();
    } catch (e) {
      this.report(e);
    }
    this.bump();
  }

  /** A change the user made: it ends a suspension of the autosave (see `autosaveSuspended`) and is saved. */
  private userChanged(): void {
    this.autosaveSuspended = false;
    this.scheduleAutosave();
  }

  private scheduleAutosave(): void {
    if (!this.autosave || this.destroyed || this.autosaveSuspended) return;
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => void this.writeAutosave().catch((e) => this.report(e)), 800);
  }

  private async writeAutosave(): Promise<void> {
    if (this.instances.length === 0) return;
    await this.store.save("ui/autosave", { version: AUTOSAVE_VERSION, savedAt: Date.now(), body: this.layoutBody() } satisfies AutosaveEnvelope);
  }

  templateBody(): TemplateBody {
    const s = this.current.toJSON();
    // A template is applied to other charts: study ids belong to the chart that had them (alerts refer to them), so they are not carried.
    return { chartType: s.chartType, typeParams: s.typeParams, styles: s.styles, studies: s.studies.map(({ id: _id, ...rest }) => rest) };
  }

  async saveTemplate(name: string): Promise<void> {
    try {
      await this.templates.save(name, this.templateBody());
      this.toast("info", this.t("layout.saved", { name: name.trim() }));
    } catch (e) {
      this.report(e);
    }
  }

  async applyTemplate(name: string): Promise<void> {
    try {
      const doc = await this.templates.load(name);
      const inst = this.current;
      const s = inst.toJSON();
      inst.fromJSON({ ...s, chartType: doc.body.chartType, typeParams: doc.body.typeParams, styles: doc.body.styles, studies: doc.body.studies });
      this.toast("info", this.t("layout.loaded", { name: doc.name }));
    } catch (e) {
      this.report(e);
    }
  }

  // ---- script panel -----------------------------------------------------------------------------------------------------------------

  get hasScript(): boolean {
    return this.options.scriptEditor !== undefined;
  }

  toggleScript(): void {
    if (!this.hasScript) return;
    this.scriptOpen = !this.scriptOpen;
    this.bump();
  }

  /** The mounted editor, so diagnostics reach it; set by the script panel. */
  scriptEditorHandle: { setDiagnostics(d: readonly ScriptDiagnostic[]): void } | null = null;
  private scriptRun: { instance: ChartInstance; remove(): void } | null = null;

  /**
   * Run `code` on the active chart. A script that compiles replaces the one
   * running; one that does not leaves the last good plot and shows why.
   */
  runScript(code: string): void {
    this.scriptCode = code;
    this.execScript(code, this.instances[this.active]);
  }

  /** Run `code` on `inst` without touching the panel's text, so a script that is not in the editor never becomes what its Run button runs. */
  private execScript(code: string, inst: ChartInstance | undefined): void {
    const runner = this.options.scriptRunner;
    if (!runner || !inst) return;
    if (!inst.main) {
      this.setScriptDiagnostics([{ line: 1, column: 1, from: 0, to: 0, message: this.t("ui.script.noData"), severity: "error" }]);
      return;
    }
    const r = runner.run({ chart: inst.chart, source: inst.main, volume: inst.volume }, code, (d) => this.setScriptDiagnostics([d]));
    this.setScriptDiagnostics(r.diagnostics);
    if (r.diagnostics.some((d) => d.severity === "error")) return;
    this.scriptRun?.remove();
    this.scriptRun = { instance: inst, remove: () => r.remove() };
  }

  /** Largest script the app stores (the script language refuses more than this anyway). */
  static readonly SCRIPT_MAX = 200_000;

  async saveScript(name: string, code: string): Promise<void> {
    if (!this.hasScript) return;
    if (!code.trim()) throw new Error(this.t("scripts.empty"));
    if (code.length > ChartApp.SCRIPT_MAX) throw new Error(this.t("scripts.tooLong", { max: ChartApp.SCRIPT_MAX }));
    await this.scripts.save(name, { code });
    this.toast("info", this.t("scripts.saved", { name }));
    this.bump();
  }

  /** Put a saved script in the panel (opened), and run it when `run`. */
  async openScript(name: string, run: boolean): Promise<void> {
    const doc = await this.scripts.load(name);
    // Opening replaces the panel's text: ask first when that would lose edits that are not this script.
    if (this.scriptCode.trim() && this.scriptCode !== doc.body.code) {
      this.confirm(this.t("scripts.replaceConfirm", { name }), this.t("scripts.replace"), () => this.applyOpenedScript(doc.body.code, run), true);
      return;
    }
    this.applyOpenedScript(doc.body.code, run);
  }

  private applyOpenedScript(code: string, run: boolean): void {
    this.scriptCode = code;
    this.scriptEpoch++;
    this.scriptOpen = true;
    if (run) this.runScript(code);
    this.closeDialog();
    this.bump();
  }

  private setScriptDiagnostics(d: readonly ScriptDiagnostic[]): void {
    this.scriptDiagnostics = [...d];
    this.scriptEditorHandle?.setDiagnostics(d);
    this.bump();
  }

  // ---- assistant (describe an indicator) ------------------------------------------------------------------------------------------

  get hasAssistant(): boolean {
    return this.options.assistant !== undefined;
  }

  /** The assistant's state, read by the Indicators dialog. `ready` carries a script that compiled, waiting for the user's Add. */
  assistant: { status: "idle" } | { status: "working" } | { status: "ready"; script: string; explanation: string | null; instance: ChartInstance } | { status: "failed"; message: string } = { status: "idle" };
  private assistantAbort: AbortController | null = null;

  /** Ask for a script. Replaces an ask in flight. Nothing reaches the chart until `addAssistantScript`. */
  async askAssistant(prompt: string): Promise<void> {
    const seam = this.options.assistant;
    const inst = this.instances[this.active];
    if (!seam || !inst) return;
    this.assistantAbort?.abort();
    const ac = new AbortController();
    this.assistantAbort = ac;
    this.assistant = { status: "working" };
    this.bump();
    try {
      const r = await seam.ask({ prompt, symbol: inst.symbol, interval: intervalId(inst.interval), signal: ac.signal });
      if (ac.signal.aborted) return;
      if (typeof r?.script !== "string" || !r.script.trim()) throw new Error(this.t("assistant.empty"));
      this.assistant = { status: "ready", script: r.script, explanation: r.explanation ?? null, instance: inst };
    } catch (e) {
      if (ac.signal.aborted) return;
      this.assistant = { status: "failed", message: e instanceof Error ? e.message : String(e) };
      this.report(e);
    } finally {
      if (this.assistantAbort === ac) this.assistantAbort = null;
    }
    this.bump();
  }

  cancelAssistant(): void {
    this.assistantAbort?.abort();
    this.assistantAbort = null;
    this.assistant = { status: "idle" };
    this.bump();
  }

  /** Run the reviewed script like the script panel's Run: it replaces the script now running, and a compile error stays in the panel's diagnostics. */
  addAssistantScript(): void {
    if (this.assistant.status !== "ready") return;
    // The script was written for one chart's symbol and interval: it does not follow the user to another chart.
    if (this.instances[this.active] !== this.assistant.instance) {
      this.assistant = { status: "failed", message: this.t("assistant.chartChanged") };
      this.bump();
      return;
    }
    this.execScript(this.assistant.script, this.assistant.instance);
    if (this.scriptDiagnostics.some((d) => d.severity === "error")) {
      this.assistant = { status: "failed", message: this.scriptDiagnostics.find((d) => d.severity === "error")!.message };
    } else {
      this.announce(this.t("assistant.added"));
      this.assistant = { status: "idle" };
      this.closeDialog();
    }
    this.bump();
  }

  /** Open the script panel on the assistant's script, to edit it before running. */
  editAssistantScript(): void {
    if (this.assistant.status !== "ready" || !this.hasScript) return;
    this.scriptCode = this.assistant.script;
    this.scriptEpoch++; // an open panel remounts on the new text: the editor reads its value only when it mounts
    this.scriptOpen = true;
    this.closeDialog();
  }

  // ---- analyses (auto drawings) -------------------------------------------------------------------------------------------------

  /** Most drawings one analysis may add. */
  static readonly ANALYSIS_MAX = 500;
  analysisBusy: string | null = null;
  private analysisAbort: AbortController | null = null;

  get analyses(): readonly AnalysisEntry[] {
    return this.options.analyses ?? [];
  }

  /** Run one analysis on the active chart and add what it draws as one undo step (all or none). */
  async runAnalysis(id: string): Promise<void> {
    const entry = this.analyses.find((a) => a.id === id);
    const inst = this.instances[this.active];
    if (!entry || !inst || !inst.drawings || this.analysisBusy) return;
    if (inst.raw.length === 0) {
      this.toast("error", this.t("analyses.noBars"));
      return;
    }
    const ac = new AbortController();
    this.analysisAbort = ac;
    this.analysisBusy = id;
    this.bump();
    // What the analysis was asked about: its answer is only drawn if the chart is still showing exactly that.
    const asked = { drawings: inst.drawings, symbol: inst.symbol, interval: inst.interval };
    try {
      // Closed bars only: the newest bar may still be forming, and a swing it confirms could vanish with the next tick.
      const bars = Array.from({ length: Math.max(0, inst.raw.length - 1) }, (_, i) => inst.raw.at(i));
      const r = await entry.run({ symbol: asked.symbol, interval: intervalId(asked.interval), bars, signal: ac.signal });
      if (ac.signal.aborted) return;
      if (inst.isDisposed || inst.drawings !== asked.drawings || inst.symbol !== asked.symbol || inst.interval !== asked.interval) {
        this.toast("info", this.t("analyses.stale", { name: entry.name }));
        return;
      }
      if (!r || !Array.isArray(r.drawings)) throw new Error(`analysis "${id}" must return { drawings: [...] }`);
      if (r.drawings.length > ChartApp.ANALYSIS_MAX) throw new Error(`analysis "${id}" returned ${r.drawings.length} drawings; the limit is ${ChartApp.ANALYSIS_MAX}`);
      const added = asked.drawings!.addMany(r.drawings);
      this.announce(added.length === 0 ? this.t("analyses.none", { name: entry.name }) : this.t("analyses.drew", { name: entry.name, count: added.length }));
    } catch (e) {
      if (!ac.signal.aborted) this.report(e);
    } finally {
      if (this.analysisAbort === ac) this.analysisAbort = null;
      this.analysisBusy = null;
      this.bump();
    }
  }

  // ---- compact layout ----------------------------------------------------------------------------------------------------------------

  drawingSheetOpen = false;

  openDrawingSheet(): void {
    this.drawingSheetOpen = true;
    this.bump();
  }

  closeDrawingSheet(): void {
    this.drawingSheetOpen = false;
    this.bump();
  }

  /** The controls that leave the top bar on a narrow screen. */
  moreItems(): MenuItem[] {
    const f = this.features;
    const t = (k: Key) => this.t(k);
    return [
      ...(f.compare && this.canSearch ? [{ id: "cmp", label: t("toolbar.compare"), onSelect: () => this.openDialog({ kind: "symbol", purpose: "compare" }) }] : []),
      ...(f.layouts ? [{ id: "lay", label: t("toolbar.layout"), onSelect: () => this.openDialog({ kind: "layouts" }) }] : []),
      ...(f.themeSwitcher ? (["inherit", "dark", "light", "high-contrast", "auto"] as ThemeName[]).map((n) => ({ id: `theme-${n}`, label: this.themeLabel(n), checked: this.themeName === n, onSelect: () => this.setTheme(n) })) : []),
      ...(f.localeSwitcher ? [{ id: "loc-en", label: "English", checked: this.locale === "en", onSelect: () => void this.setLocale("en") }, { id: "loc-hi", label: "हिन्दी", checked: this.locale === "hi", onSelect: () => void this.setLocale("hi") }] : []),
      ...(f.snapshot ? [{ id: "snap", label: t("toolbar.snapshot"), onSelect: () => void this.takeSnapshot() }, { id: "snapcopy", label: t("toolbar.snapshotCopy"), onSelect: () => void this.copySnapshot() }] : []),
      ...(f.settings ? [{ id: "set", label: t("toolbar.settings"), onSelect: () => this.openDialog({ kind: "settings" }) }] : []),
      ...(f.fullscreen ? [{ id: "fs", label: t("toolbar.fullscreen"), onSelect: () => void this.toggleFullscreen() }] : []),
    ];
  }

  // ---- lifecycle ----------------------------------------------------------------------------------------------------------------------

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    clearTimeout(this.autosaveTimer);
    for (const off of this.offs) off();
    // The script's worker goes with the app, not with whenever the chart happens to be collected.
    this.scriptRun?.remove();
    this.scriptRun = null;
    this.assistantAbort?.abort();
    this.analysisAbort?.abort();
    for (const i of this.instances) this.syncGroup?.remove(i.chart);
    for (const i of this.instances) i.dispose();
    this.dashboard?.remove();
    this.events.clear();
  }
}

void LocalStorageStore;
