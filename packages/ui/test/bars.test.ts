import { describe, expect, it } from "vitest";
import { toCols } from "../src/engine/bars.js";

describe("toCols refuses values the feed did not send", () => {
  const row = { time: 1, open: 1, high: 2, low: 1, close: 2 };
  it("accepts complete rows", () => expect(toCols([row] as never, "t").close[0]).toBe(2));
  it("refuses a null or NaN price and a missing time in rows", () => {
    expect(() => toCols([{ ...row, close: null }] as never, "t")).toThrow(/row 0/);
    expect(() => toCols([row, { ...row, open: NaN }] as never, "t")).toThrow(/row 1/);
    expect(() => toCols([{ open: 1, high: 1, low: 1, close: 1 }] as never, "t")).toThrow(/row 0/);
  });
  it("refuses a short column and a NaN in columns", () => {
    const c = { time: [1, 2], open: [1, 2], high: [1, 2], low: [1, 2], close: [1] };
    expect(() => toCols(c as never, "t")).toThrow(/close has 1 rows/);
    expect(() => toCols({ ...c, close: [1, NaN] } as never, "t")).toThrow(/row 1/);
  });
});
