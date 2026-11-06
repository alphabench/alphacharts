// Built-in WebGL2 series renderers: candles, OHLC bars, histogram, line, area.
//
// All draw instanced quads straight from an InstanceWindow (no per-frame
// geometry on the CPU). Bars are snapped to whole device pixels: body and
// wick widths are integers with equal parity, so a wick sits exactly centred
// on its body at every DPR; tops and bottoms are rounded and at least 1 px.
// Lines and area edges are analytically anti-aliased in the fragment shader.

import type { DataChange, SeriesData } from "../data/model.js";
import type { PriceScale } from "../scale/price-scale.js";
import type { TimeScale } from "../scale/time-scale.js";
import { parseColor, rgba } from "./color.js";
import { GLContext, GLSL_COMMON, type Program } from "./gl.js";
import { chooseLevel, HOLE_TEST, InstanceWindow, RECORD_BYTES } from "./window.js";

/** Everything a renderer needs for one pane in one frame. */
export interface DrawView {
  readonly gl: WebGL2RenderingContext;
  readonly ctx: GLContext;
  readonly data: SeriesData;
  readonly time: TimeScale;
  readonly price: PriceScale;
  readonly dpr: number;
  /** Pane size in device px. */
  readonly width: number;
  readonly height: number;
  /** Visible timeline indices. */
  readonly lo: number;
  readonly hi: number;
}

/** Plugin contract for a WebGL series renderer. */
export interface SeriesRenderer<O> {
  draw(view: DrawView, options: O): void;
  dataChanged(change: DataChange): void;
  /** Drop GL objects (context lost or series removed). */
  dispose(): void;
}

// ---- shared ---------------------------------------------------------------

const FS_FLAT = /* glsl */ `#version 300 es
precision highp float;
in vec4 v_color;
out vec4 o_color;
void main() { o_color = vec4(v_color.rgb * v_color.a, v_color.a); }
`;

const OFFSCREEN = "gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return;";

abstract class WindowRenderer<O> implements SeriesRenderer<O> {
  protected readonly win: InstanceWindow;
  protected readonly vao: WebGLVertexArrayObject;
  protected readonly prog: Program;
  protected level = 0;

  constructor(protected readonly gl: WebGL2RenderingContext, ctx: GLContext, data: SeriesData, zeroBase: boolean, prog: Program, pairs: boolean) {
    this.prog = prog;
    // Pair renderers join consecutive records, so they get holes removed.
    this.win = new InstanceWindow(gl, data, zeroBase, pairs);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.win.buffer);
    // Record i: a_r = (x, o, h, l), a_c = c, a_color. Pair renderers also read
    // record i+1 as a_r1/a_c1 (instance i draws the step from i to i+1).
    bindRecord(gl, prog, "a_r", "a_c", "a_color", 0);
    if (pairs) bindRecord(gl, prog, "a_r1", "a_c1", "a_color1", RECORD_BYTES);
    gl.bindVertexArray(null);
    void ctx;
  }

  abstract draw(view: DrawView, options: O): void;

  dataChanged(c: DataChange): void {
    this.win.dataChanged(c);
  }

  dispose(): void {
    this.win.dispose();
    this.gl.deleteVertexArray(this.vao);
  }

  /** Upload as needed and set the shared uniforms. Returns the record count. */
  protected prepare(v: DrawView): number {
    const gl = this.gl;
    const spacingDev = v.time.spacing * v.dpr;
    this.level = chooseLevel(v.data, spacingDev);
    this.win.setLog(v.price.logCoords);
    this.win.ensure(this.level, v.lo, v.hi);
    gl.useProgram(this.prog.program);
    gl.bindVertexArray(this.vao);
    const u = this.prog.uniforms;
    gl.uniform2f(u.u_view!, v.width, v.height);
    gl.uniform2f(u.u_x!, spacingDev, v.time.x(this.win.base) * v.dpr);
    // y = u_y.y - p_rel · u_y.x, with p_rel the uploaded coordinate minus its base.
    gl.uniform2f(u.u_y!, -v.price.pxPerCoord * v.dpr, v.price.yOfCoord(this.win.priceBase) * v.dpr);
    return this.win.count;
  }

  protected widths(v: DrawView, ratio: number): [number, number] {
    return barWidths(v.time.spacing, v.dpr, this.level, ratio);
  }
}

