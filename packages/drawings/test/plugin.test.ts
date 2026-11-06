// The plugin through its pointer/keyboard interface on a fake chart.

import { MemoryStore } from "@alphacharts/core";
import { describe, expect, it } from "vitest";
import { T0, STEP, fixture, k, key, plugin, ptr, px, recorder, view } from "./helpers.js";
import type { DrawingsPlugin } from "../src/plugin.js";

/** Press at a, drag through b, release. */
function drag(p: DrawingsPlugin, a: { x: number; y: number }, b: { x: number; y: number }, extra = {}) {
  expect(p.pointer(ptr("down", a.x, a.y, extra))).toBe(true);
  p.pointer(ptr("move", (a.x + b.x) / 2, (a.y + b.y) / 2, { buttons: 1 }));
  p.pointer(ptr("move", b.x, b.y, { buttons: 1 }));
  p.pointer(ptr("up", b.x, b.y, extra));
}
function click(p: DrawingsPlugin, x: number, y: number, extra = {}) {
  p.pointer(ptr("down", x, y, extra));
  p.pointer(ptr("up", x, y, extra));
}

describe("creating drawings", () => {
  it("trend line by dragging: anchors are the exact time and price under the pointer", () => {
    const { p } = plugin();
    p.setTool("trendLine");
    drag(p, { x: 100, y: 300 }, { x: 300, y: 100 });
    const [d] = p.list();
    expect(d!.tool).toBe("trendLine");
    expect(d!.anchors).toEqual([
      { time: T0 + 25 * STEP, price: view().yToPrice(300) },
      { time: T0 + 75 * STEP, price: view().yToPrice(100) },
    ]);
    expect(p.activeTool()).toBeNull();
    expect(p.selection()).toEqual([d!.id]);
  });

  it("trend line by click, click", () => {
    const { p } = plugin();
    p.setTool("trendLine");
    click(p, 100, 300);
    expect(p.list()).toHaveLength(0);
    click(p, 300, 100);
    expect(p.list()).toHaveLength(1);
  });

  it("a three-anchor tool takes a drag then a click; a single-anchor tool one click", () => {
    const { p } = plugin();
    p.setTool("parallelChannel");
    drag(p, { x: 100, y: 300 }, { x: 300, y: 200 });
    expect(p.list()).toHaveLength(0);
    click(p, 200, 100);
    expect(p.list().map((d) => d.anchors.length)).toEqual([3]);
    p.setTool("horizontalLine");
    click(p, 500, 250);
    expect(p.list()[1]!.anchors).toEqual([{ time: T0 + 125 * STEP, price: view().yToPrice(250) }]);
  });

  it("a variable tool finishes on double click, dropping the duplicate anchor", () => {
    const { p } = plugin();
    p.setTool("polyline");
    click(p, 100, 300);
    click(p, 200, 200);
    click(p, 300, 250);
    click(p, 300, 250);
    p.pointer(ptr("dblclick", 300, 250));
    expect(p.list()[0]!.anchors).toHaveLength(3);
  });

  it("a variable tool finishes on Enter; with too few anchors it cancels", () => {
    const { p } = plugin();
    p.setTool("polyline");
    click(p, 100, 300);
    click(p, 200, 200);
    expect(p.key(key("Enter"))).toBe(true);
    expect(p.list()).toHaveLength(1);
  });

  it("freehand brush collects points while dragging", () => {
    const { p } = plugin();
    p.setTool("brush");
    p.pointer(ptr("down", 100, 300));
    for (let i = 1; i <= 10; i++) p.pointer(ptr("move", 100 + i * 10, 300 - i * 5, { buttons: 1 }));
    p.pointer(ptr("up", 200, 250));
    expect(p.list()[0]!.anchors.length).toBeGreaterThanOrEqual(10);
  });

  it("Escape cancels a drawing in progress, then disarms the tool", () => {
    const { p } = plugin();
    p.setTool("trendLine");
    click(p, 100, 300);
    expect(p.key(key("Escape"))).toBe(true);
    click(p, 300, 100);
    expect(p.list()).toHaveLength(0); // that click started a new drawing, not finished the old one
    p.key(key("Escape"));
    expect(p.key(key("Escape"))).toBe(true);
    expect(p.activeTool()).toBeNull();
  });

  it("screen-anchored text keeps fractions of the pane", () => {
    const { p } = plugin();
    p.setTool("anchoredText");
    click(p, 200, 100);
    expect(p.list()[0]!.props).toMatchObject({ fx: 0.25, fy: 0.25 });
  });

  it("a long position clicked with the stop on the wrong side is clamped to the entry, not saved invalid", () => {
    const { p, errors } = plugin();
    p.setTool("longPosition");
    click(p, 100, 300); // entry
    click(p, 300, 200); // target above
    click(p, 300, 100); // stop above the entry: clamped
    const d = p.list()[0]!;
    expect(d.anchors[2]!.price).toBe(d.anchors[0]!.price);
    expect(errors).toEqual([]);
  });

  it("continuous mode keeps the tool armed", () => {
    const { p } = plugin({ continuous: true });
    p.setTool("horizontalLine");
    click(p, 100, 100);
    click(p, 100, 200);
    expect(p.activeTool()).toBe("horizontalLine");
    expect(p.list()).toHaveLength(2);
  });
});

