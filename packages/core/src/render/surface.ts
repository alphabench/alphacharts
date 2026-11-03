// Where a chart's series are drawn: a WebGL2 context, or Canvas2D when WebGL2
// is unavailable or the page already holds OWN_LIMIT live contexts (browsers
// evict the oldest past ~16). A surface may be shared by the charts of one
// Dashboard; each chart draws into its own cell at (ox, oy).

import { GLContext } from "./gl.js";

export type SurfaceKind = "webgl" | "canvas2d";
export type SurfaceChoice = SurfaceKind | "auto";

export interface PaneRect {
  /** Device px within the chart, top-left origin. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Surface {
  readonly kind: SurfaceKind;
  readonly gl: WebGL2RenderingContext | null;
  readonly glctx: GLContext | null;
  readonly ctx2d: CanvasRenderingContext2D | null;
  /**
   * Start drawing a chart's cell of devW × devH at device offset (ox, oy):
   * clears only that cell. False when nothing can be drawn (context lost).
   */
  begin(ox: number, oy: number, devW: number, devH: number): boolean;
  /** Clip drawing to a pane (cell-relative device px), run `draw`, restore. */
  pane(rect: PaneRect, draw: () => void): void;
  end(): void;
  dispose(): void;
}

export interface SurfaceEvents {
  /** GL objects are gone: drop every renderer made on this surface. */
  lost(): void;
  restored(): void;
}

/** Live own contexts before "auto" falls back to Canvas2D (use a Dashboard for many charts). */
export const OWN_LIMIT = 8;
let ownLive = 0;

const GL_ATTRS: WebGLContextAttributes = { antialias: false, premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: false, powerPreference: "high-performance" };

// ---- released contexts ---------------------------------------------------------------
//
// A removed chart's WebGL context is not gone until the browser collects its
// canvas: WebKit (and Chrome, less strictly) count it against the page's
// limit meanwhile and warn "too many active WebGL contexts" after ~8
// create/remove cycles, even after loseContext(). So a disposed surface does
// not lose its context: it parks the canvas with its context and compiled
// programs, and the next chart in the page adopts it (parkedCanvas). A parked
// context that nobody adopts within PARK_MS is released for real: lost, and
// its canvas shrunk to 0 × 0 so the backing store is freed.

/** Parked contexts kept at most; a further disposed surface is released at once. */
const PARK_MAX = OWN_LIMIT;
const PARK_MS = 10_000;

interface Parked {
  gl: WebGL2RenderingContext;
  glctx: GLContext;
  timer: ReturnType<typeof setTimeout>;
  onLost: () => void;
}
const parked = new Map<HTMLCanvasElement, Parked>();

/** Give a canvas back to the browser: lose its context, free its backing store. */
function releaseCanvas(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext): void {
  if (!gl.isContextLost()) gl.getExtension("WEBGL_lose_context")?.loseContext();
  canvas.width = 0;
  canvas.height = 0;
}

/** A canvas whose WebGL2 context a disposed chart parked, detached from the DOM; undefined when none. */
export function parkedCanvas(): HTMLCanvasElement | undefined {
  for (const [c, p] of parked) {
    if (!p.gl.isContextLost()) return c;
    dropParked(c); // lost while parked (eviction, GPU reset): nothing to adopt
  }
  return undefined;
}

/** Forget a parked canvas and release it. */
function dropParked(canvas: HTMLCanvasElement): void {
  const p = parked.get(canvas);
  if (!p) return;
  parked.delete(canvas);
  clearTimeout(p.timer);
  canvas.removeEventListener("webglcontextlost", p.onLost);
  releaseCanvas(canvas, p.gl);
}

/**
 * `preserveDrawingBuffer`: keep the canvas's pixels between frames. A
 * Dashboard needs it: its charts share one canvas and each redraws only its
 * own cell, so without it the browser's per-frame buffer reset blanks every
 * cell that did not redraw in that frame.
 */
