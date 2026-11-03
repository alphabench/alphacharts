// Drawing model and the tool-definition API.
//
// A drawing is plain JSON: a tool id, anchors (time + price, never a timeline
// index), a style and tool-specific props. A tool is a pure function from a
// drawing to pixel-space shapes; drawing, hit-testing, selection boxes and
// serialization are generic over shapes, so adding a tool never touches the
// interaction code.
//
// Anchors are exact inputs. Every number a tool prints (Δ price, %, Fib
// level price, risk/reward, quantity) is arithmetic on the anchors and goes
// through the chart's price formatter; nothing is estimated or defaulted.

import type { BarSource } from "./source.js";

export interface Anchor {
  /** UTC ms. Not required to be a bar time: it may sit between bars or past the last bar. */
  time: number;
  price: number;
}

export type Dash = "solid" | "dashed" | "dotted";

export interface DrawingStyle {
  color: string;
  /** CSS px. */
  width: number;
  dash: Dash;
  /** CSS colour with alpha, or null for no fill. */
  fill: string | null;
  textColor: string;
  /** CSS px. */
  fontSize: number;
  bold: boolean;
  italic: boolean;
  text: string;
  extendLeft: boolean;
  extendRight: boolean;
}

export interface Drawing {
  id: string;
  tool: string;
  pane: number;
  anchors: Anchor[];
  style: DrawingStyle;
  /** Tool-specific, JSON-safe (levels, account size, seeds …). */
  props: Record<string, unknown>;
  locked: boolean;
  hidden: boolean;
  /** Chart intervals (bar length in ms) the drawing shows on; null = all. */
  intervals: number[] | null;
}

// ---- shapes (pixel space) ------------------------------------------------------

export interface Stroke {
  color?: string;
  width?: number;
  dash?: Dash;
  /** false: drawn but not hit-testable (decorations, fills). Default true. */
  hit?: boolean;
}

export type Shape =
  | (Stroke & { k: "line"; x1: number; y1: number; x2: number; y2: number; extA?: boolean; extB?: boolean })
  | (Stroke & { k: "poly"; pts: number[]; close?: boolean; fill?: string | null; round?: boolean })
  | (Stroke & { k: "ellipse"; cx: number; cy: number; rx: number; ry: number; rot?: number; fill?: string | null })
  | (Stroke & { k: "arc"; cx: number; cy: number; r: number; a0: number; a1: number; fill?: string | null })
  | (Stroke & {
      k: "text";
      x: number;
      y: number;
      text: string;
      align?: "left" | "center" | "right";
      base?: "top" | "middle" | "bottom";
      /** Text colour (default: the drawing's text colour). */
      textColor?: string;
      size?: number;
      bg?: string | null;
      /** Border of the background box. */
      border?: string | null;
      pad?: number;
    });

// ---- tool context --------------------------------------------------------------

export interface ToolCtx {
  /** Pane size in CSS px. */
  readonly W: number;
  readonly H: number;
  readonly dpr: number;
  X(time: number): number;
  Y(price: number): number;
  T(x: number): number;
  P(y: number): number;
  /** The series' price formatter. */
  fmt(price: number): string;
  /** Bars of the main series, for tools that read them (and bar counts). */
  readonly source: BarSource | null;
  /** Current chart interval in ms, if known. */
  readonly interval: number | null;
}

export type Gesture =
  /** Press, drag, release: anchors 0 and 1 (a click then a click works too). Further anchors by click. */
  | "drag"
  /** One click per anchor. */
  | "clicks"
  /** One click. */
  | "single"
  /** Press-drag-release collecting points. */
  | "freehand";

export interface ToolDef {
  readonly id: string;
  readonly label: string;
  readonly family: string;
  readonly gesture: Gesture;
  /** Anchors (the minimum for variable tools). 0 for screen-anchored tools. */
  readonly anchors: number;
  /** Any number of anchors ≥ `anchors`: finish with double-click or Enter. */
  readonly variable?: boolean;
  /** Positioned by props.fx / props.fy (fractions of the pane), not by time and price. */
  readonly screen?: boolean;
  /** Reads bars: the plugin must have a BarSource. */
  readonly needsSource?: boolean;
  /** No handles (brush strokes: moving the whole stroke only). */
  readonly noHandles?: boolean;
  defaults(): { style?: Partial<DrawingStyle>; props?: Record<string, unknown> };
  shapes(d: Drawing, c: ToolCtx): Shape[];
  /** Throw (with context) when anchors or props are not valid for the tool. */
  validate?(d: Drawing): void;
  /** Called after anchor `i` was set by an edit; enforce invariants. */
  constrain?(d: Drawing, i: number): void;
  /** Fill props that depend on the view when the drawing is created (may throw). */
  onCreate?(d: Drawing, c: ToolCtx): void;
  /** Pixel positions of the edit handles, when they differ from the anchors. */
  handlePoints?(d: Drawing, c: ToolCtx): Array<{ x: number; y: number }>;
}

export const DEFAULT_STYLE: DrawingStyle = {
  color: "#2962ff",
  width: 1.5,
  dash: "solid",
  fill: null,
  textColor: "#d1d4dc",
  fontSize: 12,
  bold: false,
  italic: false,
  text: "",
  extendLeft: false,
  extendRight: false,
};

export const SCHEMA_VERSION = 1;

export interface DrawingsState {
  version: typeof SCHEMA_VERSION;
  drawings: Drawing[];
}
