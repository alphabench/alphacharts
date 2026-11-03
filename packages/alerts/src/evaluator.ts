// The alert evaluator: the single implementation of alert semantics. The chart
// plugin and a backend both run this class on the same definitions and ticks.
//
// Per tick, for each active alert:
// 1. a tick whose bar differs from the last one closes the last bar;
// 2. "bar close" alerts evaluate their condition on that closing tick (the
//    last tick of the closed bar), at most once per bar, and nowhere else;
// 3. every other mode evaluates the condition on the tick itself;
// 4. the trigger mode and the debounce decide whether a fired condition
//    becomes a trigger.
// Ticks must be in time order and bars never reopen; anything else throws.

import { makeStepper, validateCondition, type EvalEnv, type Stepper } from "./conditions.js";
import { ALERTS_VERSION, type AlertDefinition, type AlertStatus, type AlertsState, type AlertTrigger, type Tick, type TriggerMode } from "./types.js";

const MODES: readonly TriggerMode[] = ["once", "oncePerBar", "oncePerBarClose", "everyTime"];

export function validateAlert(a: AlertDefinition): void {
  if (typeof a.id !== "string" || !a.id) throw new TypeError("alerts: an alert needs a string id");
  validateCondition(a.condition);
  if (!MODES.includes(a.trigger?.mode)) throw new RangeError(`alerts: "${a.id}" trigger mode must be one of ${MODES.join(", ")}`);
  const db = a.trigger.debounceMs;
  if (db !== undefined && (!Number.isFinite(db) || db < 0)) throw new RangeError(`alerts: "${a.id}" debounceMs must be ≥ 0`);
  if (a.expiresAt !== undefined && a.expiresAt !== null && !Number.isFinite(a.expiresAt)) throw new RangeError(`alerts: "${a.id}" expiresAt must be a finite time`);
}

interface Runtime {
  def: AlertDefinition;
  stepper: Stepper;
  status: AlertStatus;
  count: number;
  lastTriggerTime: number | null;
  lastTriggerBar: number | null;
  /** Previous tick price this alert's stepper saw. */
  prevPrice: number | null;
  error: string | null;
}

export interface AlertRuntime {
  id: string;
  status: AlertStatus;
  count: number;
  lastTriggerTime: number | null;
  lastTriggerBar: number | null;
}

export class AlertEvaluator {
  private readonly alerts = new Map<string, Runtime>();
  private current: { bar: number; last: Tick } | null = null;
  private lastTime = -Infinity;
  private closedUpTo = -Infinity;

  constructor(defs: readonly AlertDefinition[] = [], private readonly env: EvalEnv = {}) {
    for (const d of defs) this.add(d);
  }

  add(def: AlertDefinition, status: AlertStatus = "active", runtime?: AlertRuntime): void {
    validateAlert(def);
    if (this.alerts.has(def.id)) throw new Error(`alerts: duplicate alert id "${def.id}"`);
    this.alerts.set(def.id, {
      def: structuredClone(def), stepper: makeStepper(def.condition, this.env), status, count: 0,
      lastTriggerTime: null, lastTriggerBar: null, prevPrice: null, error: null,
    });
    if (runtime) Object.assign(this.alerts.get(def.id)!, { count: runtime.count, lastTriggerTime: runtime.lastTriggerTime, lastTriggerBar: runtime.lastTriggerBar });
  }

  remove(id: string): void {
    this.alerts.delete(id);
  }

  /** Replace an alert's definition and restart its state (status active). */
  replace(def: AlertDefinition): void {
    this.remove(def.id);
    this.add(def);
  }

  /** Change a definition but keep its status and trigger history (a watched drawing moved). The condition restarts. */
  update(def: AlertDefinition): void {
    const r = this.alerts.get(def.id);
    if (!r) throw new Error(`alerts: no alert "${def.id}"`);
    validateAlert(def);
    r.def = structuredClone(def);
    r.stepper = makeStepper(def.condition, this.env);
    r.prevPrice = null;
  }

  /** Status and trigger history of every alert: persist it with the definitions so a restart does not re-fire spent alerts. */
  runtime(): AlertRuntime[] {
    return [...this.alerts.values()].map((r) => ({ id: r.def.id, status: r.status, count: r.count, lastTriggerTime: r.lastTriggerTime, lastTriggerBar: r.lastTriggerBar }));
  }

  /** Message of the error that stopped an alert (status "error"), or null. */
  error(id: string): string | null {
    const r = this.alerts.get(id);
    if (!r) throw new Error(`alerts: no alert "${id}"`);
    return r.error;
  }

  setStatus(id: string, status: AlertStatus): void {
    const r = this.alerts.get(id);
    if (!r) throw new Error(`alerts: no alert "${id}"`);
    r.status = status;
  }

  definitions(): AlertDefinition[] {
    return [...this.alerts.values()].map((r) => structuredClone(r.def));
  }

  status(id: string): AlertStatus {
    const r = this.alerts.get(id);
    if (!r) throw new Error(`alerts: no alert "${id}"`);
    return r.status;
  }

