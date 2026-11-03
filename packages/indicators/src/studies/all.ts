// Every built-in study, collected from the group modules. Importing this pulls
// them all in; import single studies from their group module to stay small.

import type { StudyDef } from "../types.js";
import * as overlap from "./overlap.js";
import * as momentum from "./momentum.js";
import * as volume from "./volume.js";
import * as volatility from "./volatility.js";
import * as price from "./price.js";
import * as statistic from "./statistic.js";
import * as math from "./math.js";
import * as cycle from "./cycle.js";
import * as sar from "./sar.js";
import * as patterns from "./patterns.js";
import * as tvTrend from "./tv-trend.js";
import * as tvOsc from "./tv-osc.js";
import * as tvVolume from "./tv-volume.js";

const isStudy = (x: unknown): x is StudyDef => typeof x === "object" && x !== null && "build" in x && "columns" in x && "plots" in x;

export const ALL_STUDIES: readonly StudyDef[] = [overlap, momentum, volume, volatility, price, statistic, math, cycle, sar, patterns, tvTrend, tvOsc, tvVolume].flatMap((m) =>
  Object.values(m).filter(isStudy),
);
