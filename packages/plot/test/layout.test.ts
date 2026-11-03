import { describe, expect, it } from "vitest";
import { freedmanDiaconisWidth, histogram } from "../src/bin.js";
import { stack } from "../src/stack.js";
import { leaves, nodeValue, squarify, treemap } from "../src/treemap.js";
import type { TreeNode } from "../src/spec.js";

describe("histogram", () => {
  const data = Array.from({ length: 1000 }, (_, i) => (i % 100) / 10); // 0 .. 9.9, 10 of each tenth
  it("fixed bin count: equal widths over the extent, counts sum to n, last bin closed", () => {
    const b = histogram([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
    expect(b.map((x) => [x.x0, x.x1])).toEqual([[0, 2], [2, 4], [4, 6], [6, 8], [8, 10]]);
    expect(b.map((x) => x.count)).toEqual([2, 2, 2, 2, 3]);
  });
  it("explicit edges", () => {
    const b = histogram([1, 2, 3, 4, 5, 50], [0, 3, 10, 100]);
    expect(b.map((x) => x.count)).toEqual([2, 3, 1]);
  });
  it("Freedman-Diaconis: width 2*IQR*n^-1/3, rounded to a nice step, edges on multiples of it", () => {
    const sorted = Float64Array.from(data).sort();
    const raw = freedmanDiaconisWidth(sorted)!;
    expect(raw).toBeCloseTo(2 * 5 * 1000 ** (-1 / 3), 1); // IQR of uniform 0..10 is ~5
    const b = histogram(data, "fd");
    const w = b[0]!.x1 - b[0]!.x0;
    expect([1, 2, 2.5, 5].some((f) => Math.abs(w / 10 ** Math.floor(Math.log10(w)) - f) < 1e-9)).toBe(true);
    expect(b.reduce((s, x) => s + x.count, 0)).toBe(1000);
    for (const x of b) expect(Math.abs(x.x0 / w - Math.round(x.x0 / w))).toBeLessThan(1e-9);
  });
  it("density integrates to 1", () => {
    const b = histogram(data, 7);
    expect(b.reduce((s, x) => s + x.density * (x.x1 - x.x0), 0)).toBeCloseTo(1);
  });
  it("skips non-finite values and handles a constant column and no data", () => {
    expect(histogram([NaN, Infinity], 3)).toEqual([]);
    const b = histogram([4, 4, 4], "fd");
    expect(b.reduce((s, x) => s + x.count, 0)).toBe(3);
  });
  it("rejects bad rules", () => {
    expect(() => histogram([1, 2], 0)).toThrow(/integer/);
    expect(() => histogram([1, 2], [3, 1])).toThrow(/increase/);
  });
});

describe("stack", () => {
  it("stacks positives up and negatives down, apart", () => {
    const keys = ["a", "b"];
    const [s1, s2, s3] = stack([
      { keys, values: [3, -2] },
      { keys, values: [4, -1] },
      { keys, values: [-5, 6] },
    ]);
    expect([...s1!.lo]).toEqual([0, 0]);
    expect([...s1!.hi]).toEqual([3, -2]);
    expect([...s2!.lo]).toEqual([3, -2]);
    expect([...s2!.hi]).toEqual([7, -3]);
    expect([...s3!.lo]).toEqual([0, 0]);
    expect([...s3!.hi]).toEqual([-5, 6]);
  });
  it("aligns by key, not position, and leaves NaN as a gap", () => {
    const [a, b] = stack([
      { keys: ["x", "y"], values: [1, 2] },
      { keys: ["y", "x"], values: [10, NaN] },
    ]);
    expect([...a!.hi]).toEqual([1, 2]);
    expect(b!.lo[0]).toBe(2);
    expect(b!.hi[0]).toBe(12);
    expect(b!.hi[1]).toBeNaN();
  });
  it("rejects mismatched keys", () => {
    expect(() => stack([{ keys: ["a"], values: [1, 2] }])).toThrow(/keys/);
  });
});

describe("treemap", () => {
  it("squarify tiles the rectangle exactly with areas in proportion", () => {
    const areas = [600, 300, 200, 100];
    const rects = squarify(areas, 0, 0, 50, 24);
    expect(rects.map((r) => r.w * r.h)).toEqual(areas.map((a) => expect.closeTo(a, 6)));
    expect(rects.reduce((s, r) => s + r.w * r.h, 0)).toBeCloseTo(1200);
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(-1e-9);
      expect(r.y).toBeGreaterThanOrEqual(-1e-9);
      expect(r.x + r.w).toBeLessThanOrEqual(50 + 1e-9);
      expect(r.y + r.h).toBeLessThanOrEqual(24 + 1e-9);
    }
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!, b = rects[j]!;
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(ox > 1e-9 && oy > 1e-9).toBe(false);
      }
  });
  it("keeps tiles squarish (the classic example)", () => {
    const rects = squarify([6, 6, 4, 3, 2, 2, 1], 0, 0, 6, 4);
    for (const r of rects) expect(Math.max(r.w / r.h, r.h / r.w)).toBeLessThan(3);
  });

  const tree: TreeNode = {
    name: "root",
    children: [
      { name: "Banks", children: [{ name: "HDFC", value: 50 }, { name: "ICICI", value: 30 }, { name: "SBI", value: 20 }] },
      { name: "IT", children: [{ name: "TCS", value: 40 }, { name: "Infy", value: 20 }] },
      { name: "Empty", value: 0 },
    ],
  };
  it("nests groups: a group's area is its sum, children sit inside its inner rectangle, zero-size nodes get no tile", () => {
    expect(nodeValue(tree)).toBe(160);
    const t = treemap(tree, 400, 200, { gap: 2, header: 16 });
    expect(t.children.map((c) => c.node.name).sort()).toEqual(["Banks", "IT"]);
    const banks = t.children.find((c) => c.node.name === "Banks")!;
    const it = t.children.find((c) => c.node.name === "IT")!;
    expect((banks.w * banks.h) / (it.w * it.h)).toBeCloseTo(100 / 60, 6);
    expect(banks.w * banks.h + it.w * it.h).toBeCloseTo(400 * 200, 6);
    for (const c of banks.children) {
      expect(c.x).toBeGreaterThanOrEqual(banks.inner.x - 1e-9);
      expect(c.y).toBeGreaterThanOrEqual(banks.inner.y - 1e-9);
      expect(c.x + c.w).toBeLessThanOrEqual(banks.inner.x + banks.inner.w + 1e-9);
      expect(c.y + c.h).toBeLessThanOrEqual(banks.inner.y + banks.inner.h + 1e-9);
    }
    expect(banks.inner.y).toBeCloseTo(banks.y + 2 + 16);
    expect(leaves(t).map((l) => l.path.join("/")).sort()).toEqual(["Banks/HDFC", "Banks/ICICI", "Banks/SBI", "IT/Infy", "IT/TCS"]);
  });
  it("refuses negative sizes", () => {
    expect(() => nodeValue({ name: "x", value: -1 })).toThrow(/not negative/);
  });
});