export function createSurface(choice: SurfaceChoice, canvas: HTMLCanvasElement, events: SurfaceEvents, opts: { preserveDrawingBuffer?: boolean } = {}): Surface {
  const p = parked.get(canvas);
  if (p) {
    parked.delete(canvas);
    clearTimeout(p.timer);
    canvas.removeEventListener("webglcontextlost", p.onLost);
    if (!p.gl.isContextLost() && choice !== "canvas2d") return new GLSurface(canvas, p.gl, events, p.glctx);
    // A lost or unwanted parked context: never getContext on its canvas again (it would return the same one).
    releaseCanvas(canvas, p.gl);
    canvas = document.createElement("canvas");
  }
  if (choice === "webgl" || (choice === "auto" && ownLive < OWN_LIMIT)) {
    const gl = canvas.getContext("webgl2", opts.preserveDrawingBuffer ? { ...GL_ATTRS, preserveDrawingBuffer: true } : GL_ATTRS);
    if (gl) return new GLSurface(canvas, gl, events);
    if (choice === "webgl") throw new Error("alphacharts: WebGL2 is not available (renderer: \"webgl\" was requested)");
  }
  return new Canvas2DSurface(canvas);
}

// ---- own context ------------------------------------------------------------------

class GLSurface implements Surface {
  readonly kind = "webgl" as const;
  glctx: GLContext | null;
  readonly ctx2d = null;
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement, readonly gl: WebGL2RenderingContext, private readonly events: SurfaceEvents, glctx?: GLContext) {
    ownLive++;
    this.glctx = glctx ?? new GLContext(gl);
    canvas.addEventListener("webglcontextlost", this.onLost);
    canvas.addEventListener("webglcontextrestored", this.onRestored);
  }

  private ox = 0;
  private oy = 0;

  begin(ox: number, oy: number, devW: number, devH: number): boolean {
    const gl = this.gl;
    if (!this.glctx || gl.isContextLost()) return false;
    this.ox = ox;
    this.oy = oy;
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(ox, this.canvas.height - oy - devH, devW, devH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    return true;
  }

  pane(r: PaneRect, draw: () => void): void {
    const gl = this.gl;
    const y = this.canvas.height - this.oy - r.y - r.height;
    gl.viewport(this.ox + r.x, y, r.width, r.height);
    gl.scissor(this.ox + r.x, y, r.width, r.height);
    draw();
  }

  end(): void {
    this.gl.bindVertexArray(null);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    ownLive--;
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onRestored);
    const { canvas, gl } = this;
    // A lost context cannot be adopted; the browser has already dropped it.
    if (this.glctx && !gl.isContextLost() && parked.size < PARK_MAX) {
      gl.bindVertexArray(null);
      canvas.width = 1;
      canvas.height = 1;
      const timer = setTimeout(() => dropParked(canvas), PARK_MS);
      // Nobody listens for restoration while parked: let a lost context go.
      const onLost = () => dropParked(canvas);
      canvas.addEventListener("webglcontextlost", onLost);
      parked.set(canvas, { gl, glctx: this.glctx, timer, onLost });
    } else {
      releaseCanvas(canvas, gl);
    }
  }

  private readonly onLost = (e: Event): void => {
    e.preventDefault();
    this.glctx?.lost();
    this.glctx = null;
    this.events.lost();
  };

  private readonly onRestored = (): void => {
    this.glctx = new GLContext(this.gl);
    this.events.restored();
  };
}

// ---- Canvas2D ------------------------------------------------------------------------

class Canvas2DSurface implements Surface {
  readonly kind = "canvas2d" as const;
  readonly gl = null;
  readonly glctx = null;
  readonly ctx2d: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("alphacharts: neither WebGL2 nor a 2D context is available");
    this.ctx2d = ctx;
  }

  private ox = 0;
  private oy = 0;

  begin(ox: number, oy: number, devW: number, devH: number): boolean {
    const c = this.ctx2d;
    this.ox = ox;
    this.oy = oy;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(ox, oy, devW, devH);
    return true;
  }

  pane(r: PaneRect, draw: () => void): void {
    const c = this.ctx2d;
    c.save();
    c.setTransform(1, 0, 0, 1, this.ox + r.x, this.oy + r.y);
    c.beginPath();
    c.rect(0, 0, r.width, r.height);
    c.clip();
    draw();
    c.restore();
  }

  end(): void {}

  dispose(): void {}
}
