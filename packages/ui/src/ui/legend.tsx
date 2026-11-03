/** @jsxImportSource preact */
import { useEffect, useReducer, useState } from "preact/hooks";
import { COL_C } from "@alphacharts/core";
import type { ChartInstance } from "../engine/instance.js";
import { floorIndex } from "../engine/bars.js";
import { useApp, useT } from "./context.js";
import { IconButton } from "./primitives.js";
import { Button } from "./primitives.js";

export function Legend({ inst }: { inst: ChartInstance }) {
  const app = useApp();
  const t = useT();
  const [time, setTime] = useState<number | undefined>(undefined);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    let raf = 0;
    const again = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => bump(0)); };
    const offs = [inst.chart.on("crosshairMove", (e) => setTime(e.time)), inst.events.on("data", again), inst.events.on("change", again)];
    return () => (cancelAnimationFrame(raf), offs.forEach((o) => o()));
  }, [inst]);

  const opts = app.legendOpts;
  const series = inst.chartType === "candles" || inst.ordinal === false && !inst.displaySeries.length ? inst.main : inst.displaySeries[0] ?? inst.main;
  const shape = series ? (series.data.shape as string) : "";
  const fmtSeries = inst.main ?? inst.displaySeries[0];
  const derived = inst.chartType === "heikinAshi" || inst.ordinal;
  const lastTime = inst.main ? (inst.raw.length ? inst.raw.at(inst.raw.length - 1).time : undefined) : inst.store && inst.store.length ? inst.store.time[inst.store.length - 1] : undefined;
  const at = time ?? lastTime;
  let bar: { open: number; high: number; low: number; close: number } | undefined;
  let prevClose: number | undefined;
  let volume: number | undefined;
  if (at !== undefined) {
    if (derived && inst.store) {
      const i = inst.store.indexOfTime(at);
      if (i !== undefined) {
        bar = inst.store.bar(i);
        if (i > 0) prevClose = inst.store.bar(i - 1).close;
      }
    } else if (inst.raw.length) {
      const [lo, hi] = inst.raw.range(at, at);
      if (hi > lo) {
        const b = inst.raw.at(lo);
        bar = b;
        if (lo > 0) prevClose = inst.raw.at(lo - 1).close;
        if (inst.hasVolume) volume = b.volume;
      }
    }
  }
  void shape; void COL_C;
  const f = (v: number) => fmtSeries?.formatPrice(v) ?? String(v);
  const change = bar && prevClose !== undefined ? bar.close - prevClose : undefined;
  const pct = change !== undefined && prevClose ? (change / prevClose) * 100 : undefined;
  const up = change === undefined ? undefined : change >= 0;
  return (
    <div class="legend" data-testid="legend">
      {inst.status !== "ready" ? <StatusBox inst={inst} /> : null}
      <div class="legend-line main-line">
        {opts.symbol ? <span class="legend-symbol" data-testid="legend-symbol"><bdi>{inst.symbol}</bdi> · {app.intervalLabel(inst.interval)}</span> : null}
        {opts.ohlc && bar ? (
          <span class={`ohlc ${up === undefined ? "" : up ? "up" : "down"}`} data-testid="legend-ohlc">
            <span><abbr title={t("chart.table.open")}>{t("status.open")}</abbr> <bdi>{f(bar.open)}</bdi></span>
            <span><abbr title={t("chart.table.high")}>{t("status.high")}</abbr> <bdi>{f(bar.high)}</bdi></span>
            <span><abbr title={t("chart.table.low")}>{t("status.low")}</abbr> <bdi>{f(bar.low)}</bdi></span>
            <span><abbr title={t("chart.table.close")}>{t("status.close")}</abbr> <bdi>{f(bar.close)}</bdi></span>
          </span>
        ) : null}
        {opts.change && change !== undefined && pct !== undefined ? (
          <span class={`chg ${up ? "up" : "down"}`} data-testid="legend-change"><bdi>{`${change >= 0 ? "+" : "−"}${f(Math.abs(change))} (${change >= 0 ? "+" : "−"}${app.i18n.number(Math.abs(pct), { maxFractionDigits: 2 })}%)`}</bdi></span>
        ) : null}
        {opts.volume && volume !== undefined ? <span class="vol"><abbr title={t("status.volume")}>{t("status.volume")}</abbr> <bdi>{app.i18n.volume(volume)}</bdi></span> : null}
      </div>
      {inst.compareList().map((c) => (
        <div class="legend-line" key={c.symbol}><span><bdi>{c.symbol}</bdi></span><IconButton icon="close" label={t("symbol.compare.remove", { symbol: c.symbol })} onClick={() => inst.removeCompare(c.symbol)} /></div>
      ))}
      {inst.studies().map((s) => {
        const times = s.study.times();
        const i = at === undefined ? -1 : floorIndex(times, at);
        const idx = i >= 0 && times[i] === at ? i : times.length - 1;
        const vals = s.study.def.columns.map((c) => {
          const v = idx >= 0 ? s.study.column(c)[idx] : undefined;
          return { c, v: v === undefined || Number.isNaN(v) ? undefined : v };
        });
        const inputs = Object.values(s.study.inputs()).filter((x) => typeof x !== "boolean").join(", ");
        const name = s.study.def.name;
        return (
          <div class={`legend-line study${s.effectivelyVisible ? "" : " off"}`} key={s.study.id} data-testid={`legend-study-${s.study.id}`}>
            <span class="study-name">{s.effectivelyVisible ? name : t("status.hidden", { name })}{opts.studyInputs && inputs ? ` (${inputs})` : ""}</span>
            {opts.studyValues && s.effectivelyVisible ? vals.map((x) => x.v !== undefined ? <span key={x.c} class="study-val"><bdi>{s.study.seriesOfColumn(x.c)?.formatPrice(x.v) ?? String(x.v)}</bdi></span> : null) : null}
            <span class="legend-actions">
              <IconButton icon={s.userHidden ? "eyeOff" : "eye"} label={t(s.userHidden ? "common.show" : "common.hide") + ` ${name}`} onClick={() => inst.setStudyHidden(s.study.id, !s.userHidden)} />
              <IconButton icon="gear" label={t("study.settings.title", { name })} onClick={() => app.openDialog({ kind: "study", id: s.study.id })} />
              <IconButton icon="close" label={t("indicators.remove", { name })} onClick={() => app.removeStudy(s.study.id)} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

function StatusBox({ inst }: { inst: ChartInstance }) {
  const t = useT();
  return (
    <div class="status-box" role="status" data-testid="chart-status">
      {inst.status === "loading" ? <span>{t("common.loading")}</span> : null}
      {inst.status === "empty" ? <span>{t("error.noData")}</span> : null}
      {inst.status === "error" ? (<><span class="error-text">{t("error.loadFailed", { reason: inst.error?.message ?? "" })}</span><Button onClick={() => inst.retry()}>{t("error.retry")}</Button></>) : null}
    </div>
  );
}
