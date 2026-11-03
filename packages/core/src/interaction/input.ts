// Pointer, wheel and keyboard input for one chart.
//
// Pointer Events cover mouse, pen and touch:
// - drag in a pane pans time (and price when its scale is not autoscaling),
//   then coasts with kinetic decay;
// - drag on a price axis scales price, on the time axis scales time;
// - drag on a separator resizes panes;
// - two touch pointers pinch-zoom around their midpoint.
// The wheel zooms around the pointer (vertical wheel, or ctrl+wheel, which is
// how macOS trackpads report a pinch) and pans on horizontal deltas.
// Touch: long-press turns the drag into a crosshair that follows the finger;
// two quick taps act as a double-click. Kinetic scrolling is off under
// prefers-reduced-motion.
// Keyboard: chart.options().keymap (TradingView-like defaults: ←/→ pan, ↑/↓
// and +/− zoom, Home/End, Shift+←/→ step the crosshair one bar, announced to
// screen readers, Esc hides it, Alt+R resets).

import type { Chart } from "../chart/chart.js";
import { LAYER_OVERLAY } from "../chart/scheduler.js";

type Drag =
  | { kind: "pan"; pane: number; x: number; y: number; moved: boolean }
  | { kind: "priceAxis"; pane: number; scaleId: string; y: number; moved: boolean }
  | { kind: "timeAxis"; x: number; moved: boolean }
  | { kind: "separator"; index: number; y: number; moved: boolean }
  /** A plugin consumed the pointer-down: it gets the move/up, the chart does nothing. */
  | { kind: "plugin"; moved: boolean }
  /** Touch long-press: the crosshair follows the finger instead of panning. */
  | { kind: "crosshair"; pane: number; moved: boolean };

const DRAG_SLOP = 3;
const KINETIC_MIN = 0.15; // px/ms to start coasting
const KINETIC_STOP = 0.02;

export class Interaction {
  private drag: Drag | null = null;
  private readonly pointers = new Map<number, { x: number; y: number; type: string }>();
  private pinch: { dist: number; mid: number } | null = null;
  private samples: { t: number; x: number }[] = [];
  private kinetic = 0;
  private rect: DOMRect | null = null;
  private longPress = 0;
  private lastTap = { t: 0, x: 0, y: 0 };

  constructor(private readonly chart: Chart, private readonly root: HTMLElement, private readonly surface: HTMLElement) {
    surface.addEventListener("pointerdown", this.down);
    surface.addEventListener("pointermove", this.move);
    surface.addEventListener("pointerup", this.up);
    surface.addEventListener("pointercancel", this.up);
    surface.addEventListener("pointerleave", this.leave);
    surface.addEventListener("dblclick", this.dbl);
    surface.addEventListener("wheel", this.wheel, { passive: false });
    root.addEventListener("keydown", this.key);
  }

  dispose(): void {
    this.stopKinetic();
    this.cancelLongPress();
    const s = this.surface;
    s.removeEventListener("pointerdown", this.down);
    s.removeEventListener("pointermove", this.move);
    s.removeEventListener("pointerup", this.up);
    s.removeEventListener("pointercancel", this.up);
    s.removeEventListener("pointerleave", this.leave);
    s.removeEventListener("dblclick", this.dbl);
    s.removeEventListener("wheel", this.wheel);
    this.root.removeEventListener("keydown", this.key);
  }

  private twoPointers(): [{ x: number; y: number }, { x: number; y: number }] {
    const [a, b] = this.pointers.values();
    return [a!, b!];
  }

