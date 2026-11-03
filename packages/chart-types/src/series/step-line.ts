// Step line: the value holds until the next point, then jumps.
//
// `stepMode` "after" (default) holds the value to the right of each point and
// jumps at the next point's x (the usual reading of "the price was X until
// then"); "before" jumps at the point's own x and holds to the next. Either
// way every horizontal run is exactly one source value and every corner is at
// a bar's x: nothing between two points is interpolated, which is why a step
// line is the honest way to show a quantity that only changes when it is
// reported. One instance joins record i to i + 1 and draws both segments in a
// single quad with union coverage, so a translucent colour does not double up
// at the corner. Zoomed out it follows each bucket's last value.

import { COL_V, registerSeriesType, type DrawView, type DrawView2D, type LastValue, type SeriesData, type SeriesTypeDef } from "@alphacharts/core";
import { HOLE_TEST, type GLContext } from "@alphacharts/core/internal";
import { Base2D, eachUnit, levelOf, strokeStyle, Y } from "../canvas.js";
import { Colors, GLSL_COMMON, GLSeries, OFFSCREEN, program } from "../gl-base.js";
import { SEG_DIST } from "../shaders.js";

export interface StepLineStyle {
  color: string;
  /** CSS px. */
  lineWidth: number;
  stepMode: "after" | "before";
}

declare module "@alphacharts/core" {
  interface SeriesOptionsMap {
    "step-line": StepLineStyle;
  }
  interface SeriesShapes {
    "step-line": "value";
  }
}

const VS = GLSL_COMMON + /* glsl */ `
in vec4 a_r; in float a_c;
in vec4 a_r1; in float a_c1;
uniform float u_half;
uniform int u_before;
out vec2 v_pos;
flat out vec2 v_p0;
flat out vec2 v_pm;
flat out vec2 v_p1;
void main() {
  if (a_r.x < ${HOLE_TEST} || a_r1.x < ${HOLE_TEST}) { ${OFFSCREEN} }
  vec2 p0 = vec2(xDev(a_r.x), yDev(a_c));
  vec2 p1 = vec2(xDev(a_r1.x), yDev(a_c1));
  vec2 pm = u_before == 1 ? vec2(p0.x, p1.y) : vec2(p1.x, p0.y);
  float r = u_half + 1.0;
  vec2 lo = min(min(p0, p1), pm) - r;
  vec2 hi = max(max(p0, p1), pm) + r;
  vec2 p = mix(lo, hi, corner(gl_VertexID));
  v_pos = p; v_p0 = p0; v_pm = pm; v_p1 = p1;
  gl_Position = vec4(toClip(p), 0.0, 1.0);
}`;

const FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_pos;
flat in vec2 v_p0;
flat in vec2 v_pm;
flat in vec2 v_p1;
uniform float u_half;
uniform vec4 u_color;
out vec4 o_color;
${SEG_DIST}
void main() {
  float d = min(segDist(v_pos, v_p0, v_pm), segDist(v_pos, v_pm, v_p1));
  float cov = clamp(u_half + 0.5 - d, 0.0, 1.0);
  if (cov <= 0.0) discard;
  float a = u_color.a * cov;
  o_color = vec4(u_color.rgb * a, a);
}`;

export class StepLineRenderer extends GLSeries<StepLineStyle> {
  private readonly colors = new Colors();
  constructor(gl: WebGL2RenderingContext, ctx: GLContext, data: SeriesData) {
    super(gl, data, false, [{ prog: program(ctx, "step", VS, FS, ["u_half", "u_before", "u_color"], ["a_r", "a_c", "a_r1", "a_c1"]), pairs: true }]);
  }
  draw(v: DrawView, o: StepLineStyle): void {
    const n = this.prepare(v, 0);
    if (n < 2) return;
    const gl = this.gl, u = this.uniforms(0);
    gl.uniform1f(u.u_half!, Math.max(0.5, (o.lineWidth * v.dpr) / 2));
    gl.uniform1i(u.u_before!, o.stepMode === "before" ? 1 : 0);
    gl.uniform4fv(u.u_color!, this.colors.get(0, o.color));
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n - 1);
  }
}

export class StepLine2D extends Base2D<StepLineStyle> {
  draw(v: DrawView2D, o: StepLineStyle): void {
    const path = new Path2D();
    let px = 0, py = 0, started = false;
    eachUnit(v, levelOf(v), (x, _o, _h, _l, c) => {
      const y = Y(v, c);
      if (!started) path.moveTo(x, y);
      else if (o.stepMode === "before") {
        path.lineTo(px, y);
        path.lineTo(x, y);
      } else {
        path.lineTo(x, py);
        path.lineTo(x, y);
      }
      px = x;
      py = y;
      started = true;
    });
    // Round joins and caps, like the capsules of the WebGL path; one path, so a translucent colour does not overlap itself.
    strokeStyle(v, o.color, o.lineWidth);
    v.ctx.stroke(path);
  }
}

export const stepLineType: SeriesTypeDef<StepLineStyle> = {
  shape: "value",
  defaults: (t) => ({ color: t.accent, lineWidth: 2, stepMode: "after" }),
  createRenderer: (gl, ctx, d) => new StepLineRenderer(gl, ctx, d),
  createRenderer2D: () => new StepLine2D(),
  autoscale: (d, _o, lo, hi, out) => void d.lod.minMax(lo, hi, out),
  valueAt: (d, o, i): LastValue | undefined => (d.has(i) ? { value: d.get(i, COL_V), color: o.color } : undefined),
};

/** Register the "step-line" series type (idempotent). */
export function registerStepLine(): void {
  registerSeriesType("step-line", stepLineType);
}
