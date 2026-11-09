// The token layer: every colour, radius, size and font the shell's components use, as `--c-*` variables on `.app`.
//
// Each token resolves, first one set wins:
//   1. `--ac-<token>`   an override aimed at the chart only (`--ac-popover`, `--ac-radius` ...)
//   2. `--<token>`      the host's own shadcn token: custom properties inherit into the shadow root, so the shell follows the
//                       page live, with no script. Only under theme "inherit"; a named theme ("dark", "light" ...) keeps its colours.
//   3. `--t-<token>`    the theme's own value, written on `.app` by the shell (Luma light or dark, or one derived from a custom theme).
// Geometry (radius) and the font always follow the host: a theme names colours, not shapes.

import { SHADCN_TOKENS } from "@alphacharts/core";

const FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

const inherit = SHADCN_TOKENS.map((k) => `--c-${k}: var(--ac-${k}, var(--${k}, var(--t-${k})));`).join(" ");
const fixed = SHADCN_TOKENS.map((k) => `--c-${k}: var(--ac-${k}, var(--t-${k}));`).join(" ");

export const TOKENS = /* css */ `
:host { display: block; contain: layout; }
.app { ${inherit} }
.app:not([data-theme="inherit"]) { ${fixed} }
.app {
  /* shadcn's radius scale (sm .6, md .8, lg 1, xl 1.4, 2xl 1.8, 3xl 2.2, 4xl 2.6 of --radius), and the role each Luma component
     uses from it. A host restyles a whole family with one role variable, e.g. --ac-radius-control: 6px for square-ish buttons. */
  --c-radius: var(--ac-radius, var(--radius, 0.625rem));
  --c-radius-control: var(--ac-radius-control, calc(var(--c-radius) * 2.6));
  --c-radius-field: var(--ac-radius-field, calc(var(--c-radius) * 2.2));
  --c-radius-surface: var(--ac-radius-surface, calc(var(--c-radius) * 2.2));
  --c-radius-dialog: var(--ac-radius-dialog, calc(var(--c-radius) * 2.6));
  --c-radius-item: var(--ac-radius-item, calc(var(--c-radius) * 1.8));
  --c-radius-tooltip: var(--ac-radius-tooltip, calc(var(--c-radius) * 1.4));
  --c-radius-kbd: var(--ac-radius-kbd, var(--c-radius));
  --c-font: var(--ac-font-sans, var(--font-sans, ${FONT}));
  /* Control heights: Luma's h-9 / h-8 / h-6; 44px on a touch screen and in the compact layout. */
  --c-h: var(--ac-control-height, 36px);
  --c-h-sm: var(--ac-control-height-sm, 32px);
  --c-h-xs: 24px;
  --c-icon: var(--ac-icon-size, 16px);
  --c-ring-shadow: 0 0 0 3px color-mix(in oklab, var(--c-ring) 30%, transparent);
  --c-hairline: 0 0 0 1px color-mix(in oklab, var(--c-foreground) 5%, transparent);
  --c-shadow-sm: 0 1px 3px 0 rgb(0 0 0 / .1), 0 1px 2px -1px rgb(0 0 0 / .1);
  --c-shadow-lg: var(--c-hairline), 0 10px 15px -3px rgb(0 0 0 / .1), 0 4px 6px -4px rgb(0 0 0 / .1);
  --c-shadow-xl: var(--c-hairline), 0 20px 25px -5px rgb(0 0 0 / .1), 0 8px 10px -6px rgb(0 0 0 / .1);
  --c-scrim: rgb(0 0 0 / .3);
  --c-hover: var(--c-muted);
}
.app[data-mode="dark"] {
  --c-hairline: 0 0 0 1px color-mix(in oklab, var(--c-foreground) 10%, transparent);
  --c-hover: color-mix(in oklab, var(--c-muted) 50%, transparent);
}
.app[data-compact] { --c-h: 44px; --c-h-sm: 44px; }
@media (pointer: coarse) { .app { --c-h: 44px; --c-h-sm: 44px; } }
`;