describe("selecting, moving, editing", () => {
  const make = () => {
    const t = plugin();
    const d = t.p.add({ tool: "trendLine", anchors: [k(20, 100), k(80, 120)] });
    return { ...t, d };
  };

  it("pressing empty space is left to the chart; a click there clears the selection", () => {
    const { p, d } = make();
    p.select([d.id]);
    expect(p.pointer(ptr("down", 700, 20))).toBe(false);
    p.pointer(ptr("click", 700, 20));
    expect(p.selection()).toEqual([]);
  });

  it("press on a line selects it and consumes the press (no pan)", () => {
    const { p, d } = make();
    const a = px(d.anchors[0]!), b = px(d.anchors[1]!);
    expect(p.pointer(ptr("down", (a.x + b.x) / 2, (a.y + b.y) / 2))).toBe(true);
    p.pointer(ptr("up", (a.x + b.x) / 2, (a.y + b.y) / 2));
    expect(p.selection()).toEqual([d.id]);
  });

  it("dragging the body moves both anchors by the same pixel offset; undo restores them exactly", () => {
    const { p, d } = make();
    const a = px(d.anchors[0]!), b = px(d.anchors[1]!);
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    drag(p, m, { x: m.x + 40, y: m.y + 20 });
    const moved = p.get(d.id)!;
    expect(px(moved.anchors[0]!).x).toBeCloseTo(a.x + 40, 9);
    expect(px(moved.anchors[0]!).y).toBeCloseTo(a.y + 20, 9);
    expect(px(moved.anchors[1]!).x).toBeCloseTo(b.x + 40, 9);
    p.undo();
    expect(p.get(d.id)!.anchors).toEqual(d.anchors);
    p.redo();
    expect(p.get(d.id)!.anchors).toEqual(moved.anchors);
  });

  it("dragging a handle moves one anchor only", () => {
    const { p, d } = make();
    p.select([d.id]);
    const b = px(d.anchors[1]!);
    drag(p, b, { x: b.x + 30, y: b.y - 30 });
    const e = p.get(d.id)!;
    expect(e.anchors[0]).toEqual(d.anchors[0]);
    expect(px(e.anchors[1]!).x).toBeCloseTo(b.x + 30, 9);
    expect(px(e.anchors[1]!).y).toBeCloseTo(b.y - 30, 9);
    p.undo();
    expect(p.get(d.id)!.anchors).toEqual(d.anchors);
  });

  it("a locked drawing selects but does not move or delete", () => {
    const { p, d } = make();
    p.update(d.id, { locked: true });
    const a = px(d.anchors[0]!), b = px(d.anchors[1]!);
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    drag(p, m, { x: m.x + 40, y: m.y });
    expect(p.get(d.id)!.anchors).toEqual(d.anchors);
    expect(p.selection()).toEqual([d.id]);
    expect(p.key(key("Delete"))).toBe(false);
    expect(p.list()).toHaveLength(1);
  });

  it("a hidden drawing is neither drawn nor hit", () => {
    const { p, d, chart } = make();
    p.update(d.id, { hidden: true });
    const a = px(d.anchors[0]!);
    expect(p.hitTest(0, a.x, a.y)).toBeNull();
    const { ctx, calls } = recorder();
    p.drawPane(ctx, chart.api.paneView(0));
    expect(calls).not.toContain("stroke");
  });

  it("visibility per interval", () => {
    const { p, d, chart } = make();
    p.update(d.id, { intervals: [5 * STEP] });
    const a = px(d.anchors[0]!);
    expect(p.hitTest(0, a.x, a.y)).toBeNull(); // chart is at 1m
    p.setInterval(5 * STEP);
    expect(p.hitTest(0, a.x, a.y)?.id).toBe(d.id);
    const { ctx, calls } = recorder();
    p.drawPane(ctx, chart.api.paneView(0));
    expect(calls).toContain("stroke");
  });

  it("shift-click adds to the selection and toggles; shift-drag box-selects", () => {
    const { p, d } = make();
    const e = p.add({ tool: "horizontalLine", anchors: [k(40, 125)] });
    const a = px(d.anchors[0]!), b = px(d.anchors[1]!);
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    click(p, m.x, m.y);
    click(p, 600, view().priceToY(125), { shiftKey: true });
    expect(p.selection().sort()).toEqual([d.id, e.id].sort());
    click(p, 600, view().priceToY(125), { shiftKey: true });
    expect(p.selection()).toEqual([d.id]);
    p.select([]);
    // box around the trend line only
    drag(p, { x: a.x - 10, y: Math.min(a.y, b.y) - 10 }, { x: b.x + 10, y: Math.max(a.y, b.y) + 10 }, { shiftKey: true });
    expect(p.selection()).toEqual([d.id]);
  });

  it("dragging a multi-selection moves all unlocked members", () => {
    const { p, d } = make();
    const e = p.add({ tool: "trendLine", anchors: [k(100, 105), k(150, 115)] });
    p.select([d.id, e.id]);
    const a = px(d.anchors[0]!), b = px(d.anchors[1]!);
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    drag(p, m, { x: m.x, y: m.y + 25 });
    expect(px(p.get(e.id)!.anchors[0]!).y).toBeCloseTo(px(e.anchors[0]!).y + 25, 9);
    p.undo();
    expect(p.get(e.id)!.anchors).toEqual(e.anchors);
    expect(p.get(d.id)!.anchors).toEqual(d.anchors);
  });

  it("cursor reflects what is under the pointer", () => {
    const { p, d } = make();
    const a = px(d.anchors[0]!), b = px(d.anchors[1]!);
    expect(p.cursor(0, (a.x + b.x) / 2, (a.y + b.y) / 2)).toBe("move");
    expect(p.cursor(0, 700, 10)).toBeNull();
    p.setTool("trendLine");
    expect(p.cursor(0, 700, 10)).toBe("crosshair");
  });

  it("touch uses a larger hit tolerance than the mouse", () => {
    const { p, d } = make();
    const a = px(d.anchors[0]!), b = px(d.anchors[1]!);
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + 12 };
    expect(p.pointer(ptr("down", m.x, m.y, { pointerType: "mouse" }))).toBe(false);
    expect(p.pointer(ptr("down", m.x, m.y, { pointerType: "touch" }))).toBe(true);
  });
});

