// Worker entry: `new Worker(new URL("@alphacharts/indicators/worker", import.meta.url), { type: "module" })`.
// Knows every built-in study; imports the full set because a worker is not on
// the page's critical path.

import { serveWorker } from "./runner.js";
import { ALL_STUDIES } from "./studies/all.js";

const byId = new Map(ALL_STUDIES.map((s) => [s.id, s]));
const scope = self as unknown as { postMessage(m: unknown, t?: Transferable[]): void; onmessage: ((e: { data: unknown }) => void) | null };
const handle = serveWorker((m, t) => scope.postMessage(m, t), (id) => byId.get(id));
scope.onmessage = (e) => handle(e.data);
