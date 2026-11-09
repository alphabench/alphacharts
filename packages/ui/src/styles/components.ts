// The components: shadcn/ui's Luma recipes (radix-luma) as plain CSS, one block per component, selected by the same
// `data-slot` / `data-variant` / `data-size` / `data-state` attributes the shadcn components carry. Every element with a
// `data-slot` also has `part` of the same name, so a host restyles one component from outside: `alpha-chart-app::part(button)`.
// Colours, radii and sizes come only from the token layer (tokens.ts). Focus is shown by shadcn's ring (a box-shadow) over a
// transparent outline: invisible normally, drawn by the system in forced-colours mode, where box-shadows are not.

export const COMPONENTS = /* css */ `
/* ---- button ---------------------------------------------------------------------------------------------------------- */
[data-slot="button"], [data-slot="toggle"], [data-slot="toggle-group-item"] {
  display: inline-flex; flex-shrink: 0; align-items: center; justify-content: center; gap: 6px; white-space: nowrap;
  border: 1px solid transparent; background-clip: padding-box; border-radius: var(--c-radius-control);
  font: 500 14px/1 var(--c-font); color: var(--c-foreground); background: transparent; outline: 2px solid transparent; outline-offset: 2px; user-select: none;
  transition: background-color .15s, color .15s, box-shadow .15s, border-color .15s; text-decoration: none;
}
[data-slot="button"] svg, [data-slot="toggle"] svg, [data-slot="toggle-group-item"] svg { inline-size: var(--c-icon); block-size: var(--c-icon); flex-shrink: 0; pointer-events: none; }
[data-slot="button"]:focus-visible, [data-slot="toggle"]:focus-visible, [data-slot="toggle-group-item"]:focus-visible { border-color: var(--c-ring); box-shadow: var(--c-ring-shadow); }
[data-slot="button"]:disabled, [data-slot="toggle"]:disabled, [data-slot="toggle-group-item"]:disabled { pointer-events: none; opacity: .5; }
[data-slot="button"]:active:not([aria-haspopup]) { transform: translateY(1px); }
[data-slot="button"][aria-invalid="true"] { border-color: var(--c-destructive); }

[data-slot="button"][data-size="default"] { block-size: var(--c-h); padding-inline: 12px; }
[data-slot="button"][data-size="xs"] { block-size: var(--c-h-xs); padding-inline: 10px; gap: 4px; font-size: 12px; }
[data-slot="button"][data-size="xs"] svg { inline-size: 12px; block-size: 12px; }
[data-slot="button"][data-size="sm"] { block-size: var(--c-h-sm); padding-inline: 12px; gap: 4px; }
[data-slot="button"][data-size="lg"] { block-size: 40px; padding-inline: 16px; }
[data-slot="button"][data-size="icon"] { inline-size: var(--c-h); block-size: var(--c-h); padding: 0; }
[data-slot="button"][data-size="icon-sm"] { inline-size: var(--c-h-sm); block-size: var(--c-h-sm); padding: 0; }
[data-slot="button"][data-size="icon-xs"] { inline-size: var(--c-h-xs); block-size: var(--c-h-xs); padding: 0; }
[data-slot="button"][data-size="icon-xs"] svg { inline-size: 12px; block-size: 12px; }

[data-slot="button"][data-variant="default"] { background: var(--c-primary); color: var(--c-primary-foreground); }
[data-slot="button"][data-variant="default"]:hover { background: color-mix(in oklab, var(--c-primary) 80%, transparent); }
[data-slot="button"][data-variant="outline"] { border-color: var(--c-border); background: var(--c-background); }
[data-slot="button"][data-variant="outline"]:hover, [data-slot="button"][data-variant="outline"][aria-expanded="true"] { background: var(--c-muted); color: var(--c-foreground); }
.app[data-mode="dark"] [data-slot="button"][data-variant="outline"] { background: transparent; }
.app[data-mode="dark"] [data-slot="button"][data-variant="outline"]:hover { background: color-mix(in oklab, var(--c-input) 30%, transparent); }
[data-slot="button"][data-variant="secondary"] { background: var(--c-secondary); color: var(--c-secondary-foreground); }
[data-slot="button"][data-variant="secondary"]:hover { background: color-mix(in oklch, var(--c-secondary), var(--c-foreground) 5%); }
[data-slot="button"][data-variant="ghost"]:hover, [data-slot="button"][data-variant="ghost"][aria-expanded="true"] { background: var(--c-hover); color: var(--c-foreground); }
[data-slot="button"][data-variant="destructive"] { background: color-mix(in oklab, var(--c-destructive) 10%, transparent); color: var(--c-destructive); }
[data-slot="button"][data-variant="destructive"]:hover { background: color-mix(in oklab, var(--c-destructive) 20%, transparent); }
.app[data-mode="dark"] [data-slot="button"][data-variant="destructive"] { background: color-mix(in oklab, var(--c-destructive) 20%, transparent); }
.app[data-mode="dark"] [data-slot="button"][data-variant="destructive"]:hover { background: color-mix(in oklab, var(--c-destructive) 30%, transparent); }
[data-slot="button"][data-variant="destructive"]:focus-visible { border-color: color-mix(in oklab, var(--c-destructive) 40%, transparent); box-shadow: 0 0 0 3px color-mix(in oklab, var(--c-destructive) 20%, transparent); }
[data-slot="button"][data-variant="link"] { color: var(--c-primary); text-underline-offset: 4px; }
[data-slot="button"][data-variant="link"]:hover { text-decoration: underline; }

/* ---- toggle and toggle group -------------------------------------------------------------------------------------------- */
[data-slot="toggle"], [data-slot="toggle-group-item"] { gap: 4px; border-radius: var(--c-radius-control); }
[data-slot="toggle"]:hover, [data-slot="toggle-group-item"]:hover { background: var(--c-muted); color: var(--c-foreground); }
[data-slot="toggle"][aria-pressed="true"], [data-slot="toggle-group-item"][data-state="on"] { background: var(--c-muted); }
[data-slot="toggle"][data-variant="outline"], [data-slot="toggle-group-item"][data-variant="outline"] { border-color: var(--c-input); }
[data-slot="toggle"][data-size="default"], [data-slot="toggle-group-item"][data-size="default"] { block-size: var(--c-h); min-inline-size: var(--c-h); padding-inline: 12px; }
[data-slot="toggle"][data-size="sm"], [data-slot="toggle-group-item"][data-size="sm"] { block-size: var(--c-h-sm); min-inline-size: var(--c-h-sm); padding-inline: 12px; }
[data-slot="toggle"][data-size="icon"] { block-size: var(--c-h); inline-size: var(--c-h); padding: 0; }
[data-slot="toggle"][data-size="icon-sm"] { block-size: var(--c-h-sm); inline-size: var(--c-h-sm); padding: 0; }
[data-slot="toggle-group"] { display: flex; inline-size: fit-content; align-items: center; gap: 2px; }
[data-slot="toggle-group"][data-orientation="vertical"] { flex-direction: column; align-items: stretch; }

/* ---- separator, badge, kbd ---------------------------------------------------------------------------------------------- */
[data-slot="separator"] { flex-shrink: 0; background: var(--c-border); border: 0; margin: 0; }
[data-slot="separator"][data-orientation="horizontal"] { block-size: 1px; inline-size: 100%; }
[data-slot="separator"][data-orientation="vertical"] { inline-size: 1px; align-self: stretch; }
[data-slot="badge"] {
  display: inline-flex; block-size: 20px; inline-size: fit-content; flex-shrink: 0; align-items: center; justify-content: center; gap: 4px;
  overflow: hidden; white-space: nowrap; border: 1px solid transparent; border-radius: var(--c-radius-field); padding: 2px 8px;
  font: 500 12px/1 var(--c-font);
}
[data-slot="badge"] svg { inline-size: 12px; block-size: 12px; }
[data-slot="badge"][data-variant="default"] { background: var(--c-primary); color: var(--c-primary-foreground); }
[data-slot="badge"][data-variant="secondary"] { background: var(--c-secondary); color: var(--c-secondary-foreground); }
[data-slot="badge"][data-variant="destructive"] { background: color-mix(in oklab, var(--c-destructive) 10%, transparent); color: var(--c-destructive); }
.app[data-mode="dark"] [data-slot="badge"][data-variant="destructive"] { background: color-mix(in oklab, var(--c-destructive) 20%, transparent); }
[data-slot="badge"][data-variant="outline"] { border-color: var(--c-border); color: var(--c-foreground); }
[data-slot="kbd"] {
  pointer-events: none; display: inline-flex; block-size: 22px; inline-size: fit-content; min-inline-size: 22px; align-items: center; justify-content: center;
  gap: 4px; border-radius: var(--c-radius-kbd); background: var(--c-muted); padding-inline: 6px; font: 500 12px/1 var(--c-font); color: var(--c-muted-foreground); user-select: none;
}
[data-slot="tooltip-content"] [data-slot="kbd"] { background: color-mix(in oklab, var(--c-background) 20%, transparent); color: var(--c-background); }
.app[data-mode="dark"] [data-slot="tooltip-content"] [data-slot="kbd"] { background: color-mix(in oklab, var(--c-background) 10%, transparent); }

/* ---- tooltip ------------------------------------------------------------------------------------------------------------ */
[data-slot="tooltip-content"] {
  position: absolute; z-index: 60; display: inline-flex; inline-size: max-content; max-inline-size: 320px; align-items: center; gap: 6px;
  border-radius: var(--c-radius-tooltip); background: var(--c-foreground); color: var(--c-background); padding: 6px 12px;
  font: 400 12px/1.35 var(--c-font); pointer-events: none; animation: ac-zoom-in .1s ease-out;
}
[data-slot="tooltip-content"]:has([data-slot="kbd"]) { padding-inline-end: 6px; }

/* ---- surfaces: popover, dropdown menu, select content ------------------------------------------------------------------- */
[data-slot="popover-content"], [data-slot="dropdown-menu-content"], [data-slot="select-content"] {
  position: absolute; z-index: 50; overflow-x: hidden; overflow-y: auto; max-block-size: 70%;
  border-radius: var(--c-radius-surface); background: var(--c-popover); color: var(--c-popover-foreground); box-shadow: var(--c-shadow-lg);
  animation: ac-zoom-in .1s ease-out; outline: 2px solid transparent; outline-offset: 2px;
}
[data-slot="popover-content"] { inline-size: 288px; display: flex; flex-direction: column; gap: 16px; padding: 16px; font-size: 14px; }
[data-slot="dropdown-menu-content"] { min-inline-size: 192px; padding: 6px; }
[data-slot="select-content"] { min-inline-size: 144px; padding: 6px; }
[data-slot="dropdown-menu-group"], [data-slot="select-group"] { display: flex; flex-direction: column; }
[data-slot="dropdown-menu-item"], [data-slot="dropdown-menu-checkbox-item"], [data-slot="select-item"] {
  position: relative; display: flex; inline-size: 100%; cursor: default; align-items: center; gap: 10px; border: 0; background: none;
  border-radius: var(--c-radius-item); padding: 8px 12px; font: 500 14px/1.25 var(--c-font); color: inherit; text-align: start; outline: 2px solid transparent; outline-offset: 2px; user-select: none;
}
[data-slot="dropdown-menu-checkbox-item"], [data-slot="select-item"] { padding-inline-end: 32px; }
[data-slot="dropdown-menu-item"] svg, [data-slot="dropdown-menu-checkbox-item"] svg, [data-slot="select-item"] svg { inline-size: var(--c-icon); block-size: var(--c-icon); flex-shrink: 0; pointer-events: none; }
[data-slot="dropdown-menu-item"]:is(:hover, :focus), [data-slot="dropdown-menu-checkbox-item"]:is(:hover, :focus), [data-slot="select-item"]:is(:hover, :focus) { background: var(--c-accent); color: var(--c-accent-foreground); }
[data-slot="dropdown-menu-item"][data-variant="destructive"] { color: var(--c-destructive); }
[data-slot="dropdown-menu-item"][data-variant="destructive"]:is(:hover, :focus) { background: color-mix(in oklab, var(--c-destructive) 10%, transparent); color: var(--c-destructive); }
.app[data-mode="dark"] [data-slot="dropdown-menu-item"][data-variant="destructive"]:is(:hover, :focus) { background: color-mix(in oklab, var(--c-destructive) 20%, transparent); }
:is([data-slot="dropdown-menu-item"], [data-slot="dropdown-menu-checkbox-item"], [data-slot="select-item"])[aria-disabled="true"] { pointer-events: none; opacity: .5; }
[data-slot="dropdown-menu-item-indicator"], [data-slot="select-item-indicator"] { position: absolute; inset-inline-end: 12px; display: flex; align-items: center; justify-content: center; }
[data-slot="dropdown-menu-label"], [data-slot="select-label"] { padding: 10px 12px; font: 400 12px/1.2 var(--c-font); color: var(--c-muted-foreground); }
[data-slot="dropdown-menu-separator"] { margin: 6px -6px; block-size: 1px; background: color-mix(in oklab, var(--c-border) 50%, transparent); }
[data-slot="dropdown-menu-shortcut"] { margin-inline-start: auto; font: 400 12px/1 var(--c-font); letter-spacing: .1em; color: var(--c-muted-foreground); }
[data-slot="dropdown-menu-item"]:is(:hover, :focus) [data-slot="dropdown-menu-shortcut"] { color: var(--c-accent-foreground); }

/* ---- dialog, sheet ------------------------------------------------------------------------------------------------------ */
[data-slot="dialog-overlay"] {
  position: absolute; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center; padding: 16px;
  background: var(--c-scrim); -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px); animation: ac-fade-in .1s ease-out;
}
[data-slot="dialog-content"] {
  display: flex; flex-direction: column; gap: 24px; inline-size: min(448px, 100%); max-block-size: 100%; padding: 24px;
  border-radius: var(--c-radius-dialog); background: var(--c-popover); color: var(--c-popover-foreground); box-shadow: var(--c-shadow-xl);
  font-size: 14px; outline: 2px solid transparent; outline-offset: 2px; animation: ac-zoom-in .1s ease-out;
}
[data-slot="dialog-content"][data-size="wide"] { inline-size: min(760px, 100%); }
[data-slot="dialog-header"] { display: flex; align-items: flex-start; gap: 12px; }
[data-slot="dialog-heading"] { display: flex; flex: 1; flex-direction: column; gap: 6px; min-inline-size: 0; }
[data-slot="dialog-title"] { margin: 0; font: 500 16px/1 var(--c-font); }
[data-slot="dialog-description"] { margin: 0; font-size: 14px; color: var(--c-muted-foreground); }
[data-slot="dialog-header"] .dialog-close { margin-block: -8px; margin-inline-end: -8px; background: var(--c-secondary); }
[data-slot="dialog-body"]:empty { display: none; }
[data-slot="dialog-body"] { display: flex; flex-direction: column; gap: 16px; overflow: auto; flex: 1; min-block-size: 0; margin-inline: -24px; padding-inline: 24px; }
[data-slot="dialog-footer"] { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
/* The compact layout shows dialogs as a bottom drawer: Luma's Drawer, inset with a handle. */
.app[data-compact] [data-slot="dialog-overlay"] { align-items: flex-end; padding: 8px; }
.app[data-compact] [data-slot="dialog-content"] { inline-size: 100%; max-block-size: 88%; padding: 16px; animation: ac-slide-up .2s ease-out; }
.app[data-compact] [data-slot="dialog-content"]::before { content: ""; align-self: center; inline-size: 100px; block-size: 6px; border-radius: 9999px; background: var(--c-muted); margin-block-end: -8px; }

/* ---- command ------------------------------------------------------------------------------------------------------------ */
[data-slot="dialog-content"][data-command] { padding: 0; gap: 0; overflow: hidden; align-self: flex-start; margin-block-start: 12vh; }
[data-slot="dialog-content"][data-command] > [data-slot="dialog-header"] { padding: 16px 16px 4px 20px; }
[data-slot="dialog-content"][data-command] > [data-slot="dialog-body"] { margin: 0; padding: 4px; gap: 0; }
[data-slot="command"] { display: flex; flex-direction: column; min-block-size: 0; background: var(--c-popover); color: var(--c-popover-foreground); }
[data-slot="command-input-wrapper"] { padding: 4px 4px 0; }
[data-slot="command-list"] { max-block-size: 320px; overflow-x: hidden; overflow-y: auto; scroll-padding-block: 4px; outline: 2px solid transparent; outline-offset: 2px; scrollbar-width: none; margin: 0; padding: 0; list-style: none; }
[data-slot="command-empty"] { padding-block: 24px; text-align: center; font-size: 14px; color: var(--c-muted-foreground); }
[data-slot="command-group"] { overflow: hidden; padding: 6px; color: var(--c-foreground); margin: 0; list-style: none; }
[data-slot="command-group-heading"] { padding: 8px 12px; font: 500 12px/1.2 var(--c-font); color: var(--c-muted-foreground); }
[data-slot="command-group-heading"]::first-letter { text-transform: uppercase; }
[data-slot="command-separator"] { margin-block: 6px; block-size: 1px; background: color-mix(in oklab, var(--c-border) 50%, transparent); }
[data-slot="command-row"] { display: flex; align-items: center; gap: 2px; }
[data-slot="command-item"] {
  position: relative; display: flex; flex: 1; min-inline-size: 0; cursor: default; align-items: center; gap: 8px; border: 0; background: none; color: inherit;
  border-radius: var(--c-radius-item); padding: 8px 12px; font: 500 14px/1.25 var(--c-font); text-align: start; outline: 2px solid transparent; outline-offset: 2px; user-select: none;
}
[data-slot="dialog-content"] [data-slot="command-item"] { border-radius: var(--c-radius-field); }
[data-slot="command-item"] svg { inline-size: var(--c-icon); block-size: var(--c-icon); flex-shrink: 0; }
[data-slot="command-item"]:is([data-selected], :hover, :focus-visible) { background: var(--c-muted); color: var(--c-foreground); }
[data-slot="command-item"][aria-disabled="true"] { pointer-events: none; opacity: .5; }
[data-slot="command-item"] [data-slot="command-check"] { margin-inline-start: auto; }
[data-slot="command-shortcut"] { margin-inline-start: auto; font: 400 12px/1 var(--c-font); letter-spacing: .1em; color: var(--c-muted-foreground); white-space: nowrap; }
[data-slot="command-shortcut"] + [data-slot="command-check"] { margin-inline-start: 8px; }
[data-slot="command-item"][data-selected] [data-slot="command-shortcut"] { color: var(--c-foreground); }
[data-slot="command-value"] { min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-slot="command-description"] { flex: 1; min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 400; color: var(--c-muted-foreground); }

/* ---- input, input group, textarea --------------------------------------------------------------------------------------- */
[data-slot="input"], [data-slot="textarea"] {
  inline-size: 100%; min-inline-size: 0; border: 1px solid transparent; background: color-mix(in oklab, var(--c-input) 50%, transparent);
  border-radius: var(--c-radius-field); font: 400 14px/1.4 var(--c-font); color: var(--c-foreground); outline: 2px solid transparent; outline-offset: 2px;
  transition: color .15s, box-shadow .15s, background-color .15s;
}
[data-slot="input"] { block-size: var(--c-h); padding: 4px 12px; }
[data-slot="textarea"] { min-block-size: 64px; padding: 12px; resize: vertical; border-radius: calc(var(--c-radius) * 1.8); }
:is([data-slot="input"], [data-slot="textarea"])::placeholder { color: var(--c-muted-foreground); }
:is([data-slot="input"], [data-slot="textarea"]):focus-visible { border-color: var(--c-ring); box-shadow: var(--c-ring-shadow); }
:is([data-slot="input"], [data-slot="textarea"]):disabled { pointer-events: none; cursor: not-allowed; opacity: .5; }
:is([data-slot="input"], [data-slot="textarea"])[aria-invalid="true"] { border-color: var(--c-destructive); box-shadow: 0 0 0 3px color-mix(in oklab, var(--c-destructive) 20%, transparent); }
[data-slot="input-group"] {
  position: relative; display: flex; block-size: var(--c-h); inline-size: 100%; min-inline-size: 0; align-items: center;
  border: 1px solid transparent; background: color-mix(in oklab, var(--c-input) 50%, transparent); border-radius: var(--c-radius-dialog);
  transition: color .15s, box-shadow .15s, background-color .15s;
}
[data-slot="input-group"]:has([data-slot="input-group-control"]:focus-visible) { border-color: var(--c-ring); box-shadow: var(--c-ring-shadow); }
[data-slot="input-group-addon"] { display: flex; align-items: center; gap: 8px; padding-inline: 12px 0; color: var(--c-muted-foreground); }
[data-slot="input-group-addon"] svg { inline-size: var(--c-icon); block-size: var(--c-icon); }
[data-slot="input-group-control"] { flex: 1; min-inline-size: 0; block-size: 100%; border: 0; background: transparent; padding-inline: 6px 12px; font: 400 14px/1.4 var(--c-font); color: var(--c-foreground); outline: 2px solid transparent; outline-offset: 2px; }
[data-slot="input-group-control"]::placeholder { color: var(--c-muted-foreground); }
[data-slot="input-group-control"]::-webkit-search-cancel-button { appearance: none; }
input[type="color"][data-slot="color"] { inline-size: 44px; block-size: var(--c-h); padding: 4px; border: 0; border-radius: var(--c-radius-field); background: color-mix(in oklab, var(--c-input) 50%, transparent); cursor: pointer; }
input[type="color"][data-slot="color"]::-webkit-color-swatch-wrapper { padding: 0; }
input[type="color"][data-slot="color"]::-webkit-color-swatch { border: 0; border-radius: calc(var(--c-radius-field) - 4px); }
input[type="range"][data-slot="slider"] { flex: 1; accent-color: var(--c-primary); }

/* ---- select ------------------------------------------------------------------------------------------------------------- */
[data-slot="select-trigger"] {
  display: flex; inline-size: 100%; align-items: center; justify-content: space-between; gap: 6px; white-space: nowrap;
  border: 1px solid transparent; background: color-mix(in oklab, var(--c-input) 50%, transparent); border-radius: var(--c-radius-field);
  block-size: var(--c-h); padding: 8px 12px; font: 400 14px/1 var(--c-font); color: var(--c-foreground); outline: 2px solid transparent; outline-offset: 2px; text-align: start;
  transition: color .15s, box-shadow .15s, background-color .15s;
}
[data-slot="select-trigger"][data-size="sm"] { block-size: var(--c-h-sm); }
[data-slot="select-trigger"]:focus-visible { border-color: var(--c-ring); box-shadow: var(--c-ring-shadow); }
[data-slot="select-trigger"]:disabled { cursor: not-allowed; opacity: .5; }
[data-slot="select-trigger"] svg { inline-size: var(--c-icon); block-size: var(--c-icon); flex-shrink: 0; color: var(--c-muted-foreground); pointer-events: none; }
[data-slot="select-value"] { overflow: hidden; text-overflow: ellipsis; }

/* ---- checkbox, switch --------------------------------------------------------------------------------------------------- */
[data-slot="checkbox"] {
  position: relative; display: inline-flex; inline-size: 16px; block-size: 16px; flex-shrink: 0; align-items: center; justify-content: center;
  border: 1px solid transparent; border-radius: min(5px, var(--c-radius)); background: color-mix(in oklab, var(--c-input) 90%, transparent);
  color: var(--c-primary-foreground); transition: box-shadow .15s;
}
[data-slot="checkbox"] > input { position: absolute; inset: -8px -12px; inline-size: calc(100% + 24px); block-size: calc(100% + 16px); margin: 0; opacity: 0; cursor: pointer; }
[data-slot="checkbox"] > svg { inline-size: 14px; block-size: 14px; opacity: 0; pointer-events: none; }
[data-slot="checkbox"]:has(input:checked) { border-color: var(--c-primary); background: var(--c-primary); }
[data-slot="checkbox"]:has(input:checked) > svg { opacity: 1; }
[data-slot="checkbox"]:has(input:focus-visible) { border-color: var(--c-ring); box-shadow: var(--c-ring-shadow); }
[data-slot="checkbox"]:has(input:disabled) { opacity: .5; }
[data-slot="switch"] {
  position: relative; display: inline-flex; inline-size: 44px; block-size: 20px; flex-shrink: 0; align-items: center; border: 2px solid transparent;
  border-radius: 9999px; background: color-mix(in oklab, var(--c-input) 90%, transparent); transition: background-color .15s, box-shadow .15s;
}
[data-slot="switch"] > input { position: absolute; inset: -8px -12px; inline-size: calc(100% + 24px); block-size: calc(100% + 16px); margin: 0; opacity: 0; cursor: pointer; }
[data-slot="switch-thumb"] { display: block; inline-size: 24px; block-size: 16px; border-radius: 9999px; background: var(--c-background); box-shadow: var(--c-shadow-sm); transition: transform .15s; pointer-events: none; }
.app[data-mode="dark"] [data-slot="switch-thumb"] { background: var(--c-foreground); }
[data-slot="switch"]:has(input:checked) { border-color: var(--c-primary); background: var(--c-primary); }
[data-slot="switch"]:has(input:checked) [data-slot="switch-thumb"] { transform: translateX(calc(100% - 8px)); }
[dir="rtl"] [data-slot="switch"]:has(input:checked) [data-slot="switch-thumb"] { transform: translateX(calc(-100% + 8px)); }
.app[data-mode="dark"] [data-slot="switch"]:has(input:checked) [data-slot="switch-thumb"] { background: var(--c-primary-foreground); }
[data-slot="switch"]:has(input:focus-visible) { border-color: var(--c-ring); box-shadow: var(--c-ring-shadow); }
[data-slot="switch"]:has(input:disabled) { opacity: .5; }

/* ---- field -------------------------------------------------------------------------------------------------------------- */
[data-slot="field-group"] { display: flex; inline-size: 100%; flex-direction: column; gap: 20px; }
[data-slot="field-set"] { display: flex; flex-direction: column; gap: 16px; border: 0; margin: 0; padding: 0; min-inline-size: 0; }
[data-slot="field-legend"] { margin-block-end: 12px; padding: 0; font: 500 14px/1.3 var(--c-font); }
[data-slot="field"] { display: flex; inline-size: 100%; flex-direction: column; gap: 10px; }
[data-slot="field"][data-orientation="horizontal"] { flex-direction: row; align-items: center; gap: 12px; }
[data-slot="field"][data-orientation="horizontal"] > [data-slot="field-label"] { flex: 1; }
[data-slot="field"][data-invalid="true"] { color: var(--c-destructive); }
[data-slot="field-label"] { display: flex; inline-size: fit-content; align-items: center; gap: 8px; font: 500 14px/1.25 var(--c-font); user-select: none; }
[data-slot="field"][data-disabled="true"] > [data-slot="field-label"] { opacity: .5; }
[data-slot="field-description"] { margin: 0; font: 400 14px/1.45 var(--c-font); color: var(--c-muted-foreground); }
[data-slot="field-error"] { margin: 0; font: 400 14px/1.45 var(--c-font); color: var(--c-destructive); }
[data-slot="field-row"] { display: flex; align-items: center; gap: 10px; }

/* ---- tabs --------------------------------------------------------------------------------------------------------------- */
[data-slot="tabs"] { display: flex; flex-direction: column; gap: 16px; }
[data-slot="tabs-list"] {
  display: inline-flex; inline-size: fit-content; max-inline-size: 100%; align-items: center; block-size: var(--c-h); padding: 4px; gap: 0;
  border-radius: 9999px; background: var(--c-muted); color: var(--c-muted-foreground); overflow-x: auto; scrollbar-width: none;
}
[data-slot="tabs-trigger"] {
  position: relative; display: inline-flex; block-size: calc(100% - 1px); flex: 1; align-items: center; justify-content: center; gap: 8px;
  border: 1px solid transparent; border-radius: 9999px; background: none; padding: 4px 12px; white-space: nowrap; outline: 2px solid transparent; outline-offset: 2px;
  font: 500 14px/1 var(--c-font); color: color-mix(in oklab, var(--c-foreground) 60%, transparent); transition: all .15s;
}
.app[data-mode="dark"] [data-slot="tabs-trigger"] { color: var(--c-muted-foreground); }
[data-slot="tabs-trigger"]:hover { color: var(--c-foreground); }
[data-slot="tabs-trigger"][aria-selected="true"] { background: var(--c-background); color: var(--c-foreground); box-shadow: var(--c-shadow-sm); }
.app[data-mode="dark"] [data-slot="tabs-trigger"][aria-selected="true"] { border-color: var(--c-input); background: color-mix(in oklab, var(--c-input) 30%, transparent); }
[data-slot="tabs-trigger"]:focus-visible { border-color: var(--c-ring); box-shadow: 0 0 0 3px color-mix(in oklab, var(--c-ring) 50%, transparent); }
[data-slot="tabs"][data-orientation="vertical"] { flex-direction: row; }
[data-slot="tabs-list"][data-orientation="vertical"] { flex-direction: column; block-size: fit-content; align-items: stretch; border-radius: var(--c-radius-item); }
[data-slot="tabs-list"][data-orientation="vertical"] [data-slot="tabs-trigger"] { justify-content: flex-start; inline-size: 100%; border-radius: var(--c-radius-item); padding: 6px 12px; flex: none; block-size: auto; min-block-size: var(--c-h-sm); }
[data-slot="tabs-content"] { flex: 1; min-inline-size: 0; font-size: 14px; outline: 2px solid transparent; outline-offset: 2px; }

/* ---- toast (Sonner's anatomy) ------------------------------------------------------------------------------------------- */
[data-slot="toaster"] { position: absolute; inset-block-end: 16px; inset-inline-end: 16px; z-index: 70; display: flex; flex-direction: column; gap: 8px; inline-size: min(356px, calc(100% - 32px)); margin: 0; padding: 0; list-style: none; }
[data-slot="toast"] {
  display: flex; align-items: center; gap: 6px; padding: 16px; border: 1px solid var(--c-border); border-radius: var(--c-radius);
  background: var(--c-popover); color: var(--c-popover-foreground); box-shadow: 0 4px 12px rgb(0 0 0 / .1); font: 400 13px/1.45 var(--c-font);
  animation: ac-slide-up .2s ease-out;
}
[data-slot="toast"] > svg { inline-size: 16px; block-size: 16px; flex-shrink: 0; }
[data-slot="toast"][data-type="error"] > svg { color: var(--c-destructive); }
[data-slot="toast-title"] { flex: 1; min-inline-size: 0; font-weight: 500; }
[data-slot="toast"] [data-slot="button"] { margin-block: -8px; margin-inline-end: -8px; }
.app[data-compact] [data-slot="toaster"] { inset-block-end: 68px; inset-inline: 16px; inline-size: auto; }

@keyframes ac-fade-in { from { opacity: 0; } }
@keyframes ac-zoom-in { from { opacity: 0; transform: scale(.95); } }
@keyframes ac-slide-up { from { opacity: 0; transform: translateY(16px); } }
@media (prefers-reduced-motion: reduce) { .app * { animation: none !important; transition: none !important; } }
`;
