// The study catalogue the Indicators dialog searches: every StudyDef it was
// given, grouped by family, matched on name, id and the family's label.

import type { StudyDef } from "@alphacharts/indicators";

export type StudyFamily = StudyDef["family"];

export const FAMILIES: readonly StudyFamily[] = ["overlap", "trend", "momentum", "volatility", "volume", "levels", "statistic", "price", "math", "cycle", "pattern", "tv"];

export interface CatalogueEntry {
  def: StudyDef;
  /** Lower-cased haystack: id, name and family label. */
  text: string;
}

export function buildCatalogue(defs: readonly StudyDef[], familyLabel: (f: StudyFamily) => string): CatalogueEntry[] {
  const seen = new Set<string>();
  const out: CatalogueEntry[] = [];
  for (const def of defs) {
    if (seen.has(def.id)) throw new Error(`study "${def.id}" appears twice in the catalogue`);
    seen.add(def.id);
    out.push({ def, text: `${def.id} ${def.name} ${familyLabel(def.family)}`.toLowerCase() });
  }
  return out.sort((a, b) => a.def.name.localeCompare(b.def.name));
}

/** Every whitespace-separated word of the query must occur in the entry's text. */
export function searchCatalogue(entries: readonly CatalogueEntry[], query: string, family?: StudyFamily | "all", favourites?: ReadonlySet<string>): CatalogueEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((e) => {
    if (family && family !== "all" && e.def.family !== family) return false;
    if (favourites && !favourites.has(e.def.id)) return false;
    return words.every((w) => e.text.includes(w));
  });
}
