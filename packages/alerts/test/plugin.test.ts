// AlertsPlugin against the pure evaluator: same definitions, same ticks, same
// triggers; plus what only the plugin does (follow drawings, persist, draw).

import { LUMA_DARK, type PluginApi, type PluginPaneView } from "@alphacharts/core";
import { ArrayBarSource, DrawingsPlugin, allTools } from "@alphacharts/drawings";
import { describe, expect, it } from "vitest";
import { AlertEvaluator, AlertsPlugin, seriesIndicator, type AlertDefinition, type AlertTrigger, type Tick } from "../src/index.js";

const STEP = 60_000;
const T0 = Date.UTC(2026, 9, 19, 3, 45);

function view(): PluginPaneView {
  return {
    pane: 0, width: 800, height: 400, dpr: 1,
    timeToX: (t) => ((t - T0) / STEP) * 4, xToTime: (x) => T0 + (x / 4) * STEP,
    priceToY: (p) => 400 - (p - 90) * 10, yToPrice: (y) => 90 + (400 - y) / 10, formatPrice: (p) => p.toFixed(2),
    priceScaleMode: () => "linear",
  };
}
const api = (): PluginApi => ({ requestRender() {}, paneCount: 1, paneView: view, barTimeAtOrBefore: (t) => t, setCursor() {}, theme: LUMA_DARK });

function barSource(n = 100): ArrayBarSource {
  const time = Array.from({ length: n }, (_, i) => T0 + i * STEP);
  const c = time.map((_, i) => 110 + 8 * Math.sin(i / 9));
  return new ArrayBarSource({ time, open: c, high: c.map((x) => x + 0.5), low: c.map((x) => x - 0.5), close: c, volume: c.map(() => 100) });
}

/** A replayed price path: 4 ticks per 1-minute bar, 15 s apart. */
function path(bars: number): Tick[] {
  const out: Tick[] = [];
  for (let b = 0; b < bars; b++) {
    for (let k = 0; k < 4; k++) {
      const price = 110 + 8 * Math.sin((b + k / 4) / 3) + (k % 2 ? 0.3 : -0.3);
      out.push({ time: T0 + b * STEP + k * 15_000, price, bar: T0 + b * STEP });
    }
  }
  return out;
}

const defs = (drawingGeometry?: AlertDefinition["condition"]): AlertDefinition[] => [
  { id: "up", condition: { type: "crossing", price: 112, direction: "up" }, trigger: { mode: "everyTime" } },
  { id: "down", condition: { type: "crossing", price: 112, direction: "down" }, trigger: { mode: "oncePerBar" } },
  { id: "chan", condition: { type: "enteringChannel", low: 105, high: 108 }, trigger: { mode: "everyTime", debounceMs: 30_000 } },
  { id: "move", condition: { type: "moving", direction: "up", bars: 4, amount: 3 }, trigger: { mode: "oncePerBar" } },
  { id: "close", condition: { type: "greaterThan", price: 115 }, trigger: { mode: "oncePerBarClose" } },
  { id: "rsi", condition: { type: "indicator", id: "ind", op: "crossingUp", value: 0 }, trigger: { mode: "everyTime" } },
  ...(drawingGeometry ? [{ id: "line", condition: drawingGeometry, trigger: { mode: "everyTime" } } as AlertDefinition] : []),
];

const indicators = { ind: (t: Tick) => Math.sin(t.time / 400_000) };

