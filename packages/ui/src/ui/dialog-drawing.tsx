/** @jsxImportSource preact */
import { useEffect, useState } from "preact/hooks";
import type { Anchor, Dash } from "@alphacharts/drawings";
import { PRESET_INTERVALS, intervalId, sortIntervals } from "../model/intervals.js";
import { useApp, useT } from "./context.js";
import { Button, Check, ColorField, Dialog, Field, NumberField, SelectField, Tabs } from "./primitives.js";

const toLocal = (ms: number, tz: string): string => new Date(ms).toISOString().slice(0, 19) + (tz ? "" : "");

export function DrawingDialog({ id }: { id: string }) {
  const app = useApp();
  const t = useT();
  const p = app.current.drawings;
  const d = p?.get(id);
  const [tab, setTab] = useState("style");
  const [names, setNames] = useState<string[]>([]);
  const [anchors, setAnchors] = useState<Anchor[]>(d ? d.anchors.map((a) => ({ ...a })) : []);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (p?.templates && d) void p.templates.list(d.tool).then((l) => setNames(l.map((x) => x.name)), (e) => app.report(e));
  }, []);
  if (!p || !d) return null;
  const st = d.style;
  const set = (style: Partial<typeof st>) => { try { p.update(id, { style }); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } app.events.emit("change", undefined); };
  const label = app.toolLabel(d.tool);
  const hasText = ["text", "anchoredText", "note", "anchoredNote", "callout", "comment", "priceLabel", "priceNote", "signpost", "flagMark"].includes(d.tool) || st.text !== "";
  const all = sortIntervals([...PRESET_INTERVALS]);
  const shown = d.intervals;
  const applyAnchors = () => {
    try {
      p.update(id, { anchors });
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Dialog title={t("drawing.properties", { tool: label })} onClose={() => app.closeDialog()} testid="drawing-dialog" footer={<Button primary onClick={() => app.closeDialog()}>{t("common.ok")}</Button>}>
      <Tabs label={t("drawing.properties", { tool: label })} value={tab} onChange={setTab} tabs={[{ id: "style", label: t("study.tab.style") }, ...(hasText ? [{ id: "text", label: t("ui.drawing.text") }] : []), { id: "coords", label: t("drawing.coordinates") }, { id: "visibility", label: t("study.tab.visibility") }]}>
        {tab === "style" ? (
          <div class="form">
            <ColorField label={t("common.color")} value={st.color} onChange={(c) => set({ color: c })} testid="drawing-color" />
            <NumberField label={t("common.thickness")} min={1} max={10} step={1} value={st.width} onChange={(w) => set({ width: w })} testid="drawing-width" />
            <SelectField label={t("study.style.lineStyle")} value={st.dash} options={(["solid", "dashed", "dotted"] as Dash[]).map((v) => ({ value: v, label: t(`study.lineStyle.${v}` as never) }))} onChange={(v) => set({ dash: v })} testid="drawing-dash" />
            <Check label={t("study.style.fill")} checked={st.fill !== null} onChange={(v) => set({ fill: v ? "rgba(41,98,255,0.2)" : null })} />
            {st.fill !== null ? <ColorField label={t("study.style.fill")} value={st.fill} alpha onChange={(c) => set({ fill: c })} /> : null}
            <Check label={t("drawing.extend.left")} checked={st.extendLeft} onChange={(v) => set({ extendLeft: v })} />
            <Check label={t("drawing.extend.right")} checked={st.extendRight} onChange={(v) => set({ extendRight: v })} />
            {names.length ? (
              <SelectField label={t("menu.drawing.template")} value="" options={[{ value: "", label: t("settings.template.apply") }, ...names.map((n) => ({ value: n, label: n }))]} onChange={(n) => n && p.applyTemplate([id], n).catch((e) => app.report(e))} />
            ) : null}
            <Button onClick={() => app.openDialog({ kind: "prompt", title: t("settings.template.save"), label: t("common.name"), value: "", onSubmit: (v) => p.saveTemplate(id, v).catch((e) => app.report(e)) })}>{t("settings.template.save")}</Button>
          </div>
        ) : tab === "text" ? (
          <div class="form">
            <Field label={t("drawing.text.placeholder")}>{(i) => <textarea id={i} value={st.text} data-testid="drawing-text" onInput={(e) => set({ text: (e.currentTarget as HTMLTextAreaElement).value })} />}</Field>
            <ColorField label={t("common.color")} value={st.textColor} onChange={(c) => set({ textColor: c })} />
            <NumberField label={t("drawing.text.fontSize")} min={8} max={64} step={1} value={st.fontSize} onChange={(v) => set({ fontSize: v })} />
            <Check label={t("drawing.text.bold")} checked={st.bold} onChange={(v) => set({ bold: v })} />
            <Check label={t("drawing.text.italic")} checked={st.italic} onChange={(v) => set({ italic: v })} />
          </div>
        ) : tab === "coords" ? (
          <div class="form">
            {anchors.map((a, i) => (
              <fieldset key={i}><legend>{i + 1}</legend>
                <Field label={t("ui.coord.time")}>{(fid) => <input id={fid} type="datetime-local" step="1" value={toLocal(a.time, "UTC").slice(0, 19)} data-testid={`anchor-time-${i}`} onChange={(e) => { const ms = Date.parse((e.currentTarget as HTMLInputElement).value + "Z"); if (Number.isFinite(ms)) setAnchors(anchors.map((x, j) => (j === i ? { ...x, time: ms } : x))); }} />}</Field>
                <NumberField label={t("ui.coord.price")} value={a.price} onChange={(v) => setAnchors(anchors.map((x, j) => (j === i ? { ...x, price: v } : x)))} testid={`anchor-price-${i}`} />
              </fieldset>
            ))}
            <p class="muted">{t("format.timeZone.utc")}</p>
            {err ? <p class="error-text" role="alert">{err}</p> : null}
            <Button primary testid="anchors-apply" onClick={applyAnchors}>{t("common.apply")}</Button>
          </div>
        ) : (
          <div class="form">
            <Check label={t("study.visibility.allIntervals")} checked={shown === null} onChange={(v) => p.update(id, { intervals: v ? null : [intervalId(app.current.interval)] })} />
            {shown ? <div class="check-grid">{all.map((i) => { const n = intervalId(i); return <Check key={i} label={app.intervalLabel(i)} checked={shown.includes(n)} onChange={(v) => p.update(id, { intervals: v ? [...shown, n] : shown.filter((x) => x !== n) })} />; })}</div> : null}
            <Check label={t("common.lock")} checked={d.locked} onChange={(v) => p.update(id, { locked: v })} />
            <Check label={t("common.hide")} checked={d.hidden} onChange={(v) => p.update(id, { hidden: v })} />
          </div>
        )}
      </Tabs>
    </Dialog>
  );
}
