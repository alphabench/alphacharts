// Bricks: a body-only bar from open to close, for Renko and Line Break, where
// the transform already made the bar exactly the move to show.
//
// The brick spans the bar's low..high, which the transforms make equal to its
// open..close, and which keeps a zoomed-out bucket honest (its full excursion,
// not first open to last close). Unlike a candle the body uses the full column width, less one device pixel
// of separation once it is wide enough (4 px), so neighbouring bricks read as
// separate boxes and stacked ones share an edge. Coloured up when close >=
// open. Edges are snapped to whole device pixels; WebGL and Canvas2D agree to
// the pixel. The bars it draws are on the ordinal axis (see store.ts).

import { COL_C, COL_O, registerSeriesType, type DrawView, type DrawView2D, type LastValue, type SeriesData, type SeriesTypeDef } from "@alphacharts/core";
import { HOLE_TEST, type GLContext } from "@alphacharts/core/internal";
import { Base2D, eachUnit, levelOf, snap, Y } from "../canvas.js";
import { Colors, FS_FLAT, GLSL_COMMON, GLSeries, OFFSCREEN, program } from "../gl-base.js";

export interface BricksStyle {
  upColor: string;
  downColor: string;
}

declare module "@alphacharts/core" {
  interface SeriesOptionsMap {
    bricks: BricksStyle;
  }
  interface SeriesShapes {
    bricks: "ohlc";
  }
}

/** Device-px brick width: the column, less a separating pixel when wide enough. */
export function brickWidth(spacingCss: number, dpr: number, level: number): number {
  const w = Math.max(1, Math.floor(spacingCss * dpr * (1 << level)));
  return w >= 4 ? w - Math.max(1, Math.floor(dpr)) : w;
}

const VS = GLSL_COMMON + /* glsl */ `
in vec4 a_r; in float a_c;
uniform float u_w;
uniform vec4 u_up, u_down;
out vec4 v_color;
void main() {
  if (a_r.x < ${HOLE_TEST}) { ${OFFSCREEN} }
  vec2 cr = corner(gl_VertexID);
  float left = floor(xDev(a_r.x) - u_w * 0.5 + 0.5);
  float ya = floor(yDev(a_r.z) + 0.5), yb = floor(yDev(a_r.w) + 0.5);
  float y0 = min(ya, yb), y1 = max(max(ya, yb), y0 + 1.0);
  gl_Position = vec4(toClip(vec2(mix(left, left + u_w, cr.x), mix(y0, y1, cr.y))), 0.0, 1.0);
  v_color = a_c >= a_r.y ? u_up : u_down;
}`;

export class BricksRenderer extends GLSeries<BricksStyle> {
  private readonly colors = new Colors();
  constructor(gl: WebGL2RenderingContext, ctx: GLContext, data: SeriesData) {
    super(gl, data, false, [{ prog: program(ctx, "bricks", VS, FS_FLAT, ["u_w", "u_up", "u_down"], ["a_r", "a_c"]), pairs: false }]);
  }
  draw(v: DrawView, o: BricksStyle): void {
    const n = this.prepare(v, 0);
    if (n === 0) return;
    const gl = this.gl, u = this.uniforms(0);
    gl.uniform1f(u.u_w!, brickWidth(v.time.spacing, v.dpr, this.level));
    gl.uniform4fv(u.u_up!, this.colors.get(0, o.upColor));
    gl.uniform4fv(u.u_down!, this.colors.get(1, o.downColor));
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
  }
}

export class Bricks2D extends Base2D<BricksStyle> {
  draw(v: DrawView2D, o: BricksStyle): void {
    const level = levelOf(v);
    const bw = brickWidth(v.time.spacing, v.dpr, level);
    const up = new Path2D(), down = new Path2D();
    eachUnit(v, level, (x, op, h, l, c) => {
      const ya = snap(Y(v, h)), yb = snap(Y(v, l));
      const y0 = Math.min(ya, yb), y1 = Math.max(Math.max(ya, yb), y0 + 1);
      (c >= op ? up : down).rect(Math.floor(x - bw / 2 + 0.5), y0, bw, y1 - y0);
    });
    v.ctx.fillStyle = o.upColor;
    v.ctx.fill(up);
    v.ctx.fillStyle = o.downColor;
    v.ctx.fill(down);
  }
}

export const bricksType: SeriesTypeDef<BricksStyle> = {
  shape: "ohlc",
  defaults: (t) => ({ upColor: t.up, downColor: t.down }),
  createRenderer: (gl, ctx, d) => new BricksRenderer(gl, ctx, d),
  createRenderer2D: () => new Bricks2D(),
  autoscale: (d, _o, lo, hi, out) => void d.lod.minMax(lo, hi, out),
  valueAt: (d, o, i): LastValue | undefined => (d.has(i) ? { value: d.get(i, COL_C), color: d.get(i, COL_C) >= d.get(i, COL_O) ? o.upColor : o.downColor } : undefined),
};

/** Register the "bricks" series type (idempotent). */
export function registerBricks(): void {
  registerSeriesType("bricks", bricksType);
}
