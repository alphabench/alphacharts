/** @jsxImportSource preact */
// Stroke icons on a 24 grid, drawn here (no icon font, no branding). Directional ones carry the
// `dir` class so RTL mirrors them (see the i18n README).

const P: Record<string, string> = {
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4-4",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6 6 18",
  check: "M5 12.5l4.5 4.5L19 7.5",
  chevron: "M6 9l6 6 6-6",
  chevronRight: "M9 6l6 6-6 6",
  undo: "M9 7 4 12l5 5M4 12h10a6 6 0 0 1 0 12",
  redo: "M15 7l5 5-5 5M20 12H10a6 6 0 0 0 0 12",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
  expand: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  shrink: "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-1-3-2 .3-1.5-1.6.3-2.2-3-1-1 2h-2l-1-2-3 1 .3 2.2L6 8.3 4 8l-1 3 2 1v1l-2 1 1 3 2-.3 1.5 1.6-.3 2.2 3 1 1-2h2l1 2 3-1-.3-2.2 1.6-1.5 2 .3 1-3-2-1z",
  layout: "M4 4h16v16H4zM4 12h16M12 4v16",
  bell: "M6 17V11a6 6 0 0 1 12 0v6l2 2H4zM10 21a2 2 0 0 0 4 0",
  indicators: "M3 17l5-6 4 3 5-8 4 5M3 21h18",
  compare: "M4 15l5-5 4 4 7-8M4 20h16",
  star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z",
  trash: "M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M5 11h14v9H5z",
  unlock: "M7 11V8a5 5 0 0 1 9.5-2M5 11h14v9H5z",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  eyeOff: "M3 3l18 18M10 6a9 9 0 0 1 2-.2c6 0 10 7 10 7a17 17 0 0 1-3 3.6M6 7.5A17 17 0 0 0 2 12s4 7 10 7a9 9 0 0 0 4-1",
  magnet: "M5 4v8a7 7 0 0 0 14 0V4h-4v8a3 3 0 0 1-6 0V4zM5 8h4M15 8h4",
  cursor: "M5 3l14 9-6 1.5L10 20z",
  cross: "M12 3v18M3 12h18",
  trend: "M4 19 20 5M4 19h.01M20 5h.01",
  hline: "M3 12h18M3 12h.01M21 12h.01",
  vline: "M12 3v18",
  ray: "M5 17 20 6M5 17h.01",
  channel: "M4 15 18 6M6 20 20 11",
  pitchfork: "M5 19 12 6M5 19l14-2M5 19l12-9",
  fib: "M4 5h16M4 10h16M4 15h16M4 20h16",
  gann: "M4 20 20 4M4 20 20 12M4 20 12 4M4 20h16V4",
  pattern: "M3 17l4-9 4 6 3-10 4 9 3-3",
  shape: "M4 6h16v12H4z",
  circle: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z",
  text: "M5 6h14M12 6v13M9 19h6",
  note: "M5 4h14v11l-4 5H5zM15 15v5",
  arrow: "M5 19 19 5M10 5h9v9",
  flag: "M6 21V4M6 5h12l-2 4 2 4H6",
  position: "M4 5h16v6H4zM4 11h16v8H4zM4 11h16",
  measure: "M3 17 17 3l4 4L7 21zM8 12l2 2M11 9l2 2M14 6l2 2",
  forecast: "M3 17l5-5 4 3 4-7M16 8h5v5",
  vwap: "M3 8c4 0 5 8 9 8s5-8 9-8",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5",
  moon: "M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
  code: "M8 7l-5 5 5 5M16 7l5 5-5 5M14 5l-4 14",
  play: "M7 4l13 8-13 8z",
  copy: "M8 8h11v12H8zM5 16V4h11",
  chartType: "M5 20V10M5 6v2M12 20v-4M12 12v-5M19 20v-8M19 8V4",
  save: "M5 4h12l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  keep: "M6 4h12v6l-3 3v7l-3-2-3 2v-7l-3-3z",
  pencil: "M4 20l1-5L16 4l4 4L9 19z",
};

/** Names with a left/right sense; mirrored in RTL. */
const DIRECTIONAL = new Set(["undo", "redo", "chevronRight", "trend", "ray", "forecast", "arrow"]);

export type IconName = keyof typeof P;

export function Icon({ name, size = 20, filled = false }: { name: string; size?: number; filled?: boolean }) {
  const d = P[name];
  if (!d) throw new Error(`unknown icon "${name}"`);
  return (
    <svg class={`icon${DIRECTIONAL.has(name) ? " dir" : ""}`} width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}

/** Icon of a drawing tool: its own where it has one, else its group's. */
const TOOL_ICON: Record<string, string> = {
  trendLine: "trend", ray: "ray", horizontalLine: "hline", horizontalRay: "hline", verticalLine: "vline", crossLine: "cross", extendedLine: "trend", infoLine: "trend",
  parallelChannel: "channel", pitchfork: "pitchfork", schiffPitchfork: "pitchfork", modifiedSchiffPitchfork: "pitchfork", insidePitchfork: "pitchfork", pitchfan: "pitchfork",
  rectangle: "shape", rotatedRectangle: "shape", ellipse: "circle", circle: "circle", text: "text", anchoredText: "text", note: "note", anchoredNote: "note", callout: "note", comment: "note",
  arrow: "arrow", arrowMarker: "arrow", arrowMarkUp: "arrow", arrowMarkDown: "arrow", flagMark: "flag", signpost: "flag", priceLabel: "note", priceNote: "note",
  longPosition: "position", shortPosition: "position", dateRange: "measure", priceRange: "measure", dateAndPriceRange: "measure", forecast: "forecast", projection: "forecast",
  anchoredVwap: "vwap", brush: "pencil", highlighter: "pencil",
};
const GROUP_ICON: Record<string, string> = { lines: "trend", channels: "channel", fibonacci: "fib", patterns: "pattern", shapes: "shape", annotations: "text", forecasting: "measure" };

export const toolIcon = (tool: string, group: string): string => TOOL_ICON[tool] ?? GROUP_ICON[group] ?? "trend";
export const groupIcon = (group: string): string => GROUP_ICON[group] ?? "trend";
