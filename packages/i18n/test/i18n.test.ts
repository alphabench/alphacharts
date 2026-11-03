import { describe, expect, it, vi } from "vitest";
import { createI18n, createI18nAsync, LocaleNotLoadedError, MissingMessageError, UnknownMessageKeyError } from "../src/index.js";
import type { MessageKey } from "../src/index.js";

describe("createI18n", () => {
  it("English works out of the box with typed keys, plurals and interpolation", () => {
    const i = createI18n({ locale: "en" });
    expect(i.t("unit.bars", { count: 1 })).toBe("1 bar");
    expect(i.t("unit.bars", { count: 1234 })).toBe("1,234 bars");
    expect(i.t("toolbar.symbol.change", { symbol: "NIFTY" })).toBe("Change symbol, current NIFTY");
    expect(i.dir).toBe("ltr");
  });
  it("throws on an unknown key, even with a fallback", () => {
    const i = createI18n({ locale: "en", fallback: "en" });
    expect(() => i.t("nope.nothing" as MessageKey)).toThrow(UnknownMessageKeyError);
  });
  it("throws on a missing value and on a never-loaded locale", () => {
    const i = createI18n({ locale: "en" });
    expect(() => i.t("unit.bars")).toThrow(/needs a value/);
    expect(() => createI18n({ locale: "fr" })).toThrow(LocaleNotLoadedError);
  });
  it("a gap in a catalogue throws unless a fallback is given, and the fallback is reported", () => {
    const messages = { fr: { "common.ok": "D'accord" } };
    const strict = createI18n({ locale: "fr", messages });
    expect(strict.t("common.ok")).toBe("D'accord");
    expect(() => strict.t("common.cancel")).toThrow(MissingMessageError);
    const onFallback = vi.fn();
    const lenient = createI18n({ locale: "fr", messages, fallback: "en", onFallback });
    expect(lenient.t("common.cancel")).toBe("Cancel");
    expect(onFallback).toHaveBeenCalledWith("common.cancel", "fr", "en");
  });
  it("region falls back to its language catalogue", async () => {
    const i = await createI18nAsync({ locale: "hi-IN" });
    expect(i.t("common.cancel")).toBe("रद्द करें");
    expect(i.dir).toBe("ltr");
  });
  it("loads a built-in locale lazily and emits localeChange", async () => {
    const i = createI18n({ locale: "en", load: async (l) => (l === "xx" ? { "common.ok": "XX" } : Promise.reject(new Error("no"))) });
    const seen: string[] = [];
    const off = i.on("localeChange", (e) => seen.push(`${e.previous}>${e.locale}:${e.dir}`));
    await i.setLocale("xx");
    expect(i.t("common.ok" as MessageKey)).toBe("XX");
    off();
    await i.setLocale("en");
    expect(seen).toEqual(["en>xx:ltr"]);
    expect(i.locale).toBe("en");
  });
  it("setLocale to an unloadable locale rejects and keeps the current one", async () => {
    const i = createI18n({ locale: "en" });
    await expect(i.setLocale("fr")).rejects.toThrow(LocaleNotLoadedError);
    expect(i.locale).toBe("en");
  });
  it("async factory + setLocale pulls Hindi in on demand", async () => {
    const i = await createI18nAsync({ locale: "en" });
    expect(i.loadedLocales).toEqual(["en"]);
    await i.setLocale("hi");
    expect(i.t("chart.table.close")).toBe("क्लोज़");
    expect(i.loadedLocales).toContain("hi");
  });
  it("Hindi plural and volume suffixes", async () => {
    const i = await createI18nAsync({ locale: "hi-IN" });
    expect(i.t("symbol.search.results", { count: 0 })).toBe("कोई परिणाम नहीं");
    expect(i.t("symbol.search.results", { count: 12 })).toBe("12 परिणाम");
    expect(i.volume(2_500_000)).toBe("25L");
    expect(i.number(1234567.5)).toBe("12,34,567.5");
  });
  it("native digits are an option on the instance", async () => {
    const i = await createI18nAsync({ locale: "hi-IN", nativeDigits: true });
    expect(i.t("unit.bars", { count: 1234 })).toBe("१,२३४ बार");
  });
  it("chartMessages is usable as the core's messages option", async () => {
    const { defaultMessages } = await import("@alphacharts/core");
    const i = createI18n({ locale: "en" });
    expect(i.chartMessages("chart.readout.value", { name: "A", value: "1" })).toBe(defaultMessages("chart.readout.value", { name: "A", value: "1" }));
  });
  it("rejects a malformed locale", () => {
    expect(() => createI18n({ locale: "not a locale" })).toThrow(RangeError);
  });
  it("a bad message surfaces with its key and locale", () => {
    const i = createI18n({ locale: "fr", messages: { fr: { "common.ok": "{a, plural, one {x}}" } } });
    expect(() => i.t("common.ok", { a: 1 })).toThrow(/"common.ok" in "fr"/);
  });
});