  private local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.rect ?? this.root.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private readonly down = (e: PointerEvent): void => {
    this.stopKinetic();
    this.rect = this.root.getBoundingClientRect();
    const p = this.local(e);
    this.pointers.set(e.pointerId, { ...p, type: e.pointerType });
    this.surface.setPointerCapture(e.pointerId);
    this.root.focus({ preventScroll: true });
    if (this.pointers.size === 2) {
      const [a, b] = this.twoPointers();
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: (a.x + b.x) / 2 };
      this.drag = null;
      return;
    }
    if (this.pointers.size > 2) return;
    const r = this.chart.region(p.x, p.y);
    if (r.kind === "pane" && this.chart.pluginPointer("down", p.x, p.y, e)) {
      this.drag = { kind: "plugin", moved: false };
      return;
    }
    switch (r.kind) {
      case "pane":
        this.drag = { kind: "pan", pane: r.pane, x: p.x, y: p.y, moved: false };
        this.samples = [{ t: e.timeStamp, x: p.x }];
        if (e.pointerType === "touch") {
          const pane = r.pane;
          this.longPress = window.setTimeout(() => {
            this.longPress = 0;
            if (this.drag?.kind === "pan" && !this.drag.moved) this.drag = { kind: "crosshair", pane, moved: false };
          }, 450);
        }
        if (e.pointerType !== "mouse") this.chart.setCrosshair({ x: p.x, y: r.y, pane: r.pane }, "pointer");
        break;
      case "priceAxis":
        this.drag = { kind: "priceAxis", pane: r.pane, scaleId: r.scaleId, y: p.y, moved: false };
        break;
      case "timeAxis":
        this.drag = { kind: "timeAxis", x: p.x, moved: false };
        break;
      case "separator":
        this.drag = { kind: "separator", index: r.index, y: p.y, moved: false };
        break;
      case "none":
        this.drag = null;
    }
  };

  private readonly move = (e: PointerEvent): void => {
    const p = this.local(e);
    const ptr = this.pointers.get(e.pointerId);
    if (ptr) {
      ptr.x = p.x;
      ptr.y = p.y;
    }
    const opts = this.chart.interactionOptions;
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = this.twoPointers();
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = (a.x + b.x) / 2;
      const area = this.chart.paneArea;
      this.chart.viewChanged(() => {
        if (opts.pan) this.chart.time.pan(mid - this.pinch!.mid);
        if (opts.zoom && this.pinch!.dist > 0) this.chart.time.zoom(mid - area.x, dist / this.pinch!.dist);
      });
      this.pinch = { dist, mid };
      return;
    }
    const d = this.drag;
    if (!d) {
      this.chart.pluginPointer("move", p.x, p.y, e);
      this.hover(p.x, p.y, e.pointerType);
      return;
    }
    switch (d.kind) {
      case "crosshair": {
        d.moved = true;
        const r = this.chart.region(p.x, p.y);
        if (r.kind === "pane") this.chart.setCrosshair({ x: p.x, y: r.y, pane: r.pane }, "pointer");
        break;
      }
      case "plugin":
        d.moved = true;
        this.chart.pluginPointer("move", p.x, p.y, e);
        if (e.pointerType === "mouse") this.hover(p.x, p.y, e.pointerType);
        break;
      case "pan": {
        const dx = p.x - d.x, dy = p.y - d.y;
        if (!d.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
        d.moved = true;
        this.cancelLongPress();
        if (opts.pan) {
          this.chart.viewChanged(() => this.chart.time.pan(dx));
          this.chart.panPrice(d.pane, dy);
        }
        d.x = p.x;
        d.y = p.y;
        this.samples.push({ t: e.timeStamp, x: p.x });
        if (this.samples.length > 8) this.samples.shift();
        if (e.pointerType === "mouse") this.hover(p.x, p.y, e.pointerType);
        else this.chart.setCrosshair(null, "pointer");
        break;
      }
      case "priceAxis": {
        const dy = p.y - d.y;
        d.moved ||= Math.abs(dy) > 0;
        if (opts.zoom) this.chart.scalePrice(d.pane, d.scaleId, Math.exp(-dy * 0.005));
        d.y = p.y;
        break;
      }
      case "timeAxis": {
        const dx = p.x - d.x;
        d.moved ||= Math.abs(dx) > 0;
        const area = this.chart.paneArea;
        if (opts.zoom) this.chart.viewChanged(() => this.chart.time.zoom(area.width, Math.exp(dx * 0.005)));
        d.x = p.x;
        break;
      }
      case "separator": {
        const dy = p.y - d.y;
        d.moved ||= Math.abs(dy) > 0;
        this.chart.resizePanes(d.index, dy);
        d.y = p.y;
        break;
      }
    }
  };

  private readonly up = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.surface.hasPointerCapture(e.pointerId)) this.surface.releasePointerCapture(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    const d = this.drag;
    this.drag = null;
    this.rect = null;
    this.cancelLongPress();
    if (!d || e.type === "pointercancel") return;
    if (d.kind === "plugin") {
      const p = this.local(e);
      this.chart.pluginPointer("up", p.x, p.y, e);
      return;
    }
    if (d.kind === "crosshair") return;
    if (!d.moved) {
      const p = this.local(e);
      // Touch has no dblclick event: two taps within 300 ms and 24 px act as one.
      if (e.pointerType === "touch") {
        const tap = this.lastTap;
        if (e.timeStamp - tap.t < 300 && Math.hypot(p.x - tap.x, p.y - tap.y) < 24) {
          this.lastTap = { t: 0, x: 0, y: 0 };
          this.doubleAt(p.x, p.y, e);
          return;
        }
        this.lastTap = { t: e.timeStamp, x: p.x, y: p.y };
      }
      if (!this.chart.pluginPointer("click", p.x, p.y, e)) this.chart.pointerEvent("click");
      return;
    }
    if (d.kind === "pan" && this.chart.interactionOptions.kinetic && !this.chart.reducedMotion) this.startKinetic(e.timeStamp);
  };

  private readonly leave = (e: PointerEvent): void => {
    if (e.pointerType === "mouse" && !this.drag) {
      const p = this.local(e);
      this.chart.pluginPointer("leave", p.x, p.y, e);
      this.chart.setCrosshair(null, "pointer");
    }
  };

  private readonly dbl = (e: MouseEvent): void => {
    const p = this.local(e);
    this.doubleAt(p.x, p.y, e);
  };

  private doubleAt(x: number, y: number, e: MouseEvent): void {
    const p = { x, y };
    const r = this.chart.region(p.x, p.y);
    if (r.kind === "priceAxis") this.chart.resetPriceScale(r.pane, r.scaleId);
    else if (r.kind === "timeAxis") this.chart.timeScale.reset();
    else if (r.kind === "pane" && !this.chart.pluginPointer("dblclick", p.x, p.y, e)) this.chart.pointerEvent("dblclick");
  }

  private cancelLongPress(): void {
    if (this.longPress) clearTimeout(this.longPress);
    this.longPress = 0;
  }

  private readonly wheel = (e: WheelEvent): void => {
    const opts = this.chart.interactionOptions;
    if (!opts.zoom && !opts.pan) return;
    e.preventDefault();
    this.stopKinetic();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.root.clientHeight : 1;
    const dx = e.deltaX * unit, dy = e.deltaY * unit;
    const p = this.local(e);
    const area = this.chart.paneArea;
    this.chart.viewChanged(() => {
      if (e.ctrlKey || e.metaKey) {
        if (opts.zoom) this.chart.time.zoom(p.x - area.x, Math.exp(-dy * 0.01));
      } else if (Math.abs(dx) > Math.abs(dy)) {
        if (opts.pan) this.chart.time.pan(-dx);
      } else if (e.shiftKey) {
        if (opts.pan) this.chart.time.pan(-dy);
      } else if (opts.zoom) {
        this.chart.time.zoom(p.x - area.x, Math.exp(-dy * 0.002));
      }
    });
    this.hover(p.x, p.y, "mouse");
  };

  private readonly key = (e: KeyboardEvent): void => {
    if (this.chart.pluginKey(e)) {
      e.preventDefault();
      return;
    }
    if (!this.chart.interactionOptions.keyboard) return;
    const t = this.chart.time;
    const area = this.chart.paneArea;
    const action = this.chart.keyAction(e);
    const handled = action !== undefined;
    switch (action) {
      case "panLeft": this.chart.viewChanged(() => t.pan(area.width * 0.1)); break;
      case "panRight": this.chart.viewChanged(() => t.pan(-area.width * 0.1)); break;
      case "zoomIn": this.chart.viewChanged(() => t.zoom(area.width, 1.25)); break;
      case "zoomOut": this.chart.viewChanged(() => t.zoom(area.width, 0.8)); break;
      case "scrollToStart": this.chart.timeScale.scrollToStart(); break;
      case "scrollToLatest": this.chart.timeScale.scrollToLatest(); break;
      case "crosshairLeft": this.stepCrosshair(-1); break;
      case "crosshairRight": this.stepCrosshair(1); break;
      case "hideCrosshair": this.chart.setCrosshair(null, "keyboard"); break;
      case "resetChart": this.chart.resetChart(); break;
      case undefined: break;
    }
    if (handled) e.preventDefault();
  };

  /** Move the keyboard crosshair one bar, keeping it on screen. */
  private stepCrosshair(dir: -1 | 1): void {
    const c = this.chart, t = c.time, area = c.paneArea;
    if (t.end <= t.first) return;
    let i = c.crosshairIndex() ?? Math.min(t.last, Math.max(t.first, t.indexAt(area.width / 2)));
    i = Math.max(t.first, Math.min(t.last, i + (c.crosshair ? dir : 0)));
    let x = t.x(i);
    if (x < 0 || x > area.width) {
      c.viewChanged(() => t.pan(x < 0 ? -x + t.spacing : area.width - x - t.spacing));
      x = t.x(i);
    }
    c.setCrosshair({ x: area.x + x, y: c.crosshair?.y ?? 0, pane: c.crosshair?.pane ?? 0 }, "keyboard");
  }

  private hover(x: number, y: number, pointerType: string): void {
    const r = this.chart.region(x, y);
    let cursor = "default";
    switch (r.kind) {
      case "pane":
        cursor = this.chart.primitiveCursor(r.pane, r.x, r.y) ?? (this.drag ? "grabbing" : "crosshair");
        if (pointerType === "mouse" || pointerType === "pen") this.chart.setCrosshair({ x, y: r.y, pane: r.pane }, "pointer");
        break;
      case "priceAxis": cursor = "ns-resize"; this.chart.setCrosshair(null, "pointer"); break;
      case "timeAxis": cursor = "ew-resize"; this.chart.setCrosshair(null, "pointer"); break;
      case "separator": cursor = "row-resize"; break;
      case "none": this.chart.setCrosshair(null, "pointer");
    }
    if (this.surface.style.cursor !== cursor) this.surface.style.cursor = cursor;
  }

  private startKinetic(now: number): void {
    const s = this.samples;
    const first = s.find((x) => now - x.t < 100) ?? s[0];
    const last = s[s.length - 1];
    if (!first || !last || last.t === first.t) return;
    let v = (last.x - first.x) / (last.t - first.t);
    if (Math.abs(v) < KINETIC_MIN) return;
    let prev = performance.now();
    const step = (t: number) => {
      const dt = Math.min(64, t - prev);
      prev = t;
      this.chart.viewChanged(() => this.chart.time.pan(v * dt));
      v *= Math.pow(0.95, dt / 16);
      this.kinetic = Math.abs(v) > KINETIC_STOP ? requestAnimationFrame(step) : 0;
    };
    this.kinetic = requestAnimationFrame(step);
    this.chart.invalidate(LAYER_OVERLAY);
  }

  private stopKinetic(): void {
    if (this.kinetic) cancelAnimationFrame(this.kinetic);
    this.kinetic = 0;
  }
}
