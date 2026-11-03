// Condition steppers: each alert owns one, fed the ticks its trigger mode
// allows. A stepper returns null when it cannot evaluate this tick (an
// indicator without a value, a drawing line that does not reach this bar):
// its state is left as it was.

import { checkGeometry, linePrice, type Logical } from "./lines.js";
import type { Condition, Tick } from "./types.js";

export interface EvalEnv {
  /** Indicator values by id: the value at this tick, or undefined when there is none yet. */
  indicators?: Record<string, (tick: Tick) => number | undefined>;
  /** Position of a time in the bar sequence, for drawing lines (see lines.ts). Default: time itself. */
  logical?: Logical;
}

export interface StepResult {
  fired: boolean;
  /** What was compared this tick. */
  values: Record<string, number>;
}

export interface Stepper {
  step(tick: Tick, prevPrice: number | null): StepResult | null;
}

const sign = (v: number): -1 | 0 | 1 => (v < 0 ? -1 : v > 0 ? 1 : 0);

/**
 * Crossing detector for a value x against a level L that may move.
 * Up: the last strict side was below and x reaches L; down: above and x reaches L.
 * A touch counts, and a touch followed by a retreat counts as a cross back.
 */
class Cross {
  /** Last strict side of the level. */
  private side: -1 | 0 | 1 = 0;
  private prev: number | null = null;
  /** Set while price sits exactly on the level after reaching it from one side: no repeat fires. */
  private on: "up" | "down" | null = null;

  step(x: number, L: number, dir: "any" | "up" | "down"): { fired: boolean; up: boolean } {
    // Re-derive the last side against the *current* level so a level that moved is not a cross.
    let s = this.prev === null ? 0 : sign(this.prev - L);
    if (s === 0) s = this.side;
    let fired = false, up = false;
    const fire = (isUp: boolean) => {
      up = isUp;
      fired = isUp ? dir !== "down" : dir !== "up";
    };
    if (x === L) {
      if (this.on === null && s !== 0) {
        fire(s === -1);
        this.on = s === -1 ? "up" : "down";
      }
    } else {
      const now = sign(x - L) as -1 | 1;
      if (this.on === "up" && now === -1) fire(false); // touched from below, now retreated
      else if (this.on === "down" && now === 1) fire(true);
      else if (this.on === null && s !== 0 && now !== s) fire(now === 1); // jumped over
      this.on = null;
      this.side = now;
    }
    this.prev = x;
    return { fired, up };
  }
}

function dirOf(op: string): "any" | "up" | "down" {
  return op === "crossingUp" ? "up" : op === "crossingDown" ? "down" : "any";
}

function channelStepper(low: number, high: number, entering: boolean): Stepper {
  let inside: boolean | null = null;
  return {
    step(t) {
      const now = t.price >= low && t.price <= high;
      const was = inside;
      inside = now;
      return { fired: was !== null && (entering ? !was && now : was && !now), values: { low, high } };
    },
  };
}

