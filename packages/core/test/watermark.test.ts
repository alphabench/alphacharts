import { beforeAll, describe, expect, it } from "vitest";
import { checkWatermarkOptions, DEFAULT_WATERMARK, drawWatermark } from "../src/chart/watermark.js";
import { DARK } from "../src/chart/theme.js";

beforeAll(() => {
  (globalThis as { Path2D?: unknown }).Path2D ??= class {};
});

function fakeCtx() {
  const calls: string[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : (...a: unknown[]) => void calls.push(`${k}(${a.length})`)),
    set: (t, k: string, v) => ((t[k] = v), calls.push(`${k}=${String(v)}`), true),
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe("watermark", () => {
  it("draws a halo in the background colour, then the glyph in the text colour", () => {
    const { ctx, calls } = fakeCtx();
    drawWatermark(ctx, 800, 400, DARK, DEFAULT_WATERMARK);
    const halo = calls.indexOf(`strokeStyle=${DARK.background}`), fill = calls.indexOf(`fillStyle=${DARK.text}`);
    expect(halo).toBeGreaterThan(-1);
    expect(calls.indexOf("stroke(1)")).toBeGreaterThan(halo);
    expect(calls.indexOf("fill(1)")).toBeGreaterThan(fill);
    expect(calls.indexOf("stroke(1)")).toBeLessThan(calls.indexOf("fill(1)"));
  });
  it("draws nothing when hidden, transparent, or the pane is too small", () => {
    for (const [w, h, o] of [[800, 400, { visible: false, opacity: 1 }], [800, 400, { visible: true, opacity: 0 }], [100, 400, DEFAULT_WATERMARK], [800, 80, DEFAULT_WATERMARK]] as const) {
      const { ctx, calls } = fakeCtx();
      drawWatermark(ctx, w, h, DARK, o);
      expect(calls).toEqual([]);
    }
  });
  it("refuses an opacity outside 0 to 1", () => {
    expect(() => checkWatermarkOptions({ visible: true, opacity: 1.5 })).toThrow(/watermark.opacity/);
    expect(() => checkWatermarkOptions({ visible: true, opacity: Number.NaN })).toThrow(/watermark.opacity/);
    expect(() => checkWatermarkOptions({ visible: true, opacity: 0.6 })).not.toThrow();
    expect(() => checkWatermarkOptions({ visible: "false" as unknown as boolean, opacity: 1 })).toThrow(/watermark.visible/);
  });
});
