/** @jsxImportSource preact */
import { useEffect, useRef, useState } from "preact/hooks";
import type { ResolutionUnit } from "@alphacharts/core";
import type { SymbolInfo } from "../types.js";
import { PRESET_INTERVALS, UNITS, customInterval, intervalId, sortIntervals, unitKey } from "../model/intervals.js";
import { checkName } from "../model/persistence.js";
import { useApp, useT } from "./context.js";
import { Button, Dialog, Field, IconButton, SelectField } from "./primitives.js";
import { Icon } from "./icons.js";

export function SymbolSearch({ purpose }: { purpose: "change" | "compare" }) {
  const app = useApp();
  const t = useT();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SymbolInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const [mode, setMode] = useState<"same" | "scale" | "pane">("same");
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (q.trim() === "") return void setResults(null);
    const ac = new AbortController();
    const timer = setTimeout(() => {
      app.search(q.trim(), ac.signal).then(
        (r) => (setResults(r), setError(null), setSel(0)),
        (e) => !ac.signal.aborted && setError(t("symbol.search.error", { reason: e instanceof Error ? e.message : String(e) })),
      );
    }, 120);
    return () => (clearTimeout(timer), ac.abort());
  }, [q]);

  const recent: SymbolInfo[] = app.prefs.recentSymbols.map((symbol) => ({ symbol }));
  const shown = results ?? recent;
  const pick = (s: SymbolInfo) => {
    app.closeDialog();
    if (purpose === "change") app.setSymbol(s.symbol);
    else app.current.addCompare(s.symbol, mode).catch((e) => app.report(e));
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = Math.max(0, Math.min(shown.length - 1, sel + (e.key === "ArrowDown" ? 1 : -1)));
      setSel(n);
      list.current?.children[n]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && shown[sel]) {
      e.preventDefault();
      pick(shown[sel]!);
    }
  };
  const cur = app.current;
  return (
    <Dialog title={t(purpose === "change" ? "symbol.search.title" : "symbol.compare.title")} onClose={() => app.closeDialog()} testid="symbol-dialog">
      <div class="search-box">
        <Icon name="search" size={18} />
        <input
          type="text" data-autofocus value={q} placeholder={t("symbol.search.placeholder")} aria-label={t("symbol.search.placeholder")} data-testid="symbol-input"
          role="combobox" aria-expanded="true" aria-controls="symbol-list" aria-activedescendant={shown[sel] ? `sym-${sel}` : undefined} aria-autocomplete="list"
          onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} onKeyDown={key}
        />
      </div>
      {purpose === "compare" ? (
        <SelectField label={t("symbol.compare.title")} value={mode} options={[{ value: "same", label: t("symbol.compare.sameScale") }, { value: "scale", label: t("symbol.compare.newScale") }, { value: "pane", label: t("symbol.compare.newPane") }]} onChange={setMode} />
      ) : null}
      {error ? <p class="error-text" role="alert">{error}</p> : null}
      <p class="muted" aria-live="polite">{results ? t("symbol.search.results", { count: results.length }) : shown.length ? t("symbol.search.recent") : ""}</p>
      {results && results.length === 0 && !error ? <p class="muted">{t("symbol.search.empty", { query: q })}</p> : null}
      <ul class="results" id="symbol-list" role="listbox" aria-label={t("symbol.search.title")} ref={list} data-testid="symbol-results">
        {shown.map((s, i) => (
          <li key={s.symbol} id={`sym-${i}`} role="option" aria-selected={i === sel} class={i === sel ? "sel" : ""} data-testid={`symbol-option-${s.symbol}`} onPointerMove={() => setSel(i)} onClick={() => pick(s)}>
            <span class="sym"><bdi>{s.symbol}</bdi></span>
            <span class="desc">{s.name ?? ""}</span>
            <span class="meta">{[s.type ? (app.i18n.hasKey(`symbol.type.${s.type}` as never) ? t(`symbol.type.${s.type}` as never) : s.type) : "", s.exchange ?? ""].filter(Boolean).join(" · ")}</span>
          </li>
        ))}
      </ul>
      {purpose === "compare" && cur.compareList().length ? (
        <ul class="chips" aria-label={t("symbol.compare.title")}>
          {cur.compareList().map((c) => (
            <li key={c.symbol}><button type="button" class="btn chip" onClick={() => cur.removeCompare(c.symbol)} aria-label={t("symbol.compare.remove", { symbol: c.symbol })}><bdi>{c.symbol}</bdi> <Icon name="close" size={12} /></button></li>
          ))}
        </ul>
      ) : null}
    </Dialog>
  );
}

