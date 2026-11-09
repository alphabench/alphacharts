// The drawing store and the undo/redo command stack.
//
// Every mutation of the store is a Command that carries what it needs for an
// exact inverse: Add remembers the index, Remove the drawings and their
// indices, Patch the full before/after snapshots, Reorder both orders.
// Undoing every command returns the store to a state that serializes
// identically to the initial one (property-tested with seeded random runs).

import type { Drawing } from "./types.js";

export class DrawingStore {
  private items: Drawing[] = [];
  private index = new Map<string, Drawing>();

  /** Back to front: later = on top. */
  get list(): readonly Drawing[] {
    return this.items;
  }

  get(id: string): Drawing | undefined {
    return this.index.get(id);
  }

  require(id: string): Drawing {
    const d = this.index.get(id);
    if (!d) throw new Error(`drawings: no drawing with id "${id}"`);
    return d;
  }

  insert(d: Drawing, at: number): void {
    if (this.index.has(d.id)) throw new Error(`drawings: duplicate drawing id "${d.id}"`);
    if (!Number.isInteger(at) || at < 0 || at > this.items.length) throw new RangeError(`drawings: insert index ${at} outside 0..${this.items.length}`);
    this.items.splice(at, 0, d);
    this.index.set(d.id, d);
  }

  remove(id: string): number {
    const i = this.items.findIndex((x) => x.id === id);
    if (i < 0) throw new Error(`drawings: no drawing with id "${id}"`);
    this.items.splice(i, 1);
    this.index.delete(id);
    return i;
  }

  /** Replace the drawing with the same id, in place in the order. */
  replace(d: Drawing): void {
    const i = this.items.findIndex((x) => x.id === d.id);
    if (i < 0) throw new Error(`drawings: no drawing with id "${d.id}"`);
    this.items[i] = d;
    this.index.set(d.id, d);
  }

  setOrder(ids: readonly string[]): void {
    if (ids.length !== this.items.length || new Set(ids).size !== ids.length) throw new Error("drawings: setOrder needs every id exactly once");
    this.items = ids.map((id) => this.require(id));
  }

  clear(): void {
    this.items = [];
    this.index.clear();
  }

  snapshot(): string {
    return JSON.stringify(this.items);
  }
}

export const clone = <T>(v: T): T => structuredClone(v);

export interface Command {
  readonly label: string;
  /** Ids of drawings the command touches (for events). */
  readonly ids: readonly string[];
  /** Stamped by the history: when the command was done (`doneAt`) and when it was last undone (`undoneAt`), from the history's clock. */
  doneAt?: number;
  undoneAt?: number;
  apply(s: DrawingStore): void;
  revert(s: DrawingStore): void;
}

export class AddCommand implements Command {
  readonly label = "add";
  readonly ids: readonly string[];
  constructor(private readonly d: Drawing, private readonly at: number) {
    this.ids = [d.id];
  }
  apply(s: DrawingStore): void {
    s.insert(clone(this.d), this.at);
  }
  revert(s: DrawingStore): void {
    s.remove(this.d.id);
  }
}

export class RemoveCommand implements Command {
  readonly label = "remove";
  readonly ids: readonly string[];
  /** Ascending by index. */
  private readonly entries: Array<{ d: Drawing; at: number }>;
  constructor(entries: Array<{ d: Drawing; at: number }>) {
    this.entries = [...entries].sort((a, b) => a.at - b.at).map((e) => ({ d: clone(e.d), at: e.at }));
    this.ids = this.entries.map((e) => e.d.id);
  }
  apply(s: DrawingStore): void {
    for (const e of this.entries) s.remove(e.d.id);
  }
  revert(s: DrawingStore): void {
    for (const e of this.entries) s.insert(clone(e.d), e.at);
  }
}

export class PatchCommand implements Command {
  readonly ids: readonly string[];
  constructor(readonly label: string, private readonly before: Drawing[], private readonly after: Drawing[]) {
    if (before.length !== after.length || before.some((b, i) => b.id !== after[i]!.id)) throw new Error("drawings: PatchCommand needs matching before/after drawings");
    this.ids = before.map((b) => b.id);
    this.before = before.map(clone);
    this.after = after.map(clone);
  }
  apply(s: DrawingStore): void {
    for (const d of this.after) s.replace(clone(d));
  }
  revert(s: DrawingStore): void {
    for (const d of this.before) s.replace(clone(d));
  }
}

export class ReorderCommand implements Command {
  readonly label = "reorder";
  readonly ids: readonly string[];
  constructor(private readonly before: string[], private readonly after: string[]) {
    this.ids = after;
  }
  apply(s: DrawingStore): void {
    s.setOrder(this.after);
  }
  revert(s: DrawingStore): void {
    s.setOrder(this.before);
  }
}

export class BatchCommand implements Command {
  readonly ids: readonly string[];
  constructor(readonly label: string, private readonly cmds: Command[]) {
    this.ids = cmds.flatMap((c) => c.ids);
  }
  apply(s: DrawingStore): void {
    for (const c of this.cmds) c.apply(s);
  }
  revert(s: DrawingStore): void {
    for (let i = this.cmds.length - 1; i >= 0; i--) this.cmds[i]!.revert(s);
  }
}

export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];

  private tick = 0;
  /** `clock` returns a number that grows with every call: it orders this history's entries against another history's (the host's studies). */
  constructor(private readonly store: DrawingStore, private readonly max = 500, private readonly clock: () => number = () => ++this.tick) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Apply a new command and make it undoable; clears redo. */
  run(c: Command): void {
    c.apply(this.store);
    c.doneAt = this.clock();
    this.undoStack.push(c);
    if (this.undoStack.length > this.max) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Record a command whose effect is already in the store (a finished drag). */
  record(c: Command): void {
    c.doneAt = this.clock();
    this.undoStack.push(c);
    if (this.undoStack.length > this.max) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(): Command | undefined {
    const c = this.undoStack.pop();
    if (!c) return undefined;
    c.revert(this.store);
    c.undoneAt = this.clock();
    this.redoStack.push(c);
    return c;
  }

  redo(): Command | undefined {
    const c = this.redoStack.pop();
    if (!c) return undefined;
    c.apply(this.store);
    this.undoStack.push(c);
    return c;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
