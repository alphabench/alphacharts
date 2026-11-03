// GLSL shared by the line-like renderers: an anti-aliased capsule joining two
// records, and an anti-aliased dot. Coverage is analytic (distance to the
// segment or centre), so it is exact at any DPR and costs no multisampling.
// All positions are device px, y down; output is premultiplied alpha.

import { HOLE_TEST } from "@alphacharts/core/internal";
import { GLSL_COMMON, OFFSCREEN } from "./gl-base.js";

/** Distance from p to segment a-b. */
export const SEG_DIST = /* glsl */ `
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float t = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * t);
}
`;

/** Capsule from record i's close to record i + 1's close. */
export const CAPSULE_VS = GLSL_COMMON + /* glsl */ `
in vec4 a_r; in float a_c;
in vec4 a_r1; in float a_c1;
uniform float u_half;
out vec2 v_pos;
flat out vec2 v_a;
flat out vec2 v_b;
void main() {
  if (a_r.x < ${HOLE_TEST} || a_r1.x < ${HOLE_TEST}) { ${OFFSCREEN} }
  vec2 a = vec2(xDev(a_r.x), yDev(a_c));
  vec2 b = vec2(xDev(a_r1.x), yDev(a_c1));
  vec2 d = b - a;
  float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float r = u_half + 1.0;
  vec2 cr = corner(gl_VertexID);
  vec2 p = mix(a - dir * r, b + dir * r, cr.x) + nrm * mix(-r, r, cr.y);
  v_pos = p; v_a = a; v_b = b;
  gl_Position = vec4(toClip(p), 0.0, 1.0);
}`;

export const CAPSULE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_pos;
flat in vec2 v_a;
flat in vec2 v_b;
uniform float u_half;
uniform vec4 u_color;
out vec4 o_color;
${SEG_DIST}
void main() {
  float cov = clamp(u_half + 0.5 - segDist(v_pos, v_a, v_b), 0.0, 1.0);
  if (cov <= 0.0) discard;
  float a = u_color.a * cov;
  o_color = vec4(u_color.rgb * a, a);
}`;

/** Dot at (v_c) of radius v_rad (device px), flat colour. */
export const DOT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_pos;
flat in vec2 v_c;
flat in float v_rad;
flat in vec4 v_color;
out vec4 o_color;
void main() {
  float cov = clamp(v_rad + 0.5 - length(v_pos - v_c), 0.0, 1.0);
  if (cov <= 0.0) discard;
  float a = v_color.a * cov;
  o_color = vec4(v_color.rgb * a, a);
}`;
