// Lexer: source text -> tokens, with Python-style INDENT/DEDENT blocks.
//
// Lines inside (), [] continue; blank and comment-only lines are ignored; tabs
// are refused (indentation is spaces). Only ASCII identifiers; any other
// character outside strings and comments is a diagnostic, never skipped
// silently.

import type { Reporter } from "./diag.js";

export type TokKind = "num" | "str" | "color" | "ident" | "kw" | "op" | "newline" | "indent" | "dedent" | "eof";

export interface Token {
  kind: TokKind;
  /** Text for ident/kw/op; decoded value for str; digits for num; "#rrggbb[aa]" for color. */
  text: string;
  value?: number;
  from: number;
  to: number;
}

export const KEYWORDS: ReadonlySet<string> = new Set(["if", "else", "for", "to", "by", "var", "and", "or", "not", "true", "false"]);
/** Words that belong to other languages (or to features this one leaves out): refused with a pointer. */
export const RESERVED: Readonly<Record<string, string>> = Object.assign(Object.create(null) as Record<string, string>, Object.fromEntries(Object.entries({
  while: "'while' is not supported: loops must be bounded, use 'for i = a to b'",
  switch: "'switch' is not supported: use if / else",
  function: "functions are not supported",
  return: "'return' is not supported",
  import: "'import' is not supported",
  export: "'export' is not supported",
  break: "'break' is not supported: loops are bounded",
  continue: "'continue' is not supported",
  class: "'class' is not supported",
  eval: "'eval' is not part of the language",
  this: "'this' is not part of the language",
  null: "there is no 'null'; use na",
  undefined: "there is no 'undefined'; use na",
  constructor: "'constructor' is a reserved name",
  prototype: "'prototype' is a reserved name",
}).concat([["__proto__", "'__proto__' is a reserved name"]])));

