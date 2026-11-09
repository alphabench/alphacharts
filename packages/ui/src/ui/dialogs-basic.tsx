/** @jsxImportSource preact */
import { useEffect, useRef, useState } from "preact/hooks";
import type { ResolutionUnit } from "@alphacharts/core";
import type { SymbolInfo } from "../types.js";
import { PRESET_INTERVALS, UNITS, customInterval, intervalId, sortIntervals, unitKey } from "../model/intervals.js";
import { checkName } from "../model/persistence.js";
import { useApp, useT } from "./context.js";
import { Button, CommandEmpty, CommandGroup, CommandInput, CommandShortcut, Dialog, Field, IconButton, Input, Item, ItemGroup, SelectField, slot } from "./primitives.js";
import { Icon } from "./icons.js";

export function SymbolSearch({ purpose }: { purpose: "change" | "compare" }) {
  const app = useApp();
  const t = useT();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SymbolInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const [mode, setMode] = useState<"same" | "scale" | "pane">("same");
  const list = useRef<HTMLUListElement | null>(null);

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
    <Dialog title={t(purpose === "change" ? "symbol.search.title" : "symbol.compare.title")} command onClose={() => app.closeDialog()} testid="symbol-dialog">
      <div {...slot("command")}>
        <CommandInput
          type="text" value={q} placeholder={t("symbol.search.placeholder")} aria-label={t("symbol.search.placeholder")} testid="symbol-input"
          role="combobox" aria-expanded="true" aria-controls="symbol-list" aria-activedescendant={shown[sel] ? `sym-${sel}` : undefined} aria-autocomplete="list"
          onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} onKeyDown={key}
        />
        {purpose === "compare" ? (
          <div class="command-extra">
            <SelectField label={t("symbol.compare.title")} value={mode} options={[{ value: "same", label: t("symbol.compare.sameScale") }, { value: "scale", label: t("symbol.compare.newScale") }, { value: "pane", label: t("symbol.compare.newPane") }]} onChange={setMode} />
          </div>
        ) : null}
        {error ? <p class="error-text command-note" role="alert">{error}</p> : null}
        <p class="command-note" aria-live="polite">{results ? t("symbol.search.results", { count: results.length }) : shown.length ? t("symbol.search.recent") : ""}</p>
        {results && results.length === 0 && !error ? <CommandEmpty>{t("symbol.search.empty", { query: q })}</CommandEmpty> : null}
        <div {...slot("command-list")}>
          <CommandGroup listbox id="symbol-list" label={t("symbol.search.title")} testid="symbol-results" listRef={list}>
            {shown.map((s, i) => (
              <li
                key={s.symbol} id={`sym-${i}`} role="option" aria-selected={i === sel} {...slot("command-item")} data-selected={i === sel ? "" : undefined}
                data-testid={`symbol-option-${s.symbol}`} onPointerMove={() => setSel(i)} onClick={() => pick(s)}
              >
                <span {...slot("command-value")} class="sym"><bdi>{s.symbol}</bdi></span>
                <span {...slot("command-description")}>{s.name ?? ""}</span>
                <CommandShortcut>{[s.type ? (app.i18n.hasKey(`symbol.type.${s.type}` as never) ? t(`symbol.type.${s.type}` as never) : s.type) : "", s.exchange ?? ""].filter(Boolean).join(" · ")}</CommandShortcut>
              </li>
            ))}
          </CommandGroup>
        </div>
        {purpose === "compare" && cur.compareList().length ? (
          <ul class="chips command-extra" aria-label={t("symbol.compare.title")}>
            {cur.compareList().map((c) => (
              <li key={c.symbol}><Button variant="secondary" size="xs" label={t("symbol.compare.remove", { symbol: c.symbol })} onClick={() => cur.removeCompare(c.symbol)}><bdi>{c.symbol}</bdi><Icon name="close" /></Button></li>
            ))}
          </ul>
        ) : null}
      </div>
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
    <Dialog title={t("interval.label")} command onClose={() => app.closeDialog()} testid="interval-dialog">
      <div {...slot("command")}>
        <div {...slot("command-list")} class="interval-list">
          {UNITS.map((u) => {
            const items = all.filter((i) => i.replace(/^\d+/, "") === u);
            if (!items.length) return null;
            return (
              <CommandGroup key={u} heading={t(`interval.unit.${unitKey(u)}` as never)}>
                {items.map((i) => (
                  <li key={i} {...slot("command-row")}>
                    <button
                      type="button" {...slot("command-item")} aria-pressed={i === cur} data-current={i === cur ? "" : undefined} data-testid={`interval-option-${i}`}
                      onClick={() => choose(i)} onKeyDown={rove}
                    >
                      <span {...slot("command-value")}>{app.intervalLabel(i)}</span>
                      <CommandShortcut>{app.t(`interval.${unitKey(u)}` as never, { count: intervalCount(i) })}</CommandShortcut>
                      {i === cur ? <span {...slot("command-check")} aria-hidden="true"><Icon name="check" /></span> : null}
                    </button>
                    <IconButton
                      icon="star" size="icon-xs" filled={favs.has(i)} class={favs.has(i) ? "star star-on" : "star"} tip="right"
                      label={t(favs.has(i) ? "interval.favorite.remove" : "interval.favorite.add", { interval: app.intervalLabel(i) })} onClick={() => void app.toggleFavourite("favouriteIntervals", i)}
                    />
                  </li>
                ))}
              </CommandGroup>
            );
          })}
        </div>
        <form class="custom-interval" onSubmit={submit}>
          <h3 class="section-title">{t("interval.custom.title")}</h3>
          <div {...slot("field-row")}>
            <Field label={t("interval.custom.value")} error={error}>
              {(id) => <Input id={id} inputMode="numeric" value={value} testid="custom-interval-value" aria-invalid={error ? "true" : undefined} onInput={(e) => (setValue((e.currentTarget as HTMLInputElement).value), setError(null))} />}
            </Field>
            <SelectField label={t("interval.custom.unit")} value={unit} options={UNITS.map((u) => ({ value: u, label: t(`interval.unit.${unitKey(u)}` as never) }))} onChange={setUnit} testid="custom-interval-unit" />
            <Button type="submit" primary testid="custom-interval-add">{t("common.add")}</Button>
          </div>
        </form>
      </div>
    </Dialog>
  );
}