/**
 * Integer device-px body and wick widths with equal parity, so a wick sits
 * exactly centred on its body. Shared by the WebGL and Canvas2D renderers.
 */
export function barWidths(spacingCss: number, dpr: number, level: number, ratio: number): [number, number] {
  const unit = spacingCss * dpr * (1 << level);
  const wick = Math.max(1, Math.floor(dpr));
  let body = Math.max(1, Math.floor(unit * ratio));
  if (body > wick && (body - wick) % 2 !== 0) body -= 1;
  return [body, Math.min(wick, body)];
}

function bindRecord(gl: WebGL2RenderingContext, p: Program, r: string, c: string, color: string, offset: number): void {
  const a = p.attribs;
  if (a[r]! >= 0) {
    gl.enableVertexAttribArray(a[r]!);
    gl.vertexAttribPointer(a[r]!, 4, gl.FLOAT, false, RECORD_BYTES, offset);
    gl.vertexAttribDivisor(a[r]!, 1);
  }
  if (a[c]! >= 0) {
    gl.enableVertexAttribArray(a[c]!);
    gl.vertexAttribPointer(a[c]!, 1, gl.FLOAT, false, RECORD_BYTES, offset + 16);
    gl.vertexAttribDivisor(a[c]!, 1);
  }
  if (a[color] !== undefined && a[color]! >= 0) {
    gl.enableVertexAttribArray(a[color]!);
    gl.vertexAttribIPointer(a[color]!, 1, gl.UNSIGNED_INT, RECORD_BYTES, offset + 20);
    gl.vertexAttribDivisor(a[color]!, 1);
  }
}

/** Parsed colour uniforms, re-parsed only when the option string changes. */
class Colors {
  private readonly keys: string[] = [];
  private readonly vals: Float32Array[] = [];
  get(slot: number, css: string): Float32Array {
    if (this.keys[slot] !== css) {
      this.keys[slot] = css;
      this.vals[slot] = rgba(parseColor(css));
    }
    return this.vals[slot]!;
  }
}

// ---- candles ----------------------------------------------------------------

export interface CandleStyle {
  upColor: string;
  downColor: string;
  wickUpColor: string;
  wickDownColor: string;
}

// A bar with its own colour (a_color != 0, packed 0xRRGGBBAA) is drawn in it, body and wick; every other bar in the
// up/down colours. The attribute is the record's existing colour slot: no extra buffer, one integer compare per vertex.
const CANDLE_VS = GLSL_COMMON + /* glsl */ `
in vec4 a_r; in float a_c; in uint a_color;
uniform vec2 u_w;
uniform vec4 u_up, u_down, u_wup, u_wdown;
out vec4 v_color;
void main() {
  if (a_r.x < ${HOLE_TEST}) { ${OFFSCREEN} }
  bool wick = gl_VertexID < 6;
  vec2 cr = corner(gl_VertexID % 6);
  float o = a_r.y, h = a_r.z, l = a_r.w, c = a_c;
  float left = floor(xDev(a_r.x) - u_w.x * 0.5 + 0.5);
  float x0, x1, y0, y1;
  if (wick) {
    x0 = left + (u_w.x - u_w.y) * 0.5; x1 = x0 + u_w.y;
    // An inverted scale draws the high below the low: order the edges as drawn.
    float ya = floor(yDev(h) + 0.5), yb = floor(yDev(l) + 0.5);
    y0 = min(ya, yb); y1 = max(max(ya, yb), y0 + 1.0);
  } else {
    x0 = left; x1 = left + u_w.x;
    float ya = floor(yDev(max(o, c)) + 0.5), yb = floor(yDev(min(o, c)) + 0.5);
    y0 = min(ya, yb); y1 = max(max(ya, yb), y0 + 1.0);
  }
  gl_Position = vec4(toClip(vec2(mix(x0, x1, cr.x), mix(y0, y1, cr.y))), 0.0, 1.0);
  bool up = c >= o;
  v_color = a_color != 0u ? unpack(a_color) : wick ? (up ? u_wup : u_wdown) : (up ? u_up : u_down);
}`;