export function IntervalDialog() {
  const app = useApp();
  const t = useT();
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState<ResolutionUnit>("m");
  const [error, setError] = useState<string | null>(null);
  const cur = app.current.interval;
  const favs = new Set(app.favouriteIntervals());
  const all = sortIntervals([...new Set([...PRESET_INTERVALS, ...app.prefs.customIntervals, ...favs, cur])]);
  const choose = (i: string) => (app.closeDialog(), app.setInterval(i));
  const submit = (e: Event) => {
    e.preventDefault();
    const r = customInterval(value, unit);
    if (!r.ok) return setError(t("interval.custom.invalid", { max: r.max }));
    if (all.includes(r.interval)) return choose(r.interval);
    app.closeDialog();
    void app.addCustomInterval(r.interval);
  };
  return (
    <Dialog title={t("interval.label")} onClose={() => app.closeDialog()} testid="interval-dialog">
      <ul class="interval-list" aria-label={t("interval.label")}>
        {all.map((i) => (
          <li key={i} class="row">
            <button type="button" class="btn row-main" aria-pressed={i === cur} data-current={i === cur ? "" : undefined} data-testid={`interval-option-${i}`} onClick={() => choose(i)}>
              {app.intervalLabel(i)}<span class="muted"> · {app.t(`interval.${unitKey(i.replace(/^\d+/, "") as ResolutionUnit)}` as never, { count: intervalCount(i) })}</span>
            </button>
            <IconButton icon="star" filled={favs.has(i)} pressed={favs.has(i)} label={t(favs.has(i) ? "interval.favorite.remove" : "interval.favorite.add", { interval: app.intervalLabel(i) })} onClick={() => void app.toggleFavourite("favouriteIntervals", i)} />
          </li>
        ))}
      </ul>
      <form class="custom-interval" onSubmit={submit}>
        <h3>{t("interval.custom.title")}</h3>
        <Field label={t("interval.custom.value")}>
          {(id) => <input id={id} inputMode="numeric" value={value} data-testid="custom-interval-value" aria-invalid={error ? "true" : undefined} onInput={(e) => (setValue((e.currentTarget as HTMLInputElement).value), setError(null))} />}
        </Field>
        <SelectField label={t("interval.custom.unit")} value={unit} options={UNITS.map((u) => ({ value: u, label: t(`interval.${unitKey(u)}` as never, { count: 2 }) }))} onChange={setUnit} testid="custom-interval-unit" />
        {error ? <p class="error-text" role="alert">{error}</p> : null}
        <Button type="submit" primary testid="custom-interval-add">{t("common.add")}</Button>
      </form>
    </Dialog>
  );
}

const intervalCount = (i: string): number => Number(/^\d+/.exec(i)![0]);
void intervalId;

export function ConfirmDialog(p: { message: string; confirmLabel: string; danger: boolean; onConfirm: () => void }) {
  const app = useApp();
  const t = useT();
  return (
    <Dialog title={p.confirmLabel} onClose={() => app.closeDialog()} testid="confirm-dialog" footer={<><Button onClick={() => app.closeDialog()}>{t("common.cancel")}</Button><Button primary={!p.danger} danger={p.danger} autofocus testid="confirm-ok" onClick={() => (app.closeDialog(), p.onConfirm())}>{p.confirmLabel}</Button></>}>
      <p>{p.message}</p>
    </Dialog>
  );
}

