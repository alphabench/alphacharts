// Hollow candles: a bar that closed above its open is drawn as an outline (the body is empty), a bar that closed at or
// below its open is filled. The colour follows the same rule as plain candles (close >= open is "up"), so only the
// fill differs: a rising bar is an outline in the up colour, a falling one a solid body in the down colour.
// The outline is one wick-width thick and, like every edge here, is snapped to whole device pixels so WebGL and
// Canvas2D agree to the pixel. A bar whose body is too short for an outline to show draws solid.

import { barWidths, COL_C, COL_O, registerSeriesType, type DrawView, type DrawView2D, type LastValue, type SeriesData, type SeriesTypeDef } from "@alphacharts/core";
import { HOLE_TEST, type GLContext } from "@alphacharts/core/internal";
import { Base2D, eachUnit, levelOf, snap, Y } from "../canvas.js";
import { Colors, FS_FLAT, GLSL_COMMON, GLSeries, OFFSCREEN, program } from "../gl-base.js";

export interface HollowCandlesStyle {
  upColor: string;
  downColor: string;
  wickUpColor: string;
  wickDownColor: string;
}

declare module "@alphacharts/core" {
  interface SeriesOptionsMap {
    "hollow-candles": HollowCandlesStyle;
  }
  interface SeriesShapes {
    "hollow-candles": "ohlc";
  }
}

// Segments of one instance, six vertices each: 0 wick, 1 solid body, 2..5 the outline's top, bottom, left and right edges.
const VS = GLSL_COMMON + /* glsl */ `
in vec4 a_r; in float a_c;
uniform vec2 u_w;
uniform vec4 u_up, u_down, u_wup, u_wdown;
out vec4 v_color;
void main() {
  if (a_r.x < ${HOLE_TEST}) { ${OFFSCREEN} }
  int seg = gl_VertexID / 6;
  vec2 cr = corner(gl_VertexID % 6);
  float o = a_r.y, h = a_r.z, l = a_r.w, c = a_c, t = u_w.y;
  bool up = c >= o;
  float left = floor(xDev(a_r.x) - u_w.x * 0.5 + 0.5);
  float ya = floor(yDev(max(o, c)) + 0.5), yb = floor(yDev(min(o, c)) + 0.5);
  float by0 = min(ya, yb), by1 = max(max(ya, yb), by0 + 1.0);
  // Hollow only where the outline leaves an inside to show: a body at least 2t + 1 device px tall and wide.
  bool hollow = up && (by1 - by0) >= 2.0 * t + 1.0 && u_w.x >= 2.0 * t + 1.0;
  float x0, x1, y0, y1;
  if (seg == 0) {
    x0 = left + (u_w.x - t) * 0.5; x1 = x0 + t;
    float wa = floor(yDev(h) + 0.5), wb = floor(yDev(l) + 0.5);
    y0 = min(wa, wb); y1 = max(max(wa, wb), y0 + 1.0);
  } else {
    if (seg == 1 ? hollow : !hollow) { ${OFFSCREEN} }
    x0 = left; x1 = left + u_w.x; y0 = by0; y1 = by1;
    if (seg == 2) y1 = y0 + t;
    else if (seg == 3) y0 = y1 - t;
    else if (seg == 4) x1 = x0 + t;
    else if (seg == 5) x0 = x1 - t;
  }
  gl_Position = vec4(toClip(vec2(mix(x0, x1, cr.x), mix(y0, y1, cr.y))), 0.0, 1.0);
  v_color = seg == 0 ? (up ? u_wup : u_wdown) : (up ? u_up : u_down);
}`;

export class HollowCandlesRenderer extends GLSeries<HollowCandlesStyle> {
  private readonly colors = new Colors();
  constructor(gl: WebGL2RenderingContext, ctx: GLContext, data: SeriesData) {
    super(gl, data, false, [{ prog: program(ctx, "hollow-candles", VS, FS_FLAT, ["u_w", "u_up", "u_down", "u_wup", "u_wdown"], ["a_r", "a_c"]), pairs: false }]);
  }
  draw(v: DrawView, o: HollowCandlesStyle): void {
    const n = this.prepare(v, 0);
    if (n === 0) return;
    const gl = this.gl, u = this.uniforms(0);
    const [body, wick] = barWidths(v.time.spacing, v.dpr, this.level, 0.8);
    gl.uniform2f(u.u_w!, body, wick);
    gl.uniform4fv(u.u_up!, this.colors.get(0, o.upColor));
    gl.uniform4fv(u.u_down!, this.colors.get(1, o.downColor));
    gl.uniform4fv(u.u_wup!, this.colors.get(2, o.wickUpColor));
    gl.uniform4fv(u.u_wdown!, this.colors.get(3, o.wickDownColor));
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, n);
  }
}

export class HollowCandles2D extends Base2D<HollowCandlesStyle> {
  draw(v: DrawView2D, o: HollowCandlesStyle): void {
    const level = levelOf(v);
    const [bw, t] = barWidths(v.time.spacing, v.dpr, level, 0.8);
    const wickUp = new Path2D(), wickDown = new Path2D(), bodyUp = new Path2D(), bodyDown = new Path2D();
    eachUnit(v, level, (x, op, h, l, c) => {
      const left = Math.floor(x - bw / 2 + 0.5);
      const up = c >= op;
      const yh = snap(Y(v, h)), yl = Math.max(snap(Y(v, l)), yh + 1);
      const yt = snap(Y(v, Math.max(op, c))), yb = Math.max(snap(Y(v, Math.min(op, c))), yt + 1);
      (up ? wickUp : wickDown).rect(left + (bw - t) / 2, yh, t, yl - yh);
      const hollow = up && yb - yt >= 2 * t + 1 && bw >= 2 * t + 1;
      if (!up) bodyDown.rect(left, yt, bw, yb - yt);
      else if (!hollow) bodyUp.rect(left, yt, bw, yb - yt);
      else {
        bodyUp.rect(left, yt, bw, t);
        bodyUp.rect(left, yb - t, bw, t);
        bodyUp.rect(left, yt, t, yb - yt);
        bodyUp.rect(left + bw - t, yt, t, yb - yt);
      }
    });
    const ctx = v.ctx;
    ctx.fillStyle = o.wickUpColor;
    ctx.fill(wickUp);
    ctx.fillStyle = o.wickDownColor;
    ctx.fill(wickDown);
    ctx.fillStyle = o.upColor;
    ctx.fill(bodyUp);
    ctx.fillStyle = o.downColor;
    ctx.fill(bodyDown);
  }
}

export const hollowCandlesType: SeriesTypeDef<HollowCandlesStyle> = {
  shape: "ohlc",
  defaults: (t) => ({ upColor: t.up, downColor: t.down, wickUpColor: t.up, wickDownColor: t.down }),
  createRenderer: (gl, ctx, d) => new HollowCandlesRenderer(gl, ctx, d),
  createRenderer2D: () => new HollowCandles2D(),
  autoscale: (d, _o, lo, hi, out) => void d.lod.minMax(lo, hi, out),
  valueAt: (d, o, i): LastValue | undefined => (d.has(i) ? { value: d.get(i, COL_C), color: d.get(i, COL_C) >= d.get(i, COL_O) ? o.upColor : o.downColor } : undefined),
};

/** Register the "hollow-candles" series type (idempotent). */
export function registerHollowCandles(): void {
  registerSeriesType("hollow-candles", hollowCandlesType);
}
