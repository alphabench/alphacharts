import { describe, expect, it } from "vitest";
import { markerFloor } from "../src/chart/marker-floor.js";

const N = NaN;

describe("markerFloor: which marks a markers plot keeps", () => {
  // marks (1) on bars 1, 4, 5, 8; the others are na
  const col = [N, 1, N, N, 1, 1, N, N, 1, N];

  it("keeps everything when the plot asks for no limit", () => {
    expect(markerFloor(col, col.length, {})).toBe(0);
  });

  it("last: starts at the Nth newest mark", () => {
    expect(markerFloor(col, col.length, { last: 1 })).toBe(8);
    expect(markerFloor(col, col.length, { last: 2 })).toBe(5);
    expect(markerFloor(col, col.length, { last: 3 })).toBe(4);
    expect(markerFloor(col, col.length, { last: 4 })).toBe(1);
  });

  it("last: fewer marks than asked keeps them all", () => {
    expect(markerFloor(col, col.length, { last: 9 })).toBe(0);
  });

  it("within: only the final N bars", () => {
    expect(markerFloor(col, col.length, { within: 3 })).toBe(7);
    expect(markerFloor(col, col.length, { within: 100 })).toBe(0);
  });

  it("last and within together: the later of the two floors; the newest marks inside the window", () => {
    // the final 6 bars are 4..9 and hold marks on 4, 5, 8; the last 2 of those start at 5
    expect(markerFloor(col, col.length, { within: 6, last: 2 })).toBe(5);
    // the final 3 bars hold one mark (8): asking for 3 keeps just that window
    expect(markerFloor(col, col.length, { within: 3, last: 3 })).toBe(7);
  });

  it("reads only the first n bars (the column may be longer than the bars)", () => {
    expect(markerFloor(col, 6, { last: 1 })).toBe(5);
  });

  it("a text mark of 0 is not a mark", () => {
    expect(markerFloor([1, 0, 1, 0], 4, { last: 1, text: true })).toBe(2);
    expect(markerFloor([1, 0, 1, 0], 4, { last: 2, text: true })).toBe(0);
  });

  it("appending a bar gives the batch answer, a newer mark pushes the oldest out", () => {
    const grown: number[] = [];
    for (let i = 0; i < col.length; i++) {
      grown.push(col[i]!);
      expect(markerFloor(grown, grown.length, { last: 3 })).toBe(markerFloor(col.slice(0, i + 1), i + 1, { last: 3 }));
    }
    expect(markerFloor(col, 9, { last: 3 })).toBe(4); // bars 0..8 hold marks on 1, 4, 5, 8: the three newest begin at 4
  });
});
