// Sibling @alphacharts packages must be peerDependencies (with a workspace
// devDependency for development), never dependencies: a dependency installs a
// second copy of the core for a host that already has one, and a plugin
// registered on a different copy of the core fails its instanceof/registry checks.
// The only runtime sibling is @alphacharts/wasm (an implementation detail of indicators).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ALLOWED_DEPENDENCIES = new Set(["@alphacharts/wasm"]);
const bad = [];
for (const dir of readdirSync("packages")) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join("packages", dir, "package.json"), "utf8"));
  } catch {
    continue;
  }
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    if (name.startsWith("@alphacharts/") && !ALLOWED_DEPENDENCIES.has(name)) bad.push(`${pkg.name}: ${name} is in dependencies; make it a peerDependency`);
  }
  for (const name of Object.keys(pkg.peerDependencies ?? {})) {
    if (name.startsWith("@alphacharts/") && pkg.devDependencies?.[name] === undefined) bad.push(`${pkg.name}: peer ${name} has no workspace devDependency`);
    // workspace:* publishes as an exact pin; a published peer needs a real range.
    if (name.startsWith("@alphacharts/") && !pkg.private && String(pkg.peerDependencies[name]).startsWith("workspace:")) bad.push(`${pkg.name}: peer ${name} is ${pkg.peerDependencies[name]}; use a range such as ^0.1.0`);
  }
}
if (bad.length === 0) {
  // The published manifest must be the dev exports without the "development" (src) condition,
  // because src is not in the tarball.
  const strip = (v) => (v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== "development").map(([k, x]) => [k, strip(x)])) : v);
  for (const dir of readdirSync("packages")) {
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(join("packages", dir, "package.json"), "utf8"));
    } catch {
      continue;
    }
    if (pkg.private || !pkg.exports) continue;
    if (JSON.stringify(pkg.publishConfig?.exports) !== JSON.stringify(strip(pkg.exports))) bad.push(`${pkg.name}: publishConfig.exports must equal exports without the "development" condition`);
  }
}
if (bad.length) {
  console.error(bad.join("\n"));
  process.exit(1);
}
console.log("package dependencies: ok");
