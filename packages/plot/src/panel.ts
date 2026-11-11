// One panel: the scales, the axes and the plot area for a prepared set of
// marks inside a rectangle. A plot has one panel, or one per facet cell.

import { crisp, type WatermarkOptions } from "@alphacharts/core";
import { makeColorScale, type ColorScale } from "./color.js";
import { Fmt, tickStep } from "./format.js";
import {
  defaultBarWidth, isBandKind, extents, visible, type AxisKind, type Extents, type PBar, type PCandle, type PHeat, type PMark, type PScatter, type PTree, type Prepared,
} from "./model.js";
import { BandScale, type BandOptions, LinearScale, LogScale, niceDomain, TimeScale, type ContinuousScale } from "./scale.js";
import type { AxesSpec, AxisSpec, ColorScaleSpec, ScalesSpec, TooltipSpec, YAxisId } from "./spec.js";
import type { PlotTheme } from "./theme.js";
import type { PlotMessages } from "./messages.js";
import { sidesOf, type Padding } from "./validate.js";

export type PosScale = ContinuousScale | BandScale;
export const isBand = (s: PosScale): s is BandScale => s instanceof BandScale;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AxisTick {
  pos: number;
  label: string;
}
export interface AxisModel {
  id: "x" | "y" | "y2";
  scale: PosScale;
  ticks: AxisTick[];
  title: string | undefined;
  grid: boolean;
  line: boolean;
  /** Draw the tick marks. */
  tickMarks: boolean;
  /** Which side of the plot area a y axis is on (the x axis is at the bottom). */
  side: "left" | "right";
  /** Draw the tick labels (facets share them). */
  labels: boolean;
  /** Distance between the first two tick values (see `tickStep`): the step a `tickFormat` is told. */
  step: number;
}

export interface PanelOptions {
  prepared: Prepared;
  theme: PlotTheme;
  fmt: Fmt;
  scales: ScalesSpec | undefined;
  axes: AxesSpec | undefined;
  msg: PlotMessages;
  /** Facet cell title, drawn above the plot area. */
  title?: string | undefined;
  /** `spec.padding`; undefined keeps the built-in margins. */
  padding?: Padding | undefined;
  /** The mark to draw in this panel's plot area; absent on a panel that carries none. */
  watermark?: WatermarkOptions | undefined;
  /** `spec.tooltip.title`. */
  tooltipTitle?: TooltipSpec["title"] | undefined;
}

export interface LayoutFlags {
  view: readonly [number, number] | null;
  xLabels: boolean;
  yLabels: boolean;
  /** Extents to scale to instead of this panel's own (facet cells that share an axis). */
  ext?: Extents | undefined;
}

const PAD = 8;

export class Panel {
  rect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  area: Rect = { x: 0, y: 0, w: 0, h: 0 };
  sx!: PosScale;
  sy!: PosScale;
  sy2: ContinuousScale | undefined;
  axes: AxisModel[] = [];
  ext!: Extents;
  /** Colour scale of each heatmap / treemap / coloured scatter mark. */
  readonly colors = new Map<PMark, ColorScale>();
  private widths = new Map<string, number>();

  constructor(readonly o: PanelOptions) {}

  get prepared(): Prepared {
    return this.o.prepared;
  }
  get theme(): PlotTheme {
    return this.o.theme;
  }
  get font(): string {
    return `${this.theme.fontSize}px ${this.theme.fontFamily}`;
  }

  textWidth(ctx: CanvasRenderingContext2D, s: string, font: string = this.font): number {
    const k = `${font}|${s}`;
    let w = this.widths.get(k);
    if (w === undefined) {
      if (this.widths.size > 2000) this.widths.clear();
      ctx.font = font;
      w = ctx.measureText(s).width;
      this.widths.set(k, w);
    }
    return w;
  }

  /** Domain extents of the visible marks (with the zoomed x range applied to y). */
  computeExtents(view: readonly [number, number] | null): Extents {
    return (this.ext = extents(this.o.prepared, view as [number, number] | null));
  }

