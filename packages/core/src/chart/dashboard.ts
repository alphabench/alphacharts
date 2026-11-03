// Many charts, one set of canvases.
//
//   const dash = new Dashboard(gridElement);
//   const a = dash.addChart(cellA, { theme: "dark" });
//
// Cells are any elements inside the container (CSS grid, flex, absolute).
// The dashboard's three canvases cover the container; each chart draws into
// its cell's rectangle and takes pointer input on its own root, so charts
// behave exactly like standalone ones. One WebGL context serves them all.

import type { SurfaceChoice } from "../render/surface.js";
import { Chart, type ChartOptionsInput } from "./chart.js";
import { CellLayers, DashboardCanvases } from "./layers.js";
import { LAYER_ALL } from "./scheduler.js";

export interface DashboardOptions {
  renderer: SurfaceChoice;
}

export class Dashboard {
  private readonly canvases: DashboardCanvases;
  private readonly charts = new Set<Chart>();
  private readonly resizeObs: ResizeObserver;
  private removed = false;

  constructor(readonly container: HTMLElement, options: Partial<DashboardOptions> = {}) {
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    this.canvases = new DashboardCanvases(
      container,
      options.renderer ?? "auto",
      {
        lost: () => {
          for (const c of this.charts) c.surfaceLost();
        },
        restored: () => this.redrawAll(),
      },
      () => this.relayout(),
      () => this.charts,
    );
    this.resizeObs = new ResizeObserver(() => this.relayout());
    this.resizeObs.observe(container);
    this.canvases.resize(window.devicePixelRatio || 1);
  }

  /** A chart drawn into `cell`, which must be inside the container. */
  addChart(cell: HTMLElement, options: ChartOptionsInput = {}): Chart {
    if (this.removed) throw new Error("alphacharts: this dashboard was removed");
    if (!this.container.contains(cell)) throw new Error("alphacharts: a dashboard cell must be inside the dashboard container");
    const chart = new Chart(cell, options, () => new CellLayers(this.canvases, cell));
    this.charts.add(chart);
    chart.onRemove(() => {
      this.charts.delete(chart);
      this.relayout();
    });
    return chart;
  }

  get size(): number {
    return this.charts.size;
  }

  remove(): void {
    if (this.removed) return;
    this.removed = true;
    for (const c of [...this.charts]) c.remove();
    this.resizeObs.disconnect();
    this.canvases.dispose();
  }

  private relayout(): void {
    if (this.removed) return;
    this.canvases.resize(window.devicePixelRatio || 1);
    this.redrawAll();
  }

  private redrawAll(): void {
    // Cleared canvases or moved cells: every chart repaints its cell.
    this.canvases.clear();
    for (const c of this.charts) {
      c.remeasure();
      c.invalidate(LAYER_ALL);
    }
  }
}
