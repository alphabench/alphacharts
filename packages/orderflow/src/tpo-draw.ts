// TPO / market profile drawn over a pane, as a primitive on a series.
//
// Each session's profile starts at its first bar. A row's letters are packed
// from the left in period order; one letter is `periodMs / barMs` bars wide, so
// a profile never runs past the session's own span. Level of detail: letters
// when a cell is at least MIN_LETTER px in both directions, otherwise filled
// blocks (and the profile still shows POC, value area and initial balance).
// Value area rows sit on a tinted band, the POC row is highlighted, single
// prints take the accent colour, the initial balance range is bracketed by two
// dotted lines. `mode: "merged"` draws one composite of the sessions in view
// (counts only) at the right edge instead of one profile per session.

import { crisp, dashPattern, resolveColors, type PaneView, type PanePrimitive, type PrimitiveHost, type Series, type SeriesType } from "@alphacharts/core";
import type { FootprintSource } from "./footprint.js";
import { mergeTpo, periodLetter, tpoSessions, type TpoOptions, type TpoProfile } from "./tpo.js";

export const MIN_LETTER = 7;

export interface TpoDrawOptions extends TpoOptions {
  mode: "split" | "merged";
  textColor: string;
  accentColor: string;
  pocColor: string;
  valueAreaColor: string;
  ibColor: string;
  /** Block width per TPO in merged mode (CSS px). */
  mergedCellPx: number;
}

export class TpoPrimitive implements PanePrimitive {
  private host: PrimitiveHost | null = null;
  private opts: TpoDrawOptions;
  private key = "";
  private cache: TpoProfile[] = [];
  last: { profiles: TpoProfile[]; letters: boolean } = { profiles: [], letters: false };

  constructor(private readonly source: FootprintSource, options: Partial<TpoDrawOptions> = {}) {
    this.opts = { mode: "split", textColor: "#a3a3a3", accentColor: "#a3a3a3", pocColor: "foreground", valueAreaColor: "rgba(163,163,163,0.22)", ibColor: "#737373", mergedCellPx: 6, ...options };
  }

  applyOptions(o: Partial<TpoDrawOptions>): void {
    this.opts = { ...this.opts, ...o };
    this.key = "";
    this.host?.requestRender();
  }
  attached(h: PrimitiveHost): void {
    this.host = h;
  }
  detached(): void {
    this.host = null;
  }

  draw(ctx: CanvasRenderingContext2D, view: PaneView): void {
    const flow = this.source.flow, bars = flow.bars, o = this.opts;
    this.last = { profiles: [], letters: false };
    let a = -1, b = -1;
    for (let i = view.lo; i <= view.hi && a < 0; i++) a = this.source.barAt(i);
    for (let i = view.hi; i >= view.lo && b < 0; i--) b = this.source.barAt(i);
    if (a < 0 || b < a) return;
    const key = `${a}:${b}:${bars.version}:${JSON.stringify(o)}`;
    if (key !== this.key) {
      const t: TpoOptions = {};
      if (o.periodMs !== undefined) t.periodMs = o.periodMs;
      if (o.rowTicks !== undefined) t.rowTicks = o.rowTicks;
      if (o.ibPeriods !== undefined) t.ibPeriods = o.ibPeriods;
      if (o.valueAreaPct !== undefined) t.valueAreaPct = o.valueAreaPct;
      const split = tpoSessions(flow, a, b, t);
      this.cache = o.mode === "merged" ? [mergeTpo(flow, split, t)] : split;
      this.key = key;
    }
    const barMs = bars.clock.periodMs!;
    const period = o.periodMs ?? 1_800_000;
    const spacing = view.x(view.lo + 1) - view.x(view.lo);
    const cell = (period / barMs) * spacing;
    ctx.save();
    for (const p of this.cache) {
      if (p.rowCount === 0) continue;
      this.last.profiles.push(p);
      if (p.merged) this.paintMerged(ctx, view, p);
      else {
        const idx = view.timeToIndex(p.start);
        const first = idx ?? this.firstIndexAfter(view, p.start);
        if (first === undefined) continue;
        this.paintSession(ctx, view, p, view.x(first) - spacing / 2, cell);
      }
    }
    ctx.restore();
  }

  private firstIndexAfter(view: PaneView, start: number): number | undefined {
    for (let i = view.lo; i <= view.hi; i++) {
      const bar = this.source.barAt(i);
      if (bar >= 0 && this.source.flow.bars.start[bar]! >= start) return i;
    }
    return undefined;
  }

  private rowY(view: PaneView, p: TpoProfile, r: number): [number, number] {
    const bars = this.source.flow.bars, tick = p.tickSize;
    const t0 = p.firstTick + r * p.rowTicks;
    const a = view.y(bars.priceOf(t0 + p.rowTicks) - tick / 2), b = view.y(bars.priceOf(t0) - tick / 2);
    return a <= b ? [a, b] : [b, a]; // [top, bottom] as drawn, also on an inverted scale
  }