  private continuousDomain(axis: "x" | "y" | "y2", kind: AxisKind, e: Extents, count: number, view: readonly [number, number] | null): [number, number] {
    const spec = this.o.scales?.[axis] as { domain?: readonly [number, number]; nice?: boolean; zero?: boolean; pad?: number } | undefined;
    if (spec?.domain) {
      if (!(spec.domain[0] < spec.domain[1])) throw new RangeError(`alphacharts: scales.${axis}.domain [${spec.domain[0]}, ${spec.domain[1]}] must increase`);
      return [spec.domain[0], spec.domain[1]];
    }
    if (axis === "x" && view) return [view[0], view[1]];
    let [lo, hi] = e[axis] ?? (kind === "log" ? [1, 10] : [0, 1]);
    if ((spec?.zero ?? e.zero[axis]) && kind !== "log") {
      lo = Math.min(lo, 0);
      hi = Math.max(hi, 0);
    }
    const pad = spec?.pad ?? (e.padScatter && !e.zero[axis] ? 0.04 : 0);
    if (pad > 0 && kind !== "log") {
      const span = hi - lo || Math.abs(hi) || 1;
      lo -= span * pad;
      hi += span * pad;
    }
    if (kind === "log") {
      if (!(lo > 0)) throw new RangeError(`alphacharts: scales.${axis} is logarithmic but the data reaches ${lo}; values must be positive`);
      const base = (this.o.scales?.[axis] as { base?: number } | undefined)?.base ?? 10;
      if (spec?.nice ?? axis !== "x") {
        lo = base ** Math.floor(Math.log(lo) / Math.log(base) + 1e-12);
        hi = base ** Math.ceil(Math.log(hi) / Math.log(base) - 1e-12);
      }
      if (lo === hi) hi = lo * base;
      return [lo, hi];
    }
    const nice = spec?.nice ?? (axis !== "x" && kind !== "time");
    if (nice) return niceDomain(lo, hi, count);
    if (lo === hi) {
      const d = lo === 0 ? 1 : Math.abs(lo) * 0.05;
      return [lo - d, hi + d];
    }
    return [lo, hi];
  }

  private continuous(kind: AxisKind, axis: "x" | "y" | "y2", domain: [number, number], range: [number, number]): ContinuousScale {
    const spec = this.o.scales?.[axis] as { reverse?: boolean; base?: number; timeZone?: string } | undefined;
    const r: [number, number] = spec?.reverse ? [range[1], range[0]] : range;
    if (kind === "log") return new LogScale(domain, r, spec?.base);
    if (kind === "time") return new TimeScale(domain, r, this.o.fmt.tz);
    return new LinearScale(domain, r);
  }

  private band(kind: "band" | "point", axis: "x" | "y", cats: readonly string[], range: [number, number]): BandScale {
    const spec = this.o.scales?.[axis] as { domain?: readonly string[]; padding?: number; paddingInner?: number; reverse?: boolean } | undefined;
    const heat = this.o.prepared.marks.some((m) => m.type === "heatmap" && !m.hidden);
    const domain = spec?.domain ?? cats;
    const opts: BandOptions = { paddingInner: spec?.paddingInner ?? (heat ? 0 : 0.2) };
    const outer = spec?.padding ?? (heat ? 0 : undefined);
    if (outer !== undefined) opts.paddingOuter = outer;
    return new BandScale(domain, range, opts, kind, spec?.reverse === true);
  }

