// Point & Figure columns: one X (rising column) or O (falling column) per box.
//
// Each bar is a column from the Point & Figure transform: low..high is a whole
// number of boxes, close > open for an X column and close < open for an O
// column. The renderer needs the transform's `boxSize` to know how many boxes
// a column holds; a box is a square cell as wide as the column pitch and as
// tall as `boxSize` on the price scale, with the glyph drawn inside it.
//
// One quad per column; the fragment shader finds which cell a pixel is in and
// evaluates the glyph analytically (two crossing segments for X, a ring for
// O), so the cost is per column, not per box, and the edges are anti-aliased
// at any DPR. Cells smaller than 4 px are filled solid in the column colour
// (a glyph there is a smudge). Columns are never aggregated into LOD buckets:
// merging columns would invent a column that never formed.
//
// Boxes are equal-height only on a linear scale (also percent and indexed,
// which are linear in price); on a log scale the cells would not be boxes,
// so drawing there throws.

import { COL_C, COL_O, registerSeriesType, type DrawView, type DrawView2D, type LastValue, type SeriesData, type SeriesTypeDef } from "@alphacharts/core";
import { HOLE_TEST, type GLContext } from "@alphacharts/core/internal";
import { Base2D, eachUnit, strokeStyle, Y } from "../canvas.js";
import { Colors, GLSL_COMMON, GLSeries, OFFSCREEN, program } from "../gl-base.js";
import { SEG_DIST } from "../shaders.js";

export interface PointFigureStyle {
  /** X (rising) columns. */
  upColor: string;
  /** O (falling) columns. */
  downColor: string;
  /** The transform's box size, in price. No default: the renderer cannot guess it. */
  boxSize: number;
  /** CSS px. */
  lineWidth: number;
}

declare module "@alphacharts/core" {
  interface SeriesOptionsMap {
    "point-figure": PointFigureStyle;
  }
  interface SeriesShapes {
    "point-figure": "ohlc";
  }
}

/** Glyph half-size as a share of the cell's smaller side; cells under this many device px fill solid. */
const GLYPH_SHARE = 0.39;
const SOLID_BELOW = 4;

const VS = GLSL_COMMON + /* glsl */ `
in vec4 a_r; in float a_c;
uniform float u_w;
uniform float u_box;
uniform vec4 u_up, u_down;
out vec2 v_pos;
flat out vec4 v_geom; // column centre x, top y, cell height, box count
flat out vec4 v_color;
flat out float v_o; // 1 for an O (falling) column
void main() {
  if (a_r.x < ${HOLE_TEST}) { ${OFFSCREEN} }
  float xc = xDev(a_r.x);
  float ya = yDev(a_r.z), yb = yDev(a_r.w);
  float top = min(ya, yb), bot = max(ya, yb);
  float n = max(1.0, floor((a_r.z - a_r.w) / u_box + 0.5));
  vec2 p = vec2(mix(xc - u_w * 0.5, xc + u_w * 0.5, corner(gl_VertexID).x), mix(top, bot, corner(gl_VertexID).y));
  v_pos = p;
  v_geom = vec4(xc, top, (bot - top) / n, n);
  v_color = a_c >= a_r.y ? u_up : u_down;
  v_o = a_c >= a_r.y ? 0.0 : 1.0;
  gl_Position = vec4(toClip(p), 0.0, 1.0);
}`;

const FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_pos;
flat in vec4 v_geom;
flat in vec4 v_color;
flat in float v_o;
uniform float u_w;
uniform float u_half;
uniform float u_solid; // device px under which a cell is filled solid
uniform float u_glyph;
out vec4 o_color;
${SEG_DIST}
void main() {
  float k = clamp(floor((v_pos.y - v_geom.y) / v_geom.z), 0.0, v_geom.w - 1.0);
  vec2 cc = vec2(v_geom.x, v_geom.y + (k + 0.5) * v_geom.z);
  float s = min(u_w, v_geom.z);
  float cov;
  if (s < u_solid) {
    cov = 1.0;
  } else {
    float hs = s * u_glyph;
    float d;
    if (v_o > 0.5) d = abs(length(v_pos - cc) - hs);
    else d = min(segDist(v_pos, cc + vec2(-hs, -hs), cc + vec2(hs, hs)), segDist(v_pos, cc + vec2(-hs, hs), cc + vec2(hs, -hs)));
    cov = clamp(u_half + 0.5 - d, 0.0, 1.0);
  }
  if (cov <= 0.0) discard;
  float a = v_color.a * cov;
  o_color = vec4(v_color.rgb * a, a);
}`;

function checkBox(o: PointFigureStyle): void {
  if (!(o.boxSize > 0) || !Number.isFinite(o.boxSize)) {
    throw new RangeError(`point-figure: set the boxSize option to the transform's box size (got ${o.boxSize})`);
  }
}

