// Shared plumbing for the WebGL renderers in this package.
//
// The core keeps its own window renderer base private; plugins get the
// building blocks (InstanceWindow, GLSL_COMMON, barWidths, chooseLevel) and
// assemble the same thing. A renderer here owns one InstanceWindow (the GPU
// copy of the visible range at one level of detail) and one or more programs
// that draw from it, each with its own vertex array: a "pair" program joins
// record i to record i + 1 (lines, fills, connectors); a plain one reads one
// record per instance. Holes are compacted out for pair programs, so a series
// whose times are a subset of the timeline joins present points, as the core's
// line does.
//
// Records are [x, o, h, l, c, color] relative to the window's base index and
// base price (see InstanceWindow); in the shaders `a_r` is (x, o, h, l) and
// `a_c` is c. A value series stores its value in all four.

import { parseColor, rgba, type DrawView, type SeriesData, type SeriesRenderer, type DataChange } from "@alphacharts/core";
import { chooseLevel, GLSL_COMMON, InstanceWindow, RECORD_BYTES, type GLContext, type Program } from "@alphacharts/core/internal";

export { GLSL_COMMON };

/** Premultiplied-alpha output of a flat v_color. */
export const FS_FLAT = /* glsl */ `#version 300 es
precision highp float;
in vec4 v_color;
out vec4 o_color;
void main() { o_color = vec4(v_color.rgb * v_color.a, v_color.a); }
`;

/** Collapse an instance (a hole, or a record that cannot be drawn). */
export const OFFSCREEN = "gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return;";

/** Parsed colour uniforms, re-parsed only when the option string changes. */
export class Colors {
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

export interface ProgramSpec {
  readonly prog: Program;
  /** Also reads record i + 1 as a_r1 / a_c1. */
  readonly pairs: boolean;
}

export abstract class GLSeries<O> implements SeriesRenderer<O> {
  protected readonly win: InstanceWindow;
  private readonly vaos: WebGLVertexArrayObject[] = [];
  protected level = 0;

  protected constructor(
    protected readonly gl: WebGL2RenderingContext,
    data: SeriesData,
    zeroBase: boolean,
    private readonly specs: readonly ProgramSpec[],
  ) {
    this.win = new InstanceWindow(gl, data, zeroBase, specs.some((s) => s.pairs));
    for (const { prog, pairs } of specs) {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.win.buffer);
      bindRecord(gl, prog, "a_r", "a_c", "a_color", 0);
      if (pairs) bindRecord(gl, prog, "a_r1", "a_c1", "a_color1", RECORD_BYTES);
      gl.bindVertexArray(null);
      this.vaos.push(vao);
    }
  }

  abstract draw(view: DrawView, options: O): void;

  dataChanged(c: DataChange): void {
    this.win.dataChanged(c);
  }

  dispose(): void {
    this.win.dispose();
    for (const v of this.vaos) this.gl.deleteVertexArray(v);
  }

  /** Level of detail for this frame; a renderer that cannot aggregate overrides it. */
  protected pickLevel(v: DrawView): number {
    return chooseLevel(v.data, v.time.spacing * v.dpr);
  }

  /** Upload as needed, bind program `which` and set the shared uniforms. Returns the record count. */
  protected prepare(v: DrawView, which: number): number {
    const gl = this.gl;
    this.level = this.pickLevel(v);
    this.win.setLog(v.price.logCoords);
    this.win.ensure(this.level, v.lo, v.hi);
    const spec = this.specs[which]!;
    gl.useProgram(spec.prog.program);
    gl.bindVertexArray(this.vaos[which]!);
    const u = spec.prog.uniforms;
    const spacingDev = v.time.spacing * v.dpr;
    gl.uniform2f(u.u_view!, v.width, v.height);
    gl.uniform2f(u.u_x!, spacingDev, v.time.x(this.win.base) * v.dpr);
    // y = u_y.y - p_rel * u_y.x, with p_rel the uploaded coordinate minus its base.
    gl.uniform2f(u.u_y!, -v.price.pxPerCoord * v.dpr, v.price.yOfCoord(this.win.priceBase) * v.dpr);
    return this.win.count;
  }

  protected uniforms(which: number): Program["uniforms"] {
    return this.specs[which]!.prog.uniforms;
  }
}

function bindRecord(gl: WebGL2RenderingContext, p: Program, r: string, c: string, color: string, offset: number): void {
  const a = p.attribs;
  if (a[r] !== undefined && a[r]! >= 0) {
    gl.enableVertexAttribArray(a[r]!);
    gl.vertexAttribPointer(a[r]!, 4, gl.FLOAT, false, RECORD_BYTES, offset);
    gl.vertexAttribDivisor(a[r]!, 1);
  }
  if (a[c] !== undefined && a[c]! >= 0) {
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

/** Compile (once per context) a program from this package. */
export function program(ctx: GLContext, key: string, vs: string, fs: string, uniforms: readonly string[], attribs: readonly string[]): Program {
  return ctx.program(`ac-ct:${key}`, vs, fs, uniforms, attribs);
}

/** Smallest log base for non-positive bases on a log scale, as the core's histogram does. */
export function baseCoord(v: DrawView, base: number): number {
  return v.price.logCoords && !(base > 0) ? v.price.min : v.price.coord(base);
}
