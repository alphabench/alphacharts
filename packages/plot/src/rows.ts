// The data actually plotted, as rows: the CSV export and the screen-reader
// table both read these, so they cannot disagree with the picture.

import { visible, type PMark, type Prepared } from "./model.js";
import { nodeValue } from "./treemap.js";
import type { TreeNode } from "./spec.js";

export type Column = "facet" | "mark" | "series" | "x" | "x1" | "y" | "y0" | "size" | "value" | "label" | "state" | "open" | "high" | "low" | "close";
export const COLUMNS: readonly Column[] = ["facet", "mark", "series", "x", "x1", "y", "y0", "open", "high", "low", "close", "size", "value", "label", "state"];

export type Row = Partial<Record<Column, string>>;

/**
 * A number as the exports print it: up to 15 significant digits, trailing zeros trimmed. A double carries 15-17, so
 * float noise from arithmetic upstream (16491689768.999998, 1.0000000000000002) is gone and data given to 15 digits
 * or fewer is unchanged. Whole numbers a double holds exactly (up to 2^53) are printed as they are.
 */
export const numText = (v: number): string => (Number.isFinite(v) && !Number.isSafeInteger(v) ? String(Number(v.toPrecision(15))) : String(v));

const n = (v: number): string | undefined => (v === v ? numText(v) : undefined);
/** A position key as text: categories as given, numbers through numText. */
const key = (c: { num: Float64Array | null; cat: string[] | null; key(i: number): string }, i: number): string => (c.num ? numText(c.num[i]!) : c.key(i));
const val = (v: number | string): string => (typeof v === "number" ? numText(v) : String(v));

/** Rows of one prepared mark. Hidden marks give none. */
export function rowsOf(m: PMark, facet: string | undefined, limit = Infinity): Row[] {
  if (m.hidden) return [];
  const base: Row = { mark: m.type };
  if (facet !== undefined) base.facet = facet;
  if (m.name !== undefined) base.series = m.name;
  const out: Row[] = [];
  const push = (r: Row) => {
    if (out.length >= limit) throw STOP;
    out.push({ ...base, ...r });
  };
  try {
    fill(m, push);
  } catch (e) {
    if (e !== STOP) throw e;
  }
  return out;
}

const STOP = Symbol("enough rows");

