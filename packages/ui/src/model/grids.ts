// Grid presets for 1 to 16 charts. A preset is a CSS grid: column and row
// track counts, and an optional area map for the uneven ones (3 variants).

export interface GridPreset {
  id: string;
  charts: number;
  /** grid-template-columns / -rows. */
  cols: string;
  rows: string;
  /** grid-template-areas, rows of area names; the chart count's names are a..p in order. Omitted: auto-placed. */
  areas?: readonly string[];
}

const eq = (n: number) => `repeat(${n}, minmax(0, 1fr))`;
const g = (id: string, charts: number, c: number, r: number): GridPreset => ({ id, charts, cols: eq(c), rows: eq(r) });

export const GRID_PRESETS: readonly GridPreset[] = [
  g("1", 1, 1, 1),
  g("2h", 2, 2, 1),
  g("2v", 2, 1, 2),
  g("3h", 3, 3, 1),
  g("3v", 3, 1, 3),
  { id: "3l", charts: 3, cols: eq(2), rows: eq(2), areas: ["a b", "a c"] },
  { id: "3t", charts: 3, cols: eq(2), rows: eq(2), areas: ["a a", "b c"] },
  g("4", 4, 2, 2),
  g("6", 6, 3, 2),
  g("8", 8, 4, 2),
  g("9", 9, 3, 3),
  g("12", 12, 4, 3),
  g("16", 16, 4, 4),
];

export function gridPreset(id: string): GridPreset {
  const p = GRID_PRESETS.find((x) => x.id === id);
  if (!p) throw new RangeError(`unknown grid preset "${id}" (${GRID_PRESETS.map((x) => x.id).join(", ")})`);
  return p;
}

export const areaName = (i: number): string => String.fromCharCode(97 + i);

/** Inline style of the grid element and of cell `i` of the preset. */
export function gridStyle(p: GridPreset): Record<string, string> {
  const s: Record<string, string> = { "grid-template-columns": p.cols, "grid-template-rows": p.rows };
  if (p.areas) s["grid-template-areas"] = p.areas.map((r) => `"${r}"`).join(" ");
  return s;
}

export function cellStyle(p: GridPreset, i: number): string | null {
  return p.areas ? areaName(i) : null;
}
