/** @jsxImportSource preact */
// The shell's components, built like shadcn/ui's (the Luma style): the same parts, variants and sizes, marked with the same
// `data-slot` names, plus `part` of that name so a host can restyle one from outside the shadow root
// (`alpha-chart-app::part(dropdown-menu-item) { ... }`). Their recipes are in styles/components.ts.
//
// Behaviour is ours and accessible: popovers and menus (arrow keys, Escape, focus returned), dialogs (focus trap, Escape, focus
// restored), tabs, a listbox select, and a tooltip on hover and keyboard focus.

import { Fragment, type ComponentChildren, type JSX } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { parseColor, resolveColor } from "@alphacharts/core";
import type { MenuItem } from "../engine/app.js";
import { Icon } from "./icons.js";
import { useApp, useRoot, useT } from "./context.js";

const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** `data-slot` and `part`: the name a host's CSS finds a component by. */
export const slot = (name: string): { "data-slot": string; part: string } => ({ "data-slot": name, part: name });

export type ButtonVariant = "default" | "outline" | "secondary" | "ghost" | "destructive" | "link";
export type ButtonSize = "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm";

/** Where a tooltip opens: the side of its trigger. */
export type TipSide = "top" | "bottom" | "left" | "right";

export function Button(p: {
  children: ComponentChildren; onClick?: ((e: MouseEvent) => void) | undefined; variant?: ButtonVariant | undefined; size?: ButtonSize | undefined;
  /** Shorthands kept for the dialogs: the primary action, and a destructive one. */
  primary?: boolean | undefined; danger?: boolean | undefined; disabled?: boolean | undefined; type?: "button" | "submit" | undefined;
  testid?: string | undefined; autofocus?: boolean | undefined; class?: string | undefined; label?: string | undefined;
  haspopup?: "dialog" | "menu" | "listbox" | undefined; tip?: string | undefined;
}) {
  const variant = p.variant ?? (p.danger ? "destructive" : p.primary ? "default" : "outline");
  return (
    <button
      type={p.type ?? "button"} {...slot("button")} data-variant={variant} data-size={p.size ?? "default"} class={p.class} aria-label={p.label} aria-haspopup={p.haspopup} data-tip={p.tip}
      disabled={p.disabled} data-testid={p.testid} data-autofocus={p.autofocus ? "" : undefined} onClick={p.onClick}
    >
      {p.children}
    </button>
  );
}

/**
 * A ghost icon button, with a tooltip of its label. Given `pressed`, it is a Toggle (`aria-pressed`, the muted fill when on).
 * `text` adds a short tag after the icon (the magnet's W or S).
 */
export function IconButton(p: {
  icon: string; label: string; onClick?: ((e: MouseEvent) => void) | undefined; pressed?: boolean | undefined; disabled?: boolean | undefined;
  text?: string | undefined; class?: string | undefined; testid?: string | undefined; filled?: boolean | undefined; haspopup?: boolean | undefined;
  expanded?: boolean | undefined; size?: "icon" | "icon-sm" | "icon-xs" | undefined; tip?: TipSide | undefined; shortcut?: string | undefined;
}) {
  const toggle = p.pressed !== undefined;
  return (
    <button
      type="button" {...slot(toggle ? "toggle" : "button")} data-variant={toggle ? "default" : "ghost"} data-size={p.size ?? "icon-sm"}
      class={p.class} aria-label={p.label} data-tip={p.label} data-tip-side={p.tip} data-tip-kbd={p.shortcut} disabled={p.disabled} data-testid={p.testid}
      aria-pressed={toggle ? p.pressed : undefined} data-state={toggle ? (p.pressed ? "on" : "off") : undefined}
      aria-haspopup={p.haspopup ? "true" : undefined} aria-expanded={p.expanded === undefined ? undefined : p.expanded}
      onClick={p.onClick}
    >
      <Icon name={p.icon} filled={p.filled ?? false} />
      {p.text ? <span class="btn-text" aria-hidden="true">{p.text}</span> : null}
    </button>
  );
}

