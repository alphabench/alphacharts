// Kagi lines: each bar is one vertical line from its open to its close, and a
// horizontal connector joins a line's end to the next line's start (they are
// the same price in a Kagi transform's output). Lines are coloured up/down by
// their direction. Widths are whole device pixels.
//
// Thick and thin: the Kagi transform's `thick` store holds the thick part of
// the lines that have one, at the same ordinals. Add it as a second series of
// this type with `connectors: false` and a larger `lineWidth`; it draws over
// the thin lines. The connectors stay thin (an approximation: Kagi draws a
// connector in the state the price was in, here the thin series' connector is
// always thin). Zoomed out (more than one line per pixel) a bucket draws one
// vertical from its lowest low to its highest high and no connectors.

import { COL_C, COL_O, registerSeriesType, type DrawView, type DrawView2D, type LastValue, type SeriesData, type SeriesTypeDef } from "@alphacharts/core";
import { HOLE_TEST, type GLContext } from "@alphacharts/core/internal";
import { Base2D, eachUnit, levelOf, snap, Y } from "../canvas.js";
import { Colors, FS_FLAT, GLSL_COMMON, GLSeries, OFFSCREEN, program } from "../gl-base.js";

export interface KagiStyle {
  upColor: string;
  downColor: string;
  /** CSS px; rounded to whole device pixels, at least 1. */
  lineWidth: number;
  /** Draw the horizontal connectors (off for the thick overlay). */
  connectors: boolean;
}

declare module "@alphacharts/core" {
  interface SeriesOptionsMap {
    kagi: KagiStyle;
  }
  interface SeriesShapes {
    kagi: "ohlc";
  }
}

export function kagiWidth(lineWidthCss: number, dpr: number): number {
  return Math.max(1, Math.round(lineWidthCss * dpr));
}

const VERT_VS = GLSL_COMMON + /* glsl */ `
in vec4 a_r; in float a_c;
uniform float u_t;
uniform vec4 u_up, u_down;
out vec4 v_color;
void main() {
  if (a_r.x < ${HOLE_TEST}) { ${OFFSCREEN} }
  vec2 cr = corner(gl_VertexID);
  float left = floor(xDev(a_r.x) - u_t * 0.5 + 0.5);
  float ya = floor(yDev(a_r.z) + 0.5), yb = floor(yDev(a_r.w) + 0.5);
  float y0 = min(ya, yb), y1 = max(max(ya, yb), y0 + 1.0);
  gl_Position = vec4(toClip(vec2(mix(left, left + u_t, cr.x), mix(y0, y1, cr.y))), 0.0, 1.0);
  v_color = a_c >= a_r.y ? u_up : u_down;
}`;

const CONN_VS = GLSL_COMMON + /* glsl */ `
in vec4 a_r; in float a_c;
in vec4 a_r1; in float a_c1;
uniform float u_t;
uniform vec4 u_up, u_down;
out vec4 v_color;
void main() {
  if (a_r.x < ${HOLE_TEST} || a_r1.x < ${HOLE_TEST}) { ${OFFSCREEN} }
  vec2 cr = corner(gl_VertexID);
  float x0 = floor(xDev(a_r.x) - u_t * 0.5 + 0.5);
  float x1 = floor(xDev(a_r1.x) - u_t * 0.5 + 0.5) + u_t;
  float y0 = floor(yDev(a_c) - u_t * 0.5 + 0.5);
  gl_Position = vec4(toClip(vec2(mix(x0, x1, cr.x), mix(y0, y0 + u_t, cr.y))), 0.0, 1.0);
  v_color = a_c >= a_r.y ? u_up : u_down;
}`;

export class KagiRenderer extends GLSeries<KagiStyle> {
  private readonly colors = new Colors();
  constructor(gl: WebGL2RenderingContext, ctx: GLContext, data: SeriesData) {
    super(gl, data, false, [
      { prog: program(ctx, "kagi-vert", VERT_VS, FS_FLAT, ["u_t", "u_up", "u_down"], ["a_r", "a_c"]), pairs: false },
      { prog: program(ctx, "kagi-conn", CONN_VS, FS_FLAT, ["u_t", "u_up", "u_down"], ["a_r", "a_c", "a_r1", "a_c1"]), pairs: true },
    ]);
  }
  draw(v: DrawView, o: KagiStyle): void {
    const gl = this.gl;
    const t = kagiWidth(o.lineWidth, v.dpr);
    let n = this.prepare(v, 0);
    if (n === 0) return;
    let u = this.uniforms(0);
    gl.uniform1f(u.u_t!, t);
    gl.uniform4fv(u.u_up!, this.colors.get(0, o.upColor));
    gl.uniform4fv(u.u_down!, this.colors.get(1, o.downColor));
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
    if (!o.connectors || this.level > 0) return;
    n = this.prepare(v, 1);
    if (n < 2) return;
    u = this.uniforms(1);
    gl.uniform1f(u.u_t!, t);
    gl.uniform4fv(u.u_up!, this.colors.get(0, o.upColor));
    gl.uniform4fv(u.u_down!, this.colors.get(1, o.downColor));
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n - 1);
  }
}

export class Kagi2D extends Base2D<KagiStyle> {
  draw(v: DrawView2D, o: KagiStyle): void {
    const level = levelOf(v);
    const t = kagiWidth(o.lineWidth, v.dpr);
    const up = new Path2D(), down = new Path2D();
    let prev: { x: number; y: number; up: boolean } | undefined;
    eachUnit(v, level, (x, op, h, l, c) => {
      const isUp = c >= op;
      const p = isUp ? up : down;
      const ya = snap(Y(v, h)), yb = snap(Y(v, l));
      const y0 = Math.min(ya, yb), y1 = Math.max(Math.max(ya, yb), y0 + 1);
      const left = Math.floor(x - t / 2 + 0.5);
      p.rect(left, y0, t, y1 - y0);
      if (o.connectors && level === 0 && prev) {
        const x0 = Math.floor(prev.x - t / 2 + 0.5);
        (prev.up ? up : down).rect(x0, Math.floor(prev.y - t / 2 + 0.5), left + t - x0, t);
      }
      prev = { x, y: Y(v, c), up: isUp };
    });
    v.ctx.fillStyle = o.upColor;
    v.ctx.fill(up);
    v.ctx.fillStyle = o.downColor;
    v.ctx.fill(down);
  }
}

export const kagiType: SeriesTypeDef<KagiStyle> = {
  shape: "ohlc",
  defaults: (t) => ({ upColor: t.up, downColor: t.down, lineWidth: 1.5, connectors: true }),
  createRenderer: (gl, ctx, d) => new KagiRenderer(gl, ctx, d),
  createRenderer2D: () => new Kagi2D(),
  autoscale: (d, _o, lo, hi, out) => void d.lod.minMax(lo, hi, out),
  valueAt: (d, o, i): LastValue | undefined => (d.has(i) ? { value: d.get(i, COL_C), color: d.get(i, COL_C) >= d.get(i, COL_O) ? o.upColor : o.downColor } : undefined),
};

/** Register the "kagi" series type (idempotent). */
export function registerKagi(): void {
  registerSeriesType("kagi", kagiType);
}
