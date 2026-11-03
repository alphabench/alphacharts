/// <reference types="vite/client" />
// Every user-visible string of the shell goes through the catalogue: each message key used in the source
// exists in English and Hindi, and the generated groups (tools, families) are complete.
import { describe, expect, it } from "vitest";
import { en } from "@alphacharts/i18n";
import { allTools } from "@alphacharts/drawings";
import { hi } from "../../i18n/src/locales/hi.js";
import { FAMILIES } from "../src/model/studies.js";
import { CHART_TYPES } from "../src/model/chartTypes.js";

const files = import.meta.glob("../src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const src = Object.values(files).join("\n");
const EN = en as Record<string, string>, HI = hi as Record<string, string>;

describe("ui strings", () => {
  it("every literal message key in the source is in English and Hindi", () => {
    const used = new Set([...src.matchAll(/\bt\(\s*"([a-zA-Z]+\.[A-Za-z0-9.]+)"/g)].map((m) => m[1]!));
    expect(used.size).toBeGreaterThan(150);
    expect([...used].filter((k) => !(k in EN))).toEqual([]);
    expect([...used].filter((k) => !(k in HI))).toEqual([]);
  });
  it("template-built keys exist for every value they can take", () => {
    const need = [
      ...allTools.map((t) => `ui.tool.${t.id}`),
      ...FAMILIES.map((f) => `ui.family.${f}`),
      ...CHART_TYPES.map((c) => c.key),
      ...["linear", "log", "percent", "indexed"].map((m) => `settings.priceScale.mode.${m}`),
      ...["crossing", "crossingUp", "crossingDown", "greaterThan", "lessThan", "enteringChannel", "exitingChannel", "movingUp", "movingDown"].map((o) => `alerts.condition.${o}`),
      ...["once", "everyTime", "oncePerBar", "oncePerBarClose"].map((m) => `alerts.trigger.${m}`),
      ...["off", "weak", "strong"].map((m) => `drawing.magnet.${m}`),
      ...["symbol", "ohlc", "change", "volume", "studyValues", "studyInputs"].map((k) => `ui.status.${k}`),
      ...["box", "reversal", "range", "lines"].map((k) => `ui.param.${k}`),
      ...["symbol", "interval", "crosshair", "time", "drawings"].map((k) => `layout.sync.${k}`),
      ...["second", "minute", "hour", "day", "week", "month"].flatMap((u) => [`interval.${u}`, `interval.short.${u}`]),
    ];
    expect(need.filter((k) => !(k in EN) || !(k in HI))).toEqual([]);
  });
  it("Hindi tool names are translated, not copied", () => {
    const same = allTools.filter((t) => HI[`ui.tool.${t.id}`] === EN[`ui.tool.${t.id}`]);
    expect(same.map((t) => t.id)).toEqual([]);
  });
});
