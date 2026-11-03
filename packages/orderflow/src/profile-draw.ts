// Volume profile drawn over a pane, as a primitive on a series (it uses that
// series' price scale). Three modes:
//   session  one profile per session in view, anchored at the session's first bar
//   visible  the bars in view, anchored to the right edge; recomputed as the view
//            moves, incrementally (VisibleProfile)
//   fixed    a time + price anchored box (FixedRange), anchored at its left edge
// Each row shows buy (up) and sell (down) volume side by side in one bar, with
// unknown-side volume as a third segment in grey; rows inside the value area are
// drawn stronger. POC is a line across the profile, HVN solid and LVN dotted
// ticks past its edge. A profile built from bars (no trades) is labelled.

import { crisp, dashPattern, parseColor, type Chart, type PaneView, type PanePrimitive, type PrimitiveHost, type Series, type SeriesType } from "@alphacharts/core";
import type { FootprintSource } from "./footprint.js";
import { SessionProfiles, VisibleProfile, fixedRangeProfile, type FixedRange, type Profile, type ProfileOptions } from "./profile.js";
import { volumeText } from "./footprint-layout.js";

export type ProfileMode = "session" | "visible" | "fixed";

export interface VolumeProfileOptions extends ProfileOptions {
  mode: ProfileMode;
  /** Longest row as a fraction of the room available (session span / pane width / box width). */
  widthFraction: number;
  /** ... but never wider than this many CSS px (a session can be thousands of px wide when zoomed in). */
  maxWidthPx: number;
  /** Required for mode "fixed". */
  range?: FixedRange;
  buyColor: string;
  sellColor: string;
  unknownColor: string;
  pocColor: string;
  textColor: string;
  /** Rows are never drawn thinner than this many CSS px: ticks are merged to fit unless rowTicks/rows is set. */
  minRowPx: number;
}

export class VolumeProfilePrimitive implements PanePrimitive {
  private host: PrimitiveHost | null = null;
  private opts: VolumeProfileOptions;
  private sessions: SessionProfiles | null = null;
  private visible: VisibleProfile | null = null;
  private fixedKey = "";
  private fixed: Profile | null = null;
  /** What the last draw computed (read by tests and the playground). */
  last: { profiles: Profile[] } = { profiles: [] };

  constructor(private readonly source: FootprintSource, options: Partial<VolumeProfileOptions> & { mode: ProfileMode }) {
    this.opts = { widthFraction: 0.35, maxWidthPx: 160, buyColor: "#26a69a", sellColor: "#ef5350", unknownColor: "#8b909a", pocColor: "#ffc107", textColor: "#d1d4dc", minRowPx: 2, ...options };
    this.check();
  }

  private check(): void {
    if (this.opts.mode === "fixed" && !this.opts.range) throw new TypeError("orderflow: a fixed-range volume profile needs `range`");
    if (this.opts.mode === "session" && !this.source.flow.bars.sessions) throw new TypeError("orderflow: session profiles need `sessions` on the OrderFlow");
    if (!(this.opts.widthFraction > 0 && this.opts.widthFraction <= 1) || !(this.opts.maxWidthPx > 0)) throw new RangeError("orderflow: widthFraction must be in (0, 1] and maxWidthPx positive");
  }

  applyOptions(o: Partial<VolumeProfileOptions>): void {
    this.opts = { ...this.opts, ...o };
    this.check();
    this.sessions = null;
    this.visible = null;
    this.fixedKey = "";
    this.host?.requestRender();
  }

  attached(host: PrimitiveHost): void {
    this.host = host;
  }
  detached(): void {
    this.host = null;
  }

  private profileOptions(view: PaneView): ProfileOptions {
    const o = this.opts;
    const out: ProfileOptions = {};
    if (o.valueAreaPct !== undefined) out.valueAreaPct = o.valueAreaPct;
    if (o.hvnFraction !== undefined) out.hvnFraction = o.hvnFraction;
    if (o.lvnFraction !== undefined) out.lvnFraction = o.lvnFraction;
    if (o.peakWindow !== undefined) out.peakWindow = o.peakWindow;
    if (o.rows !== undefined) out.rows = o.rows;
    else if (o.rowTicks !== undefined) out.rowTicks = o.rowTicks;
    else {
      const tick = this.source.flow.bars.tickSize;
      const ref = view.price(view.height / 2);
      const px = Math.abs(view.y(ref + tick) - view.y(ref));
      out.rowTicks = Math.max(1, Math.ceil(o.minRowPx / Math.max(px, 1e-9)));
    }
    return out;
  }