describe("plugin vs pure evaluator", () => {
  it("fire exactly the same triggers on the same ticks, with and without a JSON round trip", () => {
    const src = barSource();
    const drawings = new DrawingsPlugin({ tools: allTools, source: src, interval: STEP });
    drawings.install(api());
    const line = drawings.add({ tool: "trendLine", anchors: [{ time: T0, price: 104 }, { time: T0 + 80 * STEP, price: 116 }] });

    const plugin = new AlertsPlugin({ drawings, source: src, indicators });
    plugin.install(api());
    for (const d of defs()) plugin.add(d);
    const geo = plugin.addDrawingAlert({ id: "line", drawingId: line.id, line: "main", op: "crossing", trigger: { mode: "everyTime" } });

    const seen: AlertTrigger[] = [];
    plugin.on("trigger", (t) => seen.push(t));
    const ticks = path(60);
    const fromPlugin = ticks.flatMap((t) => plugin.tick(t));
    const closed = plugin.closeBar(ticks[ticks.length - 1]!.time);

    const direct = new AlertEvaluator([...defs(), geo], { indicators, logical: (t) => src.logical(t) });
    const expected = [...ticks.flatMap((t) => direct.tick(t)), ...direct.closeBar(ticks[ticks.length - 1]!.time)];

    expect([...fromPlugin, ...closed]).toEqual(expected);
    expect(seen).toEqual(expected);
    expect(new Set(expected.map((t) => t.alertId)).size).toBeGreaterThanOrEqual(5);

    // a backend: definitions only, via JSON
    const backend = new AlertEvaluator(JSON.parse(JSON.stringify(plugin.toJSON())).alerts.map((a: { definition: AlertDefinition }) => a.definition), { indicators, logical: (t) => src.logical(t) });
    const remote = [...ticks.flatMap((t) => backend.tick(t)), ...backend.closeBar(ticks[ticks.length - 1]!.time)];
    expect(remote).toEqual(expected);
  });
});

describe("drawing-based alerts", () => {
  const setup = () => {
    const src = barSource();
    const drawings = new DrawingsPlugin({ tools: allTools, source: src, interval: STEP });
    drawings.install(api());
    const errors: Error[] = [];
    const plugin = new AlertsPlugin({ drawings, source: src, onError: (e) => errors.push(e) });
    plugin.install(api());
    return { src, drawings, plugin, errors };
  };

  it("snapshots the drawing's geometry", () => {
    const { drawings, plugin } = setup();
    const d = drawings.add({ tool: "horizontalLine", anchors: [{ time: T0, price: 111 }] });
    const def = plugin.addDrawingAlert({ id: "h", drawingId: d.id, line: "main", op: "crossingUp", trigger: { mode: "once" } });
    expect(def.condition).toMatchObject({ type: "drawing", line: "main", op: "crossingUp", drawing: { id: d.id, tool: "horizontalLine", anchors: [{ time: T0, price: 111 }] } });
  });

  it("follows the drawing when it is moved: the next tick judges against the new price", () => {
    const { drawings, plugin } = setup();
    const d = drawings.add({ tool: "horizontalLine", anchors: [{ time: T0, price: 111 }] });
    plugin.addDrawingAlert({ id: "h", drawingId: d.id, line: "main", op: "crossingUp", trigger: { mode: "everyTime" } });
    const mk = (i: number, price: number): Tick => ({ time: T0 + i * 1000, price, bar: T0 });
    plugin.tick(mk(0, 110));
    drawings.update(d.id, { anchors: [{ time: T0, price: 113 }] });
    plugin.tick(mk(1, 111.5)); // line is now 113; stepper restarted
    expect(plugin.tick(mk(2, 112))).toEqual([]);
    const fired = plugin.tick(mk(3, 113.5));
    expect(fired.map((t) => [t.price, t.values.line])).toEqual([[113.5, 113]]);
  });

  it("deleting the drawing orphans the alert, reported once; it never fires", () => {
    const { drawings, plugin, errors } = setup();
    const d = drawings.add({ tool: "horizontalLine", anchors: [{ time: T0, price: 111 }] });
    plugin.addDrawingAlert({ id: "h", drawingId: d.id, line: "main", op: "crossing", trigger: { mode: "everyTime" } });
    drawings.remove([d.id]);
    const st: string[] = [];
    plugin.on("status", (e) => st.push(`${e.id}:${e.status}`));
    expect(plugin.tick({ time: T0, price: 110, bar: T0 })).toEqual([]);
    expect(plugin.tick({ time: T0 + 1000, price: 112, bar: T0 })).toEqual([]);
    expect(plugin.status("h")).toBe("orphaned");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toMatch(/no longer exists/);
    expect(st).toEqual(["h:orphaned"]);
  });

  it("refuses a drawing that does not exist or has no alertable line", () => {
    const { drawings, plugin } = setup();
    expect(() => plugin.addDrawingAlert({ id: "x", drawingId: "nope", line: "main", op: "crossing", trigger: { mode: "once" } })).toThrow(/no drawing "nope"/);
    const r = drawings.add({ tool: "rectangle", anchors: [{ time: T0, price: 100 }, { time: T0 + STEP, price: 110 }] });
    expect(() => plugin.addDrawingAlert({ id: "x", drawingId: r.id, line: "main", op: "crossing", trigger: { mode: "once" } })).toThrow(/no alertable line/);
  });
});

