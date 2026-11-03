import main from "../../indicators/fixtures/dataset.json";
import { runStudy, StudyEngine, type BarColumns, type BarInput, type StudyDef } from "@alphacharts/indicators";
import { ALL_STUDIES } from "@alphacharts/indicators/all";
import { compile, type CompileOk } from "../src/index.js";

export const DATA: Required<BarColumns> = {
  time: Float64Array.from(main.time), open: Float64Array.from(main.open), high: Float64Array.from(main.high),
  low: Float64Array.from(main.low), close: Float64Array.from(main.close), volume: Float64Array.from(main.volume),
};
export const builtin = (id: string): StudyDef => ALL_STUDIES.find((s) => s.id === id)!;

export function ok(src: string): CompileOk {
  const r = compile(src);
  if (!r.ok) throw new Error(r.diagnostics.map((d) => `${d.line}:${d.column} ${d.message}`).join("\n"));
  return r;
}
export function run(src: string, inputs: Record<string, number | boolean | string> = {}, data = DATA): Float64Array[] {
  return runStudy(ok(src).study, inputs, data);
}
export function same(a: Float64Array, b: Float64Array): void {
  if (a.length !== b.length) throw new Error(`length ${a.length} vs ${b.length}`);
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i]) && a[i] !== b[i]) throw new Error(`[${i}] script ${a[i]} vs built-in ${b[i]}`);
}
export function bar(d: Required<BarColumns>, i: number): BarInput {
  return { time: d.time[i]!, open: d.open[i]!, high: d.high[i]!, low: d.low[i]!, close: d.close[i]!, volume: d.volume[i]! };
}
export { StudyEngine, runStudy };
