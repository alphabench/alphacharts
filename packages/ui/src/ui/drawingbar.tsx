/** @jsxImportSource preact */
import { useState } from "preact/hooks";
import { TOOL_GROUPS, groupOf, type ToolGroup } from "../model/tools.js";
import type { MagnetMode } from "@alphacharts/drawings";
import { useApp, useT } from "./context.js";
import { Dialog, IconButton, Popover } from "./primitives.js";
import { Icon, groupIcon, toolIcon } from "./icons.js";

function ToolRows({ group, onPick }: { group: ToolGroup; onPick: () => void }) {
  const app = useApp();
  const t = useT();
  const avail = new Set(app.tools.map((x) => x.id));
  const favs = new Set(app.prefs.favouriteTools);
  const cur = app.activeTool();
  return (
    <ul class="tool-list" aria-label={t(group.key)}>
      {group.tools.filter((id) => avail.has(id)).map((id) => (
        <li key={id} class="row">
          <button type="button" class="btn row-main" aria-pressed={cur === id} data-testid={`tool-${id}`} onClick={() => (app.selectTool(id), onPick())}>
            <Icon name={toolIcon(id, group.id)} size={18} /><span>{app.toolLabel(id)}</span>
          </button>
          <IconButton icon="star" filled={favs.has(id)} pressed={favs.has(id)} label={`${t(favs.has(id) ? "indicators.favorite.remove" : "indicators.favorite.add", { name: app.toolLabel(id) })}`} onClick={() => void app.toggleFavourite("favouriteTools", id)} />
        </li>
      ))}
    </ul>
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
      <IconButton icon="cursor" label={t("drawing.tool.arrowCursor")} pressed={cur === null} disabled={!on} testid="tool-cursor" onClick={() => app.selectTool(null)} />
      {favs.map((id) => <IconButton key={id} icon={toolIcon(id, groupOf(id)?.id ?? "lines")} label={app.toolLabel(id)} pressed={cur === id} disabled={!on} testid={`fav-${id}`} onClick={() => app.selectTool(id)} />)}
      <span class="hsep" aria-hidden="true" />
      {TOOL_GROUPS.map((g) => {
        const last = app.prefs.lastTool[g.id] && avail.has(app.prefs.lastTool[g.id]!) ? app.prefs.lastTool[g.id]! : g.tools.find((x) => avail.has(x));
        if (!last) return null;
        const active = cur !== null && g.tools.includes(cur);
        return (
          <div class="split-btn" key={g.id}>
            <IconButton icon={toolIcon(active ? cur! : last, g.id)} label={`${t(g.key)}: ${app.toolLabel(active ? cur! : last)}`} pressed={active} disabled={!on} testid={`group-${g.id}`} onClick={() => app.selectTool(last)} />
            <button type="button" class="btn flyout-btn" disabled={!on} aria-haspopup="dialog" aria-expanded={fly?.group.id === g.id} aria-label={t(g.key)} data-testid={`flyout-${g.id}`} onClick={(e) => setFly({ group: g, el: e.currentTarget as HTMLElement })}>
              <Icon name="chevronRight" size={12} />
            </button>
          </div>
        );
      })}
      <span class="hsep" aria-hidden="true" />
      <IconButton icon="magnet" label={`${t("drawing.magnet")}: ${t(`drawing.magnet.${app.magnetMode}` as never)}`} pressed={app.magnetMode !== "off"} disabled={!on} testid="magnet-button" text={app.magnetMode === "off" ? "" : app.magnetMode === "weak" ? "W" : "S"} onClick={() => app.setMagnet(nextMagnet[app.magnetMode])} />
      <IconButton icon="keep" label={t("drawing.stayInMode")} pressed={app.keepDrawing} disabled={!on} testid="keep-button" onClick={() => app.setKeepDrawing(!app.keepDrawing)} />
      <IconButton icon={app.allLocked ? "lock" : "unlock"} label={t("drawing.lockAll")} pressed={app.allLocked} disabled={!on} testid="lockall-button" onClick={() => app.toggleLockAll()} />
      <IconButton icon={app.allHidden ? "eyeOff" : "eye"} label={t(app.allHidden ? "drawing.showAll" : "drawing.hideAll")} pressed={app.allHidden} disabled={!on} testid="hideall-button" onClick={() => app.toggleHideAll()} />
      <IconButton icon="trash" label={t("drawing.removeAll")} disabled={!on} testid="removeall-button" onClick={() => app.removeAllDrawings()} />
      {fly ? (
        <Popover label={t(fly.group.key)} at={fly.el} onClose={() => setFly(null)} class="flyout" testid="tool-flyout">
          <ToolRows group={fly.group} onPick={() => setFly(null)} />
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
        {TOOL_GROUPS.map((g) => (
          <section key={g.id}>
            <h3><Icon name={groupIcon(g.id)} size={16} /> {t(g.key)}</h3>
            <ToolRows group={g} onPick={() => app.closeDrawingSheet()} />
          </section>
        ))}
      </div>
    </Dialog>
  );
}
