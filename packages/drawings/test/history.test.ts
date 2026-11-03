// Undo/redo: every mutation has an exact inverse. Seeded random command
// sequences, undo all → initial state; redo all → final state; and every
// intermediate state is reproduced on the way back.

import { describe, expect, it } from "vitest";
import { allTools } from "../src/tools/all.js";
import { seeded } from "../src/tools/position.js";
import { fixture, k, plugin } from "./helpers.js";
import type { DrawingsPlugin } from "../src/plugin.js";

const state = (p: DrawingsPlugin) => JSON.stringify(p.toJSON());

function randomOp(p: DrawingsPlugin, r: () => number, ids: () => string[]): string {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const list = ids();
  const op = list.length < 3 ? "add" : pick(["add", "add", "update", "updateMany", "remove", "front", "back", "forward", "backward", "paste", "duplicate", "lock", "style"]);
  switch (op) {
    case "add": {
      const f = fixture(pick(allTools).id);
      const j = Math.floor(r() * 30);
      f.anchors = f.anchors!.map((a) => ({ time: a.time + j * 60_000, price: a.price + j * 0.01 }));
      p.add(f);
      return "add " + f.tool;
    }
    case "update": {
      const d = p.get(pick(list))!;
      if (d.anchors.length) p.update(d.id, { anchors: d.anchors.map((a) => ({ time: a.time + 60_000, price: a.price + 0.5 })) });
      else p.update(d.id, { props: { fx: r() * 0.9, fy: r() * 0.9 } });
      return "update";
    }
    case "updateMany": p.updateMany(list.slice(0, 3), { hidden: r() < 0.5 }); return "updateMany";
    case "remove": p.remove([pick(list)]); return "remove";
    case "front": p.bringToFront([pick(list)]); return "front";
    case "back": p.sendToBack([pick(list), pick(list)]); return "back";
    case "forward": p.bringForward([pick(list)]); return "forward";
    case "backward": p.sendBackward([pick(list)]); return "backward";
    case "paste": {
      p.copy([pick(list), pick(list)]);
      p.paste({ time: k(50, 0).time, price: 100 + r() });
      return "paste";
    }
    case "duplicate": p.select([pick(list)]); p.duplicate(); return "duplicate";
    case "lock": p.update(pick(list), { locked: r() < 0.5 }); return "lock";
    case "style": p.update(pick(list), { style: { color: "#ff0000", width: 1 + Math.floor(r() * 4) } }); return "style";
  }
  throw new Error(op);
}

describe("undo / redo inverse property", () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    it(`seed ${seed}: undo all → initial, redo all → final, each step reproduced`, () => {
      const { p, errors } = plugin();
      const r = seeded(seed);
      // a non-empty initial state
      p.add(fixture("trendLine"));
      p.add(fixture("rectangle"));
      p.fromJSON(p.toJSON()); // a loaded layout starts with an empty history
      const initial = state(p);
      const states = [initial];
      const ops: string[] = [];
      for (let i = 0; i < 40; i++) {
        ops.push(randomOp(p, r, () => p.list().map((d) => d.id)));
        states.push(state(p));
      }
      expect(errors).toEqual([]);
      const final = states[states.length - 1]!;
      // Walk back, checking every state. Ops that changed nothing (no-op reorders) leave no command.
      const seen = [final];
      while (p.canUndo) {
        p.undo();
        seen.push(state(p));
      }
      expect(seen.length).toBeGreaterThan(15);
      expect(seen[seen.length - 1]).toBe(initial);
      // every state on the way down was a state on the way up
      for (const s of seen) expect(states).toContain(s);
      const redone: string[] = [];
      while (p.canRedo) {
        p.redo();
        redone.push(state(p));
      }
      expect(redone[redone.length - 1]).toBe(final);
      expect(redone).toEqual(seen.slice().reverse().slice(1));
    });
  }

  it("a new command after undo discards the redo branch", () => {
    const { p } = plugin();
    p.add(fixture("trendLine"));
    p.add(fixture("ray"));
    p.undo();
    expect(p.canRedo).toBe(true);
    p.add(fixture("arrow"));
    expect(p.canRedo).toBe(false);
    expect(p.list().map((d) => d.tool)).toEqual(["trendLine", "arrow"]);
  });

  it("remove restores drawings at their original z positions", () => {
    const { p } = plugin();
    const ids = ["trendLine", "ray", "arrow", "rectangle"].map((t) => p.add(fixture(t)).id);
    p.remove([ids[1]!, ids[3]!]);
    expect(p.list().map((d) => d.id)).toEqual([ids[0], ids[2]]);
    p.undo();
    expect(p.list().map((d) => d.id)).toEqual(ids);
  });

  it("events: undoing an add reports removed, redoing reports created", () => {
    const { p } = plugin();
    const log: string[] = [];
    p.events.on("created", (d) => log.push("created " + d.tool));
    p.events.on("removed", (d) => log.push("removed " + d.tool));
    p.events.on("changed", (d) => log.push("changed " + d.tool));
    const d = p.add(fixture("trendLine"));
    p.update(d.id, { style: { width: 3 } });
    p.undo();
    p.undo();
    p.redo();
    expect(log).toEqual(["created trendLine", "changed trendLine", "changed trendLine", "removed trendLine", "created trendLine"]);
  });
});
