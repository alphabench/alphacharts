/** @jsxImportSource preact */
// Accessible building blocks: buttons, popovers and menus (arrow-key navigation, Escape,
// focus returned), dialogs (focus trap, Escape, focus restored), tabs and form fields.

import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { parseColor } from "@alphacharts/core";
import type { MenuItem } from "../engine/app.js";
import { Icon } from "./icons.js";
import { useApp, useRoot, useT } from "./context.js";

const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function IconButton(p: { icon: string; label: string; onClick?: (e: MouseEvent) => void | undefined; pressed?: boolean | undefined; disabled?: boolean | undefined; text?: string | undefined; class?: string | undefined; testid?: string | undefined; filled?: boolean | undefined; haspopup?: boolean | undefined; expanded?: boolean | undefined}) {
  return (
    <button
      type="button" class={`btn icon-btn ${p.class ?? ""}`} aria-label={p.label} title={p.label} disabled={p.disabled} data-testid={p.testid}
      aria-pressed={p.pressed === undefined ? undefined : p.pressed} aria-haspopup={p.haspopup ? "true" : undefined} aria-expanded={p.expanded === undefined ? undefined : p.expanded}
      onClick={p.onClick}
    >
      <Icon name={p.icon} filled={p.filled ?? false} />
      {p.text ? <span class="btn-text" aria-hidden="true">{p.text}</span> : null}
    </button>
  );
}

/** Focus the element that had focus when this component mounted, once it unmounts. */
export function useFocusReturn(): void {
  const root = useRoot();
  const prev = useRef<Element | null>(null);
  if (prev.current === null) prev.current = root.activeElement ?? null;
  useEffect(() => () => {
    const el = prev.current as HTMLElement | null;
    if (el && el.isConnected) el.focus({ preventScroll: true });
  }, []);
}

// Tab is cycled by hand, never left to the browser: Safari's default skips buttons, so relying on
// "wrap only at the first/last item" lets focus escape a modal dialog there.
function trap(e: KeyboardEvent, box: HTMLElement): void {
  if (e.key !== "Tab") return;
  e.preventDefault();
  const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
  if (items.length === 0) return box.focus();
  const at = items.indexOf((box.getRootNode() as ShadowRoot).activeElement as HTMLElement);
  const next = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : (at < 0 || at === items.length - 1 ? 0 : at + 1);
  items[next]!.focus();
}