describe("drawing alerts on non-linear scales", () => {
  it("refuses a chart view that cannot say its price scale mode", () => {
    const { priceScaleMode: _m, ...bare } = view();
    expect(() => new AlertsPlugin().install({ ...api(), paneView: () => bare })).toThrow(/price scale mode/);
  });

  // A drawing is straight in pixels. On a log scale that is straight in ln(price): the trend line from 100 to 200
  // over 80 bars passes through sqrt(100 * 200) = 141.42 at bar 40, not through 150.
  const modeApi = (mode: () => "linear" | "log" | "percent" | "indexed"): PluginApi => ({
    ...api(),
    paneView: () => ({ ...view(), priceScaleMode: () => mode() }),
  });
  const setup = (mode: () => "linear" | "log" | "percent" | "indexed", price0 = 100) => {
    const src = barSource();
    const a = modeApi(mode);
    const drawings = new DrawingsPlugin({ tools: allTools, source: src, interval: STEP });
    drawings.install(a);
    const errors: Error[] = [];
    const plugin = new AlertsPlugin({ drawings, source: src, onError: (e) => errors.push(e) });
    plugin.install(a);
    const line = drawings.add({ tool: "trendLine", anchors: [{ time: T0, price: price0 }, { time: T0 + 80 * STEP, price: 200 }] });
    return { drawings, plugin, line, errors };
  };
  const tickAt = (bar: number, price: number): Tick => ({ time: T0 + bar * STEP, price, bar: T0 + bar * STEP });

  it("a log scale interpolates in ln(price); the geometry says so", () => {
    const { plugin, line } = setup(() => "log");
    const def = plugin.addDrawingAlert({ id: "l", drawingId: line.id, line: "main", op: "crossingUp", trigger: { mode: "everyTime" } });
    expect(def.condition).toMatchObject({ drawing: { scale: "log" } });
    plugin.tick(tickAt(40, 141));
    const fired = plugin.tick(tickAt(40, 142)); // above 141.42, below the straight-in-price 150
    expect(fired.map((t) => t.values.line)).toEqual([expect.closeTo(Math.sqrt(100 * 200), 9)]);
  });

  it("a linear scale still evaluates straight in price", () => {
    const { plugin, line } = setup(() => "linear");
    const def = plugin.addDrawingAlert({ id: "l", drawingId: line.id, line: "main", op: "crossingUp", trigger: { mode: "everyTime" } });
    expect(def.condition).not.toHaveProperty("drawing.scale");
    plugin.tick(tickAt(40, 142));
    expect(plugin.tick(tickAt(40, 149))).toEqual([]);
    expect(plugin.tick(tickAt(40, 151)).map((t) => t.values.line)).toEqual([150]);
  });

  it("percent and indexed scales are affine in price: the same line as linear", () => {
    for (const mode of ["percent", "indexed"] as const) {
      const { plugin, line } = setup(() => mode);
      const def = plugin.addDrawingAlert({ id: "l", drawingId: line.id, line: "main", op: "crossingUp", trigger: { mode: "everyTime" } });
      expect(def.condition).not.toHaveProperty("drawing.scale");
      plugin.tick(tickAt(40, 142));
      expect(plugin.tick(tickAt(40, 151)).map((t) => t.values.line)).toEqual([150]);
    }
  });

  it("a channel on a log scale keeps its offset in ln(price)", () => {
    const { drawings, plugin } = setup(() => "log");
    const ch = drawings.add({ tool: "parallelChannel", anchors: [{ time: T0, price: 100 }, { time: T0 + 80 * STEP, price: 200 }, { time: T0, price: 120 }] });
    plugin.addDrawingAlert({ id: "c", drawingId: ch.id, line: "base", op: "enteringChannel", trigger: { mode: "everyTime" } });
    // At bar 40 the base is 141.42 and the offset line 1.2 times that.
    plugin.tick(tickAt(40, 100));
    const fired = plugin.tick(tickAt(40, 150));
    expect(fired).toHaveLength(1);
    expect(fired[0]!.values.low).toBeCloseTo(Math.sqrt(100 * 200), 9);
    expect(fired[0]!.values.high).toBeCloseTo(Math.sqrt(100 * 200) * 1.2, 9);
  });

  it("a backend re-evaluating the saved definition agrees with the chart", () => {
    const { plugin, line } = setup(() => "log");
    plugin.addDrawingAlert({ id: "l", drawingId: line.id, line: "main", op: "crossing", trigger: { mode: "everyTime" } });
    const src = barSource();
    const backend = new AlertEvaluator(JSON.parse(JSON.stringify(plugin.toJSON())).alerts.map((a: { definition: AlertDefinition }) => a.definition), { logical: (t) => src.logical(t) });
    const ticks = [tickAt(40, 141), tickAt(40, 142), tickAt(40, 141)];
    expect(ticks.flatMap((t) => backend.tick(t))).toEqual(ticks.flatMap((t) => plugin.tick(t)));
  });

  it("switching the scale to log re-reads the geometry; a non-positive anchor stops the alert with a clear error", () => {
    let mode: "linear" | "log" = "linear";
    const { plugin, line, errors } = setup(() => mode, -5);
    plugin.addDrawingAlert({ id: "l", drawingId: line.id, line: "main", op: "crossing", trigger: { mode: "everyTime" } });
    expect(plugin.tick(tickAt(40, 50))).toEqual([]);
    mode = "log";
    expect(plugin.tick(tickAt(40, 60))).toEqual([]);
    expect(plugin.status("l")).toBe("error");
    expect(errors.map((e) => e.message).join("\n")).toMatch(/log scale and has a non-positive anchor price -5/);
    mode = "linear"; // back on a usable scale: the alert is watched again
    plugin.tick(tickAt(40, 60));
    expect(plugin.status("l")).toBe("active");
  });

  it("refuses to add an alert on a log-scale drawing with a non-positive anchor", () => {
    const { plugin, line } = setup(() => "log", -5);
    expect(() => plugin.addDrawingAlert({ id: "l", drawingId: line.id, line: "main", op: "crossing", trigger: { mode: "once" } })).toThrow(/non-positive anchor price -5/);
  });
});