  /** Compute scales, tick labels and the plot area inside `rect`. */
  layout(ctx: CanvasRenderingContext2D, rect: Rect, f: LayoutFlags): void {
    const th = this.theme, fmt = this.o.fmt, p = this.o.prepared;
    this.rect = rect;
    const own = this.computeExtents(f.view);
    const e = f.ext ?? own;
    this.ext = e;
    this.colors.clear();
    this.buildColorScales(e);
    this.axes = [];
    const fs = th.fontSize;
    const title = this.o.title ? fs + 8 : 0;

    const pad = this.o.padding;
    if (p.noAxes) {
      const l = pad?.left ?? PAD, r = pad?.right ?? PAD, t = pad?.top ?? PAD, b = pad?.bottom ?? PAD;
      this.area = { x: rect.x + l, y: rect.y + t + title, w: Math.max(0, rect.w - l - r), h: Math.max(0, rect.h - t - b - title) };
      return;
    }

    const ax = (id: "x" | "y" | "y2"): AxisSpec | false | undefined => this.o.axes?.[id];
    const showX = ax("x") !== false, showY = ax("y") !== false;
    // A hidden y2 axis keeps its scale: the marks drawn on it stay on it.
    const hasY2 = this.hasY2();
    const showY2 = ax("y2") !== false && hasY2;
    const sides = sidesOf(this.o.axes);
    const xTitle = ax("x") ? (ax("x") as AxisSpec).label : undefined;
    const yTitle = ax("y") ? (ax("y") as AxisSpec).label : undefined;
    const y2Title = ax("y2") ? (ax("y2") as AxisSpec).label : undefined;

    const bottom = showX ? (pad?.bottom ?? 0) + (f.xLabels ? fs + 12 : 6) + (xTitle ? fs + 6 : 0) : (pad?.bottom ?? PAD);
    const top = (pad?.top ?? PAD) + title;
    const h = Math.max(1, rect.h - top - bottom);
    const yBand = isBandKind(p.yKind);
    const countY = Math.max(2, Math.floor(h / 36));

    // Vertical scales first: their label widths set the side margins. Their pixel
    // range does not depend on the margins, so these are the final scales.
    const prelim: Rect = { x: rect.x + 40, y: rect.y + top, w: Math.max(1, rect.w - 60), h };
    const yRange: [number, number] = yBand ? [prelim.y, prelim.y + h] : [prelim.y + h, prelim.y];
    this.sy = isBandKind(p.yKind)
      ? this.band(p.yKind as "band" | "point", "y", e.yCats, yRange)
      : this.continuous(p.yKind, "y", this.continuousDomain("y", p.yKind, e, countY, null), yRange);
    this.sy2 = hasY2 ? this.continuous(p.y2Kind, "y2", this.continuousDomain("y2", p.y2Kind, e, countY, null), yRange) : undefined;

    const yAxis = showY ? this.makeAxis("y", this.sy, countY, h, f.yLabels, undefined, sides.y) : undefined;
    const y2Axis = this.sy2 && showY2 ? this.makeAxis("y2", this.sy2, countY, h, f.yLabels, undefined, sides.y2) : undefined;
    const labelW = (a: AxisModel | undefined) => {
      if (!a || !a.labels) return 0;
      const fixed = (this.o.axes?.[a.id] as AxisSpec | undefined)?.width;
      return fixed !== undefined ? fixed : Math.min(180, Math.max(0, ...a.ticks.map((t) => this.textWidth(ctx, t.label)))) + 10;
    };
    // A fixed `width` is the whole gutter (labels and title); otherwise the measured labels plus the title.
    const gutter = (a: AxisModel | undefined, title: string | undefined, lead: number): number => {
      const fixed = a ? (this.o.axes?.[a.id] as AxisSpec | undefined)?.width : undefined;
      return fixed !== undefined ? fixed : lead + (title ? fs + 6 : 0) + 2;
    };
    const yLead = f.yLabels ? labelW(yAxis) : 6;
    const sideMargin = (side: "left" | "right"): number => {
      const hasPad = pad !== undefined;
      const base = pad ? pad[side] : 0;
      if (yAxis && sides.y === side) return base + gutter(yAxis, yTitle, yLead);
      if (y2Axis && sides.y2 === side) return base + gutter(y2Axis, y2Title, labelW(y2Axis));
      return hasPad ? base : side === "left" ? PAD : 14;
    };
    const left = sideMargin("left");
    const right = sideMargin("right");
    const w = Math.max(1, rect.w - left - right);
    this.area = { x: rect.x + left, y: rect.y + top, w, h };

    const xr: [number, number] = [this.area.x, this.area.x + w];
    const countX = Math.max(2, Math.floor(w / (p.xKind === "time" ? 90 : 70)));
    this.sx = isBandKind(p.xKind)
      ? this.band(p.xKind as "band" | "point", "x", e.xCats, xr)
      : this.continuous(p.xKind, "x", this.continuousDomain("x", p.xKind, e, countX, f.view), xr);

    if (showX) this.axes.push(this.makeAxis("x", this.sx, countX, w, f.xLabels, ctx));
    if (yAxis) this.axes.push({ ...this.makeAxis("y", this.sy, countY, h, f.yLabels, undefined, sides.y), title: yTitle });
    if (y2Axis && this.sy2) this.axes.push({ ...this.makeAxis("y2", this.sy2, countY, h, f.yLabels, undefined, sides.y2), title: y2Title });
    const xa = this.axes.find((a) => a.id === "x");
    if (xa) xa.title = xTitle;
  }

