// WebGL2 plumbing shared by every series renderer: program compilation and a
// per-context program cache (so many series of one type share one program).

import { emitFault } from "../fault.js";

export const GLSL_COMMON = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
// Pane size in device px.
uniform vec2 u_view;
// x_dev = x_rel * u_x.x + u_x.y; y_dev = u_y.y - p_rel * u_y.x (device px, y down).
uniform vec2 u_x;
uniform vec2 u_y;
vec2 toClip(vec2 px) {
  return vec2(px.x / u_view.x * 2.0 - 1.0, 1.0 - px.y / u_view.y * 2.0);
}
float xDev(float xr) { return xr * u_x.x + u_x.y; }
float yDev(float pr) { return u_y.y - pr * u_y.x; }
// Corner of a two-triangle quad for vertex v in 0..5: (0,0) (1,0) (0,1) (0,1) (1,0) (1,1).
vec2 corner(int v) {
  int c = v == 0 ? 0 : v == 1 ? 1 : v == 2 ? 2 : v == 3 ? 2 : v == 4 ? 1 : 3;
  return vec2(float(c & 1), float(c >> 1));
}
vec4 unpack(uint c) {
  return vec4(float((c >> 24) & 255u), float((c >> 16) & 255u), float((c >> 8) & 255u), float(c & 255u)) / 255.0;
}
`;

export interface Program {
  readonly program: WebGLProgram;
  readonly uniforms: Record<string, WebGLUniformLocation | null>;
  readonly attribs: Record<string, number>;
}

export class GLContext {
  private readonly programs = new Map<string, Program>();

  constructor(readonly gl: WebGL2RenderingContext) {}

  program(key: string, vs: string, fs: string, uniforms: readonly string[], attribs: readonly string[]): Program {
    const hit = this.programs.get(key);
    if (hit) return hit;
    const gl = this.gl;
    const p = gl.createProgram();
    gl.attachShader(p, shader(gl, gl.VERTEX_SHADER, vs, key));
    gl.attachShader(p, shader(gl, gl.FRAGMENT_SHADER, fs, key));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
      const error = new Error(`alphacharts: link failed for ${key}: ${gl.getProgramInfoLog(p)}`);
      emitFault({ source: "shader", error, renderer: "webgl" });
      throw error;
    }
    const prog: Program = {
      program: p,
      uniforms: Object.fromEntries(["u_view", "u_x", "u_y", ...uniforms].map((u) => [u, gl.getUniformLocation(p, u)])),
      attribs: Object.fromEntries(attribs.map((a) => [a, gl.getAttribLocation(p, a)])),
    };
    this.programs.set(key, prog);
    return prog;
  }

  /** Forget programs after a context loss; the next program() call recompiles. */
  lost(): void {
    this.programs.clear();
  }
}

function shader(gl: WebGL2RenderingContext, type: number, src: string, key: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const error = new Error(`alphacharts: ${type === gl.VERTEX_SHADER ? "vertex" : "fragment"} shader ${key}: ${gl.getShaderInfoLog(s)}`);
    emitFault({ source: "shader", error, renderer: "webgl" });
    throw error;
  }
  return s;
}