  toJSON(): AlertsState {
    return { version: ALERTS_VERSION, alerts: this.definitions() };
  }

  /**
   * A new tick series begins (another symbol or interval): the order checks
   * restart, so bars and times earlier than the old series' are accepted, and
   * what each alert remembered of the old series (the previous price, the
   * moving window, the bar it last fired on) is dropped. Status, trigger
   * counts and the time of the last trigger stay. `keepTriggerBars`: bar times
   * still mean the same thing (same interval), so "once per bar" alerts keep
   * the bar they last fired on and do not fire a second time on it.
   */
  resetClock(o: { keepTriggerBars?: boolean } = {}): void {
    this.current = null;
    this.lastTime = -Infinity;
    this.closedUpTo = -Infinity;
    for (const r of this.alerts.values()) {
      r.stepper = makeStepper(r.def.condition, this.env);
      r.prevPrice = null;
      if (!o.keepTriggerBars) r.lastTriggerBar = null;
    }
  }

  /** Feed one tick; returns the triggers it caused, in alert order. */
  tick(t: Tick): AlertTrigger[] {
    if (![t.time, t.price, t.bar].every(Number.isFinite)) throw new TypeError(`alerts: tick must be finite numbers, got ${JSON.stringify(t)}`);
    if (t.time < this.lastTime) throw new RangeError(`alerts: tick at ${t.time} is before the previous tick at ${this.lastTime}`);
    if (t.bar <= this.closedUpTo) throw new RangeError(`alerts: tick for bar ${t.bar}, which was already closed`);
    const out: AlertTrigger[] = [];
    if (this.current && t.bar < this.current.bar) throw new RangeError(`alerts: tick for bar ${t.bar} after bar ${this.current.bar} started`);
    if (this.current && t.bar > this.current.bar) {
      this.closeCurrent(t.time, out);
    }
    this.lastTime = t.time;
    for (const r of this.alerts.values()) {
      if (r.status !== "active") continue;
      if (r.def.expiresAt != null && t.time >= r.def.expiresAt) {
        r.status = "expired";
        continue;
      }
      if (r.def.trigger.mode === "oncePerBarClose") continue;
      this.guard(r, () => this.evaluate(r, t, t, out));
    }
    this.current = { bar: t.bar, last: t };
    return out;
  }

  /** Close the current bar now (end of session, a feed that reports closes): bar-close alerts evaluate its last tick. */
  closeBar(time: number): AlertTrigger[] {
    if (!this.current) throw new Error("alerts: closeBar with no bar open");
    if (time < this.lastTime) throw new RangeError(`alerts: closeBar at ${time} is before the last tick at ${this.lastTime}`);
    this.lastTime = time;
    const out: AlertTrigger[] = [];
    this.closeCurrent(time, out);
    return out;
  }

  private closeCurrent(time: number, out: AlertTrigger[]): void {
    const cur = this.current!;
    for (const r of this.alerts.values()) {
      if (r.status !== "active" || r.def.trigger.mode !== "oncePerBarClose") continue;
      if (r.def.expiresAt != null && time >= r.def.expiresAt) {
        r.status = "expired";
        continue;
      }
      this.guard(r, () => this.evaluate(r, cur.last, { ...cur.last, time }, out));
    }
    this.closedUpTo = cur.bar;
    this.current = null;
  }

  /** An alert that throws stops (status "error") without taking the others, or their triggers, down with it. */
  private guard(r: Runtime, f: () => void): void {
    try {
      f();
    } catch (e) {
      r.status = "error";
      r.error = e instanceof Error ? e.message : String(e);
    }
  }

  /** Step one alert on `tick`; report a trigger at `at.time`. */
  private evaluate(r: Runtime, tick: Tick, at: Tick, out: AlertTrigger[]): void {
    const prev = r.prevPrice;
    const res = r.stepper.step(tick, prev);
    r.prevPrice = tick.price;
    if (!res || !res.fired) return;
    const { mode, debounceMs } = r.def.trigger;
    if (mode === "oncePerBar" && r.lastTriggerBar === tick.bar) return;
    if (debounceMs && r.lastTriggerTime !== null && at.time - r.lastTriggerTime < debounceMs) return;
    r.count++;
    r.lastTriggerTime = at.time;
    r.lastTriggerBar = tick.bar;
    if (mode === "once") r.status = "triggered";
    out.push({
      alertId: r.def.id, label: r.def.label, mode, condition: r.def.condition.type,
      time: at.time, bar: tick.bar, price: tick.price, prevPrice: prev, values: res.values, seq: r.count,
    });
  }
}

/** Run definitions over a tick sequence and return every trigger in order. */
export function evaluate(defs: readonly AlertDefinition[], ticks: readonly Tick[], env: EvalEnv = {}): AlertTrigger[] {
  const ev = new AlertEvaluator(defs, env);
  return ticks.flatMap((t) => ev.tick(t));
}
