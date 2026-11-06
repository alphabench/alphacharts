// Study registry. Studies are plain objects, so an app that imports only what it
// uses (`import { rsi } from "@alphacharts/indicators/studies"`) ships only that;
// the registry holds the ones an app registers by id (`registerStudies`).

import type { StudyDef } from "./types.js";

const studies = new Map<string, StudyDef>();

export function registerStudy(def: StudyDef): void {
  const prev = studies.get(def.id);
  if (prev === def) return;
  if (prev) throw new Error(`alphacharts: study "${def.id}" is already registered with a different definition`);
  validateDef(def);
  studies.set(def.id, def);
}

export function registerStudies(defs: readonly StudyDef[]): void {
  for (const d of defs) registerStudy(d);
}

export function getStudy(id: string): StudyDef {
  const d = studies.get(id);
  if (!d) throw new Error(`alphacharts: unknown study "${id}" (register it with registerStudy)`);
  return d;
}

export function listStudies(): StudyDef[] {
  return [...studies.values()];
}

/** Catch an inconsistent definition when it is registered, not when it is drawn. */
export function validateDef(def: StudyDef): void {
  const cols = new Set(def.columns);
  if (cols.size !== def.columns.length) throw new Error(`${def.id}: duplicate column names`);
  const keys = new Set<string>();
  const need = (c: string, key: string) => {
    if (!cols.has(c)) throw new Error(`${def.id}: plot "${key}" uses unknown column "${c}"`);
  };
  for (const p of def.plots) {
    if (keys.has(p.key)) throw new Error(`${def.id}: duplicate plot key "${p.key}"`);
    keys.add(p.key);
    switch (p.kind) {
      case "line": need(p.col, p.key); if (p.colorBy) need(p.colorBy.col, p.key); break;
      case "histogram": case "area": case "markers": case "barcolor": case "bgcolor": need(p.col, p.key); break;
      case "band": need(p.upper, p.key); need(p.lower, p.key); break;
      case "fill": need(p.a, p.key); need(p.b, p.key); break;
      case "zigzag": need(p.price, p.key); need(p.back, p.key); break;
      case "hline": break;
    }
  }
}
