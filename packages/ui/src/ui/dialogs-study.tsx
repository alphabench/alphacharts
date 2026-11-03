/** @jsxImportSource preact */
import { useEffect, useMemo, useState } from "preact/hooks";
import type { InputValue, StudyDef } from "@alphacharts/indicators";
import { FAMILIES, searchCatalogue, type StudyFamily } from "../model/studies.js";
import { PRESET_INTERVALS, sortIntervals } from "../model/intervals.js";
import { useApp, useT } from "./context.js";
import { Button, Check, ColorField, Dialog, Field, IconButton, NumberField, SelectField, Tabs } from "./primitives.js";
import { Icon } from "./icons.js";

export function IndicatorsDialog() {
  const app = useApp();
  const t = useT();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"all" | StudyFamily | "favorites">("all");
  const [loaded, setLoaded] = useState(app.catalogue !== null);
  useEffect(() => void app.loadCatalogue().then(() => setLoaded(true), () => undefined), []);
  const favs = new Set(app.prefs.favouriteStudies);
  const entries = useMemo(
    () => (app.catalogue ? searchCatalogue(app.catalogue, q, tab === "favorites" ? "all" : tab, tab === "favorites" ? favs : undefined) : []),
    [loaded, q, tab, app.prefs.favouriteStudies, app.locale],
  );
  const active = app.current.studies();
  return (
    <Dialog title={t("indicators.title")} onClose={() => app.closeDialog()} wide testid="indicators-dialog">
      <div class="search-box">
        <Icon name="search" size={18} />
        <input type="search" data-autofocus value={q} placeholder={t("indicators.search")} aria-label={t("indicators.search")} data-testid="indicator-search" onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} />
      </div>
      <div class="split">
        <nav class="side-tabs" aria-label={t("indicators.title")}>
          {([["all", t("indicators.tab.all")], ["favorites", t("indicators.tab.favorites")], ...FAMILIES.map((f) => [f, app.familyLabel(f)])] as Array<[string, string]>).map(([id, label]) => (
            <button type="button" key={id} class="btn side-tab" aria-pressed={tab === id} onClick={() => setTab(id as never)}>{label}</button>
          ))}
        </nav>
        <div class="list-col">
          <p class="muted" aria-live="polite">{app.catalogue ? t("symbol.search.results", { count: entries.length }) : t("common.loading")}</p>
          {app.catalogue && entries.length === 0 ? <p class="muted">{t("indicators.empty", { query: q })}</p> : null}
          <ul class="results" data-testid="indicator-results" aria-label={t("indicators.title")}>
            {entries.slice(0, 300).map((e) => (
              <li key={e.def.id} class="row">
                <button type="button" class="btn row-main" data-testid={`indicator-add-${e.def.id}`} aria-label={t("indicators.add", { name: e.def.name })} onClick={() => app.addStudy(e.def)}>
                  <span class="sym">{e.def.name}</span><span class="muted">{app.familyLabel(e.def.family)}</span>
                </button>
                <IconButton icon="star" filled={favs.has(e.def.id)} pressed={favs.has(e.def.id)} label={t(favs.has(e.def.id) ? "indicators.favorite.remove" : "indicators.favorite.add", { name: e.def.name })} onClick={() => void app.toggleFavourite("favouriteStudies", e.def.id)} />
              </li>
            ))}
          </ul>
        </div>
      </div>
      <h3>{t("indicators.active", { count: active.length })}</h3>
      <ul class="results" data-testid="active-studies">
        {active.map((s) => (
          <li key={s.study.id} class="row">
            <span class="row-main static">{s.study.def.name}</span>
            <IconButton icon="gear" label={t("study.settings.title", { name: s.study.def.name })} onClick={() => app.openDialog({ kind: "study", id: s.study.id })} />
            <IconButton icon="trash" label={t("indicators.remove", { name: s.study.def.name })} onClick={() => app.removeStudy(s.study.id)} />
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

function InputControl({ def, value, onChange }: { def: StudyDef["inputs"][number]; value: InputValue; onChange: (v: InputValue) => void }) {
  if (def.type === "bool") return <Check label={def.label} checked={value === true} onChange={onChange} />;
  if (def.type === "select" || def.type === "source") {
    const opts = (def.options ?? []).map((o) => ({ value: o, label: o }));
    return <SelectField label={def.label} value={String(value)} options={opts} onChange={onChange} />;
  }
  return <NumberField label={def.label} value={Number(value)} {...(def.min !== undefined ? { min: def.min } : {})} {...(def.max !== undefined ? { max: def.max } : {})} step={def.type === "int" ? 1 : def.step ?? "any"} onChange={onChange} />;
}

export function StudyDialog({ id }: { id: string }) {
  const app = useApp();
  const t = useT();
  const inst = app.current;
  const slot = inst.studies().find((s) => s.study.id === id);
  const [tab, setTab] = useState("inputs");
  const [inputs, setInputs] = useState<Record<string, InputValue>>({ ...(slot?.study.inputs() ?? {}) });
  const [error, setError] = useState<string | null>(null);
  if (!slot) return null;
  const def = slot.study.def;
  const st = slot.study.state().styles;
  const apply = () => {
    try {
      slot.study.setInputs(inputs);
      inst.events.emit("change", undefined);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const colored = def.plots.filter((p) => "color" in p) as Array<{ key: string; title: string; color: string; width?: number; kind: string }>;
  const intervals = slot.intervals;
  const all = sortIntervals([...PRESET_INTERVALS]);
  return (
    <Dialog title={t("study.settings.title", { name: def.name })} onClose={() => app.closeDialog()} testid="study-dialog" footer={<><Button onClick={() => app.closeDialog()}>{t("common.close")}</Button><Button primary testid="study-apply" onClick={apply}>{t("common.apply")}</Button></>}>
      <Tabs label={t("study.settings.title", { name: def.name })} value={tab} onChange={setTab} tabs={[{ id: "inputs", label: t("study.tab.inputs") }, { id: "style", label: t("study.tab.style") }, { id: "visibility", label: t("study.tab.visibility") }]}>
        {tab === "inputs" ? (
          <div class="form">
            {def.inputs.length === 0 ? <p class="muted">{t("common.none")}</p> : null}
            {def.inputs.map((d) => <InputControl key={d.key} def={d} value={inputs[d.key] ?? d.default} onChange={(v) => setInputs({ ...inputs, [d.key]: v })} />)}
            {error ? <p class="error-text" role="alert">{error}</p> : null}
          </div>
        ) : tab === "style" ? (
          <div class="form">
            {colored.map((p) => (
              <fieldset key={p.key}>
                <legend>{p.title}</legend>
                <ColorField label={t("common.color")} value={st[p.key]?.color ?? p.color} onChange={(c) => (slot.study.setStyle(p.key, { color: c }), app.current.events.emit("change", undefined))} testid={`study-color-${p.key}`} />
                {p.kind === "line" || p.kind === "band" ? <NumberField label={t("study.style.lineWidth")} min={1} max={6} step={0.5} value={st[p.key]?.width ?? p.width ?? 1.5} onChange={(w) => slot.study.setStyle(p.key, { width: w })} /> : null}
              </fieldset>
            ))}
            <Check label={t("study.style.visible")} checked={!slot.userHidden} onChange={(v) => inst.setStudyHidden(id, !v)} />
          </div>
        ) : (
          <div class="form">
            <Check label={t("study.visibility.allIntervals")} checked={intervals === null} onChange={(v) => inst.setStudyIntervals(id, v ? null : [inst.interval])} />
            {intervals ? (
              <fieldset><legend>{t("study.visibility.intervals")}</legend>
                <div class="check-grid">{all.map((i) => <Check key={i} label={app.intervalLabel(i)} checked={intervals.includes(i)} onChange={(v) => inst.setStudyIntervals(id, v ? [...intervals, i] : intervals.filter((x) => x !== i))} />)}</div>
              </fieldset>
            ) : null}
          </div>
        )}
      </Tabs>
    </Dialog>
  );
}
