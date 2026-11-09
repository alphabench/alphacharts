/** @jsxImportSource preact */
import { useEffect, useMemo, useState } from "preact/hooks";
import type { InputValue, StudyDef } from "@alphacharts/indicators";
import { FAMILIES, searchCatalogue, type StudyFamily } from "../model/studies.js";
import { PRESET_INTERVALS, sortIntervals } from "../model/intervals.js";
import { useApp, useT } from "./context.js";
import { Button, Check, ColorField, CommandEmpty, CommandGroup, CommandInput, Dialog, FieldSet, IconButton, Input, Item, ItemGroup, NumberField, SelectField, Tabs, TabsList, slot } from "./primitives.js";

function AssistantBox() {
  const app = useApp();
  const t = useT();
  const [prompt, setPrompt] = useState("");
  const a = app.assistant;
  const working = a.status === "working";
  const submit = (e: Event) => {
    e.preventDefault();
    if (prompt.trim() && !working) void app.askAssistant(prompt.trim());
  };
  return (
    <section class="assistant" aria-label={t("assistant.title")} data-testid="assistant">
      <form class="assistant-form" onSubmit={submit}>
        <Input type="text" value={prompt} placeholder={t("assistant.placeholder")} aria-label={t("assistant.title")} maxLength={2000} testid="assistant-prompt" onInput={(e) => setPrompt((e.currentTarget as HTMLInputElement).value)} />
        {/* One button whose label and action change, so focus stays on it while an ask runs. */}
        <Button primary={!working} type={working ? "button" : "submit"} disabled={!working && !prompt.trim()} testid={working ? "assistant-cancel" : "assistant-ask"} {...(working ? { onClick: () => app.cancelAssistant() } : {})}>{working ? t("common.cancel") : t("assistant.ask")}</Button>
      </form>
      <p class="muted" role="status">{working ? t("assistant.working") : ""}</p>
      {a.status === "failed" ? <p class="error-text" role="alert" data-testid="assistant-error">{a.message}</p> : null}
      {a.status === "ready" ? (
        <div class="assistant-review" data-testid="assistant-review">
          {a.explanation ? <p>{a.explanation}</p> : null}
          <pre class="assistant-code" tabIndex={0} aria-label={t("assistant.code")}><code>{a.script}</code></pre>
          <div class="assistant-actions">
            <Button primary size="sm" testid="assistant-add" onClick={() => app.addAssistantScript()}>{t("assistant.add")}</Button>
            {app.hasScript ? <Button size="sm" testid="assistant-edit" onClick={() => app.editAssistantScript()}>{t(app.scriptCode.trim() ? "assistant.editReplaces" : "assistant.edit")}</Button> : null}
            <Button size="sm" variant="ghost" testid="assistant-discard" onClick={() => app.cancelAssistant()}>{t("assistant.discard")}</Button>
          </div>
          <p class="muted">{t("assistant.replaces")}</p>
        </div>
      ) : null}
    </section>
  );
}

function AnalysesBox() {
  const app = useApp();
  const t = useT();
  return (
    <section class="analyses" aria-label={t("analyses.title")} data-testid="analyses">
      <h3 class="section-title">{t("analyses.title")}</h3>
      <div class="analyses-list">
        {app.analyses.map((a) => (
          <Button key={a.id} variant="secondary" size="sm" testid={`analysis-${a.id}`} disabled={app.analysisBusy !== null} onClick={() => void app.runAnalysis(a.id)}>{app.analysisBusy === a.id ? t("analyses.working") : a.name}</Button>
        ))}
      </div>
    </section>
  );
}

