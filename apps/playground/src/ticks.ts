// Deterministic tick sequence for the alerts example and its browser test.
// Playground and tests only: the library takes ticks from the integrator.

import { rng } from "./synthetic.js";

export interface PlayTick {
  time: number;
  price: number;
  bar: number;
}

/** A random walk from `start`: `perBar` ticks per bar of `barMs`, beginning at bar open `t0`. */
export function makeTicks(seed: number, bars: number, t0: number, start: number, barMs = 60_000, perBar = 10): PlayTick[] {
  const r = rng(seed);
  const out: PlayTick[] = [];
  let p = start;
  for (let b = 0; b < bars; b++) {
    for (let k = 0; k < perBar; k++) {
      p = Math.round((p + (r() - 0.5) * p * 0.0006) * 100) / 100;
      out.push({ time: t0 + b * barMs + k * (barMs / perBar), price: p, bar: t0 + b * barMs });
    }
  }
  return out;
}