export function Dialog(p: { title: string; onClose: () => void; children: ComponentChildren; footer?: ComponentChildren | undefined; wide?: boolean | undefined; testid?: string | undefined}) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const id = useRef(`dlg-${Math.random().toString(36).slice(2, 8)}`);
  useFocusReturn();
  // Layout effect: focus is inside before first paint, so anything that can see the dialog can also close it with Escape.
  useLayoutEffect(() => {
    const el = box.current!;
    (el.querySelector<HTMLElement>("[data-autofocus]") ?? el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus({ preventScroll: true });
  }, []);
  return (
    <div class="backdrop" onPointerDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div
        ref={box} class={`dialog${p.wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={id.current} tabIndex={-1} data-testid={p.testid}
        onKeyDown={(e) => {
          if (e.key === "Escape") (e.stopPropagation(), p.onClose());
          else trap(e, box.current!);
        }}
      >
        <header class="dialog-head">
          <h2 id={id.current}>{p.title}</h2>
          <IconButton icon="close" label={t("a11y.dialog.close")} onClick={p.onClose} />
        </header>
        <div class="dialog-body">{p.children}</div>
        {p.footer ? <footer class="dialog-foot">{p.footer}</footer> : null}
      </div>
    </div>
  );
}

/** Menu / popover anchored to an element or a point. Arrow keys move between its buttons. */
export function Popover(p: { label: string; at: { x: number; y: number } | HTMLElement; onClose: () => void; children: ComponentChildren; role?: "menu" | "dialog" | undefined; returnFocus?: HTMLElement | null | undefined; class?: string | undefined; testid?: string | undefined}) {
  const app = useApp();
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = box.current!;
    const host = app.host.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    let x: number, y: number;
    if (p.at instanceof HTMLElement) {
      const a = p.at.getBoundingClientRect();
      x = a.left;
      y = a.bottom + 4;
      if (document.dir === "rtl" || app.host.getAttribute("dir") === "rtl") x = a.right - r.width;
    } else (x = p.at.x, (y = p.at.y));
    x = Math.max(host.left + 4, Math.min(x, host.right - r.width - 4));
    y = Math.max(host.top + 4, Math.min(y, host.bottom - r.height - 4));
    setPos({ left: x - host.left, top: y - host.top });
  }, []);
  // Focus only once placed: a hidden element cannot take focus.
  useEffect(() => {
    if (!pos) return;
    const el = box.current!;
    (el.querySelector<HTMLElement>('[aria-checked="true"],[aria-pressed="true"],[data-current]') ?? el.querySelector<HTMLElement>("[data-autofocus]") ?? el.querySelector<HTMLElement>("button:not([disabled]),input"))?.focus({ preventScroll: true });
  }, [pos === null]);
  useEffect(() => {
    const el = box.current!;
    const down = (e: PointerEvent) => {
      if (!e.composedPath().includes(el)) p.onClose();
    };
    const t = setTimeout(() => app.host.shadowRoot!.addEventListener("pointerdown", down as EventListener, true), 0);
    return () => (clearTimeout(t), app.host.shadowRoot!.removeEventListener("pointerdown", down as EventListener, true));
  }, []);
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape") return (e.stopPropagation(), p.onClose());
    if (e.key === "Tab") return (e.preventDefault(), p.onClose());
    const nav = [...box.current!.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),[role^="menuitem"]:not([aria-disabled="true"])')];
    const i = nav.indexOf((box.current!.getRootNode() as ShadowRoot).activeElement as HTMLElement);
    const go = (n: number) => (e.preventDefault(), nav[(n + nav.length) % nav.length]?.focus());
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i < 0 ? nav.length - 1 : i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(nav.length - 1);
  };
  return (
    <div
      ref={box} class={`popover ${p.class ?? ""}`} role={p.role ?? "dialog"} aria-label={p.label} data-testid={p.testid}
      style={pos ? { left: `${pos.left}px`, top: `${pos.top}px` } : { visibility: "hidden", left: "0px", top: "0px" }} onKeyDown={key}
    >
      {p.children}
    </div>
  );
}

export function MenuView(p: { label: string; at: { x: number; y: number } | HTMLElement; items: MenuItem[]; onClose: () => void; testid?: string | undefined}) {
  const choose = (it: MenuItem) => {
    if (it.disabled || it.heading || it.separator) return;
    p.onClose();
    it.onSelect?.();
  };
  const groups: Array<{ label?: string; items: MenuItem[] }> = [{ items: [] }];
  for (const it of p.items) {
    if (it.separator) groups.push({ items: [] });
    else if (it.heading) groups.push({ label: it.label, items: [] });
    else groups[groups.length - 1]!.items.push(it);
  }
  return (
    <Popover label={p.label} at={p.at} onClose={p.onClose} role="menu" class="menu" testid={p.testid}>
      {groups.filter((g) => g.items.length).map((g, gi) => (
        <div role="group" aria-label={g.label ?? undefined} class="menu-group" key={gi}>
          {g.label ? <div class="menu-heading" aria-hidden="true">{g.label}</div> : null}
          {g.items.map((it) => (
            <button
              type="button" key={it.id} role={it.checked === undefined ? "menuitem" : "menuitemcheckbox"} aria-checked={it.checked === undefined ? undefined : it.checked}
              aria-disabled={it.disabled ? "true" : undefined} class={`menu-item${it.danger ? " danger" : ""}`} data-testid={`menu-${it.id}`} onClick={() => choose(it)}
            >
              <span class="menu-check" aria-hidden="true">{it.checked ? <Icon name="check" size={16} /> : null}</span>
              <span class="menu-label">{it.label}</span>
              {it.hint ? <span class="menu-hint">{it.hint}</span> : null}
            </button>
          ))}
        </div>
      ))}
    </Popover>
  );
}

export function Tabs(p: { tabs: Array<{ id: string; label: string }>; value: string; onChange: (id: string) => void; children: ComponentChildren; label: string }) {
  const key = (e: KeyboardEvent) => {
    const i = p.tabs.findIndex((x) => x.id === p.value);
    const n = e.key === "ArrowRight" || e.key === "ArrowDown" ? i + 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? p.tabs.length - 1 : null;
    if (n === null) return;
    e.preventDefault();
    const t = p.tabs[(n + p.tabs.length) % p.tabs.length]!;
    p.onChange(t.id);
    queueMicrotask(() => (e.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-tab="${t.id}"]`)?.focus());
  };
  return (
    <div class="tabs">
      <div class="tablist" role="tablist" aria-label={p.label} onKeyDown={key}>
        {p.tabs.map((t) => (
          <button type="button" role="tab" key={t.id} id={`tab-${t.id}`} data-tab={t.id} aria-selected={t.id === p.value} aria-controls={`panel-${t.id}`} tabIndex={t.id === p.value ? 0 : -1} class="tab" onClick={() => p.onChange(t.id)}>{t.label}</button>
        ))}
      </div>
      <div class="tabpanel" role="tabpanel" id={`panel-${p.value}`} aria-labelledby={`tab-${p.value}`}>{p.children}</div>
    </div>
  );
}

