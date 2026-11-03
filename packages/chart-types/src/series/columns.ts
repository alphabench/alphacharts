// Columns: one column per bar from a base up (or down) to its close.
//
// `base` is a price, or "bottom" (the default) for the pane's lower edge, which
// is how a columns chart is usually read: height above the floor of the view.
// A column is coloured up when the bar closed at or above its open, down
// otherwise; this is the bar's own direction, so it needs no neighbour and a
// zoomed-out bucket (first open, last close) colours the same way. Edges are
// snapped to whole device pixels, WebGL and Canvas2D agree to the pixel.

import { barWidths, COL_C, COL_O, registerSeriesType, type DrawView, type DrawView2D, type LastValue, type SeriesData, type SeriesTypeDef } from "@alphacharts/core";
import { HOLE_TEST, type GLContext } from "@alphacharts/core/internal";
import { Base2D, eachUnit, levelOf, snap, Y } from "../canvas.js";
import { baseCoord, Colors, FS_FLAT, GLSL_COMMON, GLSeries, OFFSCREEN, program } from "../gl-base.js";

export interface ColumnsStyle {
  upColor: string;
  downColor: string;
  /** Price the columns grow from, or "bottom" for the pane's lower edge. */
  base: number | "bottom";
}

declare module "@alphacharts/core" {
  interface SeriesOptionsMap {
    columns: ColumnsStyle;
  }
  interface SeriesShapes {
    columns: "ohlc";
  }
}

const VS = GLSL_COMMON + /* glsl */ `
in vec4 a_r; in float a_c;
uniform float u_w;
uniform float u_base;
uniform int u_bottom;
uniform vec4 u_up, u_down;
out vec4 v_color;
void main() {
  if (a_r.x < ${HOLE_TEST}) { ${OFFSCREEN} }
  vec2 cr = corner(gl_VertexID);
  float left = floor(xDev(a_r.x) - u_w * 0.5 + 0.5);
  float yc = floor(yDev(a_c) + 0.5);
  float yb = u_bottom == 1 ? u_view.y : floor(yDev(u_base) + 0.5);
  float y0 = min(yc, yb), y1 = max(max(yc, yb), y0 + 1.0);
  gl_Position = vec4(toClip(vec2(mix(left, left + u_w, cr.x), mix(y0, y1, cr.y))), 0.0, 1.0);
  v_color = a_c >= a_r.y ? u_up : u_down;
}`;

export class ColumnsRenderer extends GLSeries<ColumnsStyle> {
  private readonly colors = new Colors();
  constructor(gl: WebGL2RenderingContext, ctx: GLContext, data: SeriesData) {
    super(gl, data, false, [{ prog: program(ctx, "columns", VS, FS_FLAT, ["u_w", "u_base", "u_bottom", "u_up", "u_down"], ["a_r", "a_c"]), pairs: false }]);
  }
  draw(v: DrawView, o: ColumnsStyle): void {
    const n = this.prepare(v, 0);
    if (n === 0) return;
    const gl = this.gl, u = this.uniforms(0);
    gl.uniform1f(u.u_w!, barWidths(v.time.spacing, v.dpr, this.level, 0.8)[0]);
    gl.uniform1i(u.u_bottom!, o.base === "bottom" ? 1 : 0);
    if (o.base !== "bottom") gl.uniform1f(u.u_base!, baseCoord(v, o.base) - this.win.priceBase);
    gl.uniform4fv(u.u_up!, this.colors.get(0, o.upColor));
    gl.uniform4fv(u.u_down!, this.colors.get(1, o.downColor));
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
  }
}

export class Columns2D extends Base2D<ColumnsStyle> {
  draw(v: DrawView2D, o: ColumnsStyle): void {
    const level = levelOf(v);
    const [bw] = barWidths(v.time.spacing, v.dpr, level, 0.8);
    const up = new Path2D(), down = new Path2D();
    const yb = o.base === "bottom" ? v.height : snap((v.price.logCoords && !(o.base > 0) ? v.price.yOfDisplay(v.price.min) : v.price.y(o.base)) * v.dpr);
    eachUnit(v, level, (x, op, _h, _l, c) => {
      const yc = snap(Y(v, c));
      const y0 = Math.min(yc, yb), y1 = Math.max(Math.max(yc, yb), y0 + 1);
      (c >= op ? up : down).rect(Math.floor(x - bw / 2 + 0.5), y0, bw, y1 - y0);
    });
    v.ctx.fillStyle = o.upColor;
    v.ctx.fill(up);
    v.ctx.fillStyle = o.downColor;
    v.ctx.fill(down);
  }
}

export const columnsType: SeriesTypeDef<ColumnsStyle> = {
  shape: "ohlc",
  defaults: (t) => ({ upColor: t.up, downColor: t.down, base: "bottom" }),
  createRenderer: (gl, ctx, d) => new ColumnsRenderer(gl, ctx, d),
  createRenderer2D: () => new Columns2D(),
  autoscale: (d, o, lo, hi, out) => {
    d.lod.minMax(lo, hi, out);
    if (o.base !== "bottom" && out[0]! === out[0]!) {
      out[0] = Math.min(out[0]!, o.base);
      out[1] = Math.max(out[1]!, o.base);
    }
  },
  valueAt: (d, o, i): LastValue | undefined => (d.has(i) ? { value: d.get(i, COL_C), color: d.get(i, COL_C) >= d.get(i, COL_O) ? o.upColor : o.downColor } : undefined),
};

/** Register the "columns" series type (idempotent). */
export function registerColumns(): void {
  registerSeriesType("columns", columnsType);
}