export class CandleRenderer extends WindowRenderer<CandleStyle> {
  private readonly colors = new Colors();
  constructor(gl: WebGL2RenderingContext, ctx: GLContext, data: SeriesData) {
    super(gl, ctx, data, false, ctx.program("candles", CANDLE_VS, FS_FLAT, ["u_w", "u_up", "u_down", "u_wup", "u_wdown"], ["a_r", "a_c", "a_color"]), false);
  }
  draw(v: DrawView, o: CandleStyle): void {
    const n = this.prepare(v);
    if (n === 0) return;
    const gl = this.gl, u = this.prog.uniforms;
    const [body, wick] = this.widths(v, 0.8);
    gl.uniform2f(u.u_w!, body, wick);
    gl.uniform4fv(u.u_up!, this.colors.get(0, o.upColor));
    gl.uniform4fv(u.u_down!, this.colors.get(1, o.downColor));
    gl.uniform4fv(u.u_wup!, this.colors.get(2, o.wickUpColor));
    gl.uniform4fv(u.u_wdown!, this.colors.get(3, o.wickDownColor));
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 12, n);
  }
}

// ---- OHLC bars ----------------------------------------------------------------

export interface BarStyle {
  upColor: string;
  downColor: string;
}

const BAR_VS = GLSL_COMMON + /* glsl */ `
in vec4 a_r; in float a_c; in uint a_color;
uniform vec2 u_w;
uniform vec4 u_up, u_down;
out vec4 v_color;
void main() {
  if (a_r.x < ${HOLE_TEST}) { ${OFFSCREEN} }
  int seg = gl_VertexID / 6;
  vec2 cr = corner(gl_VertexID % 6);
  float o = a_r.y, h = a_r.z, l = a_r.w, c = a_c, t = u_w.y;
  float left = floor(xDev(a_r.x) - u_w.x * 0.5 + 0.5);
  float mid = left + (u_w.x - t) * 0.5;
  float x0, x1, y0, y1;
  if (seg == 0) {
    x0 = mid; x1 = mid + t;
    float ya = floor(yDev(h) + 0.5), yb = floor(yDev(l) + 0.5);
    y0 = min(ya, yb); y1 = max(max(ya, yb), y0 + 1.0);
  } else {
    float y = floor(yDev(seg == 1 ? o : c) - t * 0.5 + 0.5);
    y0 = y; y1 = y + t;
    if (seg == 1) { x0 = left; x1 = mid; } else { x0 = mid + t; x1 = left + u_w.x; }
  }
  gl_Position = vec4(toClip(vec2(mix(x0, x1, cr.x), mix(y0, y1, cr.y))), 0.0, 1.0);
  v_color = a_color != 0u ? unpack(a_color) : c >= o ? u_up : u_down;
}`;

export class BarRenderer extends WindowRenderer<BarStyle> {
  private readonly colors = new Colors();
  constructor(gl: WebGL2RenderingContext, ctx: GLContext, data: SeriesData) {
    super(gl, ctx, data, false, ctx.program("bars", BAR_VS, FS_FLAT, ["u_w", "u_up", "u_down"], ["a_r", "a_c", "a_color"]), false);
  }
  draw(v: DrawView, o: BarStyle): void {
    const n = this.prepare(v);
    if (n === 0) return;
    const gl = this.gl, u = this.prog.uniforms;
    const [body, thick] = this.widths(v, 0.8);
    gl.uniform2f(u.u_w!, body, thick);
    gl.uniform4fv(u.u_up!, this.colors.get(0, o.upColor));
    gl.uniform4fv(u.u_down!, this.colors.get(1, o.downColor));
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 18, n);
  }
}

// ---- histogram ----------------------------------------------------------------

export interface HistogramStyle {
  color: string;
  /** Value the bars grow from. */
  base: number;
}

