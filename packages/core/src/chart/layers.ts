// The canvases a chart draws on.
//
// A standalone chart owns three canvases (bg, series, overlay). A chart in a
// Dashboard borrows the dashboard's three, which cover its whole container,
// and draws inside its own cell: measured on this Mac, 16 charts with their
// own canvases miss ~25% of 120 Hz frames from compositing 48 layers and 16
// WebGL contexts; one set of canvases for the dashboard misses none. (A shared
// context that copied each chart into its own canvas was measured too: the
// GPU readback per chart made it 3× slower, so it was removed.)

import { createSurface, parkedCanvas, type Surface, type SurfaceChoice, type SurfaceEvents } from "../render/surface.js";

export interface Layers {
  readonly bg: CanvasRenderingContext2D;
  readonly overlay: CanvasRenderingContext2D;
  readonly surface: Surface;
  /** The chart's device-px offset within the layer canvases. */
  readonly ox: number;
  readonly oy: number;
  /**
   * A chart drew its series layer. A dashboard redraws the cells that did not,
   * once, before the browser paints (see DashboardCanvases.noteGLDraw).
   */
  glDrawn?(chart: GLMember): void;
  /** Size the canvases (standalone) or re-measure the cell (dashboard). */
  fit(cssW: number, cssH: number, dpr: number): void;
  dispose(): void;
}

function canvas(parent: HTMLElement, extra = ""): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.style.cssText = `position:absolute;left:0;top:0;width:100%;height:100%;display:block;${extra}`;
  c.setAttribute("aria-hidden", "true");
  parent.appendChild(c);
  return c;
}

/** A parked canvas (its WebGL context kept from a removed chart) in place of a new one. */
function adopt(c: HTMLCanvasElement, parent: HTMLElement): HTMLCanvasElement {
  c.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;display:block;";
  parent.appendChild(c);
  return c;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("alphacharts: no 2D canvas context available");
  return ctx;
}

export class OwnLayers implements Layers {
  readonly bg: CanvasRenderingContext2D;
  readonly overlay: CanvasRenderingContext2D;
  readonly surface: Surface;
  readonly ox = 0;
  readonly oy = 0;
  private readonly canvases: HTMLCanvasElement[];

  constructor(root: HTMLElement, renderer: SurfaceChoice, events: SurfaceEvents) {
    const bg = canvas(root);
    const reused = renderer === "canvas2d" ? undefined : parkedCanvas();
    const series = reused ? adopt(reused, root) : canvas(root);
    const overlay = canvas(root);
    this.canvases = [bg, series, overlay];
    this.bg = ctx2d(bg);
    this.surface = createSurface(renderer, series, events);
    this.overlay = ctx2d(overlay);
  }

  fit(cssW: number, cssH: number, dpr: number): void {
    for (const c of this.canvases) {
      c.width = Math.max(1, Math.round(cssW * dpr));
      c.height = Math.max(1, Math.round(cssH * dpr));
    }
  }

  dispose(): void {
    this.surface.dispose();
    for (const c of this.canvases) {
      c.remove();
      // The surface keeps (parks) its canvas's GL context; the 2D ones are done.
      if (c !== this.canvases[1] || this.surface.kind !== "webgl") (c.width = 0), (c.height = 0);
    }
  }
}

/** A chart's view of its dashboard's canvases. */
/** What a dashboard needs from its charts to keep the shared canvas whole. */
export interface GLMember {
  redrawGL(): void;
}

export class CellLayers implements Layers {
  ox = 0;
  oy = 0;

  constructor(private readonly dash: DashboardCanvases, private readonly cell: HTMLElement) {}

  get bg(): CanvasRenderingContext2D {
    return this.dash.bg;
  }
  get overlay(): CanvasRenderingContext2D {
    return this.dash.overlay;
  }
  get surface(): Surface {
    return this.dash.surface;
  }

  glDrawn(chart: GLMember): void {
    this.dash.noteGLDraw(chart);
  }

  fit(_cssW: number, _cssH: number, dpr: number): void {
    const c = this.dash.container.getBoundingClientRect();
    const r = this.cell.getBoundingClientRect();
    const ox = Math.round((r.left - c.left) * dpr);
    const oy = Math.round((r.top - c.top) * dpr);
    if (ox !== this.ox || oy !== this.oy) {
      this.ox = ox;
      this.oy = oy;
      // The old cell area holds stale pixels: everyone redraws.
      this.dash.layoutChanged();
    }
  }

  dispose(): void {}
}

/** The three canvases a Dashboard shares among its charts. */
export class DashboardCanvases {
  readonly bg: CanvasRenderingContext2D;
  readonly overlay: CanvasRenderingContext2D;
  readonly surface: Surface;
  private readonly canvases: HTMLCanvasElement[];

  private readonly drawn = new Set<GLMember>();
  private flushQueued = false;
  private flushing = false;

  constructor(
    readonly container: HTMLElement,
    renderer: SurfaceChoice,
    events: SurfaceEvents,
    private readonly onLayout: () => void,
    private readonly members: () => Iterable<GLMember>,
  ) {
    // Canvases paint over the cells but take no input: pointer events reach
    // each chart's own (transparent) root.
    const bg = canvas(container, "pointer-events:none");
    const series = canvas(container, "pointer-events:none");
    const overlay = canvas(container, "pointer-events:none");
    this.canvases = [bg, series, overlay];
    this.bg = ctx2d(bg);
    // The shared WebGL canvas does not keep its pixels between frames (keeping
    // them costs a full-canvas copy every frame: 25 vs 9 missed vsyncs on 16
    // charts, measured). Instead, a frame in which any cell draws redraws every
    // cell once: noteGLDraw.
    this.surface = createSurface(renderer, series, events);
    this.overlay = ctx2d(overlay);
  }

  /**
   * A cell drew its series. The browser clears an un-preserved WebGL buffer
   * after every frame that drew to it, so the other cells must draw in the same
   * frame: a microtask, queued by the first draw, runs after the frame's render
   * loop (or after a synchronous render) and before paint, and redraws each
   * cell that did not draw. Every cell draws at most once a frame.
   */
  noteGLDraw(chart: GLMember): void {
    this.drawn.add(chart);
    if (this.flushing || this.flushQueued) return;
    this.flushQueued = true;
    queueMicrotask(() => {
      this.flushQueued = false;
      this.flushing = true;
      try {
        for (const c of this.members()) if (!this.drawn.has(c)) c.redrawGL();
      } finally {
        this.flushing = false;
        this.drawn.clear();
      }
    });
  }

  /** Match the container; returns true when the size changed (canvases cleared). */
  resize(dpr: number): boolean {
    const r = this.container.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    let changed = false;
    for (const c of this.canvases) {
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
        changed = true;
      }
    }
    return changed;
  }

  layoutChanged(): void {
    this.onLayout();
  }

  clear(): void {
    for (const ctx of [this.bg, this.overlay]) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
  }

  dispose(): void {
    this.surface.dispose();
    for (const c of this.canvases) c.remove();
  }
}
