// A framework-free script editor on CodeMirror 6: highlighting, inline
// diagnostics, autocomplete of ta.* / math.* / inputs, Mod-Enter to run.
//
// This subpath is the only place the package touches CodeMirror. The adapter
// interface is what @alphacharts/ui consumes.

import { autocompletion, closeBrackets, closeBracketsKeymap, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { HighlightStyle, StreamLanguage, syntaxHighlighting, type StringStream } from "@codemirror/language";
import { setDiagnostics as lintSet, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine, placeholder } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { completionNames, NAMESPACES } from "../builtins.js";
import { KEYWORDS } from "../lexer.js";
import type { Diagnostic } from "../diag.js";

export interface ScriptEditorAdapter {
  mount(
    el: HTMLElement,
    opts: { value: string; onChange(v: string): void; onRun(v: string): void; diagnostics: Diagnostic[] },
  ): { setDiagnostics(d: Diagnostic[]): void; destroy(): void };
}

// ---- language -------------------------------------------------------------------------

const TYPES = new Set(["int", "float", "bool", "string", "color"]);

interface LState { }

export const scriptLanguage = StreamLanguage.define<LState>({
  token(stream: StringStream): string | null {
    if (stream.eatSpace()) return null;
    if (stream.match("//")) { stream.skipToEnd(); return "comment"; }
    const q = stream.peek();
    if (q === '"' || q === "'") {
      stream.next();
      let esc = false, c: string | void;
      while ((c = stream.next()) !== undefined) {
        if (c === q && !esc) break;
        esc = !esc && c === "\\";
      }
      return "string";
    }
    if (stream.match(/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?/)) return "atom";
    if (stream.match(/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/)) return "number";
    if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*/)) {
      const w = stream.current();
      if (KEYWORDS.has(w)) return w === "true" || w === "false" ? "atom" : "keyword";
      if (TYPES.has(w) && stream.match(/^\s+[A-Za-z_]/, false)) return "typeName";
      if (w === "na") return "atom";
      if (NAMESPACES.has(w) && stream.peek() === ".") return "namespace";
      if (stream.peek() === "(") return "variableName.function";
      return "variableName";
    }
    if (stream.match(/^(?::=|[-+*\/%]=|==|!=|<=|>=)/) || stream.match(/^[-+*\/%<>=?:]/)) return "operator";
    stream.next();
    return null;
  },
  startState: () => ({}),
  languageData: { commentTokens: { line: "//" } },
});

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: "var(--ac-script-keyword, #c678dd)" },
  { tag: t.comment, color: "var(--ac-script-comment, #7f848e)", fontStyle: "italic" },
  { tag: t.string, color: "var(--ac-script-string, #98c379)" },
  { tag: t.number, color: "var(--ac-script-number, #d19a66)" },
  { tag: t.atom, color: "var(--ac-script-atom, #d19a66)" },
  { tag: t.typeName, color: "var(--ac-script-type, #e5c07b)" },
  { tag: t.namespace, color: "var(--ac-script-namespace, #61afef)" },
  { tag: t.function(t.variableName), color: "var(--ac-script-function, #61afef)" },
  { tag: t.operator, color: "var(--ac-script-operator, #56b6c2)" },
]);

// ---- completion -----------------------------------------------------------------------------

const KIND: Record<string, Completion["type"]> = { function: "function", constant: "constant", variable: "variable", keyword: "keyword", namespace: "namespace" };

/** Names declared in the text (variables, inputs, loop counters): `name =`, `var name =`, `float name =`, `for i =`, `[a, b] =`. */
export function declaredNames(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/^[ ]*(?:var[ ]+)?(?:(?:int|float|bool|string|color)[ ]+)?([A-Za-z_]\w*)[ ]*=(?!=)/gm)) out.add(m[1]!);
  for (const m of text.matchAll(/^[ ]*for[ ]+([A-Za-z_]\w*)[ ]*=/gm)) out.add(m[1]!);
  for (const m of text.matchAll(/^[ ]*\[([^\]\n]*)\][ ]*=(?!=)/gm)) for (const n of m[1]!.split(",")) if (/^\s*[A-Za-z_]\w*\s*$/.test(n)) out.add(n.trim());
  return [...out];
}

