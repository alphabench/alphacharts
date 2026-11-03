/** @jsxImportSource preact */
import { useState } from "preact/hooks";
import type { Condition, TriggerMode } from "@alphacharts/alerts";
import { DRAWING_LINES } from "@alphacharts/alerts";
import type { AlertPrefill } from "../engine/app.js";
import { useApp, useT } from "./context.js";
import { Button, Dialog, Field, IconButton, NumberField, SelectField } from "./primitives.js";

type Op = "crossing" | "crossingUp" | "crossingDown" | "greaterThan" | "lessThan" | "enteringChannel" | "exitingChannel" | "movingUp" | "movingDown";
const PRICE_OPS: Op[] = ["crossing", "crossingUp", "crossingDown", "greaterThan", "lessThan", "enteringChannel", "exitingChannel", "movingUp", "movingDown"];

export function AlertDialog({ prefill }: { prefill?: AlertPrefill | undefined }) {
  const app = useApp();
  const t = useT();
  const inst = app.current;
  const lastPrice = inst.raw.length ? inst.raw.at(inst.raw.length - 1).close : 0;
  const [kind, setKind] = useState<"price" | "indicator" | "drawing">(prefill?.kind ?? "price");
  const [op, setOp] = useState<Op>("crossing");
  const [price, setPrice] = useState(prefill?.price ?? lastPrice);
  const [high, setHigh] = useState(prefill?.price ?? lastPrice);
  const [bars, setBars] = useState(5);
  const [amount, setAmount] = useState(0);
  const studies = inst.studies();
  const [studyId, setStudyId] = useState(prefill?.studyId ?? studies[0]?.study.id ?? "");
  const drawings = inst.drawingList().filter((d) => d.tool in DRAWING_LINES);
  const [drawingId, setDrawingId] = useState(prefill?.drawingId ?? drawings[0]?.id ?? "");
  const [line, setLine] = useState("main");
  const [mode, setMode] = useState<TriggerMode>(app.alertDefaults.mode);
  const [expiry, setExpiry] = useState("");
  const [label, setLabel] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const study = studies.find((s) => s.study.id === studyId)?.study;
  const [col, setCol] = useState(study?.def.columns[0] ?? "");
  const dr = drawings.find((d) => d.id === drawingId);
  const lines = dr ? DRAWING_LINES[dr.tool] ?? [] : [];

  const submit = (e: Event) => {
    e.preventDefault();
    try {
      const expiresAt = expiry ? Date.parse(expiry + "Z") : null;
      if (expiry && !Number.isFinite(expiresAt)) throw new Error(t("alerts.expiration"));
      const o = { ...(label ? { label } : {}), expiresAt };
      const trigger = { mode };
      if (kind === "drawing") {
        const dop = op === "crossingUp" || op === "crossingDown" || op === "enteringChannel" || op === "exitingChannel" ? op : "crossing";
        inst.addDrawingAlert(drawingId, line || lines[0]!, dop, trigger, o);
      } else {
        let c: Condition;
        if (kind === "indicator") {
          const iop = op === "greaterThan" || op === "lessThan" || op === "crossing" || op === "crossingUp" || op === "crossingDown" ? op : "crossing";
          c = { type: "indicator", id: `${studyId}:${col}`, op: iop, value: price };
        } else if (op === "crossing" || op === "crossingUp" || op === "crossingDown") c = { type: "crossing", price, direction: op === "crossing" ? "any" : op === "crossingUp" ? "up" : "down" };
        else if (op === "greaterThan" || op === "lessThan") c = { type: op, price };
        else if (op === "enteringChannel" || op === "exitingChannel") c = { type: op, low: Math.min(price, high), high: Math.max(price, high) };
        else c = { type: "moving", direction: op === "movingUp" ? "up" : "down", bars, amount };
        inst.addAlert(c, trigger, o);
      }
      app.toast("info", t("alerts.created", { symbol: inst.symbol }));
      app.closeDialog();
    } catch (x) {
      setErr(t("alerts.error", { reason: x instanceof Error ? x.message : String(x) }));
    }
  };
  const kinds = [{ value: "price" as const, label: t("ui.alert.price") }, { value: "indicator" as const, label: t("ui.alert.indicator"), }, { value: "drawing" as const, label: t("ui.alert.drawing") }].filter((k) => k.value === "price" || (k.value === "indicator" ? studies.length > 0 : drawings.length > 0));
  const needsHigh = op === "enteringChannel" || op === "exitingChannel";
  const ops = kind === "price" ? PRICE_OPS : kind === "indicator" ? PRICE_OPS.slice(0, 5) : (["crossing", "crossingUp", "crossingDown", "enteringChannel", "exitingChannel"] as Op[]);
  return (
    <Dialog title={t("alerts.create.on", { symbol: inst.symbol })} onClose={() => app.closeDialog()} testid="alert-dialog">
      <form class="form" onSubmit={submit}>
        <SelectField label={t("ui.alert.source")} value={kind} options={kinds} onChange={(k) => { setKind(k); setOp("crossing"); }} testid="alert-kind" />
        {kind === "indicator" ? (<>
          <SelectField label={t("toolbar.indicators")} value={studyId} options={studies.map((s) => ({ value: s.study.id, label: s.study.def.name }))} onChange={(v) => { setStudyId(v); setCol(studies.find((s) => s.study.id === v)?.study.def.columns[0] ?? ""); }} />
          <SelectField label={t("ui.alert.column")} value={col} options={(study?.def.columns ?? []).map((c) => ({ value: c, label: c }))} onChange={setCol} />
        </>) : null}
        {kind === "drawing" ? (<>
          <SelectField label={t("ui.alert.drawing")} value={drawingId} options={drawings.map((d) => ({ value: d.id, label: `${app.toolLabel(d.tool)} ${d.id}` }))} onChange={setDrawingId} />
          <SelectField label={t("ui.alert.line")} value={line} options={lines.map((l) => ({ value: l, label: l }))} onChange={setLine} />
        </>) : null}
        <SelectField label={t("alerts.condition")} value={op} options={ops.map((o) => ({ value: o, label: t(`alerts.condition.${o}` as never) }))} onChange={setOp} testid="alert-op" />
        {kind !== "drawing" && !(op === "movingUp" || op === "movingDown") ? <NumberField label={needsHigh ? t("ui.alert.low") : t("alerts.value")} value={price} onChange={setPrice} testid="alert-value" /> : null}
        {needsHigh && kind === "price" ? <NumberField label={t("ui.alert.high")} value={high} onChange={setHigh} /> : null}
        {op === "movingUp" || op === "movingDown" ? (<><NumberField label={t("unit.bars", { count: 2 })} min={1} step={1} value={bars} onChange={setBars} /><NumberField label={t("alerts.value")} min={0} value={amount} onChange={setAmount} /></>) : null}
        <SelectField label={t("alerts.trigger")} value={mode} options={(["once", "everyTime", "oncePerBar", "oncePerBarClose"] as TriggerMode[]).map((m) => ({ value: m, label: t(`alerts.trigger.${m}` as never) }))} onChange={setMode} testid="alert-trigger" />
        <Field label={t("alerts.expiration")} hint={`${t("alerts.expiration.never")} · ${t("format.timeZone.utc")}`}>{(id) => <input id={id} type="datetime-local" value={expiry} onChange={(e) => setExpiry((e.currentTarget as HTMLInputElement).value)} />}</Field>
        <Field label={t("alerts.message")}>{(id) => <input id={id} value={label} data-testid="alert-label" onInput={(e) => setLabel((e.currentTarget as HTMLInputElement).value)} />}</Field>
        {err ? <p class="error-text" role="alert">{err}</p> : null}
        <div class="actions"><Button onClick={() => app.closeDialog()}>{t("common.cancel")}</Button><Button type="submit" primary testid="alert-create">{t("alerts.create")}</Button></div>
      </form>
    </Dialog>
  );
}