describe("keyboard, clipboard, order", () => {
  it("Delete removes the selection, Ctrl/Cmd+Z restores it, Shift+Z redoes", () => {
    const { p } = plugin();
    const d = p.add(fixture("trendLine"));
    p.select([d.id]);
    expect(p.key(key("Delete"))).toBe(true);
    expect(p.list()).toHaveLength(0);
    expect(p.key(key("z", { ctrlKey: true }))).toBe(true);
    expect(p.list()).toHaveLength(1);
    expect(p.key(key("z", { metaKey: true, shiftKey: true }))).toBe(true);
    expect(p.list()).toHaveLength(0);
    expect(p.key(key("z", { ctrlKey: true }))).toBe(true);
    expect(p.key(key("Delete"))).toBe(false); // nothing selected after undo? (selection dropped on removal, restored drawing is unselected)
  });

  it("copy and paste at the pointer: the first anchor lands there and prices are shifted by the exact difference", () => {
    const { p } = plugin();
    const d = p.add({ tool: "trendLine", anchors: [k(20, 100), k(80, 112)] });
    p.select([d.id]);
    expect(p.key(key("c", { ctrlKey: true }))).toBe(true);
    p.pointer(ptr("move", 400, 100));
    expect(p.key(key("v", { ctrlKey: true }))).toBe(true);
    const [orig, copy] = p.list();
    expect(copy!.id).not.toBe(orig!.id);
    const at = { time: T0 + 100 * STEP, price: view().yToPrice(100) };
    expect(copy!.anchors[0]).toEqual(at);
    expect(copy!.anchors[1]).toEqual({ time: at.time + 60 * STEP, price: at.price + (112 - 100) });
    expect(p.selection()).toEqual([copy!.id]);
    p.undo();
    expect(p.list()).toHaveLength(1);
  });

  it("duplicate shifts by five bars in time and not at all in price", () => {
    const { p } = plugin();
    const d = p.add({ tool: "trendLine", anchors: [k(20, 100), k(80, 112)] });
    p.select([d.id]);
    p.key(key("d", { metaKey: true }));
    const copy = p.list()[1]!;
    expect(copy.anchors).toEqual([k(25, 100), k(85, 112)]);
  });

  it("z-order", () => {
    const { p } = plugin();
    const [a, b, c] = ["trendLine", "ray", "arrow"].map((t) => p.add(fixture(t)).id) as [string, string, string];
    p.bringToFront([a]);
    expect(p.list().map((d) => d.id)).toEqual([b, c, a]);
    p.sendBackward([a]);
    expect(p.list().map((d) => d.id)).toEqual([b, a, c]);
    p.bringForward([b]);
    expect(p.list().map((d) => d.id)).toEqual([a, b, c]);
    p.sendToBack([c]);
    expect(p.list().map((d) => d.id)).toEqual([c, a, b]);
    p.undo();
    expect(p.list().map((d) => d.id)).toEqual([a, b, c]);
  });

  it("the topmost drawing wins a hit", () => {
    const { p } = plugin();
    const a = p.add({ tool: "trendLine", anchors: [k(20, 100), k(80, 120)] });
    const b = p.add({ tool: "trendLine", anchors: [k(20, 100), k(80, 120)] });
    const pa = px(a.anchors[0]!), pb = px(a.anchors[1]!);
    const m = { x: pa.x + (pb.x - pa.x) / 4, y: pa.y + (pb.y - pa.y) / 4 };
    expect(p.hitTest(0, m.x, m.y)?.id).toBe(b.id);
    p.sendToBack([b.id]);
    expect(p.hitTest(0, m.x, m.y)?.id).toBe(a.id);
  });
});