let cached: Completion[] | null = null;
function base(): Completion[] {
  return (cached ??= [
    ...completionNames().map((c): Completion => ({ label: c.label, type: KIND[c.kind]!, ...(c.detail && { detail: c.detail }), boost: c.kind === "function" ? 1 : 0 })),
    ...[...KEYWORDS].map((k): Completion => ({ label: k, type: "keyword", boost: -1 })),
    ...["int", "float", "bool", "string", "color"].map((k): Completion => ({ label: k, type: "type", boost: -1 })),
  ]);
}

/** Completion options for the word before the cursor (exported for tests). */
export function completionsFor(text: string, word: string): Completion[] {
  const own = declaredNames(text).map((n): Completion => ({ label: n, type: "variable", boost: 2 }));
  const all = [...own, ...base()];
  return all.filter((c) => c.label.startsWith(word) && c.label !== word);
}

function source(ctx: CompletionContext): CompletionResult | null {
  const w = ctx.matchBefore(/[A-Za-z_][\w]*(?:\.[\w]*)?|\.\w*/);
  if (!w || (w.from === w.to && !ctx.explicit)) return null;
  const options = completionsFor(ctx.state.doc.toString(), w.text);
  return options.length ? { from: w.from, options, validFor: /^[\w.]*$/ } : null;
}

// ---- adapter ------------------------------------------------------------------------------------

function toCm(doc: EditorState["doc"], list: Diagnostic[]): CmDiagnostic[] {
  return list.map((d) => {
    // A host may report a diagnostic by line and column only (no offsets).
    let from = d.from;
    if (typeof from !== "number") {
      const line = doc.line(Math.min(Math.max(1, d.line), doc.lines));
      from = Math.min(line.from + Math.max(0, d.column - 1), line.to);
    }
    const to = typeof d.to === "number" ? d.to : from + 1;
    return { from: Math.min(from, doc.length), to: Math.min(Math.max(to, from + 1), doc.length), severity: d.severity, message: d.message };
  });
}

export function createScriptEditorAdapter(): ScriptEditorAdapter {
  return {
    mount(el, opts) {
      const run = (view: EditorView) => { opts.onRun(view.state.doc.toString()); return true; };
      const view = new EditorView({
        parent: el,
        state: EditorState.create({
          doc: opts.value,
          extensions: [
            lineNumbers(), history(), drawSelection(), highlightActiveLine(), closeBrackets(), scriptLanguage, syntaxHighlighting(highlight),
            autocompletion({ override: [source] }),
            placeholder("plot(ta.sma(close, 20))"),
            Prec.highest(keymap.of([
              { key: "Mod-Enter", run },
              // tabs are not allowed in scripts: Tab inserts the indent
              { key: "Tab", run: (v) => { v.dispatch(v.state.replaceSelection("    ")); return true; } },
            ])),
            keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap]),
            EditorView.updateListener.of((u) => { if (u.docChanged) opts.onChange(u.state.doc.toString()); }),
            EditorView.theme({
              "&": { height: "100%", color: "var(--ac-script-fg, inherit)", backgroundColor: "var(--ac-script-bg, transparent)" },
              ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: "13px", lineHeight: "1.5" },
              ".cm-gutters": { backgroundColor: "transparent", color: "var(--ac-script-gutter, #7f848e)", border: "none" },
              "&.cm-focused": { outline: "none" },
              ".cm-content": { caretColor: "var(--ac-script-caret, currentColor)" },
            }),
          ],
        }),
      });
      const apply = (d: Diagnostic[]) => view.dispatch(lintSet(view.state, toCm(view.state.doc, d)));
      apply(opts.diagnostics);
      return { setDiagnostics: apply, destroy: () => view.destroy() };
    },
  };
}

export type { Diagnostic };
