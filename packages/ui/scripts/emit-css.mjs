#!/usr/bin/env node
// Writes dist/styles.css: the shell's built-in stylesheet as a plain file, exported as `@alphacharts/ui/styles.css`, for a host
// that keeps its own copy (the `stylesheet: "none"` option) and edits it like a shadcn component's source. Runs after vite build.

import { writeFileSync } from "node:fs";

const { STYLES } = await import(new URL("../dist/index.js", import.meta.url).href);
if (typeof STYLES !== "string" || STYLES.length < 1000) throw new Error("emit-css: dist/index.js exports no STYLES; run vite build first");
writeFileSync(new URL("../dist/styles.css", import.meta.url), `/* @alphacharts/ui: the shell's stylesheet. Pass your edited copy as \`styles\` with \`stylesheet: "none"\`. */\n${STYLES}`);
console.log(`wrote dist/styles.css (${STYLES.length} bytes)`);