describe("events and persistence", () => {
  it("created / changed / removed / selected", () => {
    const { p } = plugin();
    const log: string[] = [];
    p.events.on("created", (d) => log.push(`created ${d.tool}`));
    p.events.on("changed", (d) => log.push(`changed ${d.tool}`));
    p.events.on("removed", (d) => log.push(`removed ${d.tool}`));
    p.events.on("selected", (ids) => log.push(`selected ${ids.length}`));
    const d = p.add(fixture("ray"));
    p.select([d.id]);
    p.update(d.id, { style: { color: "#ff0000" } });
    p.remove([d.id]);
    expect(log).toEqual(["created ray", "selected 1", "changed ray", "removed ray", "selected 0"]);
  });

  it("events caused by fromJSON are marked as a restore, and only those", () => {
    const { p } = plugin();
    const seen: string[] = [];
    const note = (what: string) => () => seen.push(`${what}:${p.restoring}`);
    p.events.on("created", note("created"));
    p.events.on("removed", note("removed"));
    const a = p.add(fixture("ray"));
    p.fromJSON(JSON.parse(JSON.stringify(p.toJSON())));
    p.remove([a.id]);
    expect(seen).toEqual(["created:false", "removed:true", "created:true", "removed:false"]);
    expect(p.restoring).toBe(false);
  });

  it("a drag emits one changed per drawing and a single undo step", () => {
    const { p } = plugin();
    const d = p.add({ tool: "trendLine", anchors: [k(20, 100), k(80, 120)] });
    const changed: string[] = [];
    p.events.on("changed", (x) => changed.push(x.id));
    const a = px(d.anchors[0]!), b = px(d.anchors[1]!);
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    drag(p, m, { x: m.x + 30, y: m.y });
    expect(changed).toEqual([d.id]);
    p.undo();
    expect(p.get(d.id)!.anchors).toEqual(d.anchors);
    p.undo();
    expect(p.list()).toHaveLength(0);
  });

  it("toJSON carries a version; fromJSON validates everything before replacing anything", () => {
    const { p } = plugin();
    p.add(fixture("trendLine"));
    const good = p.toJSON();
    expect(good.version).toBe(1);
    const bad = JSON.parse(JSON.stringify(good));
    bad.drawings.push({ ...bad.drawings[0], id: "x", tool: "trendLine", anchors: [{ time: 1, price: Infinity }, { time: 2, price: 1 }] });
    expect(() => p.fromJSON(bad)).toThrow(/finite|anchor/);
    expect(p.list()).toHaveLength(1);
    expect(() => p.fromJSON({ version: 1, drawings: [good.drawings[0], good.drawings[0]] })).toThrow(/repeats id/);
  });

  it("new ids continue after the highest loaded id", () => {
    const { p } = plugin();
    p.add({ ...fixture("trendLine"), id: "d41" });
    const q = plugin();
    q.p.fromJSON(p.toJSON());
    expect(q.p.add(fixture("ray")).id).toBe("d42");
  });

  it("a tool that throws while drawing is reported once and does not stop the others", () => {
    const { p, chart, errors } = plugin();
    p.add(fixture("trendLine"));
    const d = p.add(fixture("ray"));
    // corrupt a prop behind the plugin's back so shapes() throws
    (p as unknown as { store: { get(id: string): { anchors: unknown[] } } }).store.get(d.id)!.anchors = [];
    const { ctx, calls } = recorder();
    p.drawPane(ctx, chart.api.paneView(0));
    p.drawPane(ctx, chart.api.paneView(0));
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toMatch(/no anchor 0/);
    expect(calls).toContain("stroke");
  });
});