function fill(m: PMark, push: (r: Row) => void): void {
  switch (m.type) {
    case "bar":
      for (let i = 0; i < m.pos.length; i++) {
        const cat = key(m.pos, i);
        const r: Row = m.orient === "v" ? { x: cat } : { y: cat };
        const v = n(m.value[i]!);
        if (v !== undefined) r[m.orient === "v" ? "y" : "x"] = v;
        if (m.mark.stack !== undefined || m.mark.base !== undefined) {
          const lo = m.mirror ? -m.lo[i]! : m.lo[i]!;
          const t = n(lo);
          if (t !== undefined) r.y0 = t;
        }
        push(r);
      }
      break;
    case "line":
      for (let i = 0; i < m.y.length; i++) push({ ...(n(m.pos.value(i)) !== undefined ? { x: n(m.pos.value(i))! } : m.pos.cat ? { x: m.pos.cat[i]! } : {}), ...(n(m.y[i]!) !== undefined ? { y: n(m.y[i]!)! } : {}) });
      break;
    case "area": case "errorBand":
      for (let i = 0; i < m.hi.length; i++) {
        const r: Row = {};
        if (m.pos.cat) r.x = m.pos.cat[i]!;
        else if (n(m.pos.num![i]!) !== undefined) r.x = n(m.pos.num![i]!)!;
        // The data as given (stacked areas keep their own values; the stack's edges are y0 / y1 in the picture only).
        if (n(m.y[i]!) !== undefined) r.y = n(m.y[i]!)!;
        if (m.type === "errorBand" && n(m.lo[i]!) !== undefined) r.y0 = n(m.lo[i]!)!;
        else if (m.type === "area" && !m.autoBase && n(m.lo[i]!) !== undefined) r.y0 = n(m.lo[i]!)!;
        push(r);
      }
      break;
    case "candle":
      for (let i = 0; i < m.pos.length; i++) {
        const r: Row = {};
        if (m.pos.cat) r.x = m.pos.cat[i]!;
        else if (n(m.pos.num![i]!) !== undefined) r.x = n(m.pos.num![i]!)!;
        for (const k of ["open", "high", "low", "close"] as const) if (n(m[k][i]!) !== undefined) r[k] = n(m[k][i]!)!;
        push(r);
      }
      break;
    case "scatter":
      for (let i = 0; i < m.y.length; i++) {
        const r: Row = {};
        if (m.pos.cat) r.x = m.pos.cat[i]!;
        else if (n(m.pos.num![i]!) !== undefined) r.x = n(m.pos.num![i]!)!;
        if (n(m.y[i]!) !== undefined) r.y = n(m.y[i]!)!;
        if (m.size && n(m.size[i]!) !== undefined) r.size = n(m.size[i]!)!;
        if (m.mark.colorValue && n(m.mark.colorValue[i]!) !== undefined) r.value = n(m.mark.colorValue[i]!)!;
        if (m.mark.labels) r.label = m.mark.labels[i]!;
        if (m.mark.states) r.state = m.mark.states[i]!;
        push(r);
      }
      break;
    case "histogram":
      for (const b of m.bins) push({ x: numText(b.x0), x1: numText(b.x1), y: numText(m.mark.density ? b.density : b.count) });
      break;
    case "heatmap":
      for (let i = 0; i < m.value.length; i++) push({ x: m.xc[i]!, y: m.yc[i]!, ...(n(m.value[i]!) !== undefined ? { value: n(m.value[i]!)! } : {}) });
      break;
    case "treemap": {
      const walk = (t: TreeNode, path: string[]) => {
        if (t.children && t.children.length) t.children.forEach((c) => walk(c, [...path, c.name]));
        else push({ x: path.join(" / "), value: numText(nodeValue(t)), ...(t.colorValue !== undefined ? { y: numText(t.colorValue) } : {}) });
      };
      walk(m.mark.root, []);
      break;
    }
    case "rule":
      m.xs.forEach((v, i) => push({ x: val(v), ...(m.mark.labels?.[i] !== undefined ? { label: m.mark.labels[i]! } : {}) }));
      m.ys.forEach((v, i) => push({ y: val(v), ...(m.mark.labels?.[m.xs.length + i] !== undefined ? { label: m.mark.labels[m.xs.length + i]! } : {}) }));
      break;
    case "band":
      if (m.mark.x) push({ x: val(m.mark.x[0]), x1: val(m.mark.x[1]), ...(m.mark.label ? { label: m.mark.label } : {}) });
      if (m.mark.y) push({ y: val(m.mark.y[0]), y0: val(m.mark.y[1]), ...(m.mark.label ? { label: m.mark.label } : {}) });
      break;
    case "text":
      for (let i = 0; i < m.mark.text.length; i++) push({ x: key(m.x, i), y: key(m.y, i), label: m.mark.text[i]! });
      break;
  }
}

export interface Plotted {
  columns: Column[];
  rows: Row[];
}

/** Rows for every visible mark of every cell, with only the columns something fills. */
export function plotted(cells: readonly { title?: string | undefined; prepared: Prepared }[], limit = Infinity): Plotted {
  const rows: Row[] = [];
  for (const c of cells) for (const m of visible(c.prepared)) if (rows.length < limit) rows.push(...rowsOf(m, c.title, limit - rows.length));
  const used = new Set<Column>();
  for (const r of rows) for (const k of Object.keys(r) as Column[]) used.add(k);
  return { columns: COLUMNS.filter((c) => used.has(c)), rows };
}

const needsQuote = /[",\r\n]/;
// A text cell that a spreadsheet would run as a formula gets a leading apostrophe; numbers (which may start with - or +) are left alone.
const formula = (s: string) => /^[=+\-@\t\r]/.test(s) && !Number.isFinite(Number(s));
const cell = (s: string | undefined): string => {
  if (s === undefined) return "";
  if (formula(s)) s = `'${s}`;
  return needsQuote.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** RFC 4180 CSV (CRLF line ends). Numbers keep up to 15 significant digits (see numText): float noise goes, data does not. */
export function toCsv(p: Plotted): string {
  const lines = [p.columns.join(",")];
  for (const r of p.rows) lines.push(p.columns.map((c) => cell(r[c])).join(","));
  return lines.join("\r\n") + "\r\n";
}