export function makeStepper(c: Condition, env: EvalEnv): Stepper {
  switch (c.type) {
    case "crossing": {
      const cr = new Cross();
      return {
        step(t) {
          const r = cr.step(t.price, c.price, c.direction);
          return { fired: r.fired, values: { level: c.price } };
        },
      };
    }
    case "greaterThan":
      return { step: (t) => ({ fired: t.price > c.price, values: { level: c.price } }) };
    case "lessThan":
      return { step: (t) => ({ fired: t.price < c.price, values: { level: c.price } }) };
    case "enteringChannel":
      return channelStepper(c.low, c.high, true);
    case "exitingChannel":
      return channelStepper(c.low, c.high, false);
    case "moving": {
      // Extremes of the last `bars` bars that had ticks, current included.
      const win: Array<{ bar: number; low: number; high: number }> = [];
      return {
        step(t) {
          const last = win[win.length - 1];
          if (last && last.bar === t.bar) {
            last.low = Math.min(last.low, t.price);
            last.high = Math.max(last.high, t.price);
          } else {
            win.push({ bar: t.bar, low: t.price, high: t.price });
            if (win.length > c.bars) win.shift();
          }
          let low = Infinity, high = -Infinity;
          for (const w of win) {
            if (w.low < low) low = w.low;
            if (w.high > high) high = w.high;
          }
          const ref = c.direction === "up" ? low : high;
          const threshold = c.amount !== undefined ? c.amount : (Math.abs(ref) * c.percent!) / 100;
          const move = c.direction === "up" ? t.price - low : high - t.price;
          return { fired: move >= threshold, values: { windowLow: low, windowHigh: high, move, threshold } };
        },
      };
    }
    case "indicator": {
      const fn = env.indicators?.[c.id];
      if (!fn) throw new Error(`alerts: indicator "${c.id}" is not provided (EvalEnv.indicators has: ${Object.keys(env.indicators ?? {}).join(", ") || "none"})`);
      const other = typeof c.value === "object" ? env.indicators?.[c.value.id] : undefined;
      if (typeof c.value === "object" && !other) throw new Error(`alerts: indicator "${c.value.id}" is not provided`);
      const cr = new Cross();
      return {
        step(t) {
          const v = fn(t);
          const L = typeof c.value === "number" ? c.value : other!(t);
          if (v === undefined || L === undefined) return null;
          if (!Number.isFinite(v) || !Number.isFinite(L)) throw new RangeError(`alerts: indicator gave a non-finite value (${v}, ${L}) at ${t.time}`);
          const values = { value: v, level: L };
          if (c.op === "greaterThan") return { fired: v > L, values };
          if (c.op === "lessThan") return { fired: v < L, values };
          // A crossover (value vs another indicator) is a sign change of the difference.
          return { fired: (typeof c.value === "number" ? cr.step(v, L, dirOf(c.op)) : cr.step(v - L, 0, dirOf(c.op))).fired, values };
        },
      };
    }
    case "drawing": {
      checkGeometry(c.drawing, c.line);
      const lg = env.logical;
      if (c.op === "enteringChannel" || c.op === "exitingChannel") {
        if (c.drawing.tool !== "parallelChannel") throw new Error(`alerts: ${c.op} on a drawing needs a parallelChannel, got ${c.drawing.tool}`);
        let inside: boolean | null = null;
        return {
          step(t) {
            const a = linePrice(c.drawing, "base", t.bar, lg), b = linePrice(c.drawing, "offset", t.bar, lg);
            if (a === undefined || b === undefined) return null;
            const lo = Math.min(a, b), hi = Math.max(a, b);
            const now = t.price >= lo && t.price <= hi;
            const was = inside;
            inside = now;
            return { fired: was !== null && (c.op === "enteringChannel" ? !was && now : was && !now), values: { low: lo, high: hi } };
          },
        };
      }
      const cr = new Cross();
      return {
        step(t) {
          const L = linePrice(c.drawing, c.line, t.bar, lg);
          if (L === undefined) return null;
          return { fired: cr.step(t.price, L, dirOf(c.op)).fired, values: { line: L } };
        },
      };
    }
  }
}

/** Throws with context unless the condition's numbers are usable. */
export function validateCondition(c: Condition): void {
  const finite = (name: string, v: unknown) => {
    if (typeof v !== "number" || !Number.isFinite(v)) throw new TypeError(`alerts: ${c.type} ${name} must be a finite number, got ${String(v)}`);
  };
  switch (c.type) {
    case "crossing":
      finite("price", c.price);
      if (!["any", "up", "down"].includes(c.direction)) throw new RangeError(`alerts: crossing direction must be any, up or down, got ${String(c.direction)}`);
      return;
    case "greaterThan":
    case "lessThan":
      finite("price", c.price);
      return;
    case "enteringChannel":
    case "exitingChannel":
      finite("low", c.low);
      finite("high", c.high);
      if (!(c.low < c.high)) throw new RangeError(`alerts: ${c.type} needs low < high, got ${c.low} and ${c.high}`);
      return;
    case "moving": {
      if (c.direction !== "up" && c.direction !== "down") throw new RangeError(`alerts: moving direction must be up or down`);
      if (!Number.isInteger(c.bars) || c.bars < 1) throw new RangeError(`alerts: moving needs bars ≥ 1 (integer), got ${c.bars}`);
      if ((c.amount === undefined) === (c.percent === undefined)) throw new RangeError("alerts: moving needs exactly one of amount and percent");
      const v = c.amount ?? c.percent;
      finite("amount/percent", v);
      if (!(v! > 0)) throw new RangeError(`alerts: moving amount/percent must be positive, got ${v}`);
      return;
    }
    case "indicator":
      if (!c.id) throw new TypeError("alerts: indicator condition needs an id");
      if (typeof c.value !== "number" && !c.value?.id) throw new TypeError("alerts: indicator value must be a number or {id}");
      if (typeof c.value === "number") finite("value", c.value);
      return;
    case "drawing":
      checkGeometry(c.drawing, c.line);
      return;
  }
}