export function AlertsPanel() {
  const app = useApp();
  const t = useT();
  const inst = app.current;
  const list = inst.alertList();
  const fmt = (n: number) => (inst.main ?? inst.displaySeries[0])?.formatPrice(n) ?? String(n);
  const describe = (c: Condition): string => {
    switch (c.type) {
      case "crossing": return `${t(`alerts.condition.${c.direction === "any" ? "crossing" : c.direction === "up" ? "crossingUp" : "crossingDown"}` as never)} ${fmt(c.price)}`;
      case "greaterThan": case "lessThan": return `${t(`alerts.condition.${c.type}` as never)} ${fmt(c.price)}`;
      case "enteringChannel": case "exitingChannel": return `${t(`alerts.condition.${c.type}` as never)} ${fmt(c.low)} – ${fmt(c.high)}`;
      case "moving": return `${t(c.direction === "up" ? "alerts.condition.movingUp" : "alerts.condition.movingDown")}`;
      case "indicator": return `${c.id} ${t(`alerts.condition.${c.op}` as never)} ${typeof c.value === "number" ? c.value : c.value.id}`;
      case "drawing": return `${app.toolLabel(c.drawing.tool)} ${c.line}`;
    }
  };
  return (
    <Dialog title={t("alerts.title")} onClose={() => app.closeDialog()} wide testid="alerts-dialog" footer={<Button primary testid="alerts-new" onClick={() => app.openDialog({ kind: "alert" })}>{t("alerts.create")}</Button>}>
      <h3>{t("alerts.count", { count: list.length })}</h3>
      {inst.pausedAlerts() > 0 ? <p class="muted" data-testid="alerts-paused" role="status">{t("ui.alert.paused", { count: inst.pausedAlerts() })}</p> : null}
      {list.length === 0 ? <p class="muted">{t("alerts.empty")}</p> : (
        <ul class="named-list" data-testid="alert-list" aria-label={t("alerts.title")}>
          {list.map((a) => (
            <li key={a.definition.id} class="row" data-status={a.status}>
              <span class="row-main static"><span>{a.definition.label ?? describe(a.definition.condition)}</span><span class="muted">{a.definition.label ? describe(a.definition.condition) : ""}</span></span>
              <span class={`badge ${a.status}`} data-testid="alert-status">{a.status === "active" ? t("alerts.status.active") : a.status === "triggered" ? t("alerts.status.triggered") : a.status === "expired" ? t("alerts.status.expired") : a.status}</span>
              <IconButton icon="trash" label={`${t("alerts.delete")}: ${describe(a.definition.condition)}`} onClick={() => inst.removeAlert(a.definition.id)} />
            </li>
          ))}
        </ul>
      )}
      <h3>{t("ui.alert.log")}</h3>
      {app.alertLog.length === 0 ? <p class="muted">{t("common.none")}</p> : (
        <ul class="named-list" data-testid="alert-log" aria-label={t("ui.alert.log")}>
          {app.alertLog.map((l, i) => <li key={i} class="row"><span class="row-main static"><bdi>{l.symbol}</bdi> {l.priceText}</span><span class="muted">{app.i18n.dateTime(l.time, { date: "medium", time: "seconds", timeZone: inst.chart.options().timeZone })}</span></li>)}
        </ul>
      )}
    </Dialog>
  );
}