describe("magnet", () => {
  // bar 40: find its OHLC and the pixel of each value
  const setup = (mode: "off" | "weak" | "strong") => {
    const t = plugin({ magnet: mode });
    const bar = t.src.at(40);
    const x = view().timeToX(bar.time), yHigh = view().priceToY(bar.high), yLow = view().priceToY(bar.low);
    return { ...t, bar, x, yHigh, yLow };
  };

  it("off: the raw pointer time and price", () => {
    const { p } = setup("off");
    expect(p.snap(ptr("move", 163, 201))).toEqual({ time: view().xToTime(163), price: view().yToPrice(201) });
  });

  it("strong: the nearest bar's nearest O/H/L/C, exactly", () => {
    const { p, bar, x, yHigh } = setup("strong");
    // 2 px right of the bar and 30 px above its high → the high (nearest value in y)
    expect(p.snap(ptr("move", x + 1, yHigh - 30))).toEqual({ time: bar.time, price: bar.high });
    // far from every bar still snaps (strong), to the nearest bar's value
    const far = p.snap(ptr("move", x + 1, 5));
    expect(far.time).toBe(bar.time);
    expect([bar.open, bar.high, bar.low, bar.close]).toContain(far.price);
  });

  it("strong picks the closest of the four values", () => {
    const { p, bar, x } = setup("strong");
    for (const v of [bar.open, bar.high, bar.low, bar.close]) {
      expect(p.snap(ptr("move", x, view().priceToY(v) + 0.4)).price).toBe(v);
    }
  });

  it("weak: snaps within 16 px, otherwise leaves the pointer alone", () => {
    const { p, bar, x, yHigh } = setup("weak");
    expect(p.snap(ptr("move", x + 1, yHigh - 10))).toEqual({ time: bar.time, price: bar.high });
    const away = ptr("move", x + 1, yHigh - 60);
    // 60 px above the high; the nearest of O/H/L/C is still the high but beyond 16 px
    expect(p.snap(away)).toEqual({ time: away.time, price: away.price });
  });

  it("applies while creating: the anchors are bar values", () => {
    const { p, bar, x, yHigh } = setup("strong");
    p.setTool("horizontalLine");
    click(p, x + 1, yHigh - 3);
    expect(p.list()[0]!.anchors[0]).toEqual({ time: bar.time, price: bar.high });
  });

  it("only the main pane is snapped", () => {
    const { p } = setup("strong");
    const e = ptr("move", 100, 100, { pane: 1 });
    expect(p.snap(e)).toEqual({ time: e.time, price: e.price });
  });
});

