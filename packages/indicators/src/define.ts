// Authoring helpers for study definitions.

import type { InputDef, LineStyleName, MarkerShape, PlotDef, StudyDef } from "./types.js";
import { SOURCE_NAMES } from "./engine/graph.js";

export const int = (key: string, def: number, min = 1, max = 10_000, label = key): InputDef => ({ key, label, type: "int", default: def, min, max, step: 1 });
export const float = (key: string, def: number, min = -1e9, max = 1e9, step = 0.1, label = key): InputDef => ({ key, label, type: "float", default: def, min, max, step });
export const bool = (key: string, def: boolean, label = key): InputDef => ({ key, label, type: "bool", default: def });
export const select = (key: string, def: string, options: readonly string[], label = key): InputDef => ({ key, label, type: "select", default: def, options });
export const source = (def = "close", key = "source"): InputDef => ({ key, label: key, type: "source", default: def, options: SOURCE_NAMES });

/**
 * The default colours of the studies, as colour slots (see `resolveColor` in @alphacharts/core): each draws with the chart's
 * theme, so a study looks like the page it is on. The names are roles: `red` and `green` are bearish and bullish
 * (the theme's down and up), `gray` a reference line (muted), the rest the five series of the theme's palette (shadcn's
 * --chart-1 … --chart-5). A host or a user sets any plot to a colour of its own through the study's style.
 */
export const COLORS = {
  neutral: "chart-1", orange: "chart-2", purple: "chart-3", teal: "chart-4", pink: "chart-5", cyan: "chart-3", lime: "chart-4",
  yellow: "chart-5", brown: "chart-5", red: "chart-down", green: "chart-up", gray: "muted",
} as const;

export const line = (col: string, color: string, o: { title?: string; key?: string; width?: number; style?: LineStyleName; offset?: number; connect?: boolean } = {}): PlotDef => ({
  kind: "line", key: o.key ?? col, title: o.title ?? col, col, color, ...(o.width !== undefined && { width: o.width }), ...(o.style && { style: o.style }), ...(o.offset !== undefined && { offset: o.offset }), ...(o.connect && { connect: true }),
});
export const hist = (col: string, color: string, colorDown?: string, o: { title?: string; key?: string } = {}): PlotDef => ({
  kind: "histogram", key: o.key ?? col, title: o.title ?? col, col, color, ...(colorDown && { colorDown }),
});
export const areaPlot = (col: string, color: string, o: { title?: string; key?: string } = {}): PlotDef => ({ kind: "area", key: o.key ?? col, title: o.title ?? col, col, color });
export const band = (key: string, upper: string, lower: string, color: string, fill: string, title = key): PlotDef => ({ kind: "band", key, title, upper, lower, color, fill });
export const fillBetween = (key: string, a: string, b: string, color: string, title = key): PlotDef => ({ kind: "fill", key, title, a, b, color });
export const hline = (key: string, value: number | ((p: import("./types.js").Params) => number), color: string = COLORS.gray, style: LineStyleName = "dashed"): PlotDef => ({ kind: "hline", key, title: key, value, color, style });
export const markers = (col: string, shape: MarkerShape, position: "value" | "above" | "below" | "sign", color: string, o: { title?: string; key?: string; offset?: number; text?: boolean } = {}): PlotDef => ({
  kind: "markers", key: o.key ?? col, title: o.title ?? col, col, shape, position, color, ...(o.offset !== undefined && { offset: o.offset }), ...(o.text && { text: true }),
});

export function defineStudy(def: StudyDef): StudyDef {
  return def;
}
