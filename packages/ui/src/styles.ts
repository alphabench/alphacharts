// The shell's stylesheet. Colours come only from the --ac-* variables (the core theme's tokens);
// everything else is mixed from them. Logical properties only, so one sheet serves LTR and RTL.

export const STYLES = /* css */ `
:host { display: block; contain: layout; }
.mount, .app { block-size: 100%; inline-size: 100%; }
.app {
  --surface: color-mix(in srgb, var(--ac-bg) 94%, var(--ac-text));
  --surface-2: color-mix(in srgb, var(--ac-bg) 88%, var(--ac-text));
  --hover: color-mix(in srgb, var(--ac-bg) 86%, var(--ac-text));
  --active: color-mix(in srgb, var(--ac-bg) 78%, var(--ac-text));
  --shadow: color-mix(in srgb, #000 45%, transparent);
  --radius: 6px; --h: 32px; --pad: 8px;
  position: relative; display: flex; flex-direction: column; background: var(--ac-bg); color: var(--ac-text);
  font: 13px/1.35 var(--ac-font); font-variant-numeric: tabular-nums; overflow: hidden;
}
.app[data-compact] { --h: 44px; font-size: 15px; }
@media (pointer: coarse) { .app { --h: 44px; } }
*, *::before, *::after { box-sizing: border-box; }
h2, h3 { margin: 0; font-weight: 600; } h3 { font-size: 13px; margin-block: 12px 6px; } p { margin: 6px 0; }
.sr-only { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.muted { color: var(--ac-muted); } .error-text { color: var(--ac-down); } .grow { flex: 1; }
.icon.dir { } [dir="rtl"] .icon.dir { transform: scaleX(-1); }

button, input, select, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }
:focus-visible { outline: 2px solid var(--ac-accent); outline-offset: 1px; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-block-size: var(--h); min-inline-size: var(--h); padding-inline: 6px; background: transparent; border: 1px solid transparent; border-radius: var(--radius); color: var(--ac-text); }
.btn:hover:not(:disabled) { background: var(--hover); } .btn:active:not(:disabled) { background: var(--active); }
.btn:disabled { color: var(--ac-muted); opacity: .55; cursor: default; }
.btn[aria-pressed="true"]:not(.row-main):not(.side-tab) { background: color-mix(in srgb, var(--ac-accent) 22%, transparent); color: var(--ac-text); border-color: color-mix(in srgb, var(--ac-accent) 55%, transparent); }
.text-btn { padding-inline: 14px; border-color: var(--ac-border); background: var(--surface); }
.text-btn.primary { background: var(--ac-accent); color: var(--ac-on-accent); border-color: var(--ac-accent); }
.text-btn.danger { background: var(--ac-down); color: var(--ac-on-accent); border-color: var(--ac-down); }
.btn-text { font-size: 11px; font-weight: 600; }
.chip { min-inline-size: var(--h); padding-inline: 8px; font-weight: 500; }

.toolbar { display: flex; align-items: center; gap: 2px; padding: 4px var(--pad); border-block-end: 1px solid var(--ac-border); background: var(--ac-bg); flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
.symbol-btn { font-weight: 700; font-size: 14px; padding-inline: 10px; } .symbol-name.static { font-weight: 700; padding-inline: 10px; }
.sep, .hsep { background: var(--ac-border); } .sep { inline-size: 1px; block-size: 20px; margin-inline: 6px; } .hsep { block-size: 1px; inline-size: 24px; margin-block: 4px; }
.app[data-compact] .hide-compact { display: none; }
.body { flex: 1; display: flex; min-block-size: 0; }
.stage { flex: 1; min-inline-size: 0; display: flex; flex-direction: column; position: relative; }
.grid { flex: 1; display: grid; gap: 1px; background: var(--ac-border); position: relative; min-block-size: 0; }
.cell { position: relative; min-inline-size: 0; min-block-size: 0; }
.cell-overlay { position: absolute; inset: 0; z-index: 2; pointer-events: none; }
.cell.active .cell-overlay { box-shadow: inset 0 0 0 1px var(--ac-accent); }
.legend-root { position: absolute; inset-block-start: 4px; inset-inline-start: 8px; inset-inline-end: 72px; }
.legend { display: flex; flex-direction: column; gap: 1px; font-size: 12px; text-shadow: 0 0 3px var(--ac-bg), 0 0 3px var(--ac-bg); }
.legend-line { pointer-events: auto; inline-size: max-content; max-inline-size: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; min-block-size: 20px; }
.legend-symbol { font-weight: 700; font-size: 13px; } .ohlc { display: inline-flex; gap: 8px; } abbr { text-decoration: none; color: var(--ac-muted); }
.up { color: var(--ac-up); } .down { color: var(--ac-down); }
.study.off { opacity: .6; } .study-name { color: var(--ac-muted); }
.legend-actions { display: none; pointer-events: auto; } .legend-line:hover .legend-actions, .legend-line:focus-within .legend-actions { display: inline-flex; }
@media (hover: none) { .legend-actions { display: inline-flex; } }
.legend .btn { min-block-size: 22px; min-inline-size: 22px; padding: 0; background: color-mix(in srgb, var(--ac-bg) 70%, transparent); text-shadow: none; }
.app[data-compact] .legend .btn { min-block-size: 44px; min-inline-size: 44px; }
.status-box { pointer-events: auto; display: flex; gap: 8px; align-items: center; padding: 4px 8px; background: var(--surface); border: 1px solid var(--ac-border); border-radius: var(--radius); inline-size: max-content; max-inline-size: 100%; }

.drawingbar { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 4px; inline-size: 44px; border-inline-end: 1px solid var(--ac-border); overflow-y: auto; scrollbar-width: none; }
.split-btn { position: relative; } .flyout-btn { position: absolute; inset-inline-end: -4px; inset-block: 8px; min-inline-size: 12px; min-block-size: 0; padding: 0; inline-size: 12px; opacity: .7; }
.drawingbar .icon-btn { inline-size: 36px; }
.bottombar { display: flex; justify-content: space-around; border-block-start: 1px solid var(--ac-border); padding: 4px; background: var(--ac-bg); }

.backdrop { position: absolute; inset: 0; z-index: 20; background: var(--shadow); display: flex; align-items: center; justify-content: center; padding: 16px; }
.dialog { background: var(--surface); border: 1px solid var(--ac-border); border-radius: 10px; box-shadow: 0 12px 40px var(--shadow); inline-size: min(480px, 100%); max-block-size: 100%; display: flex; flex-direction: column; outline: none; }
.dialog.wide { inline-size: min(760px, 100%); }
.dialog-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 8px 8px 16px; padding-inline: 16px 8px; border-block-end: 1px solid var(--ac-border); }
.dialog-head h2 { font-size: 15px; }
.dialog-body { padding: 12px 16px; overflow: auto; flex: 1; min-block-size: 0; }
.dialog-foot, .actions { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 16px; } .actions { padding-inline: 0; }
.dialog-foot { border-block-start: 1px solid var(--ac-border); }
.app[data-compact] .backdrop { align-items: flex-end; padding: 0; }
.app[data-compact] .dialog, .app[data-compact] .dialog.wide { inline-size: 100%; max-block-size: 88%; border-end-start-radius: 0; border-end-end-radius: 0; }

.popover { position: absolute; z-index: 30; background: var(--surface); border: 1px solid var(--ac-border); border-radius: 8px; box-shadow: 0 8px 28px var(--shadow); padding: 4px; min-inline-size: 200px; max-block-size: 70%; overflow: auto; }
.app[data-compact] .popover { position: fixed; inset: auto 0 0 0 !important; inline-size: auto; max-block-size: 70%; border-end-start-radius: 0; border-end-end-radius: 0; padding: 8px; }
.menu-group + .menu-group { border-block-start: 1px solid var(--ac-border); margin-block-start: 4px; padding-block-start: 4px; }
.menu-heading { padding: 4px 8px; font-size: 11px; color: var(--ac-muted); }
.menu-item { display: flex; align-items: center; inline-size: 100%; gap: 8px; min-block-size: var(--h); padding-inline: 8px; background: none; border: 0; border-radius: 4px; text-align: start; }
.menu-item:hover, .menu-item:focus-visible { background: var(--hover); } .menu-item.danger { color: var(--ac-down); } .menu-item[aria-disabled="true"] { color: var(--ac-muted); opacity: .6; }
.menu-check { inline-size: 16px; display: inline-flex; } .menu-label { flex: 1; } .menu-hint { color: var(--ac-muted); }

.search-box { display: flex; align-items: center; gap: 8px; border: 1px solid var(--ac-border); border-radius: var(--radius); padding-inline: 8px; background: var(--ac-bg); }
.search-box input { flex: 1; border: 0; background: none; min-block-size: var(--h); outline: none; } .search-box:focus-within { outline: 2px solid var(--ac-accent); }
.results, .named-list, .interval-list, .tool-list, .chips { list-style: none; margin: 0; padding: 0; }
.results > li:not(.row), .results [role="option"] { display: flex; gap: 12px; align-items: baseline; padding: 6px 8px; border-radius: 4px; cursor: pointer; }
.results [role="option"].sel { background: var(--hover); } .results .sym { font-weight: 600; min-inline-size: 90px; } .results .desc { flex: 1; color: var(--ac-muted); } .results .meta { color: var(--ac-muted); font-size: 11px; }
.results { max-block-size: 320px; overflow: auto; }
.row { display: flex; align-items: center; gap: 2px; } .row-main { flex: 1; justify-content: flex-start; text-align: start; gap: 10px; min-block-size: var(--h); } .row-main.static { display: flex; align-items: center; gap: 10px; padding-inline: 8px; }
.row-main[aria-pressed="true"] { background: color-mix(in srgb, var(--ac-accent) 22%, transparent); } .row-main.btn { justify-content: space-between; }
.tool-list .row-main { justify-content: flex-start; } .flyout { min-inline-size: 260px; }
.badge { font-size: 11px; padding: 2px 8px; border-radius: 10px; border: 1px solid var(--ac-border); } .badge.active { color: var(--ac-up); } .badge.triggered { color: var(--ac-accent); }
.split { display: flex; gap: 12px; margin-block-start: 8px; } .side-tabs { display: flex; flex-direction: column; inline-size: 150px; flex: none; max-block-size: 320px; overflow: auto; } .list-col { flex: 1; min-inline-size: 0; }
.side-tab { justify-content: flex-start; } .side-tab[aria-pressed="true"] { background: var(--active); font-weight: 600; }
.app[data-compact] .split { flex-direction: column; } .app[data-compact] .side-tabs { flex-direction: row; inline-size: auto; }

.tabs { display: flex; flex-direction: column; gap: 10px; } .tablist { display: flex; gap: 2px; border-block-end: 1px solid var(--ac-border); overflow-x: auto; }
.tab { background: none; border: 0; border-block-end: 2px solid transparent; padding: 8px 10px; min-block-size: var(--h); color: var(--ac-muted); white-space: nowrap; }
.tab[aria-selected="true"] { color: var(--ac-text); border-block-end-color: var(--ac-accent); font-weight: 600; }
.form { display: flex; flex-direction: column; gap: 10px; } fieldset { border: 1px solid var(--ac-border); border-radius: var(--radius); padding: 8px 12px; margin: 0; display: flex; flex-direction: column; gap: 8px; } legend { padding-inline: 4px; color: var(--ac-muted); }
.field { display: flex; flex-direction: column; gap: 4px; } .field label { color: var(--ac-muted); font-size: 12px; } .hint { color: var(--ac-muted); font-size: 11px; }
input:not([type="checkbox"]):not([type="color"]):not([type="range"]), select, textarea { background: var(--ac-bg); border: 1px solid var(--ac-border); border-radius: var(--radius); min-block-size: var(--h); padding-inline: 8px; inline-size: 100%; }
textarea { min-block-size: 80px; padding-block: 6px; } input[type="color"] { inline-size: 44px; block-size: var(--h); padding: 2px; background: none; border: 1px solid var(--ac-border); border-radius: var(--radius); }
.color-row { display: flex; align-items: center; gap: 10px; } .check { display: flex; align-items: center; gap: 8px; min-block-size: 28px; } .check input { inline-size: 18px; block-size: 18px; accent-color: var(--ac-accent); }
.check-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 2px 8px; } .keyrow { display: grid; grid-template-columns: 1fr 1.4fr; gap: 8px; align-items: center; }

.toasts { position: absolute; inset-block-end: 12px; inset-inline-end: 12px; z-index: 40; display: flex; flex-direction: column; gap: 6px; max-inline-size: min(420px, calc(100% - 24px)); }
.toast { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 6px 6px 12px; padding-inline: 12px 6px; background: var(--surface-2); border: 1px solid var(--ac-border); border-radius: 8px; box-shadow: 0 6px 20px var(--shadow); }
.toast.error { border-color: var(--ac-down); } .toast.alert { border-color: var(--ac-accent); }
.app[data-compact] .toasts { inset-block-end: 60px; }
.script-panel { block-size: 220px; border-block-start: 1px solid var(--ac-border); display: flex; flex-direction: column; } .script-panel header { display: flex; justify-content: space-between; align-items: center; padding: 2px 8px; } .script-host { flex: 1; min-block-size: 0; }
.sheet-tools section { margin-block-end: 8px; }
`;