const HIST_VS = GLSL_COMMON + /* glsl */ `
in vec4 a_r; in uint a_color;
uniform float u_w;
uniform float u_base;
uniform vec4 u_color;
out vec4 v_color;
void main() {
  if (a_r.x < ${HOLE_TEST}) { ${OFFSCREEN} }
  vec2 cr = corner(gl_VertexID);
  float left = floor(xDev(a_r.x) - u_w * 0.5 + 0.5);
  // Zoomed out, a bucket spans bars on both sides of the base: draw the
  // extreme farthest from it (at level 0, high == low == value).
  float v = abs(a_r.z - u_base) >= abs(a_r.w - u_base) ? a_r.z : a_r.w;
  float yv = floor(yDev(v) + 0.5), yb = floor(yDev(u_base) + 0.5);
  float y0 = min(yv, yb), y1 = max(max(yv, yb), y0 + 1.0);
  gl_Position = vec4(toClip(vec2(mix(left, left + u_w, cr.x), mix(y0, y1, cr.y))), 0.0, 1.0);
  v_color = a_color != 0u ? unpack(a_color) : u_color;
}`;

export class HistogramRenderer extends WindowRenderer<HistogramStyle> {
  private readonly colors = new Colors();
  constructor(gl: WebGL2RenderingContext, ctx: GLContext, data: SeriesData) {
    super(gl, ctx, data, true, ctx.program("histogram", HIST_VS, FS_FLAT, ["u_w", "u_base", "u_color"], ["a_r", "a_color"]), false);
  }
  draw(v: DrawView, o: HistogramStyle): void {
    const n = this.prepare(v);
    if (n === 0) return;
    const gl = this.gl, u = this.prog.uniforms;
    gl.uniform1f(u.u_w!, this.widths(v, 0.8)[0]);
    // On a log scale a base at or below zero sits at the pane's lowest value.
    const base = v.price.logCoords && !(o.base > 0) ? v.price.min : v.price.coord(o.base);
    gl.uniform1f(u.u_base!, base - this.win.priceBase);
    gl.uniform4fv(u.u_color!, this.colors.get(0, o.color));
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
  }
}

// ---- line -------------------------------------------------------------------

export interface LineStyle {
  color: string;
  /** CSS px. */
  lineWidth: number;
}

// Instance i joins record i to record i+1 with an anti-aliased capsule. Above
// level 0 a second capsule spans record i+1's low..high, so a zoomed-out line
// draws the exact per-bucket envelope instead of a sampled path. A segment takes
// the colour of the point it arrives at (record i+1) when that point has one.
const LINE_VS = GLSL_COMMON + /* glsl */ `
in vec4 a_r; in float a_c;
in vec4 a_r1; in uint a_color1;
uniform float u_half;
uniform int u_env;
out vec2 v_pos;
flat out vec2 v_a;
flat out vec2 v_b;
flat out vec4 v_seg;
void main() {
  if (a_r.x < ${HOLE_TEST} || a_r1.x < ${HOLE_TEST}) { ${OFFSCREEN} }
  bool env = gl_VertexID >= 6;
  if (env && u_env == 0) { ${OFFSCREEN} }
  vec2 a = env ? vec2(xDev(a_r1.x), yDev(a_r1.w)) : vec2(xDev(a_r.x), yDev(a_c));
  vec2 b = env ? vec2(xDev(a_r1.x), yDev(a_r1.z)) : vec2(xDev(a_r1.x), yDev(a_r1.y));
  vec2 d = b - a;
  float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float r = u_half + 1.0;
  vec2 cr = corner(gl_VertexID % 6);
  vec2 p = mix(a - dir * r, b + dir * r, cr.x) + nrm * mix(-r, r, cr.y);
  v_pos = p; v_a = a; v_b = b;
  v_seg = a_color1 != 0u ? unpack(a_color1) : vec4(0.0, 0.0, 0.0, -1.0);
  gl_Position = vec4(toClip(p), 0.0, 1.0);
}`;