let uid = 0;
const useId = (): string => useRef(`f${++uid}`).current;

export function Field(p: { label: string; children: (id: string) => ComponentChildren; hint?: string | undefined}) {
  const id = useId();
  return (
    <div class="field">
      <label for={id}>{p.label}</label>
      {p.children(id)}
      {p.hint ? <span class="hint">{p.hint}</span> : null}
    </div>
  );
}

export function Check(p: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean | undefined; testid?: string | undefined}) {
  return (
    <label class="check">
      <input type="checkbox" checked={p.checked} disabled={p.disabled} data-testid={p.testid} onChange={(e) => p.onChange((e.currentTarget as HTMLInputElement).checked)} />
      <span>{p.label}</span>
    </label>
  );
}

export function NumberField(p: { label: string; value: number | null; placeholder?: string | undefined; onChange: (v: number) => void; min?: number | undefined; max?: number | undefined; step?: number | "any" | undefined; testid?: string | undefined}) {
  return (
    <Field label={p.label}>
      {(id) => (
        <input
          id={id} type="number" value={p.value ?? ""} placeholder={p.placeholder} min={p.min} max={p.max} step={p.step ?? "any"} data-testid={p.testid}
          onInput={(e) => {
            const v = (e.currentTarget as HTMLInputElement).valueAsNumber;
            if (Number.isFinite(v)) p.onChange(v);
          }}
        />
      )}
    </Field>
  );
}

export function SelectField<T extends string>(p: { label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; testid?: string | undefined}) {
  return (
    <Field label={p.label}>
      {(id) => (
        <select id={id} value={p.value} data-testid={p.testid} onChange={(e) => p.onChange((e.currentTarget as HTMLSelectElement).value as T)}>
          {p.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
    </Field>
  );
}

/** "#rrggbb" and alpha 0..1 of any colour the core reads. */
export function hexAlpha(css: string): { hex: string; alpha: number } {
  const c = parseColor(css);
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return { hex: `#${h((c >>> 24) & 255)}${h((c >>> 16) & 255)}${h((c >>> 8) & 255)}`, alpha: (c & 255) / 255 };
}

export function cssRgba(hex: string, alpha: number): string {
  if (alpha >= 1) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${Number(alpha.toFixed(3))})`;
}

export function ColorField(p: { label: string; value: string; onChange: (css: string) => void; alpha?: boolean | undefined; testid?: string | undefined}) {
  const t = useT();
  const { hex, alpha } = hexAlpha(p.value);
  return (
    <Field label={p.label}>
      {(id) => (
        <span class="color-row">
          <input id={id} type="color" value={hex} data-testid={p.testid} onInput={(e) => p.onChange(cssRgba((e.currentTarget as HTMLInputElement).value, p.alpha ? alpha : 1))} />
          {p.alpha ? (
            <input type="range" min="0" max="1" step="0.05" value={alpha} aria-label={`${p.label}: ${t("common.opacity")}`} onInput={(e) => p.onChange(cssRgba(hex, Number((e.currentTarget as HTMLInputElement).value)))} />
          ) : null}
        </span>
      )}
    </Field>
  );
}

export function Button(p: { children: ComponentChildren; onClick?: () => void | undefined; primary?: boolean | undefined; danger?: boolean | undefined; disabled?: boolean | undefined; type?: "button" | "submit" | undefined; testid?: string | undefined; autofocus?: boolean | undefined}) {
  return (
    <button type={p.type ?? "button"} class={`btn text-btn${p.primary ? " primary" : ""}${p.danger ? " danger" : ""}`} disabled={p.disabled} data-testid={p.testid} data-autofocus={p.autofocus ? "" : undefined} onClick={p.onClick}>
      {p.children}
    </button>
  );
}