  private paintSession(ctx: CanvasRenderingContext2D, view: PaneView, p: TpoProfile, x0: number, periodPx: number): void {
    const o = resolveColors(this.opts, view.theme);
    const sample = this.rowY(view, p, 0);
    const rowH = sample[1] - sample[0];
    const letters = periodPx >= MIN_LETTER && rowH >= MIN_LETTER;
    // Letters are about as wide as a row is tall (a period's full width on the time axis when that is narrower);
    // blocks use the period's full width so they read as time on the axis.
    const cell = letters ? Math.min(periodPx, Math.max(MIN_LETTER, rowH)) : periodPx;
    let widest = 0;
    for (let r = 0; r < p.rowCount; r++) widest = Math.max(widest, p.counts[r]!);
    const vh = this.rowY(view, p, p.vaHigh), vl = this.rowY(view, p, p.vaLow);
    const yvT = Math.min(vh[0], vl[0]), yvB = Math.max(vh[1], vl[1]);
    ctx.fillStyle = o.valueAreaColor;
    ctx.fillRect(x0, yvT, widest * cell, yvB - yvT);
    if (letters) this.last.letters = true;
    if (letters) {
      ctx.font = `${Math.min(Math.floor(rowH) - 1, Math.floor(cell) + 2, 14)}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
    }
    const single = new Set<number>();
    for (const [s, e] of p.singlePrints) for (let r = s; r <= e; r++) single.add(r);
    for (let r = 0; r < p.rowCount; r++) {
      if (p.counts[r] === 0) continue;
      const [yT, yB] = this.rowY(view, p, r);
      const isPoc = r === p.poc;
      if (isPoc) {
        ctx.fillStyle = o.pocColor;
        ctx.globalAlpha = 0.25;
        ctx.fillRect(x0, yT, widest * cell, yB - yT);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = single.has(r) ? o.accentColor : o.textColor;
      let j = 0;
      for (let q = 0; q < p.periods; q++) {
        if (!p.has(r, q)) continue;
        if (letters) ctx.fillText(periodLetter(q), x0 + j * cell + cell / 2, (yT + yB) / 2);
        else {
          ctx.globalAlpha = 0.55;
          ctx.fillRect(x0 + j * cell, yT, Math.max(1, cell - (cell > 3 ? 1 : 0)), Math.max(1, yB - yT - (yB - yT > 3 ? 1 : 0)));
          ctx.globalAlpha = 1;
        }
        j++;
      }
    }
    // Initial balance: dotted lines at its high and low across the profile.
    if (!Number.isNaN(p.ibLow)) {
      ctx.strokeStyle = o.ibColor;
      ctx.setLineDash(dashPattern("dotted", 1));
      ctx.lineWidth = 1;
      for (const price of [p.ibHigh + p.tickSize / 2, p.ibLow - p.tickSize / 2]) {
        const y = crisp(view.y(price), view.dpr);
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x0 + (widest + 1) * cell, y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    if (p.approximate) {
      ctx.fillStyle = "#ffb300";
      ctx.font = "11px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText("APPROX: every level of each bar's range counted", Math.max(4, x0), Math.max(14, this.rowY(view, p, p.rowCount - 1)[0] - 2));
    }
  }

  private paintMerged(ctx: CanvasRenderingContext2D, view: PaneView, p: TpoProfile): void {
    const o = resolveColors(this.opts, view.theme);
    const w = o.mergedCellPx;
    for (let r = 0; r < p.rowCount; r++) {
      if (p.counts[r] === 0) continue;
      const [yT, yB] = this.rowY(view, p, r);
      const inVa = r >= p.vaLow && r <= p.vaHigh;
      ctx.fillStyle = r === p.poc ? o.pocColor : inVa ? o.valueAreaColor : o.textColor;
      ctx.globalAlpha = r === p.poc ? 0.85 : inVa ? 1 : 0.35;
      ctx.fillRect(view.width - p.counts[r]! * w, yT, p.counts[r]! * w, Math.max(1, yB - yT - (yB - yT > 3 ? 1 : 0)));
    }
    ctx.globalAlpha = 1;
    if (p.approximate) {
      ctx.fillStyle = "#ffb300";
      ctx.font = "11px system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillText("APPROX: every level of each bar's range counted", view.width - 4, 4);
    }
  }
}

export function attachTpo(series: Series<SeriesType>, source: FootprintSource, options: Partial<TpoDrawOptions> = {}): { primitive: TpoPrimitive; dispose(): void } {
  const primitive = new TpoPrimitive(source, options);
  series.attachPrimitive(primitive);
  return { primitive, dispose: () => series.detachPrimitive(primitive) };
}
