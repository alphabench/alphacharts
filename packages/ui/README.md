# @alphacharts/ui

The full charting UI as a web component: toolbar, drawing bar, legends, indicator and symbol pickers, settings, alerts,
layouts. Preact inside a shadow root; works with any framework or none. Private (unpublished) for now.

```ts
import { createChartApp } from "@alphacharts/ui";
const app = createChartApp(el, { datafeed, symbol: "ACME", interval: "5m" });
```

## Look and theme

The shell is built like shadcn/ui's components, in the Luma style, and follows the page's shadcn variables by default
(`theme: "inherit"`); see **Theming** in the repository README for the variables and their precedence.

Inside the shadow root the stylesheet works on resolved tokens, `--c-<token>` (`--c-popover`, `--c-muted`,
`--c-radius-control` …), each the `--ac-<token>` override, else (under "inherit") the host's `--<token>`, else the
theme's own value. CSS you add through `styles` can use them.

| Option | |
|---|---|
| `theme` | `"inherit"` (default), `"dark"`, `"light"`, `"high-contrast"`, `"auto"`, or a `Partial<Theme>` |
| `styles` | CSS (a string or an array) added after the built-in sheet, inside the shadow root |
| `stylesheet` | `"default"`, or `"none"` to drop the built-in sheet and ship your copy of `@alphacharts/ui/styles.css` in `styles` |
| `icons` | any icon by name: an SVG path `d`, or Lucide-style nodes on a 24 grid |

### Components and their slots

Every element carries `data-slot` (and `part` of the same name), plus `data-variant`, `data-size` and `data-state`
where shadcn's component has them:

| Slot | What |
|---|---|
| `button` | variants `default` `outline` `secondary` `ghost` `destructive` `link`; sizes `default` `xs` `sm` `lg` `icon` `icon-xs` `icon-sm` |
| `toggle`, `toggle-group`, `toggle-group-item` | pressed state is `aria-pressed` / `data-state="on"` |
| `dropdown-menu-content`, `-group`, `-label`, `-item`, `-checkbox-item`, `-separator`, `-shortcut` | every menu |
| `dialog-overlay`, `dialog-content`, `-header`, `-title`, `-description`, `-body`, `-footer` | every dialog; a bottom drawer in the compact layout |
| `command`, `command-input-wrapper`, `command-list`, `command-group`, `command-group-heading`, `command-item`, `command-shortcut`, `command-empty` | symbol search, interval list, indicator picker |
| `tabs`, `tabs-list`, `tabs-trigger`, `tabs-content` | |
| `field-group`, `field-set`, `field-legend`, `field`, `field-label`, `field-description`, `field-error` | forms |
| `input`, `textarea`, `input-group`, `select-trigger`, `select-content`, `select-item`, `checkbox`, `switch` | controls |
| `item-group`, `item`, `item-content`, `item-title`, `item-description`, `item-actions` | lists in dialogs |
| `tooltip-content`, `kbd`, `badge`, `separator`, `toaster`, `toast` | |

```css
/* from the page */
alpha-chart-app::part(tooltip-content) { font-size: 13px; }
alpha-chart-app { --ac-radius-control: 6px; }   /* square-ish buttons and toggles, Luma otherwise */
```

## Icons

Lucide icons are generated into `src/ui/icons.generated.ts` (`pnpm gen:icons`); the drawing tools Lucide has no
picture of are ours, one per tool, in `src/ui/icons.tsx`. A tool's icon is named after the tool (`trendLine`,
`fibRetracement`, `longPosition` …), so `icons: { longPosition: myPath }` replaces exactly that one.
