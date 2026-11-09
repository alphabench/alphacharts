/** @jsxImportSource preact */
import { useState } from "preact/hooks";
import { groupOf, type ToolGroup } from "../model/tools.js";
import type { MagnetMode } from "@alphacharts/drawings";
import { useApp, useT } from "./context.js";
import { CommandGroup, Dialog, IconButton, Popover, Separator, slot } from "./primitives.js";
import { Icon, toolIcon } from "./icons.js";

/** The tools of a group as menu rows: icon, name, and a star to keep it on the bar. */
function ToolRows({ group, onPick }: { group: ToolGroup; onPick: () => void }) {
  const app = useApp();
  const t = useT();
  const avail = new Set(app.tools.map((x) => x.id));
  const favs = new Set(app.prefs.favouriteTools);
  const cur = app.activeTool();
  return (
    <>
      {group.tools.filter((id) => avail.has(id)).map((id) => (
        <li key={id} class="tool-row">
          <button type="button" {...slot("dropdown-menu-item")} aria-pressed={cur === id} data-testid={`tool-${id}`} onClick={() => (app.selectTool(id), onPick())}>
            <Icon name={toolIcon(id, group.id, app.options.icons)} /><span>{app.toolLabel(id)}</span>
          </button>
          <IconButton icon="star" size="icon-xs" filled={favs.has(id)} class="star" label={`${t(favs.has(id) ? "indicators.favorite.remove" : "indicators.favorite.add", { name: app.toolLabel(id) })}`} tip="right" onClick={() => void app.toggleFavourite("favouriteTools", id)} />
        </li>
      ))}
    </>
  );
}

