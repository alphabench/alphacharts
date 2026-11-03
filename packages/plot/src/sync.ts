// Keep plots on the same x: crosshair always, zoom optionally.

import type { Plot } from "./plot.js";

export interface SyncOptions {
  /** Share the zoomed x range. Default true. */
  view?: boolean;
}

export class PlotSyncGroup {
  private readonly members = new Map<Plot, (() => void)[]>();
  constructor(private readonly opts: SyncOptions = {}) {}

  add(plot: Plot): this {
    if (this.members.has(plot)) return this;
    const others = () => [...this.members.keys()].filter((p) => p !== plot);
    const offs = [
      plot.on("crosshair", (e) => others().forEach((p) => p.crosshairTo(e.key))),
      plot.on("dispose", () => this.remove(plot)),
    ];
    if (this.opts.view !== false) {
      offs.push(plot.on("view", (e) => others().forEach((p) => p.setView(e.domain, true))));
      const current = [...this.members.keys()][0]?.getView();
      if (current !== undefined) plot.setView(current, true);
    }
    this.members.set(plot, offs);
    return this;
  }

  remove(plot: Plot): this {
    this.members.get(plot)?.forEach((off) => off());
    this.members.delete(plot);
    return this;
  }

  /** Detach every plot (the plots themselves stay). */
  dispose(): void {
    for (const p of [...this.members.keys()]) this.remove(p);
  }
}
