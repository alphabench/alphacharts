// Horizontal mapping between timeline index and CSS pixels inside a pane.
//
// The view is two numbers: `spacing` (CSS px per bar) and `rightOffset` (bars
// between the last bar and the right edge; negative when scrolled into
// history). Anchoring on the last bar is what makes "follow the live bar" free:
// appending a bar with rightOffset unchanged scrolls the view by one bar.

export interface TimeScaleOptions {
  /** Initial and reset bar spacing in CSS px. */
  barSpacing: number;
  maxBarSpacing: number;
  /** Bars of empty space right of the last bar at reset. */
  rightOffset: number;
}

export const DEFAULT_TIME_SCALE: TimeScaleOptions = { barSpacing: 8, maxBarSpacing: 80, rightOffset: 4 };

export class TimeScale {
  spacing: number;
  rightOffset: number;
  /** Pane width in CSS px. */
  width = 0;
  /** Timeline bounds, kept in sync by the chart: [first, end). */
  first = 0;
  end = 0;

  constructor(readonly options: TimeScaleOptions) {
    this.spacing = options.barSpacing;
    this.rightOffset = options.rightOffset;
  }

  get last(): number {
    return this.end - 1;
  }

  /** Logical (fractional index) coordinate at the right edge. */
  get right(): number {
    return this.last + 0.5 + this.rightOffset;
  }
  get left(): number {
    return this.right - this.width / this.spacing;
  }

  /** CSS x of index i's centre. */
  x(i: number): number {
    return this.width - (this.right - i) * this.spacing;
  }

  /** Fractional index at CSS x. */
  logical(x: number): number {
    return this.right - (this.width - x) / this.spacing;
  }

  /** Nearest whole index at CSS x (may lie outside the data). */
  indexAt(x: number): number {
    return Math.round(this.logical(x));
  }

  /** First and last index intersecting the view, clamped to the data. Empty when hi < lo. */
  visible(out: { lo: number; hi: number } = { lo: 0, hi: -1 }): { lo: number; hi: number } {
    out.lo = Math.max(this.first, Math.floor(this.left + 0.5));
    out.hi = Math.min(this.last, Math.ceil(this.right - 0.5));
    return out;
  }

  /** True while the last bar is on screen; a new bar then scrolls the view. */
  get following(): boolean {
    return this.x(this.last) <= this.width + this.spacing * 0.5;
  }

  minSpacing(): number {
    const n = Math.max(1, this.end - this.first);
    // Let the whole history fit with room to spare, but never below what a
    // 1M-px-wide screen could need.
    return Math.max(1e-7, Math.min(0.5, (this.width / n) * 0.5));
  }

  zoom(anchorX: number, factor: number): void {
    const at = this.logical(anchorX);
    this.spacing = clamp(this.spacing * factor, this.minSpacing(), this.options.maxBarSpacing);
    this.setRight(at + (this.width - anchorX) / this.spacing);
  }

  /** Content follows a drag of dx CSS px. */
  pan(dx: number): void {
    this.setRight(this.right - dx / this.spacing);
  }

  scrollToLatest(): void {
    this.rightOffset = this.options.rightOffset;
    this.clamp();
  }

  scrollToStart(): void {
    this.setRight(this.first - 0.5 + this.width / this.spacing - this.options.rightOffset);
  }

  reset(): void {
    this.spacing = this.options.barSpacing;
    this.scrollToLatest();
  }

  fitAll(): void {
    const n = Math.max(1, this.end - this.first + this.options.rightOffset);
    this.spacing = clamp(this.width / n, this.minSpacing(), this.options.maxBarSpacing);
    this.rightOffset = this.options.rightOffset;
    this.clamp();
  }

  /** Show [lo, hi] (fractional indices) across the full width. */
  setRange(lo: number, hi: number): void {
    if (!(hi > lo)) return;
    this.spacing = clamp(this.width / (hi - lo), this.minSpacing(), this.options.maxBarSpacing);
    this.setRight(hi);
  }

  setRight(right: number): void {
    this.rightOffset = right - this.last - 0.5;
    this.clamp();
  }

  clamp(): void {
    if (this.width <= 0 || this.end <= this.first) return;
    this.spacing = clamp(this.spacing, this.minSpacing(), this.options.maxBarSpacing);
    const barsWide = this.width / this.spacing;
    // Keep at least ~2 bars (or the whole series, if smaller) on screen.
    const keep = Math.min(2, this.end - this.first);
    const maxOffset = barsWide - 0.5 - keep;
    const minOffset = this.first - this.last - 0.5 + keep;
    this.rightOffset = clamp(this.rightOffset, minOffset, Math.max(minOffset, maxOffset));
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