const LINE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_pos;
flat in vec2 v_a;
flat in vec2 v_b;
flat in vec4 v_seg;
uniform float u_half;
uniform vec4 u_color;
out vec4 o_color;
void main() {
  vec2 pa = v_pos - v_a, ba = v_b - v_a;
  float t = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  float dist = length(pa - ba * t);
  float cov = clamp(u_half + 0.5 - dist, 0.0, 1.0);
  if (cov <= 0.0) discard;
  vec4 col = v_seg.a < 0.0 ? u_color : v_seg;
  float a = col.a * cov;
  o_color = vec4(col.rgb * a, a);
}`;

export class LineRenderer extends WindowRenderer<LineStyle> {
  private readonly colors = new Colors();
  constructor(gl: WebGL2RenderingContext, ctx: GLContext, data: SeriesData) {
    super(gl, ctx, data, false, ctx.program("line", LINE_VS, LINE_FS, ["u_half", "u_env", "u_color"], ["a_r", "a_c", "a_r1", "a_color1"]), true);
  }
  draw(v: DrawView, o: LineStyle): void {
    const n = this.prepare(v);
    if (n < 2) return;
    this.drawLine(v, o.color, o.lineWidth, n);
  }
  /** Draw with the program already prepared (shared with AreaRenderer). */
  drawLine(v: DrawView, color: string, width: number, n: number): void {
    const gl = this.gl, u = this.prog.uniforms;
    gl.uniform1f(u.u_half!, Math.max(0.5, (width * v.dpr) / 2));
    gl.uniform1i(u.u_env!, this.level > 0 ? 1 : 0);
    gl.uniform4fv(u.u_color!, this.colors.get(0, color));
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 12, n - 1);
  }
}

// ---- area -------------------------------------------------------------------

export interface AreaStyle {
  lineColor: string;
  topColor: string;
  bottomColor: string;
  lineWidth: number;
}

const AREA_VS = GLSL_COMMON + /* glsl */ `
in vec4 a_r; in vec4 a_r1;
out float v_t;
void main() {
  if (a_r.x < ${HOLE_TEST} || a_r1.x < ${HOLE_TEST}) { ${OFFSCREEN} }
  vec2 cr = corner(gl_VertexID);
  float x = mix(xDev(a_r.x), xDev(a_r1.x), cr.x);
  float top = mix(yDev(a_r.z), yDev(a_r1.z), cr.x);
  float y = mix(top, u_view.y, cr.y);
  v_t = y / u_view.y;
  gl_Position = vec4(toClip(vec2(x, y)), 0.0, 1.0);
}`;

const AREA_FS = /* glsl */ `#version 300 es
precision highp float;
in float v_t;
uniform vec4 u_top, u_bottom;
out vec4 o_color;
void main() {
  vec4 c = mix(u_top, u_bottom, clamp(v_t, 0.0, 1.0));
  o_color = vec4(c.rgb * c.a, c.a);
}`;

export class AreaRenderer implements SeriesRenderer<AreaStyle> {
  private readonly fill: AreaFill;
  private readonly line: LineRenderer;
  constructor(gl: WebGL2RenderingContext, ctx: GLContext, data: SeriesData) {
    this.fill = new AreaFill(gl, ctx, data);
    this.line = new LineRenderer(gl, ctx, data);
  }
  draw(v: DrawView, o: AreaStyle): void {
    this.fill.draw(v, o);
    this.line.draw(v, { color: o.lineColor, lineWidth: o.lineWidth });
  }
  dataChanged(c: DataChange): void {
    this.fill.dataChanged(c);
    this.line.dataChanged(c);
  }
  dispose(): void {
    this.fill.dispose();
    this.line.dispose();
  }
}

class AreaFill extends WindowRenderer<AreaStyle> {
  private readonly colors = new Colors();
  constructor(gl: WebGL2RenderingContext, ctx: GLContext, data: SeriesData) {
    super(gl, ctx, data, false, ctx.program("area", AREA_VS, AREA_FS, ["u_top", "u_bottom"], ["a_r", "a_r1"]), true);
  }
  draw(v: DrawView, o: AreaStyle): void {
    const n = this.prepare(v);
    if (n < 2) return;
    const gl = this.gl, u = this.prog.uniforms;
    gl.uniform4fv(u.u_top!, this.colors.get(0, o.topColor));
    gl.uniform4fv(u.u_bottom!, this.colors.get(1, o.bottomColor));
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n - 1);
  }
}