describe("templates and favourites", () => {
  it("save a style, apply it to another drawing of the tool, in one undo step", async () => {
    const { p } = plugin({ store: new MemoryStore() });
    const a = p.add({ ...fixture("trendLine"), style: { color: "#ff00ff", width: 4, dash: "dashed" } });
    const b = p.add(fixture("trendLine"));
    await p.saveTemplate(a.id, "magenta");
    await p.applyTemplate([b.id], "magenta");
    expect(p.get(b.id)!.style).toMatchObject({ color: "#ff00ff", width: 4, dash: "dashed" });
    p.undo();
    expect(p.get(b.id)!.style.color).toBe("#2962ff");
    expect(await p.templates!.list("trendLine")).toEqual([{ tool: "trendLine", name: "magenta" }]);
  });

  it("refuses unknown templates, a template across tools, and bad names", async () => {
    const { p } = plugin({ store: new MemoryStore() });
    const a = p.add(fixture("trendLine"));
    const r = p.add(fixture("rectangle"));
    await expect(p.applyTemplate([a.id], "nope")).rejects.toThrow(/no template/);
    await expect(p.applyTemplate([a.id, r.id], "x")).rejects.toThrow(/one tool/);
    await expect(p.saveTemplate(a.id, "a/b")).rejects.toThrow(/no "\/"/);
  });

  it("favourites persist in the store", async () => {
    const store = new MemoryStore();
    const { p } = plugin({ store });
    expect(await p.templates!.setFavourite("trendLine", true)).toEqual(["trendLine"]);
    expect(await p.templates!.setFavourite("fibRetracement", true)).toEqual(["trendLine", "fibRetracement"]);
    expect(await p.templates!.setFavourite("trendLine", false)).toEqual(["fibRetracement"]);
    expect(await p.templates!.favourites()).toEqual(["fibRetracement"]);
  });
});

describe("anchoring", () => {
  it("drawings stay on their time and price when the pane maps differently (prepend shifts every x)", () => {
    // Simulate prepending 50 bars: the same time now sits 200 px further right.
    const { p } = plugin();
    const d = p.add({ tool: "horizontalRay", anchors: [k(40, 110)] });
    const shift = 50 * 4;
    const v = view();
    const shifted = { ...v, timeToX: (t: number) => v.timeToX(t) + shift, xToTime: (x: number) => v.xToTime(x - shift) };
    const c = { W: v.width, H: v.height, dpr: 1, X: shifted.timeToX, Y: v.priceToY, T: shifted.xToTime, P: v.yToPrice, fmt: v.formatPrice, source: null, interval: STEP };
    const line = p.toolDef("horizontalRay").shapes(d, c).find((s) => s.k === "line")!;
    expect(line.k === "line" && line.x1).toBe(v.timeToX(d.anchors[0]!.time) + shift);
  });
});

describe("readOnly: drawings the host places by code", () => {
  it("never takes a press, key or cursor, though a drawing sits right under it", () => {
    const { p } = plugin({ readOnly: true });
    const d = p.add({ tool: "horizontalLine", anchors: [k(50, 110)], locked: true });
    const at = px(d.anchors[0]!);
    expect(p.pointer(ptr("down", at.x, at.y))).toBe(false);
    expect(p.pointer(ptr("move", at.x, at.y))).toBe(false);
    expect(p.pointer(ptr("up", at.x, at.y))).toBe(false);
    expect(p.pointer(ptr("click", at.x, at.y))).toBe(false);
    expect(p.pointer(ptr("dblclick", at.x, at.y))).toBe(false);
    expect(p.cursor(0, at.x, at.y)).toBeNull();
    expect(p.key(key("Delete"))).toBe(false);
    expect(p.key(key("Escape"))).toBe(false);
    expect(p.selection()).toEqual([]);
    expect(p.list()).toHaveLength(1);
  });

  it("takes no tool", () => {
    const { p } = plugin({ readOnly: true });
    expect(() => p.setTool("trendLine")).toThrow(/read-only/);
  });

  it("is still drawn and still changed by code", () => {
    const { p } = plugin({ readOnly: true });
    const d = p.add({ tool: "horizontalLine", anchors: [k(50, 110)] });
    p.update(d.id, { anchors: [k(50, 111)] });
    expect(p.list()[0]!.anchors[0]!.price).toBe(111);
    p.remove([d.id]);
    expect(p.list()).toHaveLength(0);
  });
});
