// The shell's stylesheet, in four cascade layers: tokens (every colour, radius and size, read from the host's shadcn variables),
// base (resets), components (shadcn's Luma recipes), layout (where the shell places them, and its few local adjustments). Anything a host adds through the `styles` option comes after
// the layers, so it wins without !important. The same text ships as `@alphacharts/ui/styles.css` for a host that wants its own
// copy (the `stylesheet: "none"` option): edit it like a shadcn component's source.

import { TOKENS } from "./styles/tokens.js";
import { BASE, LAYOUT } from "./styles/layout.js";
import { COMPONENTS } from "./styles/components.js";

export const STYLES = `@layer alphacharts.tokens, alphacharts.base, alphacharts.components, alphacharts.layout;
@layer alphacharts.tokens {${TOKENS}}
@layer alphacharts.base {${BASE}}
@layer alphacharts.components {${COMPONENTS}}
@layer alphacharts.layout {${LAYOUT}}
`;