export function PromptDialog(p: { title: string; label: string; value: string; onSubmit: (v: string) => void | Promise<void> }) {
  const app = useApp();
  const t = useT();
  const [v, setV] = useState(p.value);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: Event) => {
    e.preventDefault();
    try {
      const name = checkName(v);
      app.closeDialog();
      await p.onSubmit(name);
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x));
    }
  };
  return (
    <Dialog title={p.title} onClose={() => app.closeDialog()} testid="prompt-dialog">
      <form onSubmit={submit}>
        <Field label={p.label}>{(id) => <input id={id} data-autofocus value={v} data-testid="prompt-input" aria-invalid={err ? "true" : undefined} onInput={(e) => (setV((e.currentTarget as HTMLInputElement).value), setErr(null))} />}</Field>
        {err ? <p class="error-text" role="alert">{err}</p> : null}
        <div class="actions"><Button onClick={() => app.closeDialog()}>{t("common.cancel")}</Button><Button type="submit" primary testid="prompt-ok">{t("common.save")}</Button></div>
      </form>
    </Dialog>
  );
}

/** Saved layouts: open, rename, delete. */
export function LayoutsDialog() {
  const app = useApp();
  const t = useT();
  const [items, setItems] = useState<Array<{ name: string; savedAt: number }> | null>(null);
  const refresh = () => app.layouts.list().then(setItems, (e) => app.report(e));
  useEffect(() => void refresh(), []);
  return (
    <Dialog title={t("layout.load")} onClose={() => app.closeDialog()} testid="layouts-dialog">
      {items === null ? <p class="muted">{t("common.loading")}</p> : items.length === 0 ? <p class="muted">{t("layout.empty")}</p> : (
        <ul class="named-list" aria-label={t("layout.recent")}>
          {items.map((l) => (
            <li key={l.name} class="row">
              <button type="button" class="btn row-main" data-testid={`layout-open-${l.name}`} onClick={() => (app.closeDialog(), void app.loadLayout(l.name))}>
                <span>{l.name}</span><span class="muted">{app.i18n.dateTime(l.savedAt, { date: "medium", time: "minutes", timeZone: app.options.timeZone ?? "UTC" })}</span>
              </button>
              <IconButton icon="pencil" label={`${t("common.rename")}: ${l.name}`} onClick={() => app.openDialog({ kind: "prompt", title: t("layout.rename"), label: t("layout.name"), value: l.name, onSubmit: async (v) => { try { await app.layouts.rename(l.name, v); } catch (e) { app.report(e); } } })} />
              <IconButton icon="trash" label={`${t("layout.delete")}: ${l.name}`} onClick={() => app.confirm(t("layout.delete.confirm", { name: l.name }), t("common.delete"), () => void app.layouts.remove(l.name).then(refresh, (e) => app.report(e)), true)} />
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

/** Chart templates (studies + style) and drawing templates of the selected drawing's tool. */
export function TemplatesDialog() {
  const app = useApp();
  const t = useT();
  const [items, setItems] = useState<Array<{ name: string; savedAt: number }> | null>(null);
  const refresh = () => app.templates.list().then(setItems, (e) => app.report(e));
  useEffect(() => void refresh(), []);
  return (
    <Dialog title={t("settings.template")} onClose={() => app.closeDialog()} testid="templates-dialog">
      <Button primary testid="template-save" onClick={() => app.openDialog({ kind: "prompt", title: t("settings.template.save"), label: t("common.name"), value: "", onSubmit: async (v) => { await app.saveTemplate(v); } })}>{t("settings.template.save")}</Button>
      {items === null ? <p class="muted">{t("common.loading")}</p> : items.length === 0 ? <p class="muted">{t("common.none")}</p> : (
        <ul class="named-list" aria-label={t("settings.template")}>
          {items.map((l) => (
            <li key={l.name} class="row">
              <button type="button" class="btn row-main" data-testid={`template-apply-${l.name}`} onClick={() => (app.closeDialog(), void app.applyTemplate(l.name))}>{l.name}</button>
              <IconButton icon="trash" label={`${t("common.delete")}: ${l.name}`} onClick={() => void app.templates.remove(l.name).then(refresh, (e) => app.report(e))} />
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
