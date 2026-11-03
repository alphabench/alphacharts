import { describe, expect, it } from "vitest";
import { MemoryStore } from "@alphacharts/core";
import { ArrayBarSource, DrawingsPlugin, allTools } from "@alphacharts/drawings";
import { ALL_STUDIES } from "@alphacharts/indicators/all";
import { CHART_TYPES, chartTypeDef, derivedSize, decimalsOf } from "../src/model/chartTypes.js";
import { GRID_PRESETS, gridPreset, gridStyle } from "../src/model/grids.js";
import { MAX_COUNT, PRESET_INTERVALS, customInterval, intervalId, normalizeInterval, sortIntervals } from "../src/model/intervals.js";
import { NamedStore, PrefsStore, checkName, pushRecent, toggled, MAX_RECENT } from "../src/model/persistence.js";
import { buildCatalogue, searchCatalogue } from "../src/model/studies.js";
import { TOOL_GROUPS, groupOf } from "../src/model/tools.js";
import { contrastRatio, textOn, themeVars, resolveTheme } from "../src/theme.js";

describe("intervals", () => {
  it("normalizes through parseResolution", () => {
    expect(normalizeInterval("75")).toBe("75m");
    expect(normalizeInterval("D")).toBe("1D");
    expect(normalizeInterval("3h")).toBe("3h");
    expect(normalizeInterval("2D")).toBe("2D");
    expect(normalizeInterval("1M")).toBe("1M");
  });
  it("refuses what the core refuses and what exceeds the unit's limit", () => {
    expect(() => normalizeInterval("0m")).toThrow();
    expect(() => normalizeInterval("5x")).toThrow();
    expect(() => normalizeInterval("24h")).toThrow(/at most 23/);
    expect(() => normalizeInterval("13M")).toThrow();
  });
  it("validates the custom form", () => {
    expect(customInterval("75", "m")).toEqual({ ok: true, interval: "75m" });
    expect(customInterval("0", "m")).toEqual({ ok: false, max: MAX_COUNT.m });
    expect(customInterval("1.5", "h")).toEqual({ ok: false, max: 23 });
    expect(customInterval("", "D")).toEqual({ ok: false, max: 365 });
  });
  it("presets are valid, sorted by length, and ids are distinct", () => {
    for (const p of PRESET_INTERVALS) expect(normalizeInterval(p)).toBe(p);
    expect(sortIntervals(["1D", "5m", "1h", "30s"])).toEqual(["30s", "5m", "1h", "1D"]);
    expect(new Set(PRESET_INTERVALS.map(intervalId)).size).toBe(PRESET_INTERVALS.length);
  });
});

describe("grids", () => {
  it("has 1 to 16 charts with the required presets", () => {
    expect(GRID_PRESETS.map((g) => g.charts).sort((a, b) => a - b)).toEqual([1, 2, 2, 3, 3, 3, 3, 4, 6, 8, 9, 12, 16]);
    expect(() => gridPreset("5")).toThrow();
  });
  it("area maps name exactly the preset's charts", () => {
    for (const g of GRID_PRESETS) {
      if (!g.areas) continue;
      const names = new Set(g.areas.join(" ").split(/\s+/));
      expect(names.size).toBe(g.charts);
      expect(gridStyle(g)["grid-template-areas"]).toBeTruthy();
    }
  });
});

describe("tools", () => {
  it("every tool of the drawings package is in exactly one group", () => {
    expect(allTools.length).toBe(82);
    const seen = new Map<string, number>();
    for (const g of TOOL_GROUPS) for (const t of g.tools) seen.set(t, (seen.get(t) ?? 0) + 1);
    expect(allTools.filter((t) => seen.get(t.id) !== 1).map((t) => t.id)).toEqual([]);
    expect([...seen.keys()].filter((k) => !allTools.some((t) => t.id === k))).toEqual([]);
    expect(groupOf("fibRetracement")?.id).toBe("fibonacci");
  });
});

describe("chart types", () => {
  it("lists the required types, footprint needs trades", () => {
    const ids = CHART_TYPES.map((c) => c.id);
    for (const id of ["candles", "bars", "line", "area", "baseline", "hiLo", "columns", "heikinAshi", "renko", "kagi", "pointFigure", "rangeBars", "lineBreak", "stepLine", "footprint"]) expect(ids).toContain(id);
    expect(chartTypeDef("footprint").needsTrades).toBe(true);
    expect(chartTypeDef("renko").kind).toBe("ordinal");
  });
  it("derives sizes from data on the instrument's step", () => {
    expect(derivedSize(2500, 0.01, 0.05)).toBe(25);
    expect(derivedSize(100, 0.0001, 0.05)).toBe(0.05);
    expect(decimalsOf(0.05)).toBe(2);
    expect(() => derivedSize(0, 0.01, 0.05)).toThrow();
  });
});

