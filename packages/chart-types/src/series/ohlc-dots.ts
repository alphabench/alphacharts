// OHLC dots: four dots per bar, at its open, high, low and close, in the up
// or down colour (close >= open is up). Shows the four numbers of each bar
// without the body or wick shapes, so a gap or an inside bar reads as dots
// rather than as boxes. Dots are anti-aliased discs centred on the true price
// (not pixel-snapped: a dot is a point, not an edge). Zoomed out, a bucket
// shows its first open, highest high, lowest low and last close.

import { COL_C, COL_O, registerSeriesType, type DrawView, type DrawView2D, type LastValue, type SeriesData, type SeriesTypeDef } from "@alphacharts/core";
import { HOLE_TEST, type GLContext } from "@alphacharts/core/internal";
import { Base2D, eachUnit, levelOf, Y } from "../canvas.js";
import { Colors, GLSL_COMMON, GLSeries, OFFSCREEN, program } from "../gl-base.js";
import { DOT_FS } from "../shaders.js";

export interface OhlcDotsStyle {
  upColor: string;
  downColor: string;
  /** CSS px. */
  dotRadius: number;
}

declare module "@alphacharts/core" {
  interface SeriesOptionsMap {
    "ohlc-dots": OhlcDotsStyle;
  }
  interface SeriesShapes {
    "ohlc-dots": "ohlc";
  }
}

const VS = GLSL_COMMON + /* glsl */ `
in vec4 a_r; in float a_c;
uniform float u_rad;
uniform vec4 u_up, u_down;
out vec2 v_pos;
flat out vec2 v_c;
flat out float v_rad;
flat out vec4 v_color;
void main() {
  if (a_r.x < ${HOLE_TEST}) { ${OFFSCREEN} }
  int dot_ = gl_VertexID / 6;
  float val = dot_ == 0 ? a_r.y : dot_ == 1 ? a_r.z : dot_ == 2 ? a_r.w : a_c;
  vec2 c = vec2(xDev(a_r.x), yDev(val));
  float r = u_rad + 1.0;
  vec2 p = c + (corner(gl_VertexID % 6) * 2.0 - 1.0) * r;
  v_pos = p; v_c = c; v_rad = u_rad;
  v_color = a_c >= a_r.y ? u_up : u_down;
  gl_Position = vec4(toClip(p), 0.0, 1.0);
}`;

export class OhlcDotsRenderer extends GLSeries<OhlcDotsStyle> {
  private readonly colors = new Colors();
  constructor(gl: WebGL2RenderingContext, ctx: GLContext, data: SeriesData) {
    super(gl, data, false, [{ prog: program(ctx, "ohlc-dots", VS, DOT_FS, ["u_rad", "u_up", "u_down"], ["a_r", "a_c"]), pairs: false }]);
  }
  draw(v: DrawView, o: OhlcDotsStyle): void {
    const n = this.prepare(v, 0);
    if (n === 0) return;
    const gl = this.gl, u = this.uniforms(0);
    gl.uniform1f(u.u_rad!, Math.max(0.5, o.dotRadius * v.dpr));
    gl.uniform4fv(u.u_up!, this.colors.get(0, o.upColor));
    gl.uniform4fv(u.u_down!, this.colors.get(1, o.downColor));
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 24, n);
  }
}

export class OhlcDots2D extends Base2D<OhlcDotsStyle> {
  draw(v: DrawView2D, o: OhlcDotsStyle): void {
    const r = Math.max(0.5, o.dotRadius * v.dpr);
    const up = new Path2D(), down = new Path2D();
    eachUnit(v, levelOf(v), (x, op, h, l, c) => {
      const p = c >= op ? up : down;
      for (const val of [op, h, l, c]) {
        const y = Y(v, val);
        p.moveTo(x + r, y);
        p.arc(x, y, r, 0, Math.PI * 2);
      }
    });
    v.ctx.fillStyle = o.upColor;
    v.ctx.fill(up);
    v.ctx.fillStyle = o.downColor;
    v.ctx.fill(down);
  }
}

export const ohlcDotsType: SeriesTypeDef<OhlcDotsStyle> = {
  shape: "ohlc",
  defaults: (t) => ({ upColor: t.up, downColor: t.down, dotRadius: 2 }),
  createRenderer: (gl, ctx, d) => new OhlcDotsRenderer(gl, ctx, d),
  createRenderer2D: () => new OhlcDots2D(),
  autoscale: (d, _o, lo, hi, out) => void d.lod.minMax(lo, hi, out),
  valueAt: (d, o, i): LastValue | undefined => (d.has(i) ? { value: d.get(i, COL_C), color: d.get(i, COL_C) >= d.get(i, COL_O) ? o.upColor : o.downColor } : undefined),
};

/** Register the "ohlc-dots" series type (idempotent). */
export function registerOhlcDots(): void {
  registerSeriesType("ohlc-dots", ohlcDotsType);
}
