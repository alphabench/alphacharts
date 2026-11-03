// Line with markers: the close-to-close line of a value series with a dot at
// every point. Markers are drawn only when they fit (a point at least
// `2 * markerRadius + 2` CSS px from its neighbour, and level 0), so zoomed out
// the series is the plain line instead of a smear of overlapping dots. Zoomed
// out beyond one bar per pixel the line follows each bucket's last value, the
// same series the markers sit on.

import { COL_V, registerSeriesType, type DrawView, type DrawView2D, type LastValue, type SeriesData, type SeriesTypeDef } from "@alphacharts/core";
import { HOLE_TEST, type GLContext } from "@alphacharts/core/internal";
import { Base2D, eachUnit, levelOf, strokeStyle, Y } from "../canvas.js";
import { Colors, GLSL_COMMON, GLSeries, OFFSCREEN, program } from "../gl-base.js";
import { CAPSULE_FS, CAPSULE_VS, DOT_FS } from "../shaders.js";

export interface LineMarkersStyle {
  color: string;
  /** CSS px. */
  lineWidth: number;
  /** CSS px. */
  markerRadius: number;
}

declare module "@alphacharts/core" {
  interface SeriesOptionsMap {
    "line-markers": LineMarkersStyle;
  }
  interface SeriesShapes {
    "line-markers": "value";
  }
}

const DOT_VS = GLSL_COMMON + /* glsl */ `
in vec4 a_r; in float a_c;
uniform float u_rad;
uniform vec4 u_color;
out vec2 v_pos;
flat out vec2 v_c;
flat out float v_rad;
flat out vec4 v_color;
void main() {
  if (a_r.x < ${HOLE_TEST}) { ${OFFSCREEN} }
  vec2 c = vec2(xDev(a_r.x), yDev(a_c));
  float r = u_rad + 1.0;
  vec2 p = c + (corner(gl_VertexID) * 2.0 - 1.0) * r;
  v_pos = p; v_c = c; v_rad = u_rad; v_color = u_color;
  gl_Position = vec4(toClip(p), 0.0, 1.0);
}`;

/** Markers are drawn when the neighbour distance leaves room around them. */
export function markersFit(spacingCss: number, radiusCss: number, level: number): boolean {
  return level === 0 && spacingCss >= 2 * radiusCss + 2;
}

export class LineMarkersRenderer extends GLSeries<LineMarkersStyle> {
  private readonly colors = new Colors();
  constructor(gl: WebGL2RenderingContext, ctx: GLContext, data: SeriesData) {
    super(gl, data, false, [
      { prog: program(ctx, "capsule", CAPSULE_VS, CAPSULE_FS, ["u_half", "u_color"], ["a_r", "a_c", "a_r1", "a_c1"]), pairs: true },
      { prog: program(ctx, "dot", DOT_VS, DOT_FS, ["u_rad", "u_color"], ["a_r", "a_c"]), pairs: false },
    ]);
  }
  draw(v: DrawView, o: LineMarkersStyle): void {
    const gl = this.gl;
    let n = this.prepare(v, 0);
    if (n === 0) return;
    const col = this.colors.get(0, o.color);
    if (n >= 2) {
      const u = this.uniforms(0);
      gl.uniform1f(u.u_half!, Math.max(0.5, (o.lineWidth * v.dpr) / 2));
      gl.uniform4fv(u.u_color!, col);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n - 1);
    }
    if (!markersFit(v.time.spacing, o.markerRadius, this.level)) return;
    n = this.prepare(v, 1);
    const u = this.uniforms(1);
    gl.uniform1f(u.u_rad!, Math.max(0.5, o.markerRadius * v.dpr));
    gl.uniform4fv(u.u_color!, col);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
  }
}

export class LineMarkers2D extends Base2D<LineMarkersStyle> {
  draw(v: DrawView2D, o: LineMarkersStyle): void {
    const level = levelOf(v);
    const line = new Path2D(), dots = new Path2D();
    const r = Math.max(0.5, o.markerRadius * v.dpr);
    const dot = markersFit(v.time.spacing, o.markerRadius, level);
    let started = false;
    eachUnit(v, level, (x, _o, _h, _l, c) => {
      const y = Y(v, c);
      if (started) line.lineTo(x, y);
      else line.moveTo(x, y);
      started = true;
      if (dot) {
        dots.moveTo(x + r, y);
        dots.arc(x, y, r, 0, Math.PI * 2);
      }
    });
    strokeStyle(v, o.color, o.lineWidth);
    v.ctx.stroke(line);
    if (dot) {
      v.ctx.fillStyle = o.color;
      v.ctx.fill(dots);
    }
  }
}

export const lineMarkersType: SeriesTypeDef<LineMarkersStyle> = {
  shape: "value",
  defaults: (t) => ({ color: t.accent, lineWidth: 2, markerRadius: 3 }),
  createRenderer: (gl, ctx, d) => new LineMarkersRenderer(gl, ctx, d),
  createRenderer2D: () => new LineMarkers2D(),
  autoscale: (d, _o, lo, hi, out) => void d.lod.minMax(lo, hi, out),
  valueAt: (d, o, i): LastValue | undefined => (d.has(i) ? { value: d.get(i, COL_V), color: o.color } : undefined),
};

/** Register the "line-markers" series type (idempotent). */
export function registerLineMarkers(): void {
  registerSeriesType("line-markers", lineMarkersType);
}
