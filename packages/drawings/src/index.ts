// @alphacharts/drawings public API.

export { DrawingsPlugin, DRAG_SLOP, DUPLICATE_BARS, TOLERANCE, WEAK_MAGNET_PX } from "./plugin.js";
export type { DrawingPatch, DrawingsEvents, DrawingsOptions, MagnetMode, NewDrawing } from "./plugin.js";
export { DrawingStore, History, AddCommand, BatchCommand, PatchCommand, RemoveCommand, ReorderCommand } from "./history.js";
export type { Command } from "./history.js";
export { ArrayBarSource } from "./source.js";
export type { Bar, BarSource, ColumnarBars } from "./source.js";
export { TemplateStore } from "./templates.js";
export type { DrawingTemplate } from "./templates.js";
export { DEFAULT_STYLE, SCHEMA_VERSION } from "./types.js";
export type { Anchor, Dash, Drawing, DrawingStyle, DrawingsState, Gesture, Shape, Stroke, ToolCtx, ToolDef } from "./types.js";
export { declutter, drawShapes, shapeDistance, shapeInRect, withAlpha } from "./shapes.js";
export * as geometry from "./geometry.js";

export { allTools } from "./tools/all.js";
export { lineTools, trendLine, ray, infoLine, extendedLine, horizontalLine, horizontalRay, verticalLine, crossLine } from "./tools/lines.js";
export {
  channelTools, parallelChannel, regressionTrendChannel, flatTopBottom, disjointChannel, pitchfork, schiffPitchfork, modifiedSchiffPitchfork,
  insidePitchfork, pitchfan, regression, regressionOf, forkGeometry,
} from "./tools/channels.js";
export {
  fibTools, fibRetracement, fibExtension, fibChannel, fibTimeZone, fibSpeedFan, fibTrendTime, fibCircles, fibSpiral, fibSpeedArcs, fibWedge,
  fibRetracementPrice, fibExtensionPrice, FIB_SEQUENCE,
} from "./tools/fib.js";
export { gannTools, gannBox, gannSquareFixed, gannSquare, gannFan, gannBoxPrice, gannFanPrice, GANN_RATIOS } from "./tools/gann.js";
export {
  figureTools, rectangle, rotatedRectangle, ellipse, circle, triangle, arc, curve, doubleCurve, polyline, path, brush, highlighter,
  rotatedRectCorners, arcThrough,
} from "./tools/figures.js";
export {
  annotationTools, textTool, anchoredText, note, anchoredNote, callout, comment, priceLabel, priceNote, signpost, flagMark, arrow, arrowMarker,
  arrowMarkUp, arrowMarkDown,
} from "./tools/annotations.js";
export {
  positionTools, longPosition, shortPosition, forecast, projection, barsPattern, ghostFeed, positionStats, patternBars, ghostBars, projectionTarget, seeded,
} from "./tools/position.js";
export type { PositionStats, PositionInputs } from "./tools/position.js";
export { measureTools, dateRange, priceRange, dateAndPriceRange } from "./tools/measure.js";
export {
  patternTools, xabcd, cypher, abcd, trianglePattern, threeDrives, headAndShoulders, elliottImpulse, elliottCorrection, elliottTriangle,
  elliottDoubleCombo, elliottTripleCombo, xabcdRatios, cypherRatios, abcdRatios, driveRatios, waveLabel,
} from "./tools/patterns.js";
export { cycleTools, cyclicLines, timeCycles, sineLine, sineY } from "./tools/cycles.js";
export { volumeTools, anchoredVwapTool, volumeProfileTool, anchoredVwap, volumeProfile, startIndex } from "./tools/volume.js";
export { measure, fmtDuration, fmtTime } from "./tools/util.js";
