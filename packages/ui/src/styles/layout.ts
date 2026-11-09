// The shell's own layout: where the toolbar, drawing bar, grid of charts, legends and lists sit. The components inside them are
// styled by components.ts. Logical properties only, so one sheet serves LTR and RTL.

export const BASE = /* css */ `
.mount, .app { block-size: 100%; inline-size: 100%; }
.app {
  position: relative; display: flex; flex-direction: column; overflow: hidden;
  background: var(--c-background); color: var(--c-foreground); font: 400 14px/1.4 var(--c-font); font-variant-numeric: tabular-nums;
  -webkit-font-smoothing: antialiased;
}
*, *::before, *::after { box-sizing: border-box; }
button, input, select, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }
h2, h3, p { margin: 0; }
.sr-only { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.muted { color: var(--c-muted-foreground); } .grow { flex: 1; }
[dir="rtl"] svg.dir { transform: scaleX(-1); }
:focus-visible { outline: 2px solid var(--c-ring); outline-offset: 2px; }
`;

export const LAYOUT = /* css */ `
/* ---- toolbar ------------------------------------------------------------------------------------------------------------ */
.toolbar { display: flex; align-items: center; gap: 2px; padding: 6px 8px; border-block-end: 1px solid var(--c-border); background: var(--c-background); overflow-x: auto; scrollbar-width: none; }
.toolbar > [data-slot="separator"] { block-size: 20px; align-self: center; margin-inline: 6px; }
.symbol-btn { font-weight: 600; }
.symbol-name.static { font-weight: 600; padding-inline: 12px; }
.app[data-compact] .hide-compact { display: none; }
.bottombar { display: flex; justify-content: space-around; border-block-start: 1px solid var(--c-border); padding: 4px; background: var(--c-background); }

/* ---- body, grid, legend ------------------------------------------------------------------------------------------------- */
.body { flex: 1; display: flex; min-block-size: 0; }
.stage { flex: 1; min-inline-size: 0; display: flex; flex-direction: column; position: relative; }
.grid { flex: 1; display: grid; gap: 1px; background: var(--c-border); position: relative; min-block-size: 0; }
.cell { position: relative; min-inline-size: 0; min-block-size: 0; }
.cell-overlay { position: absolute; inset: 0; z-index: 2; pointer-events: none; }
.cell.active .cell-overlay { box-shadow: inset 0 0 0 1px var(--c-ring); }
.legend-root { position: absolute; inset-block-start: 6px; inset-inline-start: 8px; inset-inline-end: 72px; }
.legend { display: flex; flex-direction: column; gap: 2px; font-size: 12px; line-height: 1.35; text-shadow: 0 0 3px var(--c-background), 0 0 3px var(--c-background); }
.legend-line { pointer-events: auto; inline-size: max-content; max-inline-size: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 2px 10px; min-block-size: 20px; }
.legend-symbol { font-weight: 500; color: var(--c-foreground); }
.legend .ohlc { display: inline-flex; gap: 8px; }
.legend abbr { text-decoration: none; color: var(--c-muted-foreground); margin-inline-end: 2px; }
.up { color: var(--c-chart-up); } .down { color: var(--c-chart-down); }
.study.off { opacity: .55; } .study-name { color: var(--c-muted-foreground); }
.legend-actions { display: none; pointer-events: auto; gap: 2px; } .legend-line:hover .legend-actions, .legend-line:focus-within .legend-actions { display: inline-flex; }
@media (hover: none) { .legend-actions { display: inline-flex; } }
.legend :is([data-slot="button"], [data-slot="toggle"]):not(:hover) { text-shadow: none; background: color-mix(in oklab, var(--c-background) 70%, transparent); }
.app[data-compact] .legend [data-slot="button"] { inline-size: 44px; block-size: 44px; }
.status-box { pointer-events: auto; display: flex; gap: 8px; align-items: center; padding: 6px 6px 6px 12px; padding-inline: 12px 6px; background: var(--c-card); color: var(--c-card-foreground); border-radius: var(--c-radius-surface); box-shadow: var(--c-shadow-lg); inline-size: max-content; max-inline-size: 100%; font-size: 13px; }
.status-box .error-text { color: var(--c-destructive); }

/* ---- drawing bar -------------------------------------------------------------------------------------------------------- */
.drawingbar { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 6px; inline-size: 52px; border-inline-end: 1px solid var(--c-border); overflow-y: auto; scrollbar-width: none; }
.drawingbar > [data-slot="separator"] { inline-size: 24px; margin-block: 6px; }
.split-btn { position: relative; }
[data-slot="toggle"]:has(.btn-text) { position: relative; }
.btn-text { position: absolute; inset-block-end: 3px; inset-inline-end: 4px; font: 600 9px/1 var(--c-font); }
/* The flyout of a tool group: a corner mark on the group's button, as design tools draw it; the whole corner is the hit area. */
.flyout-btn {
  position: absolute; inset-block-end: 0; inset-inline-end: 0; inline-size: 14px; block-size: 14px; padding: 0; border: 0; background: none;
  color: var(--c-muted-foreground); opacity: .7; border-radius: 0 0 var(--c-radius-control) 0;
}
.flyout-btn::after { content: ""; position: absolute; inset-block-end: 4px; inset-inline-end: 4px; border-style: solid; border-width: 0 0 5px 5px; border-color: transparent transparent currentColor transparent; }
[dir="rtl"] .flyout-btn::after { border-width: 0 5px 5px 0; border-color: transparent currentColor currentColor transparent; border-inline-start-color: transparent; }
.split-btn:hover .flyout-btn, .flyout-btn:focus-visible, .flyout-btn[aria-expanded="true"] { opacity: 1; color: var(--c-foreground); }
.flyout-btn:focus-visible { box-shadow: var(--c-ring-shadow); border-radius: 4px; }
.flyout-btn:disabled { opacity: .3; }
.flyout { min-inline-size: 248px; }
.tool-list { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; }
.tool-row { display: flex; align-items: center; gap: 2px; list-style: none; }
.tool-row > [data-slot="dropdown-menu-item"] { flex: 1; min-inline-size: 0; }
.tool-row > [data-slot="dropdown-menu-item"][aria-pressed="true"] { background: var(--c-muted); }
.tool-row .star { color: var(--c-muted-foreground); }
.tool-row .star:has(svg[fill="currentColor"]), .star-on { color: var(--c-foreground); }

/* ---- lists inside dialogs: shadcn's Item ------------------------------------------------------------------------------- */
[data-slot="item-group"] { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
[data-slot="item"] { display: flex; align-items: center; gap: 4px; border-radius: var(--c-radius-item); min-block-size: var(--c-h); }
[data-slot="item"]:hover { background: var(--c-hover); }
[data-slot="item-content"] { display: flex; flex: 1; min-inline-size: 0; align-items: center; gap: 12px; padding: 6px 12px; border: 0; background: none; color: inherit; text-align: start; font: 500 14px/1.3 var(--c-font); border-radius: var(--c-radius-item); outline: none; }
button[data-slot="item-content"]:focus-visible { box-shadow: var(--c-ring-shadow); }
[data-slot="item-title"] { min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-slot="item-description"] { margin-inline-start: auto; font-weight: 400; font-size: 13px; color: var(--c-muted-foreground); white-space: nowrap; }
[data-slot="item-actions"] { display: flex; align-items: center; gap: 2px; padding-inline-end: 2px; }
.section-title { font: 500 14px/1.3 var(--c-font); }
.command-note { padding: 8px 16px 0; font-size: 12px; color: var(--c-muted-foreground); }
.command-note:empty { display: none; }
.command-extra { padding: 8px 12px 0; }
.dialog-form, .form { display: flex; flex-direction: column; gap: 20px; }
.self-start { align-self: flex-start; }
.error-text { color: var(--c-destructive); font-size: 14px; }

/* ---- dialogs' insides --------------------------------------------------------------------------------------------------- */
.split { display: flex; gap: 16px; min-block-size: 0; }
.split > [data-slot="tabs-list"] { inline-size: 168px; flex: none; max-block-size: 360px; overflow-y: auto; }
.list-col { flex: 1; min-inline-size: 0; display: flex; flex-direction: column; gap: 8px; }
.app[data-compact] .split { flex-direction: column; }
.app[data-compact] .split > [data-slot="tabs-list"] { inline-size: auto; flex-direction: row; max-inline-size: 100%; overflow-x: auto; }
.check-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 10px 12px; }
.keyrow { display: grid; grid-template-columns: 1fr 1.4fr; gap: 8px; align-items: center; font-size: 13px; }
.custom-interval { display: flex; flex-direction: column; gap: 12px; padding: 12px 12px 8px; border-block-start: 1px solid color-mix(in oklab, var(--c-border) 50%, transparent); }
.custom-interval [data-slot="field-row"] { align-items: flex-start; }
.custom-interval [data-slot="field-row"] > [data-slot="field"] { flex: 1; }
.custom-interval [data-slot="field-row"] > [data-slot="button"] { margin-block-start: 28px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
.analyses, .assistant, .my-scripts { display: flex; flex-direction: column; gap: 8px; }
.analyses-list, .assistant-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.assistant-form { display: flex; gap: 8px; }
.assistant-code { margin: 0; max-block-size: 220px; overflow: auto; border-radius: var(--c-radius-item); background: var(--c-muted); padding: 12px; font: 12px/1.5 ui-monospace, monospace; white-space: pre; }
.script-panel { block-size: 220px; border-block-start: 1px solid var(--c-border); display: flex; flex-direction: column; }
.script-panel header { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 4px 8px 4px 12px; }
.script-panel header h2 { font: 500 14px/1 var(--c-font); }
.script-panel header > span { display: flex; gap: 4px; }
.script-host { flex: 1; min-block-size: 0; }
.sheet-tools { display: flex; flex-direction: column; gap: 4px; }
`;