  /** Flow bar rows of the first and last bars in view, or null. */
  private rowsInView(view: PaneView): [number, number] | null {
    let a = -1, b = -1;
    for (let i = view.lo; i <= view.hi && a < 0; i++) a = this.source.barAt(i);
    for (let i = view.hi; i >= view.lo && b < 0; i--) b = this.source.barAt(i);
    return a >= 0 && b >= a ? [a, b] : null;
  }

  draw(ctx: CanvasRenderingContext2D, view: PaneView): void {
    const flow = this.source.flow, bars = flow.bars;
    const o = this.opts;
    const rows = this.rowsInView(view);
    this.last = { profiles: [] };
    if (!rows || bars.length === 0) return;
    const po = this.profileOptions(view);
    ctx.save();
    ctx.font = "11px system-ui, sans-serif";
    if (o.mode === "session") {
      (this.sessions ??= new SessionProfiles(flow, po)).setOptions(po);
      for (const s of this.sessions.range(rows[0], rows[1])) {
        const xi0 = view.timeToIndex(bars.start[s.firstBar]!), xi1 = view.timeToIndex(bars.start[s.lastBar]!);
        if (xi0 === undefined || xi1 === undefined) continue;
        const x0 = view.x(xi0) - (view.x(xi0 + 1) - view.x(xi0)) / 2, x1 = view.x(xi1) + (view.x(xi1 + 1) - view.x(xi1)) / 2;
        this.paint(ctx, view, s.profile, x0, Math.min(o.maxWidthPx, Math.max(1, (x1 - x0) * o.widthFraction)), "right");
      }
    } else if (o.mode === "visible") {
      (this.visible ??= new VisibleProfile(flow, po)).setOptions(po);
      const p = this.visible.update(rows[0], rows[1]);
      this.paint(ctx, view, p, view.width, Math.min(o.maxWidthPx, view.width * o.widthFraction), "left");
    } else {
      const r = o.range!;
      const key = `${r.from}:${r.to}:${r.priceLow}:${r.priceHigh}:${bars.version}:${JSON.stringify(po)}`;
      if (key !== this.fixedKey) {
        this.fixed = fixedRangeProfile(flow, r, po);
        this.fixedKey = key;
      }
      const x0 = view.x(this.source.logical(r.from)), x1 = view.x(this.source.logical(r.to));
      const yh = r.priceHigh === undefined ? undefined : view.y(r.priceHigh + bars.tickSize / 2), yl = r.priceLow === undefined ? undefined : view.y(r.priceLow - bars.tickSize / 2);
      // Higher prices are lower on screen on an inverted scale: take the edges as drawn. An open end is the pane's edge on the side prices run off to.
      const inv = yh !== undefined && yl !== undefined ? yh > yl : view.y(view.price(0) + 1) > view.y(view.price(0));
      const yTop = inv ? (yl ?? 0) : (yh ?? 0), yBot = inv ? (yh ?? view.height) : (yl ?? view.height);
      ctx.strokeStyle = o.pocColor;
      ctx.globalAlpha = 0.6;
      ctx.setLineDash(dashPattern("dashed", 1));
      ctx.strokeRect(crisp(x0, view.dpr), crisp(yTop, view.dpr), x1 - x0, yBot - yTop);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      this.paint(ctx, view, this.fixed!, x0, Math.min(o.maxWidthPx, Math.max(1, (x1 - x0) * o.widthFraction)), "right");
    }
    ctx.restore();
  }

