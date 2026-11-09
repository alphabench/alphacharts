/** @jsxImportSource preact */
import type { MenuItem } from "../engine/app.js";
import { GRID_PRESETS } from "../model/grids.js";
import type { SyncKey, ThemeName } from "../types.js";
import { useApp, useT } from "./context.js";
import { Icon } from "./icons.js";
import { Button, IconButton, Separator, ToggleGroup } from "./primitives.js";

const THEMES: ThemeName[] = ["inherit", "dark", "light", "high-contrast", "auto"];
const LOCALES: Array<{ id: string; label: string }> = [{ id: "en", label: "English" }, { id: "hi", label: "हिन्दी" }];

function anchorOf(e: MouseEvent): HTMLElement {
  return e.currentTarget as HTMLElement;
}

export function Toolbar() {
  const app = useApp();
  const t = useT();
  const f = app.features;
  const cur = app.hasCurrent ? app.current : null;
  const ordinal = cur?.ordinal ?? false;
  const open = (e: MouseEvent, label: string, items: MenuItem[]) => app.openMenu({ label, at: anchorOf(e), items, returnFocus: anchorOf(e) });

  const chartTypeMenu = (e: MouseEvent) =>
    open(e, t("a11y.menu", { name: t("toolbar.chartType", { type: cur ? app.chartTypeLabel(cur.chartType) : "" }) }),
      app.availableChartTypes().map((c) => ({ id: `type-${c.id}`, label: t(c.key as never), checked: cur?.chartType === c.id, onSelect: () => app.setChartType(c.id) })));

  const layoutMenu = (e: MouseEvent) => {
    const items: MenuItem[] = [
      { id: "h1", label: t("layout.title"), heading: true },
      { id: "save", label: t("layout.save"), onSelect: () => (app.layoutName ? void app.saveLayout(app.layoutName) : app.openDialog({ kind: "prompt", title: t("layout.saveAs"), label: t("layout.name"), value: t("layout.name.default"), onSubmit: (v) => app.saveLayout(v) })) },
      { id: "saveas", label: t("layout.saveAs"), onSelect: () => app.openDialog({ kind: "prompt", title: t("layout.saveAs"), label: t("layout.name"), value: app.layoutName ?? t("layout.name.default"), onSubmit: (v) => app.saveLayout(v) }) },
      { id: "load", label: t("layout.load"), onSelect: () => app.openDialog({ kind: "layouts" }) },
      { id: "auto", label: t("layout.autosave"), checked: app.autosave, onSelect: () => void app.setAutosave(!app.autosave) },
      { id: "tpl", label: t("settings.template"), onSelect: () => app.openDialog({ kind: "templates" }) },
      { id: "s1", label: "", separator: true },
      ...(f.multiChart ? [
        { id: "h2", label: t("layout.grid.grid"), heading: true },
        ...GRID_PRESETS.map((g) => ({ id: `grid-${g.id}`, label: t("layout.charts", { count: g.charts }) + (g.id.length > 1 && /\D/.test(g.id) ? ` (${g.id})` : ""), checked: app.gridId === g.id, onSelect: () => app.setLayout(g.id) })),
        { id: "s2", label: "", separator: true },
        { id: "h3", label: t("layout.sync.title"), heading: true },
        ...(["symbol", "interval", "crosshair", "time", "drawings"] as SyncKey[]).map((k) => ({ id: `sync-${k}`, label: t(`layout.sync.${k}` as never), checked: app.sync[k], onSelect: () => app.setSync(k, !app.sync[k]) })),
      ] : []),
    ];
    open(e, t("a11y.menu", { name: t("toolbar.layout") }), items);
  };

  const viewMenu = (e: MouseEvent) =>
    open(e, t("a11y.menu", { name: t("toolbar.theme") }), [
      { id: "ht", label: t("toolbar.theme"), heading: true },
      ...(f.themeSwitcher ? THEMES.map((n) => ({ id: `theme-${n}`, label: app.themeLabel(n), checked: app.themeName === n, onSelect: () => app.setTheme(n) })) : []),
      ...(f.themeSwitcher ? [{ id: "theme-custom", label: t("ui.theme.customize"), checked: app.themeName === "custom", onSelect: () => app.openDialog({ kind: "settings", tab: "canvas" }) }] : []),
      { id: "s", label: "", separator: true },
      { id: "hl", label: t("toolbar.language"), heading: true },
      ...(f.localeSwitcher ? LOCALES.map((l) => ({ id: `loc-${l.id}`, label: l.label, checked: app.locale === l.id, onSelect: () => void app.setLocale(l.id) })) : []),
    ]);

  const moreMenu = (e: MouseEvent) =>
    open(e, t("a11y.menu", { name: t("common.more") }), [
      ...(f.indicators ? [{ id: "ind", icon: "indicators", label: t("toolbar.indicators"), disabled: ordinal, onSelect: () => app.openDialog({ kind: "indicators" }) }] : []),
      ...(f.compare ? [{ id: "cmp", icon: "compare", label: t("toolbar.compare"), disabled: ordinal || !app.canSearch, onSelect: () => app.openDialog({ kind: "symbol", purpose: "compare" }) }] : []),
      ...(f.alerts ? [{ id: "al", icon: "bell", label: t("toolbar.alerts"), onSelect: () => app.openDialog({ kind: "alerts" }) }] : []),
      ...(f.layouts ? [{ id: "lay", icon: "layout", label: t("toolbar.layout"), onSelect: () => app.openDialog({ kind: "layouts" }) }] : []),
      ...(f.themeSwitcher || f.localeSwitcher ? [{ id: "view", icon: "globe", label: t("toolbar.theme"), onSelect: () => app.openDialog({ kind: "settings", tab: "canvas" }) }] : []),
      ...(f.snapshot ? [{ id: "snap", icon: "camera", label: t("toolbar.snapshot"), onSelect: () => void app.takeSnapshot() }] : []),
      ...(f.settings ? [{ id: "set", icon: "gear", label: t("toolbar.settings"), onSelect: () => app.openDialog({ kind: "settings" }) }] : []),
    ]);

  const symbol = cur?.symbol ?? app.options.symbol;
  const interval = cur?.interval ?? app.options.interval;
  const favs = app.favouriteIntervals();

  return (
    <div class="toolbar" role="toolbar" aria-label={t("toolbar.label")} data-testid="toolbar">
      {f.symbolSearch ? (
        <button
          type="button" data-slot="button" part="button" data-variant="ghost" data-size="sm" class="symbol-btn" aria-label={t("toolbar.symbol.change", { symbol })}
          data-tip={t("toolbar.symbol")} data-testid="symbol-button" disabled={!app.canSearch} onClick={() => app.openDialog({ kind: "symbol", purpose: "change" })}
        >
          <span class="symbol-name"><bdi>{symbol}</bdi></span>
        </button>
      ) : <span class="symbol-name static"><bdi>{symbol}</bdi></span>}
      {f.compare && f.symbolSearch ? <IconButton icon="compare" label={t("toolbar.compare")} disabled={ordinal || !app.canSearch} testid="compare-button" onClick={() => app.openDialog({ kind: "symbol", purpose: "compare" })} /> : null}
      <Separator vertical />
      {!app.compact ? (
        <ToggleGroup
          label={t("interval.label")} value={favs.includes(interval) ? interval : null} onChange={(i) => app.setInterval(i)}
          items={favs.map((i) => ({ value: i, label: app.intervalLabel(i), aria: t("toolbar.interval", { interval: app.intervalLabel(i) }), testid: `interval-${i}` }))}
        />
      ) : null}
      <Button
        variant="ghost" size="sm" haspopup="dialog" label={t("toolbar.interval", { interval: app.intervalLabel(interval) })} tip={t("interval.label")} testid="interval-button"
        onClick={() => app.openDialog({ kind: "interval" })}
      >
        {app.compact || !favs.includes(interval) ? app.intervalLabel(interval) : <Icon name="chevron" />}
      </Button>
      <Separator vertical />
      <IconButton icon="chartType" label={t("toolbar.chartType", { type: cur ? app.chartTypeLabel(cur.chartType) : "" })} haspopup testid="charttype-button" onClick={chartTypeMenu} />
      {f.indicators ? <IconButton icon="indicators" label={t("toolbar.indicators")} disabled={ordinal} testid="indicators-button" class="hide-compact" onClick={() => app.openDialog({ kind: "indicators" })} /> : null}
      {f.alerts ? <IconButton icon="bell" label={t("toolbar.alerts")} disabled={ordinal} testid="alerts-button" class="hide-compact" onClick={() => app.openDialog({ kind: "alerts" })} /> : null}
      <IconButton icon="undo" label={t("toolbar.undo")} disabled={!app.canUndo} testid="undo-button" class="hide-compact" onClick={() => void app.undo()} />
      <IconButton icon="redo" label={t("toolbar.redo")} disabled={!app.canRedo} testid="redo-button" class="hide-compact" onClick={() => void app.redo()} />
      <span class="grow" />
      {f.layouts ? <IconButton icon="layout" label={t("toolbar.layout")} haspopup testid="layout-button" class="hide-compact" onClick={layoutMenu} /> : null}
      {f.themeSwitcher || f.localeSwitcher ? <IconButton icon="globe" label={t("toolbar.theme")} haspopup testid="view-button" class="hide-compact" onClick={viewMenu} /> : null}
      {app.hasScript ? <IconButton icon="code" label={t("ui.script.title")} pressed={app.scriptOpen} testid="script-button" class="hide-compact" onClick={() => app.toggleScript()} /> : null}
      {f.settings ? <IconButton icon="gear" label={t("toolbar.settings")} testid="settings-button" class="hide-compact" onClick={() => app.openDialog({ kind: "settings" })} /> : null}
      {f.snapshot ? <IconButton icon="camera" label={t("toolbar.snapshot")} testid="snapshot-button" class="hide-compact" onClick={() => void app.takeSnapshot()} /> : null}
      {f.snapshot ? <IconButton icon="copy" label={t("toolbar.snapshotCopy")} testid="snapshot-copy-button" class="hide-compact" onClick={() => void app.copySnapshot()} /> : null}
      {f.fullscreen ? <IconButton icon={app.fullscreen ? "shrink" : "expand"} label={t(app.fullscreen ? "toolbar.fullscreen.exit" : "toolbar.fullscreen")} testid="fullscreen-button" class="hide-compact" onClick={() => void app.toggleFullscreen()} /> : null}
    </div>
  );
}

