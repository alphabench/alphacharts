// A stand-in for @alphacharts/core. The real chart needs WebGL2 and
// ResizeObserver, which jsdom lacks, and these tests are about the wrapper:
// what it creates, when it calls core, and that it releases everything. The
// fake records every call and counts live listeners. Real core is exercised
// by the SSR test (no mock) and by the browser tests in bench/.

type Fn = (e: never) => void;

export const stats = {
  charts: [] as FakeChart[],
  dashboards: [] as FakeDashboard[],
  groups: [] as FakeSyncGroup[],
  reset(): void {
    this.charts = [];
    this.dashboards = [];
    this.groups = [];
  },
  liveCharts: (): number => stats.charts.filter((c) => !c.removed).length,
  listeners: (): number => stats.charts.reduce((n, c) => n + c.listenerCount(), 0),
};

export class FakePriceLine {
  applied: Record<string, unknown>[] = [];
  constructor(public options: Record<string, unknown>) {}
  applyOptions(o: Record<string, unknown>): void {
    this.applied.push(o);
    this.options = { ...this.options, ...o };
  }
}

export class FakeSeries {
  calls: [string, unknown?][] = [];
  removed = false;
  lines: FakePriceLine[] = [];
  constructor(readonly type: string, public given: Record<string, unknown>) {}
  /** Core resolves defaults; the fake resolves just the two the wrappers read. */
  options(): Record<string, unknown> {
    return { priceScaleId: "right", pane: 0, ...this.given };
  }
  setData(d: unknown): void {
    this.calls.push(["setData", d]);
  }
  update(b: unknown): void {
    this.calls.push(["update", b]);
  }
  applyOptions(o: Record<string, unknown>): void {
    this.calls.push(["applyOptions", o]);
    this.given = { ...this.given, ...o };
  }
  count(name: string): number {
    return this.calls.filter((c) => c[0] === name).length;
  }
}

export class FakeChart {
  removed = false;
  element: HTMLElement;
  applied: Record<string, unknown>[] = [];
  series: FakeSeries[] = [];
  private readonly listeners = new Map<string, Set<Fn>>();
  range = { from: 1, to: 2 };

  constructor(readonly container: HTMLElement, public options: Record<string, unknown> = {}) {
    this.element = document.createElement("div");
    this.element.className = "fake-chart";
    container.appendChild(this.element);
    stats.charts.push(this);
  }
  get isRemoved(): boolean {
    return this.removed;
  }
  applyOptions(o: Record<string, unknown>): void {
    this.applied.push(o);
  }
  on(type: string, fn: Fn): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn);
    return () => void set.delete(fn);
  }
  emit(type: string, e: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) (fn as (e: unknown) => void)(e);
  }
  listenerCount(type?: string): number {
    if (type) return this.listeners.get(type)?.size ?? 0;
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }
  timeScale = { getVisibleLogicalRange: () => this.range };
  addSeries(type: string, options: Record<string, unknown> = {}): FakeSeries {
    const s = new FakeSeries(type, options);
    this.series.push(s);
    return s;
  }
  /** Every applyOptions made on a price scale, keyed "pane:id". */
  scaleCalls: [string, Record<string, unknown>][] = [];
  priceScale(id: string, pane = 0): { applyOptions(o: Record<string, unknown>): void } {
    return { applyOptions: (o) => void this.scaleCalls.push([`${pane}:${id}`, o]) };
  }
  removeSeries(s: FakeSeries): void {
    if (this.removed) throw new Error("removeSeries on a removed chart");
    s.removed = true;
  }
  createPriceLine(s: FakeSeries, o: Record<string, unknown>): FakePriceLine {
    const l = new FakePriceLine(o);
    s.lines.push(l);
    return l;
  }
  removePriceLine(s: FakeSeries, l: FakePriceLine): void {
    if (this.removed) throw new Error("removePriceLine on a removed chart");
    s.lines = s.lines.filter((x) => x !== l);
  }
  remove(): void {
    if (this.removed) return;
    this.removed = true;
    this.listeners.clear();
    this.element.remove();
  }
}

export class FakeDashboard {
  removed = false;
  charts: FakeChart[] = [];
  constructor(readonly container: HTMLElement, public options: Record<string, unknown> = {}) {
    stats.dashboards.push(this);
  }
  addChart(cell: HTMLElement, o: Record<string, unknown> = {}): FakeChart {
    if (!this.container.contains(cell)) throw new Error("cell outside the dashboard");
    const c = new FakeChart(cell, o);
    this.charts.push(c);
    return c;
  }
  remove(): void {
    if (this.removed) return;
    this.removed = true;
    for (const c of this.charts) c.remove();
  }
}

export class FakeSyncGroup {
  members = new Set<FakeChart>();
  constructor(readonly options: Record<string, unknown> = {}) {
    stats.groups.push(this);
  }
  add(c: FakeChart): void {
    this.members.add(c);
  }
  remove(c: FakeChart): void {
    this.members.delete(c);
  }
}

export const createChart = (el: HTMLElement, o?: Record<string, unknown>): FakeChart => new FakeChart(el, o);
export { FakeDashboard as Dashboard, FakeSyncGroup as SyncGroup };
