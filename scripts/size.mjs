// Gzip size of the built core beside lightweight-charts' production bundle.
// Reports; does not assert. Run `pnpm build` first.
import { readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, resolve } from "node:path";

const gz = (p) => gzipSync(Buffer.isBuffer(p) ? p : readFileSync(p), { level: 9 }).length;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

// index.js plus the shared chunk it imports (./internal re-exports from the same chunk, so it adds nothing).
const coreDir = "packages/core/dist";
const ours = Buffer.concat(readdirSync(coreDir).filter((f) => f.endsWith(".js") && f !== "internal.js").sort().map((f) => readFileSync(join(coreDir, f))));
// lightweight-charts exports only import/require conditions; read its dist directly.
const lwcDir = resolve("apps/playground/node_modules/lightweight-charts/dist");
const lwc = readdirSync(lwcDir).find((f) => /production\.mjs$/.test(f));
if (!lwc) throw new Error(`no production .mjs in ${lwcDir}`);

const rows = [
  { bundle: "@alphacharts/core (all built-in series)", raw: ours.length, gzip: gz(ours) },
  { bundle: `lightweight-charts 5.2.1 (${lwc})`, raw: readFileSync(join(lwcDir, lwc)).length, gzip: gz(join(lwcDir, lwc)) },
];
console.table(rows.map((r) => ({ bundle: r.bundle, raw: kb(r.raw), gzip: kb(r.gzip) })));
