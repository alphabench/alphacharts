// Hi-Lo ("high-low bars"): one floating column per bar from its low to its
// high, in a single colour. The body width is the candle body width and every
// edge is snapped to whole device pixels, so WebGL and Canvas2D agree to the
// pixel. Zoomed out, a bucket draws its full low..high.

import { barWidths, COL_C, registerSeriesType, type DrawView, type DrawView2D, type LastValue, type SeriesData, type SeriesTypeDef } from "@alphacharts/core";
import { HOLE_TEST, type GLContext } from "@alphacharts/core/internal";
import { Base2D, eachUnit, levelOf, snap, Y } from "../canvas.js";
import { Colors, FS_FLAT, GLSL_COMMON, GLSeries, OFFSCREEN, program } from "../gl-base.js";

export interface HiLoStyle {
  color: string;
}

declare module "@alphacharts/core" {
  interface SeriesOptionsMap {
    "hi-lo": HiLoStyle;
  }
  interface SeriesShapes {
    "hi-lo": "ohlc";
  }
}

const VS = GLSL_COMMON + /* glsl */ `
in vec4 a_r; in float a_c;
uniform float u_w;
uniform vec4 u_color;
out vec4 v_color;
void main() {
  if (a_r.x < ${HOLE_TEST}) { ${OFFSCREEN} }
  vec2 cr = corner(gl_VertexID);
  float left = floor(xDev(a_r.x) - u_w * 0.5 + 0.5);
  float ya = floor(yDev(a_r.z) + 0.5), yb = floor(yDev(a_r.w) + 0.5);
  float y0 = min(ya, yb), y1 = max(max(ya, yb), y0 + 1.0);
  gl_Position = vec4(toClip(vec2(mix(left, left + u_w, cr.x), mix(y0, y1, cr.y))), 0.0, 1.0);
  v_color = u_color;
}`;

export class HiLoRenderer extends GLSeries<HiLoStyle> {
  private readonly colors = new Colors();
  constructor(gl: WebGL2RenderingContext, ctx: GLContext, data: SeriesData) {
    super(gl, data, false, [{ prog: program(ctx, "hi-lo", VS, FS_FLAT, ["u_w", "u_color"], ["a_r", "a_c"]), pairs: false }]);
  }
  draw(v: DrawView, o: HiLoStyle): void {
    const n = this.prepare(v, 0);
    if (n === 0) return;
    const gl = this.gl, u = this.uniforms(0);
    gl.uniform1f(u.u_w!, barWidths(v.time.spacing, v.dpr, this.level, 0.8)[0]);
    gl.uniform4fv(u.u_color!, this.colors.get(0, o.color));
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
  }
}

export class HiLo2D extends Base2D<HiLoStyle> {
  draw(v: DrawView2D, o: HiLoStyle): void {
    const level = levelOf(v);
    const [bw] = barWidths(v.time.spacing, v.dpr, level, 0.8);
    const path = new Path2D();
    eachUnit(v, level, (x, _o, h, l) => {
      const ya = snap(Y(v, h)), yb = snap(Y(v, l));
      const y0 = Math.min(ya, yb), y1 = Math.max(Math.max(ya, yb), y0 + 1);
      path.rect(Math.floor(x - bw / 2 + 0.5), y0, bw, y1 - y0);
    });
    v.ctx.fillStyle = o.color;
    v.ctx.fill(path);
  }
}

export const hiLoType: SeriesTypeDef<HiLoStyle> = {
  shape: "ohlc",
  defaults: (t) => ({ color: t.accent }),
  createRenderer: (gl, ctx, d) => new HiLoRenderer(gl, ctx, d),
  createRenderer2D: () => new HiLo2D(),
  autoscale: (d, _o, lo, hi, out) => void d.lod.minMax(lo, hi, out),
  valueAt: (d, o, i): LastValue | undefined => (d.has(i) ? { value: d.get(i, COL_C), color: o.color } : undefined),
};

/** Register the "hi-lo" series type (idempotent). */
export function registerHiLo(): void {
  registerSeriesType("hi-lo", hiLoType);
}
