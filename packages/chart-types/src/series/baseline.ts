// Baseline: a line with the area between it and a base price filled, in one
// colour above the base and another below.
//
// Where a segment crosses the base the fill is split exactly at the crossing
// (linear interpolation along the segment, on the pane's price coordinate), so
// the colour changes at the base and nowhere else; the line changes colour at
// the same place. Fill gradients run in pane space: `topFillColor` at the top
// of the pane fading to `topFillFadeColor` at the base, `bottomFillFadeColor`
// at the base fading to `bottomFillColor` at the bottom of the pane (the same
// convention as the core's area). Zoomed out the series follows each bucket's
// last value. A base at or below zero on a log scale sits at the pane's lowest
// value, as the core's histogram does.

import { COL_V, registerSeriesType, type DrawView, type DrawView2D, type LastValue, type SeriesData, type SeriesTypeDef, parseColor, cssColor } from "@alphacharts/core";
import { HOLE_TEST, type GLContext } from "@alphacharts/core/internal";
import { Base2D, eachUnit, levelOf, strokeStyle, Y } from "../canvas.js";
import { baseCoord, Colors, GLSL_COMMON, GLSeries, OFFSCREEN, program } from "../gl-base.js";
import { CAPSULE_VS, SEG_DIST } from "../shaders.js";

export interface BaselineStyle {
  /** Price the fill is measured from. */
  base: number;
  topLineColor: string;
  bottomLineColor: string;
  topFillColor: string;
  topFillFadeColor: string;
  bottomFillColor: string;
  bottomFillFadeColor: string;
  /** CSS px. */
  lineWidth: number;
}

declare module "@alphacharts/core" {
  interface SeriesOptionsMap {
    baseline: BaselineStyle;
  }
  interface SeriesShapes {
    baseline: "value";
  }
}

// Two trapezoids per pair (vertices 0-5 and 6-11): the part of the segment
// before the crossing and the part after (collapsed when there is none).
const FILL_VS = GLSL_COMMON + /* glsl */ `
in vec4 a_r; in float a_c;
in vec4 a_r1; in float a_c1;
uniform float u_baseY;
out float v_y;
out float v_g;
flat out float v_above;
void main() {
  if (a_r.x < ${HOLE_TEST} || a_r1.x < ${HOLE_TEST}) { ${OFFSCREEN} }
  float x0 = xDev(a_r.x), x1 = xDev(a_r1.x);
  float y0 = yDev(a_c), y1 = yDev(a_c1);
  float s0 = u_baseY - y0, s1 = u_baseY - y1;
  bool cross = s0 * s1 < 0.0;
  float tc = cross ? s0 / (s0 - s1) : 1.0;
  int half_ = gl_VertexID / 6;
  if (half_ == 1 && !cross) { ${OFFSCREEN} }
  float ta = half_ == 0 ? 0.0 : tc;
  float tb = half_ == 0 ? tc : 1.0;
  vec2 cr = corner(gl_VertexID % 6);
  float t = mix(ta, tb, cr.x);
  float yl = mix(y0, y1, t);
  float x = mix(x0, x1, t);
  float y = mix(yl, u_baseY, cr.y);
  v_above = mix(s0, s1, 0.5 * (ta + tb)) >= 0.0 ? 1.0 : 0.0;
  v_y = y;
  v_g = cr.y;
  gl_Position = vec4(toClip(vec2(x, y)), 0.0, 1.0);
}`;

const FILL_FS = /* glsl */ `#version 300 es
precision highp float;
in float v_y;
in float v_g;
flat in float v_above;
uniform float u_baseY;
uniform float u_height;
uniform vec4 u_topA, u_topB, u_botA, u_botB;
out vec4 o_color;
void main() {
  vec4 c;
  if (v_above > 0.5) {
    float t = u_baseY > 0.0 ? clamp(v_y / u_baseY, 0.0, 1.0) : 1.0;
    c = mix(u_topA, u_topB, t);
  } else {
    float span = u_height - u_baseY;
    float t = span > 0.0 ? clamp((v_y - u_baseY) / span, 0.0, 1.0) : 0.0;
    c = mix(u_botA, u_botB, t);
  }
  o_color = vec4(c.rgb * c.a, c.a);
}`;

