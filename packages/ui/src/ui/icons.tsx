/** @jsxImportSource preact */
// Stroke icons on a 24 grid with a 2px stroke, as Lucide draws them. Most are Lucide (shadcn/ui's icon library, generated into
// icons.generated.ts); the drawing tools Lucide has no picture of are our own below, on the same grid and stroke, one per tool so
// no two tools look alike. A host replaces any of them with the `icons` option, by the same name (a tool's icon is named after
// the tool: `trendLine`, `fibRetracement` ...). Directional ones carry the `dir` class so RTL mirrors them.

import { h } from "preact";
import { LUCIDE, type IconNode } from "./icons.generated.js";
import { useApp } from "./context.js";

export type IconSpec = string | IconNode;

const dot = (cx: number, cy: number): readonly ["circle", Record<string, string>] => ["circle", { cx: String(cx), cy: String(cy), r: "2" }];
const p = (d: string): readonly ["path", Record<string, string>] => ["path", { d }];

/** Our own icons: shell ones Lucide lacks, and the drawing tools. A string is one path's `d`. */
const CUSTOM: Record<string, IconSpec> = {
  hideIndicators: "M3 17l5-6 4 3 5-8 4 5M3 21h18M3 3l18 18",
  vwap: "M3 8c4 0 5 8 9 8s5-8 9-8",
  // lines: each with its handles, so a segment, a ray and an extended line read apart
  trendLine: [p("M6.5 17.5 17.5 6.5"), dot(5, 19), dot(19, 5)],
  trendAngle: [p("M6.5 17.5 18 6"), p("M7 19h14"), p("M12 19a7 7 0 0 0-1.5-4.3"), dot(5, 19)],
  ray: [p("M6.5 17.5 20 4"), p("M14 4h6v6"), dot(5, 19)],
  infoLine: [p("M5.5 18.5 13 11"), dot(4, 20), dot(14.5, 9.5), p("M15 3h6v4h-6z")],
  extendedLine: [p("M3 21l4.6-4.6M10.4 13.6l3.2-3.2M16.4 7.6 21 3"), dot(9, 15), dot(15, 9)],
  horizontalLine: [p("M2 12h8M14 12h8"), dot(12, 12)],
  horizontalRay: [p("M7 12h15"), p("m18 8 4 4-4 4"), dot(5, 12)],
  verticalLine: [p("M12 2v8M12 14v8"), dot(12, 12)],
  crossLine: [p("M12 2v8M12 14v8M2 12h8M14 12h8"), dot(12, 12)],
  // channels
  parallelChannel: [p("M3 15 15 3"), p("M9 21 21 9")],
  regressionTrendChannel: [p("M3 14 14 3"), p("M10 21 21 10"), p("M5.5 18.5l1.5-1.5M10 14l1.5-1.5M14.5 9.5 16 8")],
  flatTopBottom: [p("M3 6h18"), p("M3 20 21 12")],
  disjointChannel: [p("M3 10 21 4"), p("M3 14l18 6")],
  pitchfork: [p("M3 21l8-8"), p("M7 9l8 8"), p("M7 9l6-6M11 13l8-8M15 17l6-6")],
  schiffPitchfork: [p("M3 17l8-4"), p("M7 9l8 8"), p("M7 9l6-6M11 13l8-8M15 17l6-6")],
  modifiedSchiffPitchfork: [p("M3 19l8-6"), p("M7 9l8 8"), p("M7 9l6-6M11 13l8-8M15 17l6-6")],
  insidePitchfork: [p("M3 21l8-8"), p("M8 10l6 6"), p("M9.5 11.5l5-5M11 13l6-6M12.5 14.5l5-5")],
  pitchfan: [p("M3 21 21 3M3 21l18-9M3 21l9-18"), p("M12 3l9 9")],
  // Fibonacci and Gann
  fibRetracement: [p("M4 4h16M4 9h16M4 14h16M4 20h16"), p("M4 20 20 4")],
  fibExtension: [p("M4 4h16M4 10h16M4 16h16"), p("M4 21l4-8 4 5 5-14")],
  fibChannel: [p("M3 9l6-6M3 15 15 3M3 21 21 3M9 21 21 9")],
  fibTimeZone: [p("M3 4v16M5 4v16M8 4v16M13 4v16M21 4v16")],
  fibSpeedFan: [p("M4 20 20 4M4 20l16-11M4 20l16-6M4 20 9 4M4 20l10-16")],
  fibTrendTime: [p("M3 20l6-8"), p("M12 4v16M16 4v16M21 4v16")],
  fibCircles: [["circle", { cx: "12", cy: "12", r: "3" }], ["circle", { cx: "12", cy: "12", r: "6" }], ["circle", { cx: "12", cy: "12", r: "9.5" }]],
  fibSpiral: "M12 12a2 2 0 0 1 2 2a4 4 0 0 1-4 4a6 6 0 0 1-6-6a8 8 0 0 1 8-8a10 10 0 0 1 10 10",
  fibSpeedArcs: [p("M4 20 20 4"), p("M4 12a8 8 0 0 1 8 8"), p("M4 6a14 14 0 0 1 14 14")],
  fibWedge: [p("M4 20 20 6M4 20l16-2"), p("M13 12a10 10 0 0 1 1 7")],
  gannBox: [p("M4 4h16v16H4z"), p("M4 20 20 4M4 4l16 16")],
  gannSquareFixed: [p("M4 4h16v16H4z"), p("M4 12h16M12 4v16"), p("M4 20 20 4")],
  gannSquare: [p("M4 4h16v16H4z"), p("M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16")],
  gannFan: [p("M4 20 20 4M4 20l16-8M4 20l8-16"), p("M4 20h16M4 20V4")],
  // patterns
  xabcd: [p("M3 18 8 6l4 8 5-10 4 12"), p("M3 18l9-4")],
  cypher: [p("M3 16 8 5l4 10 5-7 4 10"), p("M3 16l9-1")],
  abcd: [p("M4 18 10 6l5 7 5-9")],
  trianglePattern: [p("M3 4l18 8L3 20"), p("M3 6l5 11 4-8 3 5")],
  threeDrives: [p("M3 20l3-6 2 3 4-7 2 3 4-9")],
  headAndShoulders: [p("M2 18l3-7 3 4 4-10 4 10 3-4 3 7"), p("M2 16h20")],
  elliottImpulse: [p("M3 20l4-8 3 3 5-10 3 5 3-6")],
  elliottCorrection: [p("M3 5l6 11 5-6 7 10")],
  elliottTriangle: [p("M3 5l4 12 4-9 4 7 4-5")],
  elliottDoubleCombo: [p("M3 5l4 8 4-4 4 8 6-5")],
  elliottTripleCombo: [p("M2 4l4 7 3-3 4 7 3-3 6 8")],
  cyclicLines: [p("M4 4v16M9 4v16M14 4v16M19 4v16")],
  timeCycles: [p("M2 18a5 5 0 0 1 10 0a5 5 0 0 1 10 0"), p("M2 18h20")],
  sineLine: "M2 12c3-8 7-8 10 0s7 8 10 0",
  // shapes
  rotatedRectangle: "M7 3l14 7-4 9L3 12z",
  ellipse: [["ellipse", { cx: "12", cy: "12", rx: "10", ry: "6" }]],
  arc: "M4 18a8 8 0 0 1 16 0",
  doubleCurve: "M3 17c2-10 7-10 9-5s7 5 9-5",
  polyline: [p("M5 18l4-9 6 6 4-9"), dot(5, 18), dot(19, 6)],
  // forecasting
  longPosition: [p("M4 4h16v16H4z"), p("M4 13h16"), p("m9 9 3-3 3 3")],
  shortPosition: [p("M4 4h16v16H4z"), p("M4 11h16"), p("m9 15 3 3 3-3")],
  forecast: "M3 17l5-5 4 3 4-7M16 8h5v5",
  projection: [p("M3 17l5-5 4 3"), p("M14 13l1.5-1.5M17.5 9.5 19 8M20.5 6.5 21 6")],
  barsPattern: [p("M6 3v18M18 5v14M12 6v12"), p("M4 8h4v7H4zM10 9h4v5h-4zM16 7h4v8h-4z")],
  dateRange: [p("M4 4v16M20 4v16"), p("M7 12h10M10 9l-3 3 3 3M14 9l3 3-3 3")],
  priceRange: [p("M4 4h16M4 20h16"), p("M12 7v10M9 10l3-3 3 3M9 14l3 3 3-3")],
  dateAndPriceRange: [p("M4 4h16v16H4z"), p("M8 12h8M12 8v8")],
  anchoredVwap: [p("M3 8c4 0 5 8 9 8s5-8 9-8"), dot(3, 19)],
  volumeProfile: [p("M4 4v16"), p("M4 6h8M4 10h14M4 14h10M4 18h5")],
  anchoredVolumeProfile: [p("M20 4v16"), p("M20 6h-8M20 10H6M20 14H10M20 18h-5")],
};

