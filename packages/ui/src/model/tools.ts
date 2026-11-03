// The 82 drawing tools in TradingView-like groups. Every tool of the drawings
// package is in exactly one group (checked by test/tools.test.ts), so a tool
// added to the package without a group fails the test instead of vanishing.

export type ToolGroupId = "lines" | "channels" | "fibonacci" | "patterns" | "shapes" | "annotations" | "forecasting";

export interface ToolGroup {
  id: ToolGroupId;
  /** The `drawing.group.*` message key. */
  key: "drawing.group.lines" | "drawing.group.channels" | "drawing.group.fibonacci" | "drawing.group.patterns" | "drawing.group.shapes" | "drawing.group.annotations" | "drawing.group.forecasting";
  tools: readonly string[];
}

export const TOOL_GROUPS: readonly ToolGroup[] = [
  { id: "lines", key: "drawing.group.lines", tools: ["trendLine", "ray", "infoLine", "extendedLine", "horizontalLine", "horizontalRay", "verticalLine", "crossLine"] },
  {
    id: "channels", key: "drawing.group.channels",
    tools: ["parallelChannel", "regressionTrendChannel", "flatTopBottom", "disjointChannel", "pitchfork", "schiffPitchfork", "modifiedSchiffPitchfork", "insidePitchfork", "pitchfan"],
  },
  {
    id: "fibonacci", key: "drawing.group.fibonacci",
    tools: ["fibRetracement", "fibExtension", "fibChannel", "fibTimeZone", "fibSpeedFan", "fibTrendTime", "fibCircles", "fibSpiral", "fibSpeedArcs", "fibWedge", "gannBox", "gannSquareFixed", "gannSquare", "gannFan"],
  },
  {
    id: "patterns", key: "drawing.group.patterns",
    tools: [
      "xabcd", "cypher", "abcd", "trianglePattern", "threeDrives", "headAndShoulders",
      "elliottImpulse", "elliottCorrection", "elliottTriangle", "elliottDoubleCombo", "elliottTripleCombo", "cyclicLines", "timeCycles", "sineLine",
    ],
  },
  {
    id: "shapes", key: "drawing.group.shapes",
    tools: ["rectangle", "rotatedRectangle", "ellipse", "circle", "triangle", "arc", "curve", "doubleCurve", "polyline", "path", "brush", "highlighter"],
  },
  {
    id: "annotations", key: "drawing.group.annotations",
    tools: ["text", "anchoredText", "note", "anchoredNote", "callout", "comment", "priceLabel", "priceNote", "signpost", "flagMark", "arrow", "arrowMarker", "arrowMarkUp", "arrowMarkDown"],
  },
  {
    id: "forecasting", key: "drawing.group.forecasting",
    tools: ["longPosition", "shortPosition", "forecast", "projection", "barsPattern", "ghostFeed", "dateRange", "priceRange", "dateAndPriceRange", "anchoredVwap", "volumeProfile"],
  },
];

export function groupOf(tool: string): ToolGroup | undefined {
  return TOOL_GROUPS.find((g) => g.tools.includes(tool));
}
