// ?ex=i18n&locale=hi-IN|ar|en: a chart with the core's readout and table in
// the chosen locale, and a sample of UI-shell strings in the chosen locale and
// direction. The shell uses CSS logical properties only, so the same CSS
// serves left-to-right and right-to-left; the chart stays left-to-right (time
// runs left to right in every locale).

import { createChart, DARK, type Chart, type Theme } from "@alphacharts/core";
import { createI18nAsync, type I18n, type MessageKey } from "@alphacharts/i18n";
import { arSample } from "./ar-sample.js";
import { ohlc, volume } from "./synthetic.js";

declare global {
  interface Window {
    __i18n: I18n;
    __setLocale: (locale: string) => Promise<void>;
    __i18nFallbacks: string[];
  }
}

const NAMES: Record<string, string> = { en: "English", "hi-IN": "हिन्दी", ar: "العربية" };

const STYLE = `
.i18n-shell { display: flex; flex-direction: column; block-size: 100%; }
.i18n-shell .strip { padding-block: 6px; padding-inline: 12px; border-block-end: 1px solid var(--pg-line); display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: baseline; }
.i18n-shell .strip.alt { color: var(--pg-muted); }
.i18n-shell .btn { padding-block: 2px; padding-inline: 8px; border: 1px solid var(--pg-line); border-radius: 4px; background: transparent; color: inherit; font: inherit; }
.i18n-shell .btn[aria-pressed="true"] { background: var(--pg-line); }
.i18n-shell .grow { margin-inline-start: auto; display: flex; gap: 4px; }
.i18n-shell .chip { padding-inline: 6px; border-radius: 4px; background: var(--pg-line); }
.i18n-shell input { padding-block: 2px; padding-inline: 6px; border: 1px solid var(--pg-line); border-radius: 4px; background: transparent; color: inherit; font: inherit; inline-size: 14em; }
.i18n-shell .chart { flex: 1; min-block-size: 0; position: relative; }
`;

export async function runI18nExample(app: HTMLElement, locale: string, o: { theme: Theme; R: Record<string, unknown>; n: number }): Promise<void> {
  const fallbacks: string[] = [];
  const i18n = await createI18nAsync({
    locale,
    messages: { ar: arSample },
    // Arabic is a sample, not a catalogue: anything it lacks would show English.
    // Recorded so the test can prove nothing on screen came from the fallback.
    fallback: "en",
    onFallback: (key, loc) => fallbacks.push(`${loc}:${key}`),
    load: async (l) => {
      if (l === "ar") return arSample;
      const { builtInLoaders } = await import("@alphacharts/i18n");
      const load = builtInLoaders[new Intl.Locale(l).language];
      if (!load) throw new Error(`no catalogue for ${l}`);
      return load();
    },
  });
  window.__i18n = i18n;
  window.__i18nFallbacks = fallbacks;

  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.appendChild(style);
  app.innerHTML = `<div class="i18n-shell"><div class="strip" id="s-toolbar"></div><div class="strip alt" id="s-intervals"></div><div class="strip" id="s-search"></div><div class="strip alt" id="s-draw"></div><div class="strip" id="s-formats"></div><div class="chart" id="s-chart" dir="ltr"></div></div>`;
  const $ = (id: string) => app.querySelector<HTMLElement>(`#${id}`)!;

  // Same data as the "basic" example, fixed seed.
  const d = ohlc(o.n, 1);
  window.__data = d;
  const chart: Chart = createChart($("s-chart"), {
    theme: o.theme === DARK ? "dark" : "light",
    ...o.R,
    timeZone: "Asia/Kolkata",
    locale: i18n.locale,
    messages: i18n.chartMessages,
  });
  chart.addSeries("candles", { title: "NIFTY", priceFormat: { type: "price", minMove: 0.05 } }).setData(d);
  chart.addSeries("histogram", { priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false, priceFormat: { type: "volume" } })
    .setData(volume(d, ((parseInt(o.theme.up.slice(1), 16) << 8) | 0x80) >>> 0, ((parseInt(o.theme.down.slice(1), 16) << 8) | 0x80) >>> 0));
  chart.priceScale("vol").applyOptions({ marginTop: 0.8, marginBottom: 0 });
  window.__charts = [chart];

  const t = (k: MessageKey, v?: Record<string, string | number>) => i18n.t(k, v);
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const chips = (xs: string[]) => xs.map((x) => `<span class="chip">${esc(x)}</span>`).join("");
  const WHEN = Date.UTC(2026, 9, 20, 9, 45);

  function render(): void {
    const l = i18n.locale;
    document.documentElement.lang = l;
    document.documentElement.dir = i18n.dir;
    const switcher = Object.entries(NAMES)
      .map(([code, name]) => `<button class="btn" data-locale="${code}" aria-pressed="${code === l}" lang="${code}">${name}</button>`)
      .join("");
    $("s-toolbar").innerHTML =
      ["toolbar.symbol", "toolbar.indicators", "toolbar.alerts", "toolbar.layout", "toolbar.undo", "toolbar.redo", "toolbar.settings"].map((k) => `<span class="btn">${esc(t(k as MessageKey))}</span>`).join("") +
      `<span class="grow">${switcher}</span>`;
    $("s-intervals").innerHTML =
      `<span>${esc(t("interval.label"))}:</span>` +
      chips([t("interval.short.minute", { count: 1 }), t("interval.short.minute", { count: 5 }), t("interval.short.minute", { count: 15 }), t("interval.short.hour", { count: 1 }), t("interval.short.day", { count: 1 }), t("interval.custom")]) +
      `<span>${chips([t("chartType.candles"), t("chartType.line"), t("chartType.area"), t("chartType.heikinAshi")])}</span>`;
    $("s-search").innerHTML =
      `<input type="search" aria-label="${esc(t("common.search"))}" placeholder="${esc(t("symbol.search.placeholder"))}">` +
      [0, 1, 2, 12].map((count) => `<span>${esc(t("symbol.search.results", { count }))}</span>`).join("") +
      chips([t("symbol.type.stock"), t("symbol.type.futures"), t("symbol.type.options")]);
    $("s-draw").innerHTML =
      `<span>${esc(t("drawing.label"))}:</span>` +
      chips(["trendLine", "horizontalLine", "fibRetracement", "rectangle", "parallelChannel", "text"].map((k) => t(`drawing.tool.${k}` as MessageKey)));
    $("s-formats").innerHTML = [
      i18n.number(12345678.5),
      `${t("status.volume")} ${i18n.volume(12_500_000)}`,
      i18n.percent(12.5),
      i18n.dateTime(WHEN, { timeZone: "Asia/Kolkata", date: "medium", time: "minutes", hourCycle: "h23" }),
      i18n.relative(300),
      t("status.countdown", { time: i18n.clock(309) }),
      t("unit.bars", { count: 1 }),
      t("unit.bars", { count: 1500 }),
      t("alerts.created", { symbol: "NIFTY" }),
      t("alerts.count", { count: 3 }),
    ].map((s) => `<span>${esc(s)}</span>`).join("");
  }

  async function setLocale(next: string): Promise<void> {
    await i18n.setLocale(next);
  }
  i18n.on("localeChange", () => {
    chart.applyOptions({ locale: i18n.locale, messages: i18n.chartMessages });
    render();
  });
  app.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-locale]");
    if (b) void setLocale(b.dataset.locale!);
  });
  window.__setLocale = setLocale;
  render();
}