describe("persistence", () => {
  it("saves, lists newest first, loads, renames, deletes", async () => {
    const s = new NamedStore<{ n: number }>(new MemoryStore(), "layout");
    await s.save("a", { n: 1 }, 100);
    await s.save("b", { n: 2 }, 200);
    expect((await s.list()).map((x) => x.name)).toEqual(["b", "a"]);
    expect((await s.load("a")).body).toEqual({ n: 1 });
    await s.rename("a", "c");
    expect((await s.list()).map((x) => x.name).sort()).toEqual(["b", "c"]);
    await expect(s.rename("c", "b")).rejects.toThrow(/already exists/);
    await s.remove("b");
    await expect(s.load("b")).rejects.toThrow(/no layout/);
  });
  it("refuses names that would split the key", () => {
    expect(() => checkName("a/b")).toThrow();
    expect(() => checkName("  ")).toThrow();
    expect(checkName(" ok ")).toBe("ok");
  });
  it("keeps layouts and templates apart", async () => {
    const m = new MemoryStore();
    await new NamedStore(m, "layout").save("x", {});
    expect(await new NamedStore(m, "template").list()).toEqual([]);
  });
  it("prefs round-trip and refuse an unknown version", async () => {
    const m = new MemoryStore();
    const p = new PrefsStore(m);
    await p.update((x) => ({ ...x, favouriteIntervals: toggled(x.favouriteIntervals, "5m") }));
    expect((await new PrefsStore(m).get()).favouriteIntervals).toEqual(["5m"]);
    await m.save("ui/prefs", { version: 9 });
    await expect(new PrefsStore(m).get()).rejects.toThrow(/version/);
  });
  it("recent symbols are unique, newest first, bounded", () => {
    let r: string[] = [];
    for (let i = 0; i < 15; i++) r = pushRecent(r, `S${i}`);
    r = pushRecent(r, "S10");
    expect(r[0]).toBe("S10");
    expect(r.length).toBe(MAX_RECENT);
    expect(new Set(r).size).toBe(r.length);
  });
});

describe("study catalogue", () => {
  const cat = buildCatalogue(ALL_STUDIES, (f) => f);
  it("holds all 210 studies and finds by name, id and family", () => {
    expect(cat.length).toBe(210);
    expect(searchCatalogue(cat, "rsi").some((e) => e.def.id === "rsi")).toBe(true);
    expect(searchCatalogue(cat, "bollinger").length).toBeGreaterThan(0);
    expect(searchCatalogue(cat, "", "pattern").every((e) => e.def.family === "pattern")).toBe(true);
    expect(searchCatalogue(cat, "zzzzqq")).toEqual([]);
    expect(searchCatalogue(cat, "", "all", new Set(["rsi"])).map((e) => e.def.id)).toEqual(["rsi"]);
  });
  it("refuses a duplicate id", () => {
    expect(() => buildCatalogue([ALL_STUDIES[0]!, ALL_STUDIES[0]!], (f) => f)).toThrow(/twice/);
  });
});

describe("undo integration", () => {
  it("the drawings history the toolbar drives undoes and redoes an add", () => {
    const src = new ArrayBarSource({ time: [60_000, 120_000], open: [1, 1], high: [2, 2], low: [1, 1], close: [2, 2], volume: [1, 1] });
    const p = new DrawingsPlugin({ tools: allTools, source: src, interval: 60_000 });
    expect(p.canUndo).toBe(false);
    p.add({ tool: "horizontalLine", anchors: [{ time: 60_000, price: 1.5 }] });
    expect(p.canUndo).toBe(true);
    expect(p.undo()).toBe(true);
    expect(p.list().length).toBe(0);
    expect(p.canRedo).toBe(true);
    expect(p.redo()).toBe(true);
    expect(p.list().length).toBe(1);
  });
});

describe("theme", () => {
  it("derives the shell from core tokens and reads text on the accent", () => {
    for (const n of ["dark", "light", "high-contrast"] as const) {
      const t = resolveTheme(n, null);
      const v = themeVars(t);
      expect(v["--ac-bg"]).toBe(t.background);
      expect(contrastRatio(v["--ac-on-accent"]!, t.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.text, t.background)).toBeGreaterThanOrEqual(7);
    }
    expect(textOn("#ffffff")).toBe("#000000");
    expect(() => resolveTheme("custom", { accent: "nope" })).toThrow();
  });
});
