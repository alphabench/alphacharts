/** @jsxImportSource preact */
import { useState } from "preact/hooks";
import type { PriceScaleMode, Theme } from "@alphacharts/core";
import { NSE, US_EQUITY, ALWAYS_OPEN, DEFAULT_KEYMAP, type KeyAction } from "@alphacharts/core";
import type { ThemeName } from "../types.js";
import { useApp, useT } from "./context.js";
import { Button, Check, ColorField, Dialog, NumberField, SelectField, Tabs } from "./primitives.js";

const TABS = ["symbol", "statusLine", "scales", "canvas", "trading", "alerts", "events", "accessibility"] as const;
const SESSIONS = { none: null, nse: NSE(), us: US_EQUITY(), always: ALWAYS_OPEN } as const;

export function SettingsDialog({ tab: first }: { tab?: string | undefined }) {
  const app = useApp();
  const t = useT();
  const [tab, setTab] = useState<string>(first ?? "symbol");
  const inst = app.current;
  const chart = inst.chart;
  const o = chart.options();
  const apply = (p: Parameters<typeof chart.applyOptions>[0]) => (app.instances.forEach((i) => i.chart.applyOptions(p)), app.events.emit("change", undefined));
  // The chart's options are the scale's until a series uses it.
  const right = o.rightPriceScale;
  const left = o.leftPriceScale;
  const sty = inst.styleTarget();
  const so = (sty?.options() ?? {}) as Record<string, unknown>;
  const colorKeys = ["upColor", "downColor", "wickUpColor", "wickDownColor", "color", "lineColor", "topColor", "bottomColor", "topLineColor", "bottomLineColor"].filter((k) => typeof so[k] === "string");
  const setScale = (id: "right" | "left", p: Partial<{ mode: PriceScaleMode; autoScale: boolean; invert: boolean; visible: boolean; marginTop: number; marginBottom: number }>) => {
    app.instances.forEach((i) => i.chart.applyOptions(id === "right" ? { rightPriceScale: p } : { leftPriceScale: p }));
    app.events.emit("change", undefined);
  };
  const colorOf = (k: keyof Theme) => app.theme[k] as string;
  const custom = (k: keyof Theme, v: string) => app.setTheme("custom", { ...app.theme, [k]: v });
  const sessionKey = (Object.entries(SESSIONS).find(([, v]) => v === o.sessions)?.[0] ?? "none") as keyof typeof SESSIONS;
  const tz = [...new Set(["UTC", app.options.timeZone ?? "UTC", Intl.DateTimeFormat().resolvedOptions().timeZone, o.timeZone])];
  const pm = (k: string) => t(`settings.priceScale.mode.${k}` as never);

  return (
    <Dialog title={t("settings.title")} onClose={() => app.closeDialog()} wide testid="settings-dialog">
      <Tabs label={t("settings.title")} value={tab} onChange={setTab} tabs={TABS.map((id) => ({ id, label: t(`settings.tab.${id}` as never) }))}>
        {tab === "symbol" ? (
          <div class="form">
            <fieldset><legend>{t("settings.series.title")}</legend>
              {colorKeys.map((k) => <ColorField key={k} label={t(`settings.series.${k}` as never)} value={so[k] as string} alpha onChange={(c) => inst.setSeriesStyle({ [k]: c })} testid={`series-${k}`} />)}
              {typeof so.lineWidth === "number" ? <NumberField label={t("settings.series.lineWidth")} min={1} max={6} step={0.5} value={so.lineWidth} onChange={(v) => inst.setSeriesStyle({ lineWidth: v })} /> : null}
              {typeof so.base === "number" ? <NumberField label={t("settings.series.base")} value={so.base} onChange={(v) => inst.setSeriesStyle({ base: v })} /> : null}
              {(["box", "reversal", "range", "lines"] as const).map((k) => {
                const def = ({ box: ["renko", "pointFigure"], reversal: ["kagi"], range: ["rangeBars"], lines: ["lineBreak"] } as const)[k] as readonly string[];
                if (k === "box" && inst.boxFromAtr) return <NumberField key={k} label={t("ui.param.box")} min={0} value={null} placeholder="ATR 14" onChange={(v) => inst.setTypeParam(k, v)} testid={`param-${k}`} />;
                return def.includes(inst.chartType) && inst.raw.length ? <NumberField key={k} label={t(`ui.param.${k}` as never)} min={0} value={inst.paramValue(k)} onChange={(v) => inst.setTypeParam(k, v)} testid={`param-${k}`} /> : null;
              })}
            </fieldset>
          </div>
        ) : tab === "statusLine" ? (
          <div class="form">
            {(["symbol", "ohlc", "change", "volume", "studyValues", "studyInputs"] as const).map((k) => (
              <Check key={k} label={t(`ui.status.${k}` as never)} checked={app.legendOpts[k]} onChange={(v) => (app.legendOpts = { ...app.legendOpts, [k]: v }, app.events.emit("change", undefined))} />
            ))}
          </div>
        ) : tab === "scales" ? (
          <div class="form">
            {(["right", "left"] as const).map((id) => {
              const s = id === "right" ? right : left;
              return (
                <fieldset key={id}><legend>{t(`settings.priceScale.position.${id}` as never)}</legend>
                  <SelectField label={t("settings.priceScale.mode")} value={s.mode} options={(["linear", "log", "percent", "indexed"] as const).map((m) => ({ value: m, label: pm(m) }))} onChange={(m) => setScale(id, { mode: m })} testid={`scale-mode-${id}`} />
                  <Check label={t("settings.priceScale.autoScale")} checked={s.autoScale} onChange={(v) => setScale(id, { autoScale: v })} />
                  <Check label={t("settings.priceScale.invert")} checked={s.invert} onChange={(v) => setScale(id, { invert: v })} />
                  <Check label={t("settings.priceScale.visible")} checked={s.visible} onChange={(v) => setScale(id, { visible: v })} />
                  <NumberField label={t("settings.priceScale.marginTop")} min={0} max={0.9} step={0.05} value={s.marginTop} onChange={(v) => setScale(id, { marginTop: v })} />
                  <NumberField label={t("settings.priceScale.marginBottom")} min={0} max={0.9} step={0.05} value={s.marginBottom} onChange={(v) => setScale(id, { marginBottom: v })} />
                </fieldset>
              );
            })}
            <fieldset><legend>{t("settings.timeScale.title")}</legend>
              <NumberField label={t("settings.timeScale.barSpacing")} min={1} value={o.timeScale.barSpacing} onChange={(v) => apply({ timeScale: { barSpacing: v } })} />
              <NumberField label={t("settings.timeScale.maxBarSpacing")} min={1} value={o.timeScale.maxBarSpacing} onChange={(v) => apply({ timeScale: { maxBarSpacing: v } })} />
              <NumberField label={t("settings.timeScale.rightOffset")} min={0} value={o.timeScale.rightOffset} onChange={(v) => apply({ timeScale: { rightOffset: v } })} />
            </fieldset>
            <Check label={t("settings.chart.countdown")} checked={o.countdown} onChange={(v) => apply({ countdown: v })} />
          </div>
        ) : tab === "canvas" ? (
          <div class="form">
            <SelectField label={t("settings.chart.theme")} value={app.themeName} options={(["dark", "light", "high-contrast", "auto", "custom"] as ThemeName[]).map((n) => ({ value: n, label: app.themeLabel(n) }))} onChange={(n) => app.setTheme(n)} testid="theme-select" />
            <ColorField label={t("settings.chart.background")} value={colorOf("background")} onChange={(c) => custom("background", c)} testid="color-background" />
            <ColorField label={t("settings.chart.grid")} value={colorOf("grid")} onChange={(c) => custom("grid", c)} />
            <ColorField label={t("common.color")} value={colorOf("text")} onChange={(c) => custom("text", c)} />
            <ColorField label={t("settings.series.upColor")} value={colorOf("up")} onChange={(c) => custom("up", c)} />
            <ColorField label={t("settings.series.downColor")} value={colorOf("down")} onChange={(c) => custom("down", c)} />
            <ColorField label={t("ui.theme.accent")} value={colorOf("accent")} onChange={(c) => custom("accent", c)} />
            <fieldset><legend>{t("settings.crosshair.title")}</legend>
              <Check label={t("settings.crosshair.visible")} checked={o.crosshair.visible} onChange={(v) => apply({ crosshair: { visible: v } })} />
              <SelectField label={t("settings.crosshair.mode")} value={o.crosshair.mode} options={(["magnet", "normal", "hidden"] as const).map((m) => ({ value: m, label: t(`settings.crosshair.mode.${m}` as never) }))} onChange={(m) => apply({ crosshair: { mode: m } })} />
            </fieldset>
            <SelectField label={t("settings.chart.timeVisible")} value={String(o.timeVisible)} options={[{ value: "auto", label: t("settings.chart.timeVisible.auto") }, { value: "true", label: t("common.on") }, { value: "false", label: t("common.off") }]} onChange={(v) => apply({ timeVisible: v === "auto" ? "auto" : v === "true" })} />
            <SelectField label={t("settings.chart.renderer")} value={"auto"} options={[{ value: "auto", label: `${t("settings.chart.renderer.auto")} (${chart.renderer})` }]} onChange={() => undefined} />
          </div>
        ) : tab === "trading" ? (
          <div class="form">
            <SelectField label={t("settings.chart.sessions")} value={sessionKey} options={[{ value: "none", label: t("common.none") }, { value: "nse", label: "NSE" }, { value: "us", label: "US" }, { value: "always", label: t("ui.sessions.always") }]} onChange={(k) => apply({ sessions: SESSIONS[k] })} testid="sessions-select" />
            <SelectField label={t("settings.chart.timeZone")} value={o.timeZone} options={tz.map((z) => ({ value: z, label: z === "UTC" ? t("format.timeZone.utc") : z }))} onChange={(z) => app.setTimeZone(z)} />
          </div>
        ) : tab === "alerts" ? (
          <div class="form">
            <SelectField label={t("alerts.trigger")} value={app.alertDefaults.mode} options={(["once", "everyTime", "oncePerBar", "oncePerBarClose"] as const).map((m) => ({ value: m, label: t(`alerts.trigger.${m}` as never) }))} onChange={(m) => (app.alertDefaults = { mode: m }, app.events.emit("change", undefined))} />
          </div>
        ) : tab === "events" ? (
          <div class="form">
            {(["pan", "zoom", "kinetic", "keyboard"] as const).map((k) => <Check key={k} label={t(`settings.interaction.${k}` as never)} checked={o.interaction[k]} onChange={(v) => apply({ interaction: { [k]: v } })} />)}
            <fieldset><legend>{t("settings.interaction.keymap")}</legend>
              {(Object.keys(DEFAULT_KEYMAP) as KeyAction[]).map((k) => (
                <label key={k} class="keyrow"><span>{k}</span><input value={(o.keymap[k] ?? DEFAULT_KEYMAP[k]).join(", ")} onChange={(e) => apply({ keymap: { [k]: (e.currentTarget as HTMLInputElement).value.split(",").map((x) => x.trim()).filter(Boolean) } })} /></label>
              ))}
            </fieldset>
          </div>
        ) : (
          <div class="form">
            <Check label={t("settings.accessibility.table")} checked={o.a11yTable} onChange={(v) => apply({ a11yTable: v })} />
          </div>
        )}
      </Tabs>
    </Dialog>
  );
}