function MyScripts() {
  const app = useApp();
  const t = useT();
  const [items, setItems] = useState<Array<{ name: string }>>([]);
  const refresh = () => app.scripts.list().then(setItems, (e) => app.report(e));
  useEffect(() => void refresh(), []);
  if (items.length === 0) return null;
  return (
    <section class="my-scripts" aria-label={t("scripts.title")} data-testid="my-scripts">
      <h3 class="section-title">{t("scripts.title")}</h3>
      <ItemGroup label={t("scripts.title")}>
        {items.map((s) => (
          <Item key={s.name} actions={<>
            <IconButton icon="pencil" label={t("scripts.open", { name: s.name })} onClick={() => void app.openScript(s.name, false).catch((e) => app.report(e))} />
            <IconButton icon="trash" label={t("common.delete")} onClick={() => void app.scripts.remove(s.name).then(refresh, (e) => app.report(e))} />
          </>}>
            <button type="button" {...slot("item-content")} data-testid={`script-run-${s.name}`} aria-label={t("scripts.run", { name: s.name })} onClick={() => void app.openScript(s.name, true).catch((e) => app.report(e))}>
              <span {...slot("item-title")}>{s.name}</span><span {...slot("item-description")}>{t("scripts.run", { name: "" }).trim()}</span>
            </button>
          </Item>
        ))}
      </ItemGroup>
    </section>
  );
}

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
      {app.hasAssistant ? <AssistantBox /> : null}
      {app.analyses.length ? <AnalysesBox /> : null}
      {app.hasScript ? <MyScripts /> : null}
      <CommandInput type="search" value={q} placeholder={t("indicators.search")} aria-label={t("indicators.search")} testid="indicator-search" onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} />
      <div class="split">
        <TabsList
          vertical label={t("indicators.title")} value={tab} onChange={(id) => setTab(id as never)}
          tabs={([["all", t("indicators.tab.all")], ["favorites", t("indicators.tab.favorites")], ...FAMILIES.map((f) => [f, app.familyLabel(f)])] as Array<[string, string]>).map(([id, label]) => ({ id, label }))}
        />
        <div class="list-col">
          <p class="command-note" aria-live="polite">{app.catalogue ? t("symbol.search.results", { count: entries.length }) : t("common.loading")}</p>
          {app.catalogue && entries.length === 0 ? <CommandEmpty>{t("indicators.empty", { query: q })}</CommandEmpty> : null}
          <div {...slot("command-list")}>
            <CommandGroup label={t("indicators.title")} testid="indicator-results">
              {entries.slice(0, 300).map((e) => (
                <Item key={e.def.id} actions={
                  <IconButton icon="star" size="icon-xs" filled={favs.has(e.def.id)} class={favs.has(e.def.id) ? "star star-on" : "star"} label={t(favs.has(e.def.id) ? "indicators.favorite.remove" : "indicators.favorite.add", { name: e.def.name })} onClick={() => void app.toggleFavourite("favouriteStudies", e.def.id)} />
                }>
                  <button type="button" {...slot("item-content")} data-testid={`indicator-add-${e.def.id}`} aria-label={t("indicators.add", { name: e.def.name })} onClick={() => app.addStudy(e.def)}>
                    <span {...slot("item-title")}>{e.def.name}</span><span {...slot("item-description")}>{app.familyLabel(e.def.family)}</span>
                  </button>
                </Item>
              ))}
            </CommandGroup>
          </div>
        </div>
      </div>
      <h3 class="section-title">{t("indicators.active", { count: active.length })}</h3>
      <ItemGroup label={t("indicators.active", { count: active.length })} testid="active-studies">
        {active.map((s) => (
          <Item key={s.study.id} actions={<>
            <IconButton icon="gear" label={t("study.settings.title", { name: s.study.def.name })} onClick={() => app.openDialog({ kind: "study", id: s.study.id })} />
            <IconButton icon="trash" label={t("indicators.remove", { name: s.study.def.name })} onClick={() => app.removeStudy(s.study.id)} />
          </>}>
            <span {...slot("item-content")}><span {...slot("item-title")}>{s.study.def.name}</span></span>
          </Item>
        ))}
      </ItemGroup>
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
            {error ? <p data-slot="field-error" part="field-error" role="alert">{error}</p> : null}
          </div>
        ) : tab === "style" ? (
          <div class="form">
            {colored.map((p) => (
              <FieldSet key={p.key} legend={p.title}>
                <ColorField label={t("common.color")} value={st[p.key]?.color ?? p.color} onChange={(c) => (slot.study.setStyle(p.key, { color: c }), app.current.events.emit("change", undefined))} testid={`study-color-${p.key}`} />
                {p.kind === "line" || p.kind === "band" ? <NumberField label={t("study.style.lineWidth")} min={1} max={6} step={0.5} value={st[p.key]?.width ?? p.width ?? 1.5} onChange={(w) => slot.study.setStyle(p.key, { width: w })} /> : null}
              </FieldSet>
            ))}
            <Check label={t("study.style.visible")} checked={!slot.userHidden} onChange={(v) => inst.setStudyHidden(id, !v)} />
          </div>
        ) : (
          <div class="form">
            <Check label={t("study.visibility.allIntervals")} checked={intervals === null} onChange={(v) => inst.setStudyIntervals(id, v ? null : [inst.interval])} />
            {intervals ? (
              <FieldSet legend={t("study.visibility.intervals")}>
                <div class="check-grid">{all.map((i) => <Check key={i} label={app.intervalLabel(i)} checked={intervals.includes(i)} onChange={(v) => inst.setStudyIntervals(id, v ? [...intervals, i] : intervals.filter((x) => x !== i))} />)}</div>
              </FieldSet>
            ) : null}
          </div>
        )}
      </Tabs>
    </Dialog>
  );
}