/** Arrow keys move between the items of a command list that has no search field. */
function rove(e: KeyboardEvent): void {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
  const list = (e.currentTarget as HTMLElement).closest('[data-slot="command-list"]')!;
  const items = [...list.querySelectorAll<HTMLElement>('[data-slot="command-item"]:not([disabled])')];
  const i = items.indexOf(e.currentTarget as HTMLElement);
  const n = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
  e.preventDefault();
  items[n]?.focus();
}

const intervalCount = (i: string): number => Number(/^\d+/.exec(i)![0]);
void intervalId;

export function ConfirmDialog(p: { message: string; confirmLabel: string; danger: boolean; onConfirm: () => void }) {
  const app = useApp();
  const t = useT();
  return (
    <Dialog title={p.confirmLabel} description={p.message} onClose={() => app.closeDialog()} testid="confirm-dialog" footer={<><Button onClick={() => app.closeDialog()}>{t("common.cancel")}</Button><Button primary={!p.danger} danger={p.danger} autofocus testid="confirm-ok" onClick={() => (app.closeDialog(), p.onConfirm())}>{p.confirmLabel}</Button></>}>{null}</Dialog>
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
      <form class="dialog-form" onSubmit={submit}>
        <Field label={p.label} error={err}>{(id) => <Input id={id} autofocus value={v} testid="prompt-input" aria-invalid={err ? "true" : undefined} onInput={(e) => (setV((e.currentTarget as HTMLInputElement).value), setErr(null))} />}</Field>
        <div {...slot("dialog-footer")}><Button onClick={() => app.closeDialog()}>{t("common.cancel")}</Button><Button type="submit" primary testid="prompt-ok">{t("common.save")}</Button></div>
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
        <ItemGroup label={t("layout.recent")}>
          {items.map((l) => (
            <Item key={l.name} actions={<>
              <IconButton icon="pencil" label={`${t("common.rename")}: ${l.name}`} onClick={() => app.openDialog({ kind: "prompt", title: t("layout.rename"), label: t("layout.name"), value: l.name, onSubmit: async (v) => { try { await app.layouts.rename(l.name, v); } catch (e) { app.report(e); } } })} />
              <IconButton icon="trash" label={`${t("layout.delete")}: ${l.name}`} onClick={() => app.confirm(t("layout.delete.confirm", { name: l.name }), t("common.delete"), () => void app.layouts.remove(l.name).then(refresh, (e) => app.report(e)), true)} />
            </>}>
              <button type="button" {...slot("item-content")} data-testid={`layout-open-${l.name}`} onClick={() => (app.closeDialog(), void app.loadLayout(l.name))}>
                <span {...slot("item-title")}>{l.name}</span><span {...slot("item-description")}>{app.i18n.dateTime(l.savedAt, { date: "medium", time: "minutes", timeZone: app.options.timeZone ?? "UTC" })}</span>
              </button>
            </Item>
          ))}
        </ItemGroup>
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
      <Button variant="secondary" class="self-start" testid="template-save" onClick={() => app.openDialog({ kind: "prompt", title: t("settings.template.save"), label: t("common.name"), value: "", onSubmit: async (v) => { await app.saveTemplate(v); } })}>{t("settings.template.save")}</Button>
      {items === null ? <p class="muted">{t("common.loading")}</p> : items.length === 0 ? <p class="muted">{t("common.none")}</p> : (
        <ItemGroup label={t("settings.template")}>
          {items.map((l) => (
            <Item key={l.name} actions={<IconButton icon="trash" label={`${t("common.delete")}: ${l.name}`} onClick={() => void app.templates.remove(l.name).then(refresh, (e) => app.report(e))} />}>
              <button type="button" {...slot("item-content")} data-testid={`template-apply-${l.name}`} onClick={() => (app.closeDialog(), void app.applyTemplate(l.name))}><span {...slot("item-title")}>{l.name}</span></button>
            </Item>
          ))}
        </ItemGroup>
      )}
    </Dialog>
  );
}