/** A set of toggles of which one is on (the favourite intervals). */
export function ToggleGroup<T extends string>(p: { label: string; value: T | null; items: Array<{ value: T; label: string; aria?: string; testid?: string }>; onChange: (v: T) => void; size?: "default" | "sm" | undefined; class?: string | undefined }) {
  return (
    <div {...slot("toggle-group")} role="group" aria-label={p.label} data-orientation="horizontal" class={p.class}>
      {p.items.map((it) => (
        <button
          type="button" key={it.value} {...slot("toggle-group-item")} data-variant="default" data-size={p.size ?? "sm"} data-state={it.value === p.value ? "on" : "off"}
          aria-pressed={it.value === p.value} aria-label={it.aria} data-testid={it.testid} onClick={() => p.onChange(it.value)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Separator(p: { vertical?: boolean | undefined }) {
  return <div {...slot("separator")} role="none" data-orientation={p.vertical ? "vertical" : "horizontal"} />;
}

export function Badge(p: { children: ComponentChildren; variant?: "default" | "secondary" | "destructive" | "outline" | undefined; testid?: string | undefined }) {
  return <span {...slot("badge")} data-variant={p.variant ?? "default"} data-testid={p.testid}>{p.children}</span>;
}

export function Kbd(p: { children: ComponentChildren }) {
  return <kbd {...slot("kbd")}>{p.children}</kbd>;
}

/**
 * The shell's one tooltip: it follows hover and keyboard focus to any element with `data-tip` (its text; `data-tip-side`, and a
 * shortcut in `data-tip-kbd`). The text is the element's own accessible name, so the tooltip itself is hidden from assistive tech.
 */
export function TooltipLayer() {
  const app = useApp();
  const root = useRoot();
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ el: HTMLElement; text: string; kbd: string | null; side: TipSide } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    let timer = 0;
    let warm = false; // a tooltip was open a moment ago: the next one opens at once, as Radix does
    let cool = 0;
    const of = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>("[data-tip]") : null);
    const show = (el: HTMLElement, now: boolean) => {
      clearTimeout(timer);
      const open = () => setTip({ el, text: el.dataset.tip!, kbd: el.dataset.tipKbd ?? null, side: (el.dataset.tipSide as TipSide | undefined) ?? "bottom" });
      if (now || warm) open();
      else timer = window.setTimeout(open, 300);
    };
    const hide = () => {
      clearTimeout(timer);
      setTip((cur) => {
        if (cur) {
          warm = true;
          clearTimeout(cool);
          cool = window.setTimeout(() => (warm = false), 300);
        }
        return null;
      });
    };
    const over = (e: Event) => {
      const el = of(e.target);
      if (el && !(el as HTMLButtonElement).disabled) show(el, false);
    };
    const out = (e: Event) => {
      const el = of(e.target);
      if (el && !el.contains((e as PointerEvent).relatedTarget as Node | null)) hide();
    };
    const focus = (e: Event) => {
      const el = of(e.target);
      if (el && el.matches(":focus-visible")) show(el, true);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && hide();
    root.addEventListener("pointerover", over);
    root.addEventListener("pointerout", out);
    root.addEventListener("focusin", focus);
    root.addEventListener("focusout", hide);
    root.addEventListener("pointerdown", hide, true);
    root.addEventListener("keydown", key as EventListener, true);
    return () => {
      clearTimeout(timer);
      clearTimeout(cool);
      root.removeEventListener("pointerover", over);
      root.removeEventListener("pointerout", out);
      root.removeEventListener("focusin", focus);
      root.removeEventListener("focusout", hide);
      root.removeEventListener("pointerdown", hide, true);
      root.removeEventListener("keydown", key as EventListener, true);
    };
  }, []);
  useLayoutEffect(() => {
    if (!tip || !box.current) return setPos(null);
    const host = app.host.getBoundingClientRect();
    const a = tip.el.getBoundingClientRect();
    const r = box.current.getBoundingClientRect();
    const gap = 6;
    let x = a.left + a.width / 2 - r.width / 2, y = a.bottom + gap;
    if (tip.side === "top") y = a.top - r.height - gap;
    else if (tip.side === "right" || tip.side === "left") {
      y = a.top + a.height / 2 - r.height / 2;
      const rtl = app.host.getAttribute("dir") === "rtl";
      const right = (tip.side === "right") !== rtl;
      x = right ? a.right + gap : a.left - r.width - gap;
    }
    x = Math.max(host.left + 4, Math.min(x, host.right - r.width - 4));
    y = Math.max(host.top + 4, Math.min(y, host.bottom - r.height - 4));
    setPos({ left: x - host.left, top: y - host.top });
  }, [tip]);
  if (!tip) return null;
  return (
    <div ref={box} {...slot("tooltip-content")} aria-hidden="true" data-side={tip.side} data-testid="tooltip" style={pos ? { left: `${pos.left}px`, top: `${pos.top}px` } : { visibility: "hidden", left: "0px", top: "0px" }}>
      {tip.text}
      {tip.kbd ? <Kbd>{tip.kbd}</Kbd> : null}
    </div>
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

/**
 * A modal dialog: overlay, content, header (title, description, close), a scrolling body and a footer. `command` gives it the
 * Command palette's shape (no padding, opened high, the list edge to edge). In the compact layout it is a bottom drawer.
 */
export function Dialog(p: {
  title: string; description?: string | undefined; onClose: () => void; children: ComponentChildren; footer?: ComponentChildren | undefined;
  wide?: boolean | undefined; command?: boolean | undefined; testid?: string | undefined;
}) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const id = useRef(`dlg-${Math.random().toString(36).slice(2, 8)}`);
  useFocusReturn();
  // Layout effect: focus is inside before first paint, so anything that can see the dialog can also close it with Escape.
  useLayoutEffect(() => {
    const el = box.current!;
    (el.querySelector<HTMLElement>("[data-autofocus]") ?? el.querySelector<HTMLElement>("[data-current]") ?? el.querySelector<HTMLElement>(`[data-slot="dialog-body"] ${FOCUSABLE.split(",").join(`,[data-slot="dialog-body"] `)}`) ?? el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus({ preventScroll: true });
    el.querySelector<HTMLElement>("[data-current]")?.scrollIntoView?.({ block: "nearest" });
  }, []);
  return (
    <div {...slot("dialog-overlay")} onPointerDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div
        ref={box} {...slot("dialog-content")} data-size={p.wide ? "wide" : undefined} data-command={p.command ? "" : undefined} role="dialog" aria-modal="true"
        aria-labelledby={id.current} aria-describedby={p.description ? `${id.current}-d` : undefined} tabIndex={-1} data-testid={p.testid}
        onKeyDown={(e) => {
          if (e.key === "Escape") (e.stopPropagation(), p.onClose());
          else trap(e, box.current!);
        }}
      >
        <header {...slot("dialog-header")}>
          <div {...slot("dialog-heading")}>
            <h2 {...slot("dialog-title")} id={id.current}>{p.title}</h2>
            {p.description ? <p {...slot("dialog-description")} id={`${id.current}-d`}>{p.description}</p> : null}
          </div>
          <IconButton icon="close" label={t("a11y.dialog.close")} size="icon-sm" class="dialog-close" onClick={p.onClose} />
        </header>
        <div {...slot("dialog-body")}>{p.children}</div>
        {p.footer ? <footer {...slot("dialog-footer")}>{p.footer}</footer> : null}
      </div>
    </div>
  );
}

/** A floating surface anchored to an element or a point. Arrow keys move between its buttons and options. */
export function Popover(p: {
  label: string; at: { x: number; y: number } | HTMLElement; onClose: () => void; children: ComponentChildren; role?: "menu" | "dialog" | "listbox" | undefined;
  returnFocus?: HTMLElement | null | undefined; slot?: "popover-content" | "dropdown-menu-content" | "select-content" | undefined; class?: string | undefined;
  testid?: string | undefined; side?: "bottom" | "right" | undefined; matchWidth?: boolean | undefined; id?: string | undefined;
}) {
  const app = useApp();
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; minWidth?: number } | null>(null);
  useLayoutEffect(() => {
    const el = box.current!;
    const host = app.host.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const rtl = app.host.getAttribute("dir") === "rtl";
    let x: number, y: number, minWidth: number | undefined;
    if (p.at instanceof HTMLElement) {
      const a = p.at.getBoundingClientRect();
      if (p.matchWidth) minWidth = a.width;
      if (p.side === "right") {
        x = rtl ? a.left - r.width - 6 : a.right + 6;
        y = a.top;
      } else {
        x = rtl ? a.right - Math.max(r.width, minWidth ?? 0) : a.left;
        y = a.bottom + 6;
        // No room below: open above the anchor.
        if (y + r.height > host.bottom - 4 && a.top - r.height - 6 >= host.top + 4) y = a.top - r.height - 6;
      }
    } else (x = p.at.x, (y = p.at.y));
    x = Math.max(host.left + 4, Math.min(x, host.right - Math.max(r.width, minWidth ?? 0) - 4));
    y = Math.max(host.top + 4, Math.min(y, host.bottom - r.height - 4));
    setPos({ left: x - host.left, top: y - host.top, ...(minWidth !== undefined ? { minWidth } : {}) });
  }, []);
  // Focus only once placed: a hidden element cannot take focus.
  useEffect(() => {
    if (!pos) return;
    const el = box.current!;
    (el.querySelector<HTMLElement>('[aria-checked="true"],[aria-selected="true"],[aria-pressed="true"],[data-current]') ?? el.querySelector<HTMLElement>("[data-autofocus]") ?? el.querySelector<HTMLElement>("button:not([disabled]),input"))?.focus({ preventScroll: true });
  }, [pos === null]);
  useEffect(() => {
    const el = box.current!;
    // A press on the anchor (a Select's trigger) is left to the anchor's own click, which toggles: closing here first would
    // make that click open the popover again.
    const anchor = p.at instanceof HTMLElement ? p.at : null;
    const down = (e: PointerEvent) => {
      const path = e.composedPath();
      if (!path.includes(el) && !(anchor && path.includes(anchor))) p.onClose();
    };
    const t = setTimeout(() => app.host.shadowRoot!.addEventListener("pointerdown", down as EventListener, true), 0);
    return () => (clearTimeout(t), app.host.shadowRoot!.removeEventListener("pointerdown", down as EventListener, true));
  }, []);
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape") return (e.stopPropagation(), p.onClose());
    // Tab closes and returns focus to the trigger; it must not also reach a dialog's focus trap, which would move focus on to
    // an option that is about to unmount (and so out of the modal).
    if (e.key === "Tab") return (e.preventDefault(), e.stopPropagation(), p.onClose());
    const nav = [...box.current!.querySelectorAll<HTMLElement>('button:not([disabled]):not([aria-disabled="true"]),input:not([disabled]),[role="option"]:not([aria-disabled="true"])')].filter((x, i, a) => a.indexOf(x) === i);
    const i = nav.indexOf((box.current!.getRootNode() as ShadowRoot).activeElement as HTMLElement);
    const go = (n: number) => (e.preventDefault(), nav[(n + nav.length) % nav.length]?.focus());
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i < 0 ? nav.length - 1 : i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(nav.length - 1);
  };
  return (
    <div
      ref={box} {...slot(p.slot ?? "popover-content")} id={p.id} class={p.class} role={p.role ?? "dialog"} aria-label={p.label} data-testid={p.testid} data-state="open"
      style={pos ? { left: `${pos.left}px`, top: `${pos.top}px`, ...(pos.minWidth !== undefined ? { minWidth: `${pos.minWidth}px` } : {}) } : { visibility: "hidden", left: "0px", top: "0px" }} onKeyDown={key}
    >
      {p.children}
    </div>
  );
}

/** A menu (shadcn's DropdownMenu content): groups with labels, items with an icon and a trailing hint, checkbox items, separators. */
export function MenuView(p: { label: string; at: { x: number; y: number } | HTMLElement; items: MenuItem[]; onClose: () => void; testid?: string | undefined; side?: "bottom" | "right" | undefined }) {
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
  const shown = groups.filter((g) => g.items.length);
  return (
    <Popover label={p.label} at={p.at} onClose={p.onClose} role="menu" slot="dropdown-menu-content" testid={p.testid} side={p.side}>
      {shown.map((g, gi) => (
        <Fragment key={gi}>
          {gi > 0 ? <div {...slot("dropdown-menu-separator")} role="separator" /> : null}
          <div role="group" aria-label={g.label ?? undefined} {...slot("dropdown-menu-group")}>
            {g.label ? <div {...slot("dropdown-menu-label")} aria-hidden="true">{g.label}</div> : null}
            {g.items.map((it) => (
              <button
                type="button" key={it.id} {...slot(it.checked === undefined ? "dropdown-menu-item" : "dropdown-menu-checkbox-item")}
                role={it.checked === undefined ? "menuitem" : "menuitemcheckbox"} aria-checked={it.checked === undefined ? undefined : it.checked}
                data-variant={it.danger ? "destructive" : "default"} aria-disabled={it.disabled ? "true" : undefined} data-testid={`menu-${it.id}`} onClick={() => choose(it)}
              >
                {it.icon ? <Icon name={it.icon} /> : null}
                <span>{it.label}</span>
                {it.hint ? <span {...slot("dropdown-menu-shortcut")}>{it.hint}</span> : null}
                {it.checked ? <span {...slot("dropdown-menu-item-indicator")} aria-hidden="true"><Icon name="check" /></span> : null}
              </button>
            ))}
          </div>
        </Fragment>
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
    <div {...slot("tabs")} data-orientation="horizontal">
      <TabsList label={p.label} tabs={p.tabs} value={p.value} onChange={p.onChange} onKeyDown={key} />
      <div {...slot("tabs-content")} role="tabpanel" id={`panel-${p.value}`} aria-labelledby={`tab-${p.value}`}>{p.children}</div>
    </div>
  );
}

/** The trigger row of tabs; vertical, it is the indicator dialog's list of families. */
export function TabsList(p: { label: string; tabs: Array<{ id: string; label: string }>; value: string; onChange: (id: string) => void; onKeyDown?: ((e: KeyboardEvent) => void) | undefined; vertical?: boolean | undefined }) {
  return (
    <div {...slot("tabs-list")} role="tablist" aria-label={p.label} aria-orientation={p.vertical ? "vertical" : "horizontal"} data-orientation={p.vertical ? "vertical" : "horizontal"} onKeyDown={p.onKeyDown}>
      {p.tabs.map((t) => (
        <button
          type="button" role="tab" key={t.id} {...slot("tabs-trigger")} id={`tab-${t.id}`} data-tab={t.id} aria-selected={t.id === p.value} data-state={t.id === p.value ? "active" : "inactive"}
          aria-controls={p.onKeyDown ? `panel-${t.id}` : undefined} tabIndex={p.onKeyDown && t.id !== p.value ? -1 : 0} onClick={() => p.onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

let uid = 0;
export const useId = (): string => useRef(`f${++uid}`).current;

export function FieldGroup(p: { children: ComponentChildren; class?: string | undefined }) {
  return <div {...slot("field-group")} class={p.class}>{p.children}</div>;
}

export function FieldSet(p: { legend: string; children: ComponentChildren }) {
  return (
    <fieldset {...slot("field-set")}>
      <legend {...slot("field-legend")}>{p.legend}</legend>
      {p.children}
    </fieldset>
  );
}

/** A label, its control (given the id to bind to), and an optional description or error. */
export function Field(p: { label: string; children: (id: string) => ComponentChildren; hint?: string | undefined; error?: string | null | undefined; orientation?: "vertical" | "horizontal" | undefined }) {
  const id = useId();
  return (
    <div {...slot("field")} data-orientation={p.orientation ?? "vertical"} data-invalid={p.error ? "true" : undefined}>
      <label {...slot("field-label")} for={id}>{p.label}</label>
      {p.children(id)}
      {p.hint ? <p {...slot("field-description")}>{p.hint}</p> : null}
      {p.error ? <p {...slot("field-error")} role="alert">{p.error}</p> : null}
    </div>
  );
}

/** A text input (shadcn's Input). */
export function Input(p: JSX.IntrinsicElements["input"] & { testid?: string | undefined; autofocus?: boolean | undefined }) {
  const { testid, autofocus, ...rest } = p;
  return <input {...slot("input")} data-testid={testid} data-autofocus={autofocus ? "" : undefined} {...rest} />;
}

export function Textarea(p: JSX.IntrinsicElements["textarea"] & { testid?: string | undefined }) {
  const { testid, ...rest } = p;
  return <textarea {...slot("textarea")} data-testid={testid} {...rest} />;
}

/** shadcn's Checkbox beside its label. The native checkbox stays underneath (transparent, over the box), so it keeps its role and keys. */
export function Check(p: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean | undefined; testid?: string | undefined }) {
  const id = useId();
  return (
    <div {...slot("field")} data-orientation="horizontal" data-disabled={p.disabled ? "true" : undefined}>
      <span {...slot("checkbox")} data-state={p.checked ? "checked" : "unchecked"}>
        <input type="checkbox" id={id} checked={p.checked} disabled={p.disabled} data-testid={p.testid} onChange={(e) => p.onChange((e.currentTarget as HTMLInputElement).checked)} />
        <Icon name="check" size={14} />
      </span>
      <label {...slot("field-label")} for={id}>{p.label}</label>
    </div>
  );
}

/** shadcn's Switch, for a setting that takes effect at once. A native checkbox with the switch role, under the track. */
export function Switch(p: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean | undefined; testid?: string | undefined }) {
  const id = useId();
  return (
    <div {...slot("field")} data-orientation="horizontal" data-disabled={p.disabled ? "true" : undefined}>
      <label {...slot("field-label")} for={id}>{p.label}</label>
      <span {...slot("switch")} data-state={p.checked ? "checked" : "unchecked"}>
        <input type="checkbox" role="switch" id={id} checked={p.checked} disabled={p.disabled} data-testid={p.testid} onChange={(e) => p.onChange((e.currentTarget as HTMLInputElement).checked)} />
        <span {...slot("switch-thumb")} />
      </span>
    </div>
  );
}

export function NumberField(p: { label: string; value: number | null; placeholder?: string | undefined; onChange: (v: number) => void; min?: number | undefined; max?: number | undefined; step?: number | "any" | undefined; testid?: string | undefined }) {
  return (
    <Field label={p.label}>
      {(id) => (
        <Input
          id={id} type="number" value={p.value ?? ""} placeholder={p.placeholder} min={p.min} max={p.max} step={p.step ?? "any"} testid={p.testid}
          onInput={(e) => {
            const v = (e.currentTarget as HTMLInputElement).valueAsNumber;
            if (Number.isFinite(v)) p.onChange(v);
          }}
        />
      )}
    </Field>
  );
}

/**
 * shadcn's Select: a trigger showing the value, and a listbox popover of the options (arrow keys, Enter, Escape, the chosen one
 * focused on open). `testid` is the trigger's; each option is `<testid>-<value>`.
 */
export function Select<T extends string>(p: { id?: string | undefined; label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; testid?: string | undefined; size?: "default" | "sm" | undefined }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useId();
  const cur = p.options.find((o) => o.value === p.value);
  const close = () => (setOpen(false), trigger.current?.focus({ preventScroll: true }));
  const pick = (v: T) => {
    close();
    if (v !== p.value) p.onChange(v);
  };
  return (
    <>
      <button
        ref={trigger} type="button" id={p.id} {...slot("select-trigger")} data-size={p.size ?? "default"} role="combobox" aria-haspopup="listbox" aria-expanded={open}
        aria-controls={open ? list : undefined} aria-label={p.id ? undefined : p.label} data-testid={p.testid} data-value={p.value}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") (e.preventDefault(), setOpen(true));
        }}
      >
        <span {...slot("select-value")}>{cur?.label ?? ""}</span>
        <Icon name="chevron" />
      </button>
      {open && trigger.current ? (
        <Popover label={p.label} at={trigger.current} onClose={close} role="listbox" slot="select-content" id={list} matchWidth testid={p.testid ? `${p.testid}-list` : undefined}>
          <div {...slot("select-group")}>
            {p.options.map((o) => (
              <button
                type="button" key={o.value} {...slot("select-item")} role="option" aria-selected={o.value === p.value} data-testid={p.testid ? `${p.testid}-${o.value}` : undefined}
                onClick={() => pick(o.value)}
              >
                <span>{o.label}</span>
                {o.value === p.value ? <span {...slot("select-item-indicator")} aria-hidden="true"><Icon name="check" /></span> : null}
              </button>
            ))}
          </div>
        </Popover>
      ) : null}
    </>
  );
}

export function SelectField<T extends string>(p: { label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; testid?: string | undefined }) {
  return <Field label={p.label}>{(id) => <Select id={id} label={p.label} value={p.value} options={p.options} onChange={p.onChange} testid={p.testid} />}</Field>;
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

export function ColorField(p: { label: string; value: string; onChange: (css: string) => void; alpha?: boolean | undefined; testid?: string | undefined }) {
  const t = useT();
  const app = useApp();
  // A colour slot ("chart-2" …) shows as the colour the chart draws it with now; picking a colour replaces the slot.
  const { hex, alpha } = hexAlpha(resolveColor(p.value, app.current.chart.options().theme));
  return (
    <Field label={p.label}>
      {(id) => (
        <span {...slot("field-row")}>
          <input id={id} type="color" {...slot("color")} value={hex} data-testid={p.testid} onInput={(e) => p.onChange(cssRgba((e.currentTarget as HTMLInputElement).value, p.alpha ? alpha : 1))} />
          {p.alpha ? (
            <input type="range" {...slot("slider")} min="0" max="1" step="0.05" value={alpha} aria-label={`${p.label}: ${t("common.opacity")}`} onInput={(e) => p.onChange(cssRgba(hex, Number((e.currentTarget as HTMLInputElement).value)))} />
          ) : null}
        </span>
      )}
    </Field>
  );
}

// ---- Command (a searchable, grouped list) and Item (a row with actions) -------------------------------------------------------

/** The search field of a Command: shadcn's InputGroup with a search icon. */
export function CommandInput(p: JSX.IntrinsicElements["input"] & { testid?: string | undefined }) {
  const { testid, ...rest } = p;
  return (
    <div {...slot("command-input-wrapper")}>
      <div {...slot("input-group")}>
        <span {...slot("input-group-addon")} aria-hidden="true"><Icon name="search" /></span>
        <input {...slot("input-group-control")} data-autofocus data-testid={testid} {...rest} />
      </div>
    </div>
  );
}

export function CommandGroup(p: { heading?: string | undefined; children: ComponentChildren; label?: string | undefined; testid?: string | undefined; listbox?: boolean | undefined; id?: string | undefined; listRef?: { current: HTMLUListElement | null } | undefined }) {
  return (
    <div {...slot("command-group")} role="presentation">
      {p.heading ? <div {...slot("command-group-heading")} aria-hidden="true">{p.heading}</div> : null}
      <ul {...slot("item-group")} {...(p.listRef ? { ref: p.listRef } : {})} id={p.id} role={p.listbox ? "listbox" : undefined} aria-label={p.label ?? p.heading} data-testid={p.testid}>{p.children}</ul>
    </div>
  );
}

export function CommandShortcut(p: { children: ComponentChildren }) {
  return <span {...slot("command-shortcut")}>{p.children}</span>;
}

export function CommandEmpty(p: { children: ComponentChildren }) {
  return <p {...slot("command-empty")}>{p.children}</p>;
}

export function ItemGroup(p: { label: string; children: ComponentChildren; testid?: string | undefined }) {
  return <ul {...slot("item-group")} aria-label={p.label} data-testid={p.testid}>{p.children}</ul>;
}

/** A row of a list: its main content (a button when the row does something) and trailing actions. */
export function Item(p: { children: ComponentChildren; actions?: ComponentChildren | undefined; testid?: string | undefined; status?: string | undefined }) {
  return (
    <li {...slot("item")} data-testid={p.testid} data-status={p.status}>
      {p.children}
      {p.actions ? <span {...slot("item-actions")}>{p.actions}</span> : null}
    </li>
  );
}