function checkLinear(logCoords: boolean): void {
  if (logCoords) throw new Error("point-figure: boxes are equal-height cells; use a linear, percent or indexed price scale, not log");
}

export class PointFigureRenderer extends GLSeries<PointFigureStyle> {
  private readonly colors = new Colors();
  constructor(gl: WebGL2RenderingContext, ctx: GLContext, data: SeriesData) {
    super(gl, data, false, [
      { prog: program(ctx, "point-figure", VS, FS, ["u_w", "u_box", "u_up", "u_down", "u_half", "u_solid", "u_glyph"], ["a_r", "a_c"]), pairs: false },
    ]);
  }
  protected override pickLevel(): number {
    return 0;
  }
  draw(v: DrawView, o: PointFigureStyle): void {
    checkBox(o);
    checkLinear(v.price.logCoords);
    const n = this.prepare(v, 0);
    if (n === 0) return;
    const gl = this.gl, u = this.uniforms(0);
    gl.uniform1f(u.u_w!, v.time.spacing * v.dpr);
    gl.uniform1f(u.u_box!, o.boxSize);
    gl.uniform1f(u.u_half!, Math.max(0.5, (o.lineWidth * v.dpr) / 2));
    gl.uniform1f(u.u_solid!, SOLID_BELOW);
    gl.uniform1f(u.u_glyph!, GLYPH_SHARE);
    gl.uniform4fv(u.u_up!, this.colors.get(0, o.upColor));
    gl.uniform4fv(u.u_down!, this.colors.get(1, o.downColor));
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
  }
}

export class PointFigure2D extends Base2D<PointFigureStyle> {
  draw(v: DrawView2D, o: PointFigureStyle): void {
    checkBox(o);
    checkLinear(v.price.logCoords);
    const w = v.time.spacing * v.dpr;
    const xs = new Path2D(), os = new Path2D(), solidUp = new Path2D(), solidDown = new Path2D();
    eachUnit(v, 0, (xc, op, h, l, c) => {
      const isO = c < op;
      const ya = Y(v, h), yb = Y(v, l);
      const top = Math.min(ya, yb), bot = Math.max(ya, yb);
      const n = Math.max(1, Math.floor((h - l) / o.boxSize + 0.5));
      const ch = (bot - top) / n;
      const s = Math.min(w, ch);
      if (s < SOLID_BELOW) {
        (isO ? solidDown : solidUp).rect(xc - w / 2, top, w, bot - top);
        return;
      }
      const hs = s * GLYPH_SHARE;
      for (let k = 0; k < n; k++) {
        const cy = top + (k + 0.5) * ch;
        if (isO) {
          os.moveTo(xc + hs, cy);
          os.arc(xc, cy, hs, 0, Math.PI * 2);
        } else {
          xs.moveTo(xc - hs, cy - hs);
          xs.lineTo(xc + hs, cy + hs);
          xs.moveTo(xc - hs, cy + hs);
          xs.lineTo(xc + hs, cy - hs);
        }
      }
    });
    const ctx = v.ctx;
    ctx.fillStyle = o.upColor;
    ctx.fill(solidUp);
    ctx.fillStyle = o.downColor;
    ctx.fill(solidDown);
    strokeStyle(v, o.upColor, o.lineWidth);
    ctx.stroke(xs);
    strokeStyle(v, o.downColor, o.lineWidth);
    ctx.stroke(os);
  }
}

export const pointFigureType: SeriesTypeDef<PointFigureStyle> = {
  shape: "ohlc",
  defaults: (t) => ({ upColor: t.up, downColor: t.down, boxSize: Number.NaN, lineWidth: 1.5 }),
  createRenderer: (gl, ctx, d) => new PointFigureRenderer(gl, ctx, d),
  createRenderer2D: () => new PointFigure2D(),
  autoscale: (d, _o, lo, hi, out) => void d.lod.minMax(lo, hi, out),
  valueAt: (d, o, i): LastValue | undefined => (d.has(i) ? { value: d.get(i, COL_C), color: d.get(i, COL_C) >= d.get(i, COL_O) ? o.upColor : o.downColor } : undefined),
};

/** Register the "point-figure" series type (idempotent). */
export function registerPointFigure(): void {
  registerSeriesType("point-figure", pointFigureType);
}
