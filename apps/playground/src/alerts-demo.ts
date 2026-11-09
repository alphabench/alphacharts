// ?ex=alerts — alerts firing on a replayed tick stream, logged on screen.
// `?auto=0` stops the timer; tests then call window.__feed(k).

import { createChart, type Chart, type Theme } from "@alphacharts/core";
import { AlertsPlugin, type AlertDefinition, type AlertTrigger } from "@alphacharts/alerts";
import { ohlc } from "./synthetic.js";
import { makeTicks } from "./ticks.js";

const BAR_MS = 60_000;

export function alertDefs(base: number): AlertDefinition[] {
  return [
    { id: "cross", label: "cross", condition: { type: "crossing", price: base, direction: "any" }, trigger: { mode: "everyTime" } },
    { id: "enter", label: "enter", condition: { type: "enteringChannel", low: base * 1.001, high: base * 1.002 }, trigger: { mode: "oncePerBar" } },
    { id: "move", label: "move", condition: { type: "moving", direction: "up", bars: 3, percent: 0.15 }, trigger: { mode: "oncePerBar" } },
    { id: "close", label: "close", condition: { type: "greaterThan", price: base * 1.002 }, trigger: { mode: "oncePerBarClose" } },
    { id: "first", label: "first", condition: { type: "lessThan", price: base * 0.998 }, trigger: { mode: "once" } },
  ];
}

export function runAlerts(app: HTMLElement, theme: Theme, params: URLSearchParams, extra: Record<string, unknown>): Chart {
  const n = Number(params.get("n") ?? 2000);
  const d = ohlc(n, 8);
  const chart = createChart(app, { theme });
  const series = chart.addSeries("candles", { title: "SYNTH", priceFormat: { type: "price", minMove: 0.05 } });
  series.setData(d);
  const lastTime = d.time[n - 1]!, lastClose = d.close[n - 1]!;
  chart.timeScale.setVisibleLogicalRange({ from: n - 120, to: n + 60 });

  const base = Math.round(lastClose * 100) / 100;
  const log = document.createElement("pre");
  log.id = "alert-log";
  log.style.cssText = "position:absolute;left:8px;bottom:36px;margin:0;padding:6px 8px;max-height:30%;overflow:auto;background:rgba(0,0,0,.55);color:#e5e5e5;font:11px ui-monospace,monospace;pointer-events:none";
  app.appendChild(log);

  const triggers: AlertTrigger[] = [];
  const plugin = new AlertsPlugin({
    onTrigger: (t) => {
      triggers.push(t);
      log.textContent += `${new Date(t.time).toISOString().slice(11, 19)} ${t.alertId} ${t.price.toFixed(2)} #${t.seq}\n`;
      log.scrollTop = log.scrollHeight;
    },
  });
  chart.addPlugin(plugin);
  const defs = alertDefs(base);
  for (const a of defs) plugin.add(a);

  // Ticks continue from the last bar; 10 per bar, 200 bars.
  const ticks = makeTicks(42, 200, lastTime + BAR_MS, base, BAR_MS, 10);
  let i = 0;
  let bar: { time: number; open: number; high: number; low: number; close: number } | null = null;
  const feedOne = () => {
    const t = ticks[i++];
    if (!t) return false;
    plugin.tick(t);
    if (bar && bar.time === t.bar) {
      bar = { ...bar, high: Math.max(bar.high, t.price), low: Math.min(bar.low, t.price), close: t.price };
    } else bar = { time: t.bar, open: t.price, high: t.price, low: t.price, close: t.price };
    series.update(bar);
    return true;
  };
  if (params.get("auto") !== "0") {
    const id = setInterval(() => {
      if (!feedOne()) clearInterval(id);
    }, 30);
  }
  Object.assign(extra, {
    __alerts: plugin,
    __ticks: ticks,
    __defs: defs,
    __triggers: triggers,
    __feed: (k: number) => {
      for (let j = 0; j < k; j++) if (!feedOne()) break;
      return i;
    },
  });
  return chart;
}