/** Names with a left/right sense; mirrored in RTL. */
const DIRECTIONAL = new Set(["undo", "redo", "chevronRight", "trendLine", "ray", "forecast", "arrow", "horizontalRay", "projection"]);

const toNode = (spec: IconSpec): IconNode => (typeof spec === "string" ? [["path", { d: spec }]] : spec);

/** The icon `name` as drawing instructions: the host's own first, then ours, then Lucide's. Throws on a name nobody has. */
export function iconNode(name: string, overrides?: Readonly<Record<string, IconSpec>>): IconNode {
  const spec = overrides?.[name] ?? CUSTOM[name] ?? LUCIDE[name];
  if (!spec) throw new Error(`unknown icon "${name}"`);
  return toNode(spec);
}

/** Whether `name` is an icon anyone defines. */
const known = (name: string): boolean => name in CUSTOM || name in LUCIDE;

export function Icon({ name, size = 16, filled = false }: { name: string; size?: number; filled?: boolean }) {
  const app = useApp();
  const node = iconNode(name, app.options.icons);
  return (
    <svg class={`icon${DIRECTIONAL.has(name) ? " dir" : ""}`} width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      {node.map(([tag, attrs], k) => h(tag, { key: k, ...attrs }))}
    </svg>
  );
}

const GROUP_ICON: Record<string, string> = { lines: "trendLine", channels: "parallelChannel", fibonacci: "fibRetracement", patterns: "xabcd", shapes: "rectangle", annotations: "text", forecasting: "longPosition", custom: "pencil" };

/** The icon of a drawing tool: a host's icon of the tool's name, else the tool's own, else its group's. */
export const toolIcon = (tool: string, group: string, overrides?: Readonly<Record<string, IconSpec>>): string =>
  overrides?.[tool] || known(tool) ? tool : GROUP_ICON[group] ?? "pencil";
export const groupIcon = (group: string): string => GROUP_ICON[group] ?? "pencil";
