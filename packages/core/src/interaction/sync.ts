// Keeps a set of charts on the same time window and crosshair.
//
// Charts may show different instruments with different bar times, so the
// window is matched by time, not index: the bar at the leader's right edge is
// found in each follower's timeline by binary search, and bar spacing is
// copied. Only views moved by the user propagate ("sync" and "data" moves do
// not), so followers never echo back to the leader.

import type { Chart } from "../chart/chart.js";

export interface SyncOptions {
  time: boolean;
  crosshair: boolean;
}

export class SyncGroup {
  private readonly members = new Map<Chart, (() => void)[]>();
  private readonly opts: SyncOptions;

  constructor(options: Partial<SyncOptions> = {}) {
    this.opts = { time: true, crosshair: true, ...options };
  }

  add(chart: Chart): void {
    if (this.members.has(chart)) return;
    const offs: (() => void)[] = [];
    if (this.opts.time) {
      offs.push(
        chart.on("visibleRangeChange", (e) => {
          if (e.source === "user") this.followTime(chart, e.to);
        }),
      );
    }
    if (this.opts.crosshair) {
      offs.push(
        chart.on("crosshairMove", (e) => {
          if (e.source === "sync") return;
          for (const other of this.members.keys()) {
            if (other.isRemoved) {
              this.remove(other);
              continue;
            }
            if (other === chart) continue;
            if (e.time === undefined) {
              other.setSyncedCrosshair(null);
              continue;
            }
            other.setSyncedCrosshair(other.timeline.indexAtOrBefore(e.time) ?? null);
          }
        }),
      );
    }
    this.members.set(chart, offs);
  }

  remove(chart: Chart): void {
    for (const off of this.members.get(chart) ?? []) off();
    this.members.delete(chart);
  }

  private followTime(leader: Chart, right: number): void {
    const ltl = leader.timeline;
    if (ltl.length === 0) return;
    const i = Math.max(ltl.first, Math.min(ltl.end - 1, Math.floor(right)));
    const t = ltl.timeAt(i);
    const frac = right - i;
    const spacing = leader.time.spacing;
    for (const other of this.members.keys()) {
      if (other.isRemoved) {
        this.remove(other);
        continue;
      }
      if (other === leader) continue;
      // The follower's bar containing t; before its first bar, its first bar.
      const tl = other.timeline;
      if (tl.length === 0) continue;
      const j = tl.indexAtOrBefore(t) ?? tl.first;
      other.viewChanged(() => {
        other.time.spacing = spacing;
        other.time.setRight(j + frac);
      }, "sync");
    }
  }
}