describe("persistence", () => {
  it("saves definitions and statuses; a restored plugin continues as before and rejects bad input atomically", () => {
    const a = new AlertsPlugin({ indicators });
    a.install(api());
    a.add({ id: "once", condition: { type: "greaterThan", price: 100 }, trigger: { mode: "once" } });
    a.add({ id: "x", condition: { type: "crossing", price: 100, direction: "any" }, trigger: { mode: "everyTime" } });
    a.tick({ time: 0, price: 101, bar: 0 });
    expect(a.status("once")).toBe("triggered");
    const saved = JSON.parse(JSON.stringify(a.toJSON()));
    expect(saved.version).toBe(1);
    const b = new AlertsPlugin({ indicators });
    b.install(api());
    b.fromJSON(saved);
    expect(b.list()).toEqual(a.list());
    expect(b.tick({ time: 1000, price: 102, bar: 0 })).toEqual([]); // the spent alert stays spent

    const bad = JSON.parse(JSON.stringify(saved));
    bad.alerts.push({ definition: { id: "bad", condition: { type: "enteringChannel", low: 5, high: 1 }, trigger: { mode: "once" } }, status: "active" });
    expect(() => b.fromJSON(bad)).toThrow(/low < high/);
    expect(b.list()).toHaveLength(2);
    expect(() => b.validateState(bad)).toThrow(/low < high/); // the core checks this before it replaces a layout
    expect(() => b.validateState(saved)).not.toThrow();
    expect(b.list()).toHaveLength(2);
    expect(() => b.fromJSON({ version: 9, alerts: [] })).toThrow(/newer/);
    expect(() => b.fromJSON({ version: 1, alerts: [{ definition: saved.alerts[0].definition, status: "weird" }] })).toThrow(/invalid saved status/);
  });
});

