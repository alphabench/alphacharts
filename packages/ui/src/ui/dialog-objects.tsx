/** @jsxImportSource preact */
import { useApp, useT } from "./context.js";
import { Dialog, IconButton, Item, ItemGroup, slot } from "./primitives.js";

/** Every study and drawing of the active chart in one list, each with show/hide, lock (drawings) and delete. */
export function ObjectsDialog() {
  const app = useApp();
  const t = useT();
  const inst = app.current;
  const studies = inst.studies();
  const drawings = inst.drawingList();
  const p = inst.drawings;
  return (
    <Dialog title={t("objects.title")} onClose={() => app.closeDialog()} testid="objects-dialog">
      <h3 class="section-title">{t("objects.indicators", { count: studies.length })}</h3>
      {studies.length === 0 ? <p class="muted">{t("common.none")}</p> : null}
      <ItemGroup label={t("objects.indicators", { count: studies.length })} testid="objects-studies">
        {studies.map((s) => (
          <Item key={s.study.id} actions={<>
            <IconButton icon={s.userHidden ? "eyeOff" : "eye"} pressed={s.userHidden} label={t(s.userHidden ? "common.show" : "common.hide")} onClick={() => (inst.setStudyHidden(s.study.id, !s.userHidden), app.events.emit("change", undefined))} />
            <IconButton icon="trash" label={t("indicators.remove", { name: s.study.def.name })} onClick={() => app.removeStudy(s.study.id)} />
          </>}>
            <span {...slot("item-content")}><span {...slot("item-title")}>{s.study.def.name}</span></span>
          </Item>
        ))}
      </ItemGroup>
      <h3 class="section-title">{t("objects.drawings", { count: drawings.length })}</h3>
      {drawings.length === 0 ? <p class="muted">{t("common.none")}</p> : null}
      <ItemGroup label={t("objects.drawings", { count: drawings.length })} testid="objects-drawings">
        {drawings.map((d) => (
          <Item key={d.id} actions={<>
            <IconButton icon={d.locked ? "lock" : "unlock"} pressed={d.locked} label={t(d.locked ? "common.unlock" : "common.lock")} onClick={() => (p?.update(d.id, { locked: !d.locked }), app.events.emit("change", undefined))} />
            <IconButton icon={d.hidden ? "eyeOff" : "eye"} pressed={d.hidden} label={t(d.hidden ? "common.show" : "common.hide")} onClick={() => (p?.update(d.id, { hidden: !d.hidden }), app.events.emit("change", undefined))} />
            <IconButton icon="trash" label={t("common.delete")} onClick={() => (p?.remove([d.id]), app.events.emit("change", undefined))} />
          </>}>
            <span {...slot("item-content")}><span {...slot("item-title")}>{app.toolLabel(d.tool)}</span></span>
          </Item>
        ))}
      </ItemGroup>
    </Dialog>
  );
}
