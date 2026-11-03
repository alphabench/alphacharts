import { describe, expect, it } from "vitest";
import { dir, formatClock, formatDateTime, formatList, formatNumber, formatPercent, formatRelative, formatVolume, fractionDigitsOf, parseNumber } from "../src/format.js";

const LOCALES = ["en", "en-US", "en-IN", "hi-IN", "hi", "de-DE", "fr-FR", "ar", "ar-EG", "fa-IR", "ur-PK", "he-IL", "ja-JP"];

describe("numbers", () => {
  it("Indian grouping for en-IN and hi-IN, Western elsewhere", () => {
    expect(formatNumber(12345678.5, "en-IN")).toBe("1,23,45,678.5");
    expect(formatNumber(12345678.5, "hi-IN")).toBe("1,23,45,678.5");
    expect(formatNumber(12345678.5, "en-US")).toBe("12,345,678.5");
    expect(formatNumber(-100000, "en-IN")).toBe("-1,00,000");
  });
  it("Latin digits by default in every locale; native digits only on request", () => {
    expect(formatNumber(1234.5, "hi-IN")).toBe("1,234.5");
    expect(formatNumber(1234.5, "hi-IN", { nativeDigits: true })).toBe("१,२३४.५");
    expect(formatNumber(1234, "ar-EG")).toMatch(/^1.234$/);
    expect(formatNumber(1234, "ar-EG", { nativeDigits: true })).toMatch(/^١.٢٣٤$/);
  });
  it("never rounds: exactly the digits the value has", () => {
    expect(formatNumber(0.1 + 0.2, "en")).toBe("0.30000000000000004");
    expect(formatNumber(1e-7, "en")).toBe("0.0000001");
    expect(formatNumber(1.5e21, "en").replace(/,/g, "")).toBe("1500000000000000000000");
    expect(formatNumber(24990.05, "en-IN")).toBe("24,990.05");
    expect(fractionDigitsOf(24990.05)).toBe(2);
    expect(fractionDigitsOf(5e-324)).toBe(324);
  });
  it("fixed or capped fraction digits are explicit requests", () => {
    expect(formatNumber(1.5, "en", { fractionDigits: 2 })).toBe("1.50");
    expect(formatNumber(1.23456, "en", { maxFractionDigits: 2 })).toBe("1.23");
  });
  it("refuses values that need more fraction digits than Intl can write, instead of rounding", () => {
    expect(() => formatNumber(Number.MIN_VALUE, "en")).toThrow(/at most 100/);
  });
  it("refuses non-finite numbers", () => {
    for (const v of [NaN, Infinity, -Infinity]) expect(() => formatNumber(v, "en")).toThrow(RangeError);
  });

  it("parse(format(x)) === x across locales, digit systems and magnitudes", () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const samples = [0, 1, -1, 0.05, 24990.05, 1e-7, 123456789.123, 0.1 + 0.2, 2 ** 53, -1.5e-10, 1e21, 1.2345e25, 1e-100, Number.MAX_VALUE];
    for (let i = 0; i < 300; i++) samples.push((rnd() - 0.5) * 10 ** Math.floor(rnd() * 24 - 8), Math.round(rnd() * 1e8) / 100);
    for (const loc of LOCALES) {
      for (const native of [false, true]) {
        for (const x of samples) {
          const text = formatNumber(x, loc, { nativeDigits: native });
          const back = parseNumber(text, loc);
          expect(Object.is(back, x) || back === x, `${loc} native=${native} ${x} -> "${text}" -> ${back}`).toBe(true);
        }
      }
    }
  });
  it("parseNumber rejects what is not a number", () => {
    for (const bad of ["", "abc", "1.2.3", "1,2,3x", "--1", "1-", "٣a"]) expect(() => parseNumber(bad, "en"), bad).toThrow(RangeError);
  });
  it("parseNumber reads German decimal comma and accepts a typographic minus", () => {
    expect(parseNumber("1.234,5", "de-DE")).toBe(1234.5);
    expect(parseNumber("−1,5", "de-DE")).toBe(-1.5);
  });
});