export function DrawingBar() {
  const app = useApp();
  const t = useT();
  const [fly, setFly] = useState<{ group: ToolGroup; el: HTMLElement } | null>(null);
  const on = app.analysisOn;
  const cur = app.activeTool();
  const avail = new Set(app.tools.map((x) => x.id));
  const nextMagnet: Record<MagnetMode, MagnetMode> = { off: "weak", weak: "strong", strong: "off" };
  const favs = app.prefs.favouriteTools.filter((id) => avail.has(id));
  return (
    <div class="drawingbar" role="toolbar" aria-orientation="vertical" aria-label={t("a11y.drawingToolbar")} data-testid="drawingbar">
      <IconButton icon="cursor" label={t("drawing.tool.arrowCursor")} size="icon" tip="right" pressed={cur === null} disabled={!on} testid="tool-cursor" onClick={() => app.selectTool(null)} />
      {favs.map((id) => <IconButton key={id} icon={toolIcon(id, groupOf(id)?.id ?? "custom", app.options.icons)} label={app.toolLabel(id)} size="icon" tip="right" pressed={cur === id} disabled={!on} testid={`fav-${id}`} onClick={() => app.selectTool(id)} />)}
      <Separator />
      {app.toolGroups.map((g) => {
        const last = app.prefs.lastTool[g.id] && avail.has(app.prefs.lastTool[g.id]!) ? app.prefs.lastTool[g.id]! : g.tools.find((x) => avail.has(x));
        if (!last) return null;
        const active = cur !== null && g.tools.includes(cur);
        return (
          <div class="split-btn" key={g.id}>
            <IconButton icon={toolIcon(active ? cur! : last, g.id, app.options.icons)} label={`${t(g.key)}: ${app.toolLabel(active ? cur! : last)}`} size="icon" tip="right" pressed={active} disabled={!on} testid={`group-${g.id}`} onClick={() => app.selectTool(last)} />
            <button
              type="button" class="flyout-btn" disabled={!on} aria-haspopup="dialog" aria-expanded={fly?.group.id === g.id} aria-label={t(g.key)} data-tip={t(g.key)} data-tip-side="right"
              data-testid={`flyout-${g.id}`} onClick={(e) => setFly(fly?.group.id === g.id ? null : { group: g, el: (e.currentTarget as HTMLElement).parentElement! })}
            />
          </div>
        );
      })}
      <Separator />
      <IconButton size="icon" tip="right" icon={app.cursorMode === "cross" ? "cross" : "cursor"} label={`${t("cursor.title")}: ${t(app.cursorMode === "cross" ? "cursor.cross" : "cursor.arrow")}`} pressed={app.cursorMode === "arrow"} testid="cursor-mode-button" onClick={() => app.setCursorMode(app.cursorMode === "cross" ? "arrow" : "cross")} />
      <IconButton size="icon" tip="right" icon="magnet" label={`${t("drawing.magnet")}: ${t(`drawing.magnet.${app.magnetMode}` as never)}`} pressed={app.magnetMode !== "off"} disabled={!on} testid="magnet-button" text={app.magnetMode === "off" ? "" : app.magnetMode === "weak" ? "W" : "S"} onClick={() => app.setMagnet(nextMagnet[app.magnetMode])} />
      <IconButton size="icon" tip="right" icon="snapIndicators" label={t("drawing.snapIndicators")} pressed={app.snapToIndicators} disabled={!on || app.magnetMode === "off"} testid="snap-indicators-button" onClick={() => app.setSnapToIndicators(!app.snapToIndicators)} />
      <IconButton size="icon" tip="right" icon="keep" label={t("drawing.stayInMode")} pressed={app.keepDrawing} disabled={!on} testid="keep-button" onClick={() => app.setKeepDrawing(!app.keepDrawing)} />
      <IconButton size="icon" tip="right" icon={app.allLocked ? "lock" : "unlock"} label={t("drawing.lockAll")} pressed={app.allLocked} disabled={!on} testid="lockall-button" onClick={() => app.toggleLockAll()} />
      <IconButton size="icon" tip="right" icon={app.allHidden ? "eyeOff" : "eye"} label={t(app.allHidden ? "drawing.showAll" : "drawing.hideAll")} pressed={app.allHidden} disabled={!on} testid="hideall-button" onClick={() => app.toggleHideAll()} />
      <IconButton size="icon" tip="right" icon="hideIndicators" label={t(app.allIndicatorsHidden ? "indicators.showAll" : "indicators.hideAll")} pressed={app.allIndicatorsHidden} disabled={!on || app.current.studies().length === 0} testid="hideindicators-button" onClick={() => app.toggleHideIndicators()} />
      <IconButton size="icon" tip="right" icon="list" label={t("objects.title")} testid="objects-button" onClick={() => app.openDialog({ kind: "objects" })} />
      <IconButton size="icon" tip="right" icon="trash" label={t("drawing.removeAll")} disabled={!on} testid="removeall-button" onClick={() => app.removeAllDrawings()} />
      {fly ? (
        <Popover label={t(fly.group.key)} at={fly.el} side="right" slot="dropdown-menu-content" class="flyout" onClose={() => setFly(null)} testid="tool-flyout">
          <div {...slot("dropdown-menu-label")} aria-hidden="true">{t(fly.group.key)}</div>
          <ul class="tool-list" aria-label={t(fly.group.key)}><ToolRows group={fly.group} onPick={() => setFly(null)} /></ul>
        </Popover>
      ) : null}
    </div>
  );
}

/** The whole drawing toolbar as a sheet, for a narrow screen. */
export function DrawingSheet() {
  const app = useApp();
  const t = useT();
  return (
    <Dialog title={t("toolbar.drawings")} onClose={() => app.closeDrawingSheet()} testid="drawing-sheet">
      <div class="sheet-tools">
        {app.toolGroups.map((g) => (
          <CommandGroup key={g.id} heading={t(g.key)} label={t(g.key)}>
            <ToolRows group={g} onPick={() => app.closeDrawingSheet()} />
          </CommandGroup>
        ))}
      </div>
    </Dialog>
  );
}
