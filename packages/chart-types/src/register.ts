// Series types are registered by calling register*(), not by importing a module
// for its side effect: the package is `sideEffects: false`, so a bundler may
// drop a bare import, and the explicit call keeps the unused types out of the
// bundle. Each call is idempotent. `registerAllChartTypes()` is the
// everything-at-once convenience.

import { registerBaseline } from "./series/baseline.js";
import { registerBricks } from "./series/bricks.js";
import { registerColumns } from "./series/columns.js";
import { registerHiLo } from "./series/hi-lo.js";
import { registerKagi } from "./series/kagi.js";
import { registerLineMarkers } from "./series/line-markers.js";
import { registerOhlcDots } from "./series/ohlc-dots.js";
import { registerPointFigure } from "./series/point-figure.js";
import { registerStepLine } from "./series/step-line.js";

export function registerAllChartTypes(): void {
  registerBaseline();
  registerStepLine();
  registerColumns();
  registerHiLo();
  registerOhlcDots();
  registerLineMarkers();
  registerBricks();
  registerKagi();
  registerPointFigure();
}
