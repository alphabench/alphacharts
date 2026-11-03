// Strings the plot itself produces. Same contract as the core's ChartMessages:
// one injectable function, `{name}` placeholders, a throw on an unknown key.

export const PLOT_MESSAGES = {
  "plot.ariaLabel": "Chart",
  "plot.roleDescription": "chart",
  "plot.keyboardHint": "Arrow keys move along the data, plus and minus zoom, 1 to 9 toggle series, Escape clears.",
  "plot.table.caption": "{title}: data table",
  "plot.table.truncated": "Showing the first {shown} rows; export the CSV for all of them.",
  "plot.table.series": "Series",
  "plot.table.x": "X",
  "plot.table.y": "Y",
  "plot.table.size": "Size",
  "plot.table.value": "Value",
  "plot.table.group": "Group",
  "plot.table.mark": "Mark",
  "plot.table.x1": "X end",
  "plot.table.y0": "Y start",
  "plot.table.label": "Label",
  "plot.table.state": "State",
  "plot.table.open": "Open",
  "plot.table.high": "High",
  "plot.table.low": "Low",
  "plot.table.close": "Close",
  "plot.legend.show": "Show {name}",
  "plot.legend.hide": "Hide {name}",
  "plot.announce.hidden": "{name} hidden",
  "plot.announce.shown": "{name} shown",
  "plot.announce.zoomReset": "Zoom reset",
  "plot.tooltip.count": "Count",
  "plot.tooltip.range": "Range",
  "plot.tooltip.density": "Density",
  "plot.tooltip.size": "Size",
  "plot.tooltip.open": "O",
  "plot.tooltip.high": "H",
  "plot.tooltip.low": "L",
  "plot.tooltip.close": "C",
  "plot.tooltip.value": "Value",
  "plot.treemap.share": "{value}% of total",
} as const;

export type PlotMessageKey = keyof typeof PLOT_MESSAGES;
export type PlotMessageValues = Readonly<Record<string, string | number>>;
export type PlotMessages = (key: PlotMessageKey, values?: PlotMessageValues) => string;

export const defaultPlotMessages: PlotMessages = (key, values = {}) => {
  const template = PLOT_MESSAGES[key] as string | undefined;
  if (template === undefined) throw new Error(`alphacharts: unknown plot message key "${key}"`);
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = values[name];
    if (v === undefined) throw new Error(`alphacharts: plot message "${key}" needs a value for "${name}"`);
    return String(v);
  });
};
