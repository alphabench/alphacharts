// Style templates and favourite tools, kept in a LayoutStore from core
// (MemoryStore, LocalStorageStore, or a server-backed one).
//
// Keys: "<prefix>template/<tool>/<name>" and "<prefix>favourites".

import type { LayoutStore } from "@alphacharts/core";
import type { Drawing, DrawingStyle } from "./types.js";

export interface DrawingTemplate {
  version: 1;
  tool: string;
  name: string;
  style: DrawingStyle;
  props: Record<string, unknown>;
}

function checkName(name: string): void {
  if (!name || name.includes("/")) throw new RangeError(`template name must be non-empty and contain no "/", got "${name}"`);
}

export class TemplateStore {
  constructor(private readonly store: LayoutStore, private readonly prefix = "drawings/") {}

  private key(tool: string, name: string): string {
    checkName(tool);
    checkName(name);
    return `${this.prefix}template/${tool}/${name}`;
  }

  /** Save a drawing's style and props as a template for its tool. */
  async save(name: string, d: Drawing): Promise<void> {
    const t: DrawingTemplate = { version: 1, tool: d.tool, name, style: { ...d.style }, props: structuredClone(d.props) };
    await this.store.save(this.key(d.tool, name), t);
  }

  async load(tool: string, name: string): Promise<DrawingTemplate> {
    const raw = (await this.store.load(this.key(tool, name))) as DrawingTemplate | undefined;
    if (!raw) throw new Error(`drawings: no template "${name}" for tool "${tool}"`);
    if (raw.version !== 1 || raw.tool !== tool) throw new Error(`drawings: template "${name}" is not a version 1 template of "${tool}"`);
    return raw;
  }

  async list(tool?: string): Promise<Array<{ tool: string; name: string }>> {
    const p = `${this.prefix}template/`;
    const out: Array<{ tool: string; name: string }> = [];
    for (const k of await this.store.keys()) {
      if (!k.startsWith(p)) continue;
      const [t, n] = k.slice(p.length).split("/");
      if (t && n && (tool === undefined || t === tool)) out.push({ tool: t, name: n });
    }
    return out;
  }

  async remove(tool: string, name: string): Promise<void> {
    await this.store.remove(this.key(tool, name));
  }

  async favourites(): Promise<string[]> {
    const raw = await this.store.load(`${this.prefix}favourites`);
    if (raw === undefined) return [];
    if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string")) throw new TypeError("drawings: stored favourites are not a list of tool ids");
    return raw as string[];
  }

  async setFavourite(tool: string, on: boolean): Promise<string[]> {
    const cur = await this.favourites();
    const next = on ? (cur.includes(tool) ? cur : [...cur, tool]) : cur.filter((t) => t !== tool);
    await this.store.save(`${this.prefix}favourites`, next);
    return next;
  }
}
