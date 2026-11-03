// @alphacharts/ui public API. Nothing here registers anything on import: call defineChartApp()
// (createChartApp does), or import "@alphacharts/ui/element" for the custom element.

import { ChartApp } from "./engine/app.js";
import { mountShell } from "./ui/shell.js";
import type { ChartAppOptions } from "./types.js";

export type { ChartAppOptions, Features, ScriptDiagnostic, ScriptEditorAdapter, ScriptRunAdapter, SymbolInfo, SyncKey, ThemeName, UiDatafeed, VolumeBar } from "./types.js";
export { DEFAULT_FEATURES } from "./types.js";
export { ChartApp } from "./engine/app.js";
export type { AppEvents, Dialog, LayoutBody, MenuItem, TemplateBody } from "./engine/app.js";
export { ChartInstance } from "./engine/instance.js";
export type { InstanceState } from "./engine/instance.js";
export { GRID_PRESETS, gridPreset } from "./model/grids.js";
export { CHART_TYPES } from "./model/chartTypes.js";
export type { ChartTypeId } from "./model/chartTypes.js";
export { PRESET_INTERVALS, normalizeInterval, customInterval } from "./model/intervals.js";
export { TOOL_GROUPS } from "./model/tools.js";

/** The typed controller `createChartApp` returns. */
export type ChartAppController = ChartApp;

export const TAG = "alpha-chart-app";

/** The custom element's public shape; the class itself is built on first use (see `elementClass`). */
export interface AlphaChartAppElement extends HTMLElement {
  /** Start the app in this element; it can be started once. */
  start(options: ChartAppOptions): ChartApp;
  readonly controller: ChartApp | null;
}

let elementCtor: (new () => AlphaChartAppElement) | undefined;

/**
 * The `<alpha-chart-app>` class. Built on the first call, not at import:
 * `extends HTMLElement` at module top would make importing this package on a
 * server (SSR) throw.
 */
export function elementClass(): new () => AlphaChartAppElement {
  if (elementCtor) return elementCtor;
  class Element extends HTMLElement implements AlphaChartAppElement {
    private app: ChartApp | null = null;
    private unmount: (() => void) | null = null;

    start(options: ChartAppOptions): ChartApp {
      if (this.app) throw new Error("<alpha-chart-app> is already started");
      const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
      const app = new ChartApp(this, options);
      this.app = app;
      this.style.display = "block";
      void app.ready.then(() => {
        if (this.app !== app) return;
        this.unmount = mountShell(app, root);
        this.setAttribute("data-ready", "");
      });
      return app;
    }

    get controller(): ChartApp | null {
      return this.app;
    }

    disconnectedCallback(): void {
      // Moving the element keeps it alive; removal is destroyed on the next task if still detached.
      queueMicrotask(() => {
        if (this.isConnected) return;
        this.unmount?.();
        this.app?.destroy();
        this.unmount = null;
        this.app = null;
      });
    }
  }
  return (elementCtor = Element);
}

export function defineChartApp(): void {
  if (!customElements.get(TAG)) customElements.define(TAG, elementClass());
}

/** Create `<alpha-chart-app>` in `container` and start it. */
export function createChartApp(container: HTMLElement, options: ChartAppOptions): ChartAppController {
  defineChartApp();
  const el = document.createElement(TAG) as AlphaChartAppElement;
  el.style.cssText = "display:block;width:100%;height:100%";
  container.appendChild(el);
  return el.start(options);
}
