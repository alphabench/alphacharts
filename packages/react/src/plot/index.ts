// @alphacharts/react/plot: <Plot>, <PlotSync> and usePlot, over @alphacharts/plot.
// A separate entry so hosts that only draw candles never load the plot package.

export { Plot, usePlot } from "./plot.js";
export type { PlotEventProps, PlotProps, PlotRef } from "./plot.js";
export { PlotSync } from "./sync.js";
export type { PlotSyncProps } from "./sync.js";