  private hasY2(): boolean {
    return visible(this.o.prepared).some((m) => m.yAxis === "y2" && (m.type === "line" || m.type === "area" || m.type === "bar" || m.type === "scatter" || m.type === "errorBand" || m.type === "histogram" || m.type === "candle"));
  }

  private makeAxis(id: "x" | "y" | "y2", scale: PosScale, count: number, lenPx: number, labels: boolean, ctx?: CanvasRenderingContext2D, side: "left" | "right" = "left"): AxisModel {
    const spec = (this.o.axes?.[id] || undefined) as AxisSpec | undefined;
    const fmt = this.o.fmt;
    const ticks: AxisTick[] = [];
    let step = 1;
    if (isBand(scale)) {
      const pos = new Map(scale.domain.map((c, i) => [c, i] as const));
      const ctxOf = (shown: readonly string[], i: number, step: number) => ({ step, values: shown.map((c) => pos.get(c)!), index: i });
      let cats = [...scale.domain];
      let stride = 1;
      if (spec?.tickValues) {
        const want = new Set(spec.tickValues.map(String));
        cats = cats.filter((c) => want.has(c));
      } else if (ctx && id === "x") {
        // Thin crowded labels: every k-th band, k from the widest label.
        const all = cats;
        const wmax = Math.max(1, ...all.map((c, i) => this.textWidth(ctx, spec?.tickFormat ? spec.tickFormat(c, ctxOf(all, i, 1)) : c)));
        stride = Math.max(1, Math.ceil((wmax + 8) / Math.max(1, scale.step)));
        cats = cats.filter((_, i) => i % stride === 0);
      } else if (id !== "x") {
        stride = Math.max(1, Math.ceil((this.theme.fontSize + 6) / Math.max(1, scale.step)));
        cats = cats.filter((_, i) => i % stride === 0);
      }
      step = stride;
      cats.forEach((c, i) => ticks.push({ pos: scale.center(c), label: spec?.tickFormat ? spec.tickFormat(c, ctxOf(cats, i, stride)) : c }));
    } else {
      let values: number[];
      if (spec?.tickValues) values = spec.tickValues.map(Number).filter((v) => Number.isFinite(v));
      else values = scale.ticks(spec?.ticks ?? count);
      const [d0, d1] = scale.domain;
      values = values.filter((v) => v >= Math.min(d0, d1) - 1e-9 * Math.abs(d1 - d0) && v <= Math.max(d0, d1) + 1e-9 * Math.abs(d1 - d0));
      step = tickStep(values);
      const ctxOf = (i: number) => ({ step, values, index: i });
      const text = spec?.tickFormat ? values.map((v, i) => spec.tickFormat!(v, ctxOf(i))) : scale.kind === "time" ? fmt.timeTicks(values, spec?.format) : fmt.numberTicks(values, spec?.format);
      values.forEach((v, i) => ticks.push({ pos: scale.map(v), label: text[i]! }));
    }
    void lenPx;
    const bandAxis = isBand(scale);
    return { id, scale, ticks, title: undefined, grid: spec?.grid ?? (id === "y2" ? false : !bandAxis), line: spec?.line ?? true, tickMarks: spec?.tickMarks ?? true, side, labels, step };
  }