describe("compact volume", () => {
  it("K/L/Cr for Indian locales, K/M/B/T elsewhere (as the core)", () => {
    expect(formatVolume(950, "en-IN")).toBe("950");
    expect(formatVolume(12_500, "en-IN")).toBe("12.5K");
    expect(formatVolume(250_000, "hi-IN")).toBe("2.5L");
    expect(formatVolume(35_000_000, "en-IN")).toBe("3.5Cr");
    expect(formatVolume(-35_000_000, "en-IN")).toBe("-3.5Cr");
    expect(formatVolume(1_250_000, "en-US")).toBe("1.25M");
    expect(formatVolume(3e9, "en")).toBe("3B");
    expect(formatVolume(2e12, "de-DE")).toBe("2T");
  });
  it("agrees with the core's volume format for the same locales", async () => {
    const { createFormatter } = await import("../../core/src/scale/format.js");
    for (const loc of ["en-IN", "hi-IN", "en-US"]) {
      const f = createFormatter({ type: "volume" }, 1, loc);
      for (const v of [999, 1000, 12_345, 99_999, 100_000, 3_456_789, 12_345_678_901]) expect(formatVolume(v, loc)).toBe(f.format(v));
    }
  });
  it("suffixes are replaceable", () => {
    expect(formatVolume(250_000, "hi-IN", { suffixes: { l: "लाख" } })).toBe("2.5लाख");
  });
});

describe("percent", () => {
  it("does not divide: the value is already a percentage", () => {
    expect(formatPercent(12.5, "en")).toBe("12.5%");
    expect(formatPercent(-0.07, "en-IN")).toBe("-0.07%");
    expect(parseNumber(formatPercent(0.07, "hi-IN").replace("%", ""), "hi-IN")).toBe(0.07);
  });
});

describe("dates and times", () => {
  const t = Date.UTC(2026, 9, 21, 9, 15, 30); // 2026-10-21 09:15:30 UTC = 14:45:30 IST
  it("respects the time zone", () => {
    expect(formatDateTime(t, "en-IN", { timeZone: "Asia/Kolkata", date: "none", time: "seconds", hourCycle: "h23" })).toBe("14:45:30");
    expect(formatDateTime(t, "en-IN", { timeZone: "UTC", date: "none", time: "minutes", hourCycle: "h23" })).toBe("09:15");
  });
  it("dates are Gregorian with Latin digits even where the locale defaults differ", () => {
    const s = formatDateTime(t, "ar-SA", { timeZone: "UTC", date: "medium", time: "none" });
    expect(s).toMatch(/2026/);
    expect(s).not.toMatch(/[٠-٩]/);
    expect(formatDateTime(t, "hi-IN", { timeZone: "UTC", date: "medium", time: "none" })).toMatch(/2026/);
  });
  it("native digits are opt-in", () => {
    expect(formatDateTime(t, "hi-IN", { timeZone: "UTC", date: "short", time: "none", nativeDigits: true })).toMatch(/[०-९]/);
  });
  it("needs a date or a time, and a finite instant", () => {
    expect(() => formatDateTime(t, "en", { timeZone: "UTC", date: "none", time: "none" })).toThrow();
    expect(() => formatDateTime(NaN, "en", { timeZone: "UTC" })).toThrow();
  });
});

describe("relative time, clock, list", () => {
  it("relative picks the largest whole unit", () => {
    expect(formatRelative(300, "en")).toBe("in 5 minutes");
    expect(formatRelative(-7200, "en")).toBe("2 hours ago");
    expect(formatRelative(172_800, "en")).toBe("in 2 days");
    expect(formatRelative(45, "en")).toBe("in 45 seconds");
    expect(formatRelative(300, "hi-IN")).toMatch(/5/);
  });
  it("countdown clock", () => {
    expect(formatClock(309, "en")).toBe("05:09");
    expect(formatClock(3723, "en")).toBe("1:02:03");
    expect(formatClock(309, "hi-IN", { nativeDigits: true })).toBe("०५:०९");
    expect(() => formatClock(-1, "en")).toThrow();
  });
  it("list", () => {
    expect(formatList(["a", "b", "c"], "en")).toBe("a, b, and c");
    expect(formatList(["a", "b"], "en", "disjunction")).toBe("a or b");
    expect(formatList(["क", "ख", "ग"], "hi")).toContain("और");
  });
});

describe("direction", () => {
  it("rtl for Arabic, Hebrew, Persian, Urdu; ltr otherwise", () => {
    for (const l of ["ar", "ar-EG", "he", "he-IL", "fa", "fa-IR", "ur", "ur-PK", "ar-Arab", "ps"]) expect(dir(l), l).toBe("rtl");
    for (const l of ["en", "hi-IN", "de", "ja", "en-IN", "zh-Hans", "sr-Latn", "ku-Latn"]) expect(dir(l), l).toBe("ltr");
  });
  it("throws on a malformed tag", () => {
    expect(() => dir("not a locale")).toThrow(RangeError);
  });
});
