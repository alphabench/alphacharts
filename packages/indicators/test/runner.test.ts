// The worker protocol, exercised with an in-process worker: the same
// serveWorker handler a real Worker runs, messages delivered asynchronously.

import { describe, expect, it } from "vitest";
import { StudyEngine } from "../src/engine/study.js";
import { CancelledError, InlineRunner, WorkerRunner, serveWorker, type WorkerLike } from "../src/runner.js";
import { ALL_STUDIES } from "../src/studies/all.js";
import { randomBars } from "./support.js";

const byId = new Map(ALL_STUDIES.map((s) => [s.id, s]));
const macd = byId.get("macd")!;

function fakeWorker(): WorkerLike {
  const listeners: ((e: { data: unknown }) => void)[] = [];
  const handle = serveWorker((m) => queueMicrotask(() => listeners.forEach((l) => l({ data: m }))), (id) => byId.get(id));
  return {
    postMessage: (msg) => void setTimeout(() => handle(structuredClone(msg)), 0),
    addEventListener: (type: string, fn: never) => void (type === "message" && listeners.push(fn)),
    terminate: () => {},
  } as WorkerLike;
}

function copy(d: ReturnType<typeof randomBars>) {
  return { time: d.time.slice(), open: d.open.slice(), high: d.high.slice(), low: d.low.slice(), close: d.close.slice(), volume: d.volume.slice() };
}

describe("runners", () => {
  const d = randomBars(200_000, 5);
  const ref = new StudyEngine(macd);
  ref.load(d);

  it("worker result equals a direct batch run, and the engine can adopt it and keep streaming", async () => {
    const r = new WorkerRunner(fakeWorker(), (def) => byId.has(def.id));
    const res = await r.run(macd, { studyId: "macd", params: {}, bars: copy(d) }).promise;
    const e = new StudyEngine(macd);
    e.graph.adopt(res.buffers, res.n);
    for (let k = 0; k < 3; k++) expect(Array.from(e.column(k))).toEqual(Array.from(ref.column(k)));
    // streaming after adoption equals streaming on the original
    const bar = { time: d.time[199_999]! + 60_000, open: 100, high: 101, low: 99, close: 100.5, volume: 10 };
    e.push(bar);
    ref.push(bar);
    expect(e.column(0)[200_000]).toBe(ref.column(0)[200_000]);
  });

  it("cancel rejects with CancelledError and stops early", async () => {
    for (const r of [new WorkerRunner(fakeWorker(), () => true), new InlineRunner()]) {
      const job = r.run(macd, { studyId: "macd", params: {}, bars: copy(d) });
      setTimeout(() => job.cancel(), 1);
      await expect(job.promise).rejects.toBeInstanceOf(CancelledError);
    }
  });

  it("a worker error reaches the caller", async () => {
    const r = new WorkerRunner(fakeWorker(), () => true);
    const bogus = { ...macd, id: "does-not-exist" };
    await expect(r.run(bogus, { studyId: bogus.id, params: {}, bars: copy(d) }).promise).rejects.toThrow(/unknown study/);
  });
});