/** Compact layout: the controls that left the top bar. */
export function BottomBar() {
  const app = useApp();
  const t = useT();
  const f = app.features;
  const ordinal = app.hasCurrent && app.current.ordinal;
  return (
    <nav class="bottombar" aria-label={t("toolbar.label")} data-testid="bottombar">
      {f.indicators ? <IconButton icon="indicators" label={t("toolbar.indicators")} disabled={ordinal} onClick={() => app.openDialog({ kind: "indicators" })} /> : null}
      {f.drawings ? <IconButton icon="trendLine" label={t("toolbar.drawings")} disabled={ordinal} testid="drawings-sheet-button" onClick={() => app.openDrawingSheet()} /> : null}
      {f.alerts ? <IconButton icon="bell" label={t("toolbar.alerts")} disabled={ordinal} onClick={() => app.openDialog({ kind: "alerts" })} /> : null}
      <IconButton icon="undo" label={t("toolbar.undo")} disabled={!app.canUndo} onClick={() => void app.undo()} />
      <IconButton icon="more" label={t("common.more")} haspopup tip="top" testid="more-button" onClick={(e) => app.openMenu({ label: t("a11y.menu", { name: t("common.more") }), at: e.currentTarget as HTMLElement, returnFocus: e.currentTarget as HTMLElement, items: app.moreItems() })} />
    </nav>
  );
}
