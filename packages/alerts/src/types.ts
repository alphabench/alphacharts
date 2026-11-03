// Alert definitions: plain, versioned JSON that a chart and a backend can
// both evaluate with the same AlertEvaluator.
//
// Evaluation consumes ticks. A tick carries the time of the trade/quote, its
// price, and the open time of the bar it belongs to; the evaluator never
// guesses a bar from a clock.

import type { Anchor } from "@alphacharts/drawings";

export interface Tick {
  /** UTC ms of the tick; non-decreasing across ticks. */
  time: number;
  price: number;
  /** Open time of the bar the tick belongs to; non-decreasing, and a bar never reopens once a later one has started. */
  bar: number;
}

export type Direction = "any" | "up" | "down";
export type CrossOp = "crossing" | "crossingUp" | "crossingDown";
export type IndicatorOp = CrossOp | "greaterThan" | "lessThan";

export type Condition =
  /** Price crosses a level. Touching it counts: 99 → 100 crosses up 100. */
  | { type: "crossing"; price: number; direction: Direction }
  /** State: price > level (fires on every tick it holds; use the trigger mode to limit it). */
  | { type: "greaterThan"; price: number }
  | { type: "lessThan"; price: number }
  /** Price goes from outside [low, high] to inside / inside to outside. */
  | { type: "enteringChannel"; low: number; high: number }
  | { type: "exitingChannel"; low: number; high: number }
  /**
   * State: price is at least `amount` (or `percent` of the window's low) above
   * the lowest (up) / below the highest (down) price seen in the last `bars`
   * bars, the current one included. Exactly one of amount/percent.
   */
  | { type: "moving"; direction: "up" | "down"; bars: number; amount?: number; percent?: number }
  /** A named indicator (see EvalEnv.indicators) against a number or another indicator. */
  | { type: "indicator"; id: string; op: IndicatorOp; value: number | { id: string } }
  | { type: "drawing"; drawing: DrawingGeometry; line: string; op: CrossOp | "enteringChannel" | "exitingChannel" };

/** What the evaluator needs of a drawing: its tool, anchors and the style/props that change its geometry. */
export interface DrawingGeometry {
  id: string;
  tool: string;
  anchors: Anchor[];
  extendLeft: boolean;
  extendRight: boolean;
  /**
   * The price scale the drawing was drawn on. A drawing is straight in pixels:
   * on a "log" scale that is straight in ln(price), so the line's price at a
   * bar is interpolated in ln(price) (and every anchor price must be > 0).
   * Linear, percent and indexed scales are affine in price: omit it.
   */
  scale?: "log";
}

export type TriggerMode = "once" | "oncePerBar" | "oncePerBarClose" | "everyTime";

export interface TriggerOptions {
  mode: TriggerMode;
  /** After a trigger, ignore further ones for this many ms of tick time. */
  debounceMs?: number;
}

export interface AlertDefinition {
  id: string;
  label?: string;
  condition: Condition;
  trigger: TriggerOptions;
  /** Tick time (UTC ms) from which the alert no longer fires. */
  expiresAt?: number | null;
}

/** orphaned: the drawing the alert watches no longer exists. */
export type AlertStatus = "active" | "triggered" | "expired" | "orphaned" | "error";

export interface AlertTrigger {
  alertId: string;
  label: string | undefined;
  mode: TriggerMode;
  condition: Condition["type"];
  /** Tick that completed the condition (for bar-close mode: the first tick of the next bar, or the closeBar time). */
  time: number;
  /** Bar the values belong to: the tick's bar, or the closed bar in bar-close mode. */
  bar: number;
  /** The tick price, or the bar's closing price in bar-close mode. */
  price: number;
  /** The price before it. */
  prevPrice: number | null;
  /** Numbers the condition compared (level, line price, indicator value, window extreme, threshold …). */
  values: Record<string, number>;
  /** 1-based count of triggers of this alert. */
  seq: number;
}

export const ALERTS_VERSION = 1;

export interface AlertsState {
  version: typeof ALERTS_VERSION;
  alerts: AlertDefinition[];
}
