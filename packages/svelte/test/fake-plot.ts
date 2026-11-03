// A stand-in for @alphacharts/plot: the real plot needs a 2D canvas and
// ResizeObserver, which jsdom lacks. These tests are about the wrapper: what it
// creates, when it updates, that it joins sync groups and releases everything.

type Fn = (e: never) => void;

export const plots = {
  all: [] as FakePlot[],
  groups: [] as FakeGroup[],
  reset(): void {
    this.all = [];
    this.groups = [];
  },
  live: (): number => plots.all.filter((p) => !p.disposed).length,
  listeners: (): number => plots.all.reduce((n, p) => n + [...p.handlers.values()].reduce((m, s) => m + s.size, 0), 0),
};

export class FakePlot {
  disposed = false;
  updates: unknown[] = [];
  handlers = new Map<string, Set<Fn>>();
  constructor(readonly element: HTMLElement, public spec: unknown) {
    plots.all.push(this);
    element.classList.add("fake-plot");
  }
  update(s: unknown): void {
    this.updates.push(s);
    this.spec = s;
  }
  on(type: string, fn: Fn): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }
  emit(type: string, e: unknown): void {
    for (const f of [...(this.handlers.get(type) ?? [])]) (f as (e: unknown) => void)(e);
  }
  dispose(): void {
    this.disposed = true;
    this.element.classList.remove("fake-plot");
  }
}

export class FakeGroup {
  members: FakePlot[] = [];
  constructor(readonly opts: unknown = {}) {
    plots.groups.push(this);
  }
  add(p: FakePlot): this {
    this.members.push(p);
    return this;
  }
  remove(p: FakePlot): this {
    this.members = this.members.filter((m) => m !== p);
    return this;
  }
}

export const createPlot = (el: HTMLElement, spec: unknown): FakePlot => new FakePlot(el, spec);
export const PlotSyncGroup = FakeGroup;