const LINE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_pos;
flat in vec2 v_a;
flat in vec2 v_b;
uniform float u_half;
uniform float u_baseY;
uniform vec4 u_top, u_bottom;
out vec4 o_color;
${SEG_DIST}
void main() {
  vec2 pa = v_pos - v_a, ba = v_b - v_a;
  float t = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  float cov = clamp(u_half + 0.5 - length(pa - ba * t), 0.0, 1.0);
  if (cov <= 0.0) discard;
  vec4 c = (v_a.y + t * (v_b.y - v_a.y)) <= u_baseY ? u_top : u_bottom;
  float a = c.a * cov;
  o_color = vec4(c.rgb * a, a);
}`;

export class BaselineRenderer extends GLSeries<BaselineStyle> {
  private readonly colors = new Colors();
  constructor(gl: WebGL2RenderingContext, ctx: GLContext, data: SeriesData) {
    super(gl, data, false, [
      { prog: program(ctx, "baseline-fill", FILL_VS, FILL_FS, ["u_baseY", "u_height", "u_topA", "u_topB", "u_botA", "u_botB"], ["a_r", "a_c", "a_r1", "a_c1"]), pairs: true },
      { prog: program(ctx, "baseline-line", CAPSULE_VS, LINE_FS, ["u_half", "u_baseY", "u_top", "u_bottom"], ["a_r", "a_c", "a_r1", "a_c1"]), pairs: true },
    ]);
  }
  draw(v: DrawView, o: BaselineStyle): void {
    const gl = this.gl;
    let n = this.prepare(v, 0);
    if (n < 2) return;
    const baseY = v.price.yOfCoord(baseCoord(v, o.base)) * v.dpr;
    let u = this.uniforms(0);
    gl.uniform1f(u.u_baseY!, baseY);
    gl.uniform1f(u.u_height!, v.height);
    gl.uniform4fv(u.u_topA!, this.colors.get(0, o.topFillColor));
    gl.uniform4fv(u.u_topB!, this.colors.get(1, o.topFillFadeColor));
    gl.uniform4fv(u.u_botA!, this.colors.get(2, o.bottomFillFadeColor));
    gl.uniform4fv(u.u_botB!, this.colors.get(3, o.bottomFillColor));
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 12, n - 1);

    n = this.prepare(v, 1);
    u = this.uniforms(1);
    gl.uniform1f(u.u_half!, Math.max(0.5, (o.lineWidth * v.dpr) / 2));
    gl.uniform1f(u.u_baseY!, baseY);
    gl.uniform4fv(u.u_top!, this.colors.get(4, o.topLineColor));
    gl.uniform4fv(u.u_bottom!, this.colors.get(5, o.bottomLineColor));
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n - 1);
  }
}

export class Baseline2D extends Base2D<BaselineStyle> {
  draw(v: DrawView2D, o: BaselineStyle): void {
    const level = levelOf(v);
    const ctx = v.ctx;
    const baseY = (v.price.logCoords && !(o.base > 0) ? v.price.yOfDisplay(v.price.min) : v.price.y(o.base)) * v.dpr;
    const above = new Path2D(), below = new Path2D(), line = new Path2D();
    let px = 0, py = 0, started = false;
    const half = (path: Path2D, xa: number, ya: number, xb: number, yb: number) => {
      path.moveTo(xa, ya);
      path.lineTo(xb, yb);
      path.lineTo(xb, baseY);
      path.lineTo(xa, baseY);
      path.closePath();
    };
    eachUnit(v, level, (x, _o, _h, _l, c) => {
      const y = Y(v, c);
      if (!started) line.moveTo(x, y);
      else {
        line.lineTo(x, y);
        const s0 = baseY - py, s1 = baseY - y;
        if (s0 * s1 < 0) {
          const t = s0 / (s0 - s1), xc = px + (x - px) * t;
          half(s0 > 0 ? above : below, px, py, xc, baseY);
          half(s1 > 0 ? above : below, xc, baseY, x, y);
        } else half(s0 + s1 >= 0 ? above : below, px, py, x, y);
      }
      px = x;
      py = y;
      started = true;
    });
    const H = v.height;
    const top = ctx.createLinearGradient(0, 0, 0, Math.max(baseY, 1));
    top.addColorStop(0, o.topFillColor);
    top.addColorStop(1, o.topFillFadeColor);
    ctx.fillStyle = top;
    ctx.fill(above);
    const bot = ctx.createLinearGradient(0, baseY, 0, Math.max(H, baseY + 1));
    bot.addColorStop(0, o.bottomFillFadeColor);
    bot.addColorStop(1, o.bottomFillColor);
    ctx.fillStyle = bot;
    ctx.fill(below);
    // The line, coloured by which side of the base it is on.
    for (const [color, y0, y1] of [[o.topLineColor, 0, baseY], [o.bottomLineColor, baseY, H]] as const) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, y0, v.width, Math.max(0, y1 - y0));
      ctx.clip();
      strokeStyle(v, color, o.lineWidth);
      ctx.stroke(line);
      ctx.restore();
    }
  }
}

/** The core's area convention: a translucent version of a colour. */
function withAlpha(css: string, alpha: number): string {
  const c = parseColor(css);
  return cssColor(((c & 0xffffff00) | Math.round(alpha * 255)) >>> 0);
}

export const baselineType: SeriesTypeDef<BaselineStyle> = {
  shape: "value",
  defaults: (t) => ({
    base: 0,
    topLineColor: t.up,
    bottomLineColor: t.down,
    topFillColor: withAlpha(t.up, 0.28),
    topFillFadeColor: withAlpha(t.up, 0.04),
    bottomFillColor: withAlpha(t.down, 0.28),
    bottomFillFadeColor: withAlpha(t.down, 0.04),
    lineWidth: 2,
  }),
  createRenderer: (gl, ctx, d) => new BaselineRenderer(gl, ctx, d),
  createRenderer2D: () => new Baseline2D(),
  autoscale: (d, o, lo, hi, out) => {
    d.lod.minMax(lo, hi, out);
    if (out[0]! === out[0]!) {
      out[0] = Math.min(out[0]!, o.base);
      out[1] = Math.max(out[1]!, o.base);
    }
  },
  valueAt: (d, o, i): LastValue | undefined => {
    if (!d.has(i)) return undefined;
    const v = d.get(i, COL_V);
    return { value: v, color: v >= o.base ? o.topLineColor : o.bottomLineColor };
  },
};

/** Register the "baseline" series type (idempotent). */
export function registerBaseline(): void {
  registerSeriesType("baseline", baselineType);
}