  /** Draw one profile; `dir` right grows rightward from `anchor`, left grows leftward. */
  private paint(ctx: CanvasRenderingContext2D, view: PaneView, p: Profile, anchor: number, room: number, dir: "right" | "left"): void {
    this.last.profiles.push(p);
    if (p.rowCount === 0) return;
    const o = this.opts, tick = p.tickSize, sgn = dir === "right" ? 1 : -1;
    let max = 0;
    for (let i = 0; i < p.rowCount; i++) if (p.total[i]! > max) max = p.total[i]!;
    const buy = parseColor(o.buyColor), sell = parseColor(o.sellColor), unk = parseColor(o.unknownColor);
    const rgb = (c: number, a: number) => `rgba(${c >>> 24},${(c >>> 16) & 255},${(c >>> 8) & 255},${a})`;
    const edgeY = (tickIdx: number) => view.y(this.source.flow.bars.priceOf(tickIdx) - tick / 2);
    for (let i = 0; i < p.rowCount; i++) {
      if (p.total[i]! === 0) continue;
      const t0 = p.firstTick + i * p.rowTicks;
      // Top and bottom as drawn: an inverted scale puts the row's upper price edge lower.
      const ea = edgeY(t0 + p.rowTicks), eb = edgeY(t0);
      const yT = Math.min(ea, eb), yB = Math.max(ea, eb);
      const h = Math.max(1, yB - yT - (yB - yT > 4 ? 1 : 0));
      const inVa = i >= p.vaLow && i <= p.vaHigh;
      const a = inVa ? 0.7 : 0.3;
      const scale = room / max;
      let x = anchor;
      for (const [v, c] of [[p.sell[i]!, sell], [p.buy[i]!, buy], [p.unknown[i]!, unk]] as const) {
        const w = v * scale;
        if (w <= 0) continue;
        ctx.fillStyle = rgb(c, a);
        ctx.fillRect(sgn > 0 ? x : x - w, yT, w, h);
        x += sgn * w;
      }
    }
    // POC line, HVN solid ticks, LVN dotted ticks.
    const line = (i: number, style: "solid" | "dotted", color: string, extra: number) => {
      const t0 = p.firstTick + i * p.rowTicks;
      const y = crisp((edgeY(t0) + edgeY(t0 + p.rowTicks)) / 2, view.dpr);
      ctx.strokeStyle = color;
      ctx.setLineDash(dashPattern(style, 1));
      ctx.beginPath();
      ctx.moveTo(anchor, y);
      ctx.lineTo(anchor + sgn * (room * (p.total[i]! / max) + extra), y);
      ctx.stroke();
    };
    ctx.lineWidth = 1;
    for (const i of p.hvn) line(i, "solid", rgb(buy, 0.9), 12);
    for (const i of p.lvn) line(i, "dotted", rgb(sell, 0.9), 12);
    line(p.poc, "solid", o.pocColor, 16);
    ctx.setLineDash([]);
    // Label: POC and value area; unknown volume is never folded into a side, so it is named.
    const bars = this.source.flow.bars;
    const yTop = Math.min(edgeY(p.firstTick + p.rowCount * p.rowTicks), edgeY(p.firstTick));
    ctx.fillStyle = o.textColor;
    ctx.textBaseline = "top";
    const fmt = (price: number) => view.formatPrice(price);
    const lines = [
      `POC ${fmt(p.rowPrice(p.poc))}`,
      `VA ${fmt(p.rowPrice(p.vaLow))} - ${fmt(p.rowTopPrice(p.vaHigh))}`,
      p.approximate ? `vol ${volumeText(p.sum.total, false)} (no sides)` : `vol ${volumeText(p.sum.total, false)}  delta ${p.sum.delta > 0 ? "+" : ""}${volumeText(p.sum.delta, false)}`,
      ...(!p.approximate && p.sum.unknown > 0 ? [`unknown side ${volumeText(p.sum.unknown, false)}`] : []),
      ...(p.approximate ? ["APPROX: from bars, not trades"] : []),
    ];
    void bars;
    // Above the profile when there is room, else stacked from the top of the pane.
    const y0 = Math.max(2, yTop - 4 - lines.length * 13);
    const textW = Math.max(...lines.map((s) => ctx.measureText(s).width));
    ctx.textAlign = "left";
    // Keep the whole label inside the pane (a profile at the edge would be clipped).
    const lx = Math.max(4, Math.min(dir === "right" ? anchor + 4 : anchor - 4 - textW, view.width - textW - 4));
    lines.forEach((s, k) => ctx.fillText(s, lx, y0 + k * 13));
  }
}

export function attachVolumeProfile(_chart: Chart, series: Series<SeriesType>, source: FootprintSource, options: Partial<VolumeProfileOptions> & { mode: ProfileMode }): { primitive: VolumeProfilePrimitive; dispose(): void } {
  const primitive = new VolumeProfilePrimitive(source, options);
  series.attachPrimitive(primitive);
  return { primitive, dispose: () => series.detachPrimitive(primitive) };
}