  private buildColorScales(e: Extents): void {
    const th = this.theme;
    const global = this.o.scales?.color;
    for (const m of visible(this.o.prepared)) {
      if (m.type === "heatmap") {
        const vals = m.value;
        let lo = Infinity, hi = -Infinity;
        for (let i = 0; i < vals.length; i++) {
          const v = vals[i]!;
          if (v === v) {
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
        }
        this.colors.set(m, makeColorScale(m.mark.colorScale ?? global, th, lo <= hi ? [lo, hi] : [0, 1]));
      } else if (m.type === "scatter" && m.mark.colorValue) {
        this.colors.set(m, makeColorScale(global, th, e.color ?? [0, 1]));
      } else if (m.type === "treemap" && m.mark.colorBy === "value") {
        let lo = Infinity, hi = -Infinity;
        const walk = (n: PTree["mark"]["root"]) => {
          if (n.children && n.children.length) n.children.forEach(walk);
          else {
            const v = n.colorValue ?? n.value ?? 0;
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
        };
        walk(m.mark.root);
        this.colors.set(m, makeColorScale((m.mark.colorScale ?? global) as ColorScaleSpec | undefined, th, lo <= hi ? [lo, hi] : [0, 1]));
      }
    }
  }

  private barWidths = new WeakMap<PBar, number>();
  /** Thickness (x units) of bars on a continuous category axis. */
  widthOf(m: PBar): number {
    let w = this.barWidths.get(m);
    if (w === undefined) this.barWidths.set(m, (w = defaultBarWidth(m.pos.num!)));
    return w;
  }

  private candleWidths = new WeakMap<PCandle, number>();
  /** Thickness (x units) of candles on a continuous x axis. */
  candleWidthOf(m: PCandle): number {
    let w = this.candleWidths.get(m);
    if (w === undefined) this.candleWidths.set(m, (w = defaultBarWidth(m.pos.num!)));
    return w;
  }

  /** The scale a value-carrying mark uses on the vertical axis. */
  yScaleOf(axis: YAxisId): PosScale {
    return axis === "y2" && this.sy2 ? this.sy2 : this.sy;
  }

  /** Pixel position of a coordinate on x (band centre or mapped number). */
  xPx(c: { num: Float64Array | null; cat: string[] | null }, i: number): number {
    return isBand(this.sx) ? this.sx.center(c.cat![i]!) : this.sx.map(c.num![i]!);
  }

  /** Pixel position of an arbitrary rule / band value on a scale (numbers interpolate between numeric categories). */
  valuePx(s: PosScale, v: number | string): number {
    if (isBand(s)) {
      if (typeof v === "string" && s.has(v)) return s.center(v);
      const n = Number(v);
      return Number.isFinite(n) ? s.centerOfNumber(n) : NaN;
    }
    const n = Number(v);
    if (!Number.isFinite(n)) throw new TypeError(`alphacharts: "${v}" is not a number on a ${s.kind} axis`);
    return s.map(n);
  }

  // ---- axes drawing -----------------------------------------------------

  drawAxes(ctx: CanvasRenderingContext2D, dpr: number): void {
    const th = this.theme, a = this.area;
    ctx.save();
    ctx.font = this.font;
    ctx.lineWidth = 1;
    // Gridlines first.
    for (const ax of this.axes) {
      if (!ax.grid) continue;
      ctx.strokeStyle = th.grid;
      ctx.beginPath();
      for (const t of ax.ticks) {
        if (ax.id === "x") {
          const x = crisp(t.pos, dpr);
          ctx.moveTo(x, a.y);
          ctx.lineTo(x, a.y + a.h);
        } else {
          const y = crisp(t.pos, dpr);
          ctx.moveTo(a.x, y);
          ctx.lineTo(a.x + a.w, y);
        }
      }
      ctx.stroke();
    }
    // Zero line of a continuous value axis.
    for (const ax of this.axes) {
      if (ax.id === "x" || isBand(ax.scale)) continue;
      const [d0, d1] = ax.scale.domain;
      if (Math.min(d0, d1) < 0 && Math.max(d0, d1) > 0 && ax.id === "y") {
        const y = crisp(ax.scale.map(0), dpr);
        ctx.strokeStyle = th.border;
        ctx.beginPath();
        ctx.moveTo(a.x, y);
        ctx.lineTo(a.x + a.w, y);
        ctx.stroke();
      }
    }
    const xAxis = this.axes.find((q) => q.id === "x");
    const horizontalBars = visible(this.o.prepared).some((m) => m.type === "bar" && m.orient === "h");
    if (xAxis && !isBand(xAxis.scale) && horizontalBars) {
      const [d0, d1] = xAxis.scale.domain;
      if (Math.min(d0, d1) < 0 && Math.max(d0, d1) > 0) {
        const x = crisp(xAxis.scale.map(0), dpr);
        ctx.strokeStyle = th.border;
        ctx.beginPath();
        ctx.moveTo(x, a.y);
        ctx.lineTo(x, a.y + a.h);
        ctx.stroke();
      }
    }
    for (const ax of this.axes) {
      ctx.strokeStyle = th.border;
      ctx.fillStyle = th.textMuted;
      ctx.beginPath();
      if (ax.id === "x") {
        const y = crisp(a.y + a.h, dpr);
        if (ax.line) {
          ctx.moveTo(a.x, y);
          ctx.lineTo(a.x + a.w, y);
        }
        if (ax.tickMarks) {
          for (const t of ax.ticks) {
            const x = crisp(t.pos, dpr);
            ctx.moveTo(x, y);
            ctx.lineTo(x, y + 4);
          }
        }
        ctx.stroke();
        if (ax.labels) {
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          const maxW = isBand(ax.scale) ? Math.max(20, ax.scale.step * (ax.ticks.length > 1 ? Math.round(Math.abs(ax.ticks[1]!.pos - ax.ticks[0]!.pos) / ax.scale.step) : 1)) : 120;
          const r = this.rect;
          for (const t of ax.ticks) {
            const text = this.fit(ctx, t.label, maxW);
            // A label at either end stays inside the chart instead of being clipped by its edge.
            const half = this.textWidth(ctx, text) / 2;
            ctx.fillText(text, Math.min(Math.max(t.pos, r.x + half), r.x + r.w - half), y + 7);
          }
        }
        if (ax.title) {
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillStyle = th.text;
          ctx.fillText(ax.title, a.x + a.w / 2, this.rect.y + this.rect.h - 2 - (this.o.padding?.bottom ?? 0));
        }
      } else {
        const right = ax.side === "right";
        const x = crisp(right ? a.x + a.w : a.x, dpr);
        if (ax.line) {
          ctx.moveTo(x, a.y);
          ctx.lineTo(x, a.y + a.h);
        }
        if (ax.tickMarks) {
          for (const t of ax.ticks) {
            const y = crisp(t.pos, dpr);
            ctx.moveTo(x, y);
            ctx.lineTo(x + (right ? 4 : -4), y);
          }
        }
        ctx.stroke();
        if (ax.labels) {
          ctx.textAlign = right ? "left" : "right";
          ctx.textBaseline = "middle";
          // A fixed width is the whole gutter: what the title and the label offset leave is for the labels.
          const fixed = (this.o.axes?.[ax.id] as AxisSpec | undefined)?.width;
          const maxW = fixed !== undefined ? Math.max(0, fixed - 10 - (ax.title ? this.theme.fontSize + 6 : 0)) : 180;
          for (const t of ax.ticks) ctx.fillText(this.fit(ctx, t.label, maxW), x + (right ? 8 : -8), t.pos);
        }
        if (ax.title) {
          ctx.save();
          ctx.fillStyle = th.text;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.translate(right ? this.rect.x + this.rect.w - 2 - (this.o.padding?.right ?? 0) : this.rect.x + 2 + (this.o.padding?.left ?? 0), a.y + a.h / 2);
          ctx.rotate(right ? Math.PI / 2 : -Math.PI / 2);
          ctx.fillText(ax.title, 0, 0);
          ctx.restore();
        }
      }
    }
    ctx.restore();
  }

  /** `s`, cut with an ellipsis to fit `maxW`. */
  fit(ctx: CanvasRenderingContext2D, s: string, maxW: number, font: string = this.font): string {
    if (this.textWidth(ctx, s, font) <= maxW) return s;
    let lo = 0, hi = s.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.textWidth(ctx, s.slice(0, mid) + "…", font) <= maxW) lo = mid;
      else hi = mid - 1;
    }
    return lo > 0 ? s.slice(0, lo) + "…" : "";
  }

  // Convenience for hit-testing and drawing.
  contains(px: number, py: number): boolean {
    const a = this.area;
    return px >= a.x && px <= a.x + a.w && py >= a.y && py <= a.y + a.h;
  }
}

export type { PHeat, PScatter };
