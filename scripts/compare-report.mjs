// Turns bench/results/compare.json (from `pnpm bench:compare`) into markdown tables on
// stdout, for the comparison posts. Every number is the median over the runs with the
// min-max range beside it; a library that failed shows what happened instead.
// node scripts/compare-report.mjs [path/to/compare.json]
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "bench/results/compare.json";
const data = JSON.parse(readFileSync(file, "utf8"));
const { meta, bundles, results } = data;

const LABEL = {
  alphacharts: "alphacharts",
  "lightweight-charts": "lightweight-charts",
  echarts: "ECharts",
  "echarts-sync": "ECharts (progressive off)",
};
const sizes = [...new Set(results.map((c) => c.bars))].sort((a, b) => a - b);
const libs = [...new Set(results.map((c) => c.lib))];
const cell = (lib, bars) => results.find((c) => c.lib === lib && c.bars === bars);
const sizeName = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : `${n / 1000}k`) + " bars";

const num = (x, d) => (Number.isInteger(x) && d === 0 ? String(x) : x.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: 0 }));

/** "median (min-max)" for one metric, or why there is no number. */
function show(c, metric, d = 1, unit = "") {
  if (!c) return "not run";
  const failed = c.runs.filter((r) => r.outcome === "failed");
  const ok = c.runs.filter((r) => r.outcome === "ok" || r.outcome === "partial");
  if (!ok.length) {
    const why = failed[0]?.detail ?? c.runs[0]?.detail ?? "no result";
    return why.replace(/ \((load|sweep)\).*$/, "").replace(/^failed to load.*$/, "failed to load");
  }
  const s = c.summary?.[metric];
  if (!s) return "n/a";
  const range = s.min === s.max ? "" : ` (${num(s.min, d)}-${num(s.max, d)})`;
  const partial = c.runs.some((r) => r.outcome === "partial") || failed.length ? "*" : "";
  return `${num(s.median, d)}${unit}${range}${partial}`;
}

function table(title, metric, d = 1, unit = "", note = "") {
  const out = [`### ${title}`, "", `| library | ${sizes.map(sizeName).join(" | ")} |`, `|---|${sizes.map(() => "---:").join("|")}|`];
  for (const lib of libs) out.push(`| ${LABEL[lib] ?? lib} | ${sizes.map((n) => show(cell(lib, n), metric, d, unit)).join(" | ")} |`);
  if (note) out.push("", note);
  return out.join("\n");
}

const kb = (b) => `${(b / 1024).toFixed(1)} KB`;
const lines = [];
const push = (...s) => lines.push(...s, "");

const m = meta.machine ?? {};
const d = meta.display ?? {};
const lv = meta.libraries ?? {};
const h = meta.harness ?? {};
push(
  "## Setup",
  [
    `- Date: ${meta.date}`,
    `- Machine: ${[m.model, m.cpu, m.gpu && `GPU ${m.gpu}`, m.memoryGB && `${m.memoryGB} GB`, `${m.os}${m.osVersion ? ` (macOS ${m.osVersion})` : ""}`].filter(Boolean).join(", ")}`,
    `- Chrome ${meta.chrome}, headed, viewport ${h.viewport?.width}x${h.viewport?.height} at device pixel ratio ${h.deviceScaleFactor}; display refresh ${d.refreshHz} Hz (${d.refreshMs} ms)${d.resolution ? `, ${d.resolution}` : ""}`,
    `- Libraries: alphacharts ${lv.alphacharts?.version} (${lv.alphacharts?.commit?.slice(0, 9)}${lv.alphacharts?.dirty ? ", uncommitted changes" : ""}), lightweight-charts ${lv["lightweight-charts"]?.version}, ECharts ${lv.echarts?.version} (canvas renderer)`,
    `- Data: ${meta.dataset?.generator}, seed ${meta.dataset?.seed}, 1-minute bars; generated once per run and handed to every library in its own input form (the generator's output is checksum-checked)`,
    `- Method: ${h.runsPerCell} runs per library and size, each a fresh page; run order rotated; cells show median (min-max); * marks a cell where some runs failed or were cut short (see compare.json)${meta.partial ? "; PARTIAL: a subset of libraries, sizes or runs" : ""}`,
  ].join("\n"),
);

push(
  table("Pan/zoom frame interval p95 (ms)", "p95", 1, "", `Lower is better. One vsync is ${d.refreshMs} ms. 600 frames per run: zoom out from 200 bars to the whole history, pan, zoom back in.`),
);
push(table("Pan/zoom frame interval p50 (ms)", "p50", 1));
push(table("Pan/zoom frame interval p99 (ms)", "p99", 1));
push(table(`Frames that missed a vsync (of ${h.sweepFrames}, longer than 1.5 x ${d.refreshMs} ms)`, "missed", 0));
push(table("Time to first paint after the data is handed over (ms)", "firstPaintMs", 0, "", "From the start of preparing the data in the library's format to the second animation frame after the load call."));
push(table("Load: prepare + setData (ms)", "loadMs", 0, "", "alphacharts takes typed arrays as they are; lightweight-charts takes row objects and ECharts row arrays, built by the harness. The split is in compare.json (prepareMs, setDataMs)."));
push(table("ECharts: time until its render-complete event (ms)", "settledMs", 0, "", "Only ECharts reports it. With progressive rendering on, first paint can be a partial picture; this is when the picture is complete."));
push(table("JS heap growth over a measured sweep, after a warm-up sweep (KB)", "heapGrowthKB", 0, "", "usedJSHeapSize after a forced GC; typed-array backing stores are not in it. Near zero means the sweep leaks nothing."));
push(table("Page memory added by loading the data (MB)", "pageLoadDeltaMB", 0, "", "performance.measureUserAgentSpecificMemory() before and after the hand-over: JS plus ArrayBuffers, so typed-array data is counted. The harness's own copy of the arrays is in both."));
push(table("Bars on screen at the widest zoom of the sweep", "fullZoomOutVisibleBars", 0, "", "The sweep asks every library to show the whole history. A library that clamps its zoom (lightweight-charts' minimum bar spacing) shows fewer bars, so its widest frames are cheaper than the others'."));

const rows = ["alphacharts", "lightweight-charts", "echarts"].filter((k) => bundles?.[k]);
push(
  "### Bundle size (minified production build, library only)",
  ["| library | raw | gzip |", "|---|---:|---:|", ...rows.map((k) => `| ${LABEL[k]} | ${kb(bundles[k].rawBytes)} | ${kb(bundles[k].gzipBytes)} |`)].join("\n"),
);
if (bundles?.note) push(`${bundles.note}`);

const paths = [...new Set(results.map((c) => c.lib))].map((lib) => `- **${LABEL[lib] ?? lib}**: ${results.find((c) => c.lib === lib && c.path)?.path ?? "(never loaded)"}`);
push("### Configuration used", paths.join("\n"));

const fails = results.flatMap((c) => c.runs.filter((r) => r.outcome !== "ok").map((r) => `- ${LABEL[c.lib] ?? c.lib}, ${sizeName(c.bars)}, run ${r.run}: ${r.outcome}${r.detail ? ` - ${r.detail}` : ""}`));
if (fails.length) push("### Runs that did not complete cleanly", fails.join("\n"));

process.stdout.write(lines.join("\n"));
