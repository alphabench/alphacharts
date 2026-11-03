import { beforeAll, describe, expect, it } from "vitest";
import { Fmt } from "../src/format.js";
import { drawPanel } from "../src/draw.js";
import { defaultPlotMessages } from "../src/messages.js";
import { prepare } from "../src/model.js";
import { Panel } from "../src/panel.js";
import type { Mark, PlotSpec } from "../src/spec.js";
import { PLOT_DARK } from "../src/theme.js";
import { validateSpec } from "../src/validate.js";

beforeAll(() => {
  (globalThis as { Path2D?: unknown }).Path2D ??= class {};
});

const marks: Mark[] = [{ type: "line", x: [0, 1, 2, 3], y: [10, 20, 15, 30] }];

/** Paints a panel of w x h onto a recording context; returns whether the glyph was filled in the text colour. */
function marked(w: number, h: number, watermark: Panel["o"]["watermark"]): boolean {
  const prepared = prepare({ marks, scales: undefined, theme: PLOT_DARK, hidden: new Set(), colors: new Map() });
  const p = new Panel({ prepared, theme: PLOT_DARK, fmt: new Fmt("en-US", "UTC"), scales: undefined, axes: undefined, msg: defaultPlotMessages, watermark });
  const calls: string[] = [];
  const ctx = new Proxy({ measureText: (s: string) => ({ width: s.length * 6 }) } as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : (...a: unknown[]) => void calls.push(`${k}(${a.length})`)),
    set: (t, k: string, v) => ((t[k] = v), calls.push(`${k}=${String(v)}`), true),
  }) as unknown as CanvasRenderingContext2D;
  p.layout(ctx, { x: 0, y: 0, w, h }, { view: null, xLabels: true, yLabels: true });
  drawPanel(p, ctx, 1);
  return calls.some((c, i) => c === "fill(1)" && calls[i - 1] === `fillStyle=${PLOT_DARK.text}`);
}

describe("watermark", () => {
  it("is drawn in the plot area when asked for", () => {
    expect(marked(600, 400, { visible: true, opacity: 1 })).toBe(true);
  });
  it("is not drawn when the panel carries none, it is hidden, or the area is small", () => {
    expect(marked(600, 400, undefined)).toBe(false);
    expect(marked(600, 400, { visible: false, opacity: 1 })).toBe(false);
    expect(marked(120, 80, { visible: true, opacity: 1 })).toBe(false);
  });
  it("refuses a bad option up front", () => {
    const spec = (watermark: NonNullable<PlotSpec["watermark"]>): PlotSpec => ({ marks, watermark });
    expect(() => validateSpec(spec({ opacity: 2 }))).toThrow(/watermark.opacity/);
    expect(() => validateSpec(spec({ visible: false }))).not.toThrow();
  });
});