describe("callbacks and drawing", () => {
  it("onTrigger receives the exact tick values before listeners", () => {
    const calls: string[] = [];
    const p = new AlertsPlugin({ onTrigger: (t) => calls.push(`cb ${t.time} ${t.price} ${t.values.level}`) });
    p.install(api());
    p.on("trigger", (t) => calls.push(`on ${t.seq}`));
    p.add({ id: "a", label: "L", condition: { type: "crossing", price: 100, direction: "up" }, trigger: { mode: "everyTime" } });
    p.tick({ time: 5, price: 99, bar: 0 });
    const [t] = p.tick({ time: 6, price: 100.25, bar: 0 });
    expect(t).toMatchObject({ alertId: "a", label: "L", time: 6, bar: 0, price: 100.25, prevPrice: 99, seq: 1, condition: "crossing", mode: "everyTime" });
    expect(calls).toEqual(["cb 6 100.25 100", "on 1"]);
  });

  it("seriesIndicator reads the bar's value", () => {
    const f = seriesIndicator({ barAt: (t) => (t === 5 ? { value: 7 } : undefined) });
    expect(f({ time: 9, price: 1, bar: 5 })).toBe(7);
    expect(f({ time: 9, price: 1, bar: 6 })).toBeUndefined();
  });

  it("draws alert levels and fired markers without error", () => {
    const calls: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, n: string) => (n in t ? t[n] : (...a: unknown[]) => { calls.push(n); a.forEach((x) => { if (typeof x === "number" && !Number.isFinite(x)) throw new Error("NaN"); }); }),
      set: (t, n: string, v) => ((t[n] = v), true),
    }) as unknown as CanvasRenderingContext2D;
    const p = new AlertsPlugin();
    p.install(api());
    p.add({ id: "a", condition: { type: "crossing", price: 112, direction: "any" }, trigger: { mode: "everyTime" } });
    p.add({ id: "c", condition: { type: "enteringChannel", low: 100, high: 105 }, trigger: { mode: "once" } });
    p.tick({ time: T0, price: 111, bar: T0 });
    p.tick({ time: T0 + 1, price: 113, bar: T0 });
    p.drawPane(ctx, view());
    expect(calls.filter((c) => c === "stroke").length).toBeGreaterThanOrEqual(4);
    expect(calls).toContain("fill");
  });
});

describe("resetClock", () => {
  it("lets ticks of a new series start earlier, and clears the old markers", () => {
    const p = new AlertsPlugin({ indicators });
    p.install(api());
    p.add({ id: "g", condition: { type: "greaterThan", price: 1e9 }, trigger: { mode: "everyTime" } });
    p.tick({ time: T0 + 5 * STEP, price: 100, bar: T0 + 5 * STEP });
    expect(() => p.tick({ time: T0, price: 100, bar: T0 })).toThrow(/before the previous tick/);
    p.resetClock();
    expect(() => p.tick({ time: T0, price: 100, bar: T0 })).not.toThrow();
  });
});
