// Worker entry for user scripts. The lockdown runs first, before anything else
// in this module graph handles a script.
import { lockdown, serveScripts, type FromWorker } from "./sandbox.js";

lockdown(self);
const scope = self as unknown as { postMessage(m: unknown, t?: Transferable[]): void; onmessage: ((e: { data: unknown }) => void) | null };
const handle = serveScripts((m: FromWorker, t) => scope.postMessage(m, t));
scope.onmessage = (e) => handle(e.data);