const OPS3 = new Set<string>([]);
const OPS2 = new Set([":=", "==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "%="]);
const OPS1 = new Set(["+", "-", "*", "/", "%", "<", ">", "=", "?", ":", "(", ")", "[", "]", ",", "."]);

const isDigit = (c: number) => c >= 48 && c <= 57;
const isIdStart = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
const isIdPart = (c: number) => isIdStart(c) || isDigit(c);
const isHex = (c: number) => isDigit(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);

export function lex(src: string, rep: Reporter): Token[] {
  const out: Token[] = [];
  const n = src.length;
  let i = 0;
  let depth = 0;
  const indents = [0];
  let atLineStart = true;
  const push = (kind: TokKind, text: string, from: number, to: number, value?: number) => {
    out.push(value === undefined ? { kind, text, from, to } : { kind, text, from, to, value });
  };

  while (i < n) {
    if (atLineStart && depth === 0) {
      // measure indentation of this line
      let j = i;
      while (j < n && src.charCodeAt(j) === 32) j++;
      if (j < n && src.charCodeAt(j) === 9) {
        rep.error("tab characters are not allowed; indent with spaces", { from: j, to: j + 1 });
        while (j < n && src.charCodeAt(j) === 9) j++;
      }
      const c = src.charCodeAt(j);
      const blank = j >= n || c === 10 || c === 13 || (c === 47 && src.charCodeAt(j + 1) === 47);
      if (blank) {
        // skip to end of line
        while (j < n && src.charCodeAt(j) !== 10) j++;
        i = j < n ? j + 1 : j;
        continue;
      }
      const width = j - i;
      const top = indents[indents.length - 1]!;
      if (width > top) {
        indents.push(width);
        push("indent", "", i, j);
      } else if (width < top) {
        while (indents.length > 1 && indents[indents.length - 1]! > width) {
          indents.pop();
          push("dedent", "", i, j);
        }
        if (indents[indents.length - 1]! !== width) {
          rep.error("indentation does not match any outer block", { from: i, to: j });
          indents.push(width);
        }
      }
      i = j;
      atLineStart = false;
      continue;
    }
    const ch = src.charCodeAt(i);
    if (ch === 10) {
      if (depth === 0) {
        push("newline", "\n", i, i + 1);
        atLineStart = true;
      }
      i++;
      continue;
    }
    if (ch === 32 || ch === 13) { i++; continue; }
    if (ch === 9) {
      rep.error("tab characters are not allowed; indent with spaces", { from: i, to: i + 1 });
      i++;
      continue;
    }
    if (ch === 47 && src.charCodeAt(i + 1) === 47) {
      while (i < n && src.charCodeAt(i) !== 10) i++;
      continue;
    }
    // numbers
    if (isDigit(ch) || (ch === 46 && isDigit(src.charCodeAt(i + 1)))) {
      const s = i;
      while (i < n && isDigit(src.charCodeAt(i))) i++;
      if (src.charCodeAt(i) === 46 && isDigit(src.charCodeAt(i + 1))) {
        i++;
        while (i < n && isDigit(src.charCodeAt(i))) i++;
      } else if (src.charCodeAt(i) === 46 && !isIdStart(src.charCodeAt(i + 1))) {
        i++; // "1." is a float
      }
      if (src.charCodeAt(i) === 101 || src.charCodeAt(i) === 69) {
        let k = i + 1;
        if (src.charCodeAt(k) === 43 || src.charCodeAt(k) === 45) k++;
        if (isDigit(src.charCodeAt(k))) {
          while (isDigit(src.charCodeAt(k))) k++;
          i = k;
        }
      }
      const text = src.slice(s, i);
      if (isIdStart(src.charCodeAt(i))) {
        let e = i;
        while (e < n && isIdPart(src.charCodeAt(e))) e++;
        rep.error(`invalid number "${src.slice(s, e)}"`, { from: s, to: e });
        i = e;
        push("num", "0", s, e, 0);
        continue;
      }
      const v = Number(text);
      if (!Number.isFinite(v)) rep.error(`number "${text}" is out of range`, { from: s, to: i });
      push("num", text, s, i, Number.isFinite(v) ? v : 0);
      continue;
    }
    if (isIdStart(ch)) {
      const s = i;
      while (i < n && isIdPart(src.charCodeAt(i))) i++;
      const text = src.slice(s, i);
      if (text in RESERVED) {
        rep.error(RESERVED[text]!, { from: s, to: i });
        push("ident", "_reserved", s, i);
      } else push(KEYWORDS.has(text) ? "kw" : "ident", text, s, i);
      continue;
    }
    if (ch === 34 || ch === 39) {
      const s = i;
      const q = ch;
      i++;
      let val = "";
      let closed = false;
      while (i < n) {
        const c = src.charCodeAt(i);
        if (c === 10) break;
        if (c === q) { i++; closed = true; break; }
        if (c === 92) {
          const e = src[i + 1];
          if (e === "n") val += "\n";
          else if (e === "t") val += "\t";
          else if (e === "\\" || e === '"' || e === "'") val += e;
          else rep.error(`unknown escape "\\${e ?? ""}"`, { from: i, to: Math.min(n, i + 2) });
          i += 2;
          continue;
        }
        val += src[i];
        i++;
      }
      if (!closed) rep.error("unterminated string", { from: s, to: i });
      push("str", val, s, i);
      continue;
    }
    if (ch === 35) {
      const s = i;
      i++;
      while (i < n && isHex(src.charCodeAt(i))) i++;
      const hex = src.slice(s + 1, i);
      if (hex.length !== 6 && hex.length !== 8) rep.error(`invalid color "${src.slice(s, i)}": use #RRGGBB or #RRGGBBAA`, { from: s, to: i });
      push("color", `#${hex}`.toLowerCase(), s, i);
      continue;
    }
    const two = src.slice(i, i + 2);
    if (OPS2.has(two)) {
      push("op", two, i, i + 2);
      i += 2;
      continue;
    }
    const one = src[i]!;
    if (OPS1.has(one)) {
      if (one === "(" || one === "[") depth++;
      else if (one === ")" || one === "]") depth = Math.max(0, depth - 1);
      push("op", one, i, i + 1);
      i++;
      continue;
    }
    void OPS3;
    const cp = src.codePointAt(i)!;
    const len = cp > 0xffff ? 2 : 1;
    rep.error(`unexpected character ${JSON.stringify(src.slice(i, i + len))}`, { from: i, to: i + len });
    i += len;
  }
  if (depth > 0) rep.error("unclosed bracket", { from: n, to: n });
  if (out.length > 0 && out[out.length - 1]!.kind !== "newline") push("newline", "\n", n, n);
  while (indents.length > 1) {
    indents.pop();
    push("dedent", "", n, n);
  }
  push("eof", "", n, n);
  return out;
}
