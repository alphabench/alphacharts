// Every built-in tool. Import named tools from their modules instead to keep
// the rest out of a bundle.

import type { ToolDef } from "../types.js";
import { annotationTools } from "./annotations.js";
import { channelTools } from "./channels.js";
import { cycleTools } from "./cycles.js";
import { fibTools } from "./fib.js";
import { figureTools } from "./figures.js";
import { gannTools } from "./gann.js";
import { lineTools } from "./lines.js";
import { measureTools } from "./measure.js";
import { patternTools } from "./patterns.js";
import { positionTools } from "./position.js";
import { volumeTools } from "./volume.js";

export const allTools: readonly ToolDef[] = [
  ...lineTools, ...channelTools, ...fibTools, ...gannTools, ...figureTools, ...annotationTools,
  ...positionTools, ...measureTools, ...patternTools, ...cycleTools, ...volumeTools,
];
