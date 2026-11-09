/** @jsxImportSource preact */
import { render } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { ChartApp, Dialog as DialogSpec } from "../engine/app.js";
import { AppContext, RootContext, useApp, useT } from "./context.js";
import { Toolbar, BottomBar } from "./toolbar.js";
import { DrawingBar, DrawingSheet } from "./drawingbar.js";
import { Legend } from "./legend.js";
import { ConfirmDialog, IntervalDialog, LayoutsDialog, PromptDialog, SymbolSearch, TemplatesDialog } from "./dialogs-basic.js";
import { IndicatorsDialog, StudyDialog } from "./dialogs-study.js";
import { SettingsDialog } from "./dialog-settings.js";
import { DrawingDialog } from "./dialog-drawing.js";
import { ObjectsDialog } from "./dialog-objects.js";
import { AlertDialog, AlertsPanel } from "./dialog-alerts.js";
import { Button, MenuView, IconButton, TooltipLayer, slot } from "./primitives.js";
import { Icon } from "./icons.js";
import { STYLES } from "../styles.js";

function DialogHost({ d }: { d: DialogSpec }) {
  switch (d.kind) {
    case "symbol": return <SymbolSearch purpose={d.purpose} />;
    case "interval": return <IntervalDialog />;
    case "indicators": return <IndicatorsDialog />;
    case "study": return <StudyDialog id={d.id} />;
    case "settings": return <SettingsDialog tab={d.tab} />;
    case "drawing": return <DrawingDialog id={d.id} />;
    case "alert": return <AlertDialog prefill={d.prefill} />;
    case "alerts": return <AlertsPanel />;
    case "layouts": return <LayoutsDialog />;
    case "objects": return <ObjectsDialog />;
    case "templates": return <TemplatesDialog />;
    case "confirm": return <ConfirmDialog message={d.message} confirmLabel={d.confirmLabel} danger={d.danger ?? false} onConfirm={d.onConfirm} />;
    case "prompt": return <PromptDialog title={d.title} label={d.label} value={d.value} onSubmit={d.onSubmit} />;
  }
}

function ScriptPanel() {
  const app = useApp();
  const t = useT();
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const adapter = app.options.scriptEditor!;
    const h = adapter.mount(el.current!, { value: app.scriptCode, onChange: (v) => (app.scriptCode = v), onRun: (v) => app.runScript(v), diagnostics: app.scriptDiagnostics });
    app.scriptEditorHandle = h;
    return () => {
      app.scriptEditorHandle = null;
      h.destroy();
    };
  }, []);
  return (
    <section class="script-panel" aria-label={t("ui.script.title")} data-testid="script-panel">
      <header>
        <h2>{t("ui.script.title")}</h2>
        <span>
          <Button size="sm" testid="script-save" onClick={() => app.openDialog({ kind: "prompt", title: t("scripts.save"), label: t("common.name"), value: "", onSubmit: (v) => app.saveScript(v, app.scriptCode).catch((e) => app.report(e)) })}>{t("scripts.save")}</Button>
          <Button primary size="sm" testid="script-run" onClick={() => app.runScript(app.scriptCode)}>{t("ui.script.run")}</Button>
          <IconButton icon="close" label={t("common.close")} onClick={() => app.toggleScript()} />
        </span>
      </header>
      <div ref={el} class="script-host" />
    </section>
  );
}

function Shell() {
  const app = useApp();
  const t = useT();
  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => { app.attachGrid(gridRef.current!); }, []);
  // The per-chart legends live in overlay roots inside the grid cells.
  useEffect(() => {
    app.instances.forEach((inst, i) => {
      const root = app.legendRoots[i];
      if (root) render(<AppContext.Provider value={app}><RootContext.Provider value={app.host.shadowRoot!}><Legend inst={inst} /></RootContext.Provider></AppContext.Provider>, root);
    });
  });
  const dialog = app.dialogs[app.dialogs.length - 1];
  const f = app.features;
  return (
    <div class="app" data-compact={app.compact ? "" : undefined} style={app.vars()} data-theme={app.themeName} data-mode={app.mode}>
      <Toolbar />
      <div class="body">
        {f.drawings && !app.compact ? <DrawingBar /> : null}
        <div class="stage">
          <div class="grid" ref={gridRef} data-testid="grid" data-charts={app.instances.length} />
          {app.scriptOpen && app.hasScript ? <ScriptPanel key={app.scriptEpoch} /> : null}
        </div>
      </div>
      {app.compact ? <BottomBar /> : null}
      {app.drawingSheetOpen ? <DrawingSheet /> : null}
      {dialog ? <DialogHost d={dialog} key={app.dialogs.length} /> : null}
      {app.menu ? <MenuView label={app.menu.label} at={app.menu.at} items={app.menu.items} onClose={() => app.closeMenu()} /> : null}
      <ol {...slot("toaster")} data-testid="toasts" aria-label={t("ui.notifications")}>
        {app.toasts.map((x) => (
          <li key={x.id} {...slot("toast")} data-type={x.kind} class={`toast ${x.kind}`}>
            <Icon name={x.kind === "error" ? "error" : x.kind === "alert" ? "bell" : "info"} />
            <span {...slot("toast-title")}>{x.text}</span>
            <IconButton icon="close" label={t("common.close")} size="icon-xs" onClick={() => app.dismissToast(x.id)} />
          </li>
        ))}
      </ol>
      <TooltipLayer />
      <div class="sr-only" role="status" aria-live="polite" data-testid="live">{app.liveText}</div>
    </div>
  );
}

export function mountShell(app: ChartApp, root: ShadowRoot): () => void {
  // The built-in sheet (unless the host brings its own), then the host's, in that order: later rules win.
  const o = app.options;
  const extra = o.styles === undefined ? [] : typeof o.styles === "string" ? [o.styles] : [...o.styles];
  const sheets = [...(o.stylesheet === "none" ? [] : [STYLES]), ...extra].map((css, i) => {
    const el = document.createElement("style");
    el.textContent = css;
    el.dataset.alphacharts = i === 0 && o.stylesheet !== "none" ? "default" : "host";
    return root.appendChild(el);
  });
  const mount = document.createElement("div");
  mount.className = "mount";
  root.appendChild(mount);
  render(<AppContext.Provider value={app}><RootContext.Provider value={root}><Shell /></RootContext.Provider></AppContext.Provider>, mount);
  return () => {
    render(null, mount);
    for (const r of app.legendRoots) render(null, r);
    mount.remove();
    for (const el of sheets) el.remove();
  };
}
