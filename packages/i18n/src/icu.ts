// A small ICU MessageFormat subset, no dependencies.
//
//   {name}                          interpolation (string or number)
//   {n, number}                     a number in the locale's grouping/digits
//   {n, plural, =0 {…} one {…} other {# …}}   cardinal plural; # is the count
//   {n, plural, offset:1 …}         offset applies to # and the category, not to =N
//   {n, selectordinal, one {#st} …} ordinal plural
//   {k, select, a {…} other {…}}    string choice
//
// Quoting: `'{'`, `'}'` and (inside a plural) `'#'` are literal; `''` is an
// apostrophe. A lone apostrophe elsewhere is literal, as in ICU.
//
// Parsing is strict: every error carries the message and the offset, and a
// plural/select without `other` is an error. Formatting never guesses: a
// missing value throws.

export type MessageValue = string | number;
export type MessageValues = Readonly<Record<string, MessageValue>>;

export type Node =
  | { t: "text"; s: string }
  | { t: "arg"; name: string }
  | { t: "number"; name: string }
  | { t: "pound" }
  | { t: "plural"; name: string; offset: number; ordinal: boolean; cases: Cases }
  | { t: "select"; name: string; cases: Cases };

export type Cases = Record<string, Node[]>;

export class MessageSyntaxError extends Error {
  constructor(message: string, readonly source: string, readonly offset: number) {
    super(`ICU syntax error at ${offset}: ${message} in "${source}"`);
    this.name = "MessageSyntaxError";
  }
}

const PLURAL_CATEGORIES = new Set(["zero", "one", "two", "few", "many", "other"]);

export function parseMessage(src: string): Node[] {
  let i = 0;
  const fail = (msg: string): never => {
    throw new MessageSyntaxError(msg, src, i);
  };

  const skipWs = () => {
    while (i < src.length && /\s/.test(src[i]!)) i++;
  };

  const ident = (): string => {
    skipWs();
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (!m) return fail("expected a name");
    i += m[0].length;
    return m[0];
  };

  // Parses until `}` (when nested) or the end of input. `inPlural` enables `#`.
  function nodes(nested: boolean, inPlural: boolean): Node[] {
    const out: Node[] = [];
    let text = "";
    const flush = () => {
      if (text) out.push({ t: "text", s: text });
      text = "";
    };
    while (i < src.length) {
      const c = src[i]!;
      if (c === "'") {
        const n = src[i + 1];
        if (n === "'") {
          text += "'";
          i += 2;
        } else if (n === "{" || n === "}" || (n === "#" && inPlural)) {
          // Quoted literal run up to the next lone apostrophe.
          i++;
          for (;;) {
            if (i >= src.length) break;
            if (src[i] === "'") {
              if (src[i + 1] === "'") {
                text += "'";
                i += 2;
                continue;
              }
              i++;
              break;
            }
            text += src[i++];
          }
        } else {
          text += c;
          i++;
        }
      } else if (c === "{") {
        flush();
        out.push(argument());
      } else if (c === "}") {
        if (!nested) fail("unmatched }");
        break;
      } else if (c === "#" && inPlural) {
        flush();
        out.push({ t: "pound" });
        i++;
      } else {
        text += c;
        i++;
      }
    }
    flush();
    return out;
  }

  function argument(): Node {
    i++; // {
    const name = ident();
    skipWs();
    if (src[i] === "}") {
      i++;
      return { t: "arg", name };
    }
    if (src[i] !== ",") return fail("expected , or }");
    i++;
    const type = ident();
    skipWs();
    if (type === "number") {
      if (src[i] !== "}") return fail("number takes no style");
      i++;
      return { t: "number", name };
    }
    if (type !== "plural" && type !== "selectordinal" && type !== "select") return fail(`unknown argument type "${type}"`);
    if (src[i] !== ",") return fail("expected ,");
    i++;
    let offset = 0;
    skipWs();
    const om = /^offset:\s*(\d+)/.exec(src.slice(i));
    if (om) {
      if (type === "select") fail("offset is only for plural");
      offset = Number(om[1]);
      i += om[0].length;
    }
    const cases: Cases = {};
    for (;;) {
      skipWs();
      if (src[i] === "}") {
        i++;
        break;
      }
      if (i >= src.length) return fail("unterminated argument");
      let key: string;
      if (type !== "select" && src[i] === "=") {
        const m = /^=(\d+)/.exec(src.slice(i));
        if (!m) return fail("expected a number after =");
        key = m[0];
        i += m[0].length;
      } else {
        key = ident();
        if (type !== "select" && !PLURAL_CATEGORIES.has(key)) return fail(`unknown plural category "${key}"`);
      }
      if (key in cases) return fail(`duplicate case "${key}"`);
      skipWs();
      if (src[i] !== "{") return fail("expected { before a case body");
      i++;
      cases[key] = nodes(true, type !== "select");
      if (src[i] !== "}") return fail("unterminated case body");
      i++;
    }
    if (!("other" in cases)) return fail(`${type} needs an "other" case`);
    return type === "select" ? { t: "select", name, cases } : { t: "plural", name, offset, ordinal: type === "selectordinal", cases };
  }

  const out = nodes(false, false);
  return out;
}

/** Where a message needs numbers and strings from: name → what it does with it. */
export function placeholders(ast: readonly Node[]): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (ns: readonly Node[]) => {
    for (const n of ns) {
      if (n.t === "arg") out.set(n.name, out.get(n.name) ?? "arg");
      else if (n.t === "number") out.set(n.name, "number");
      else if (n.t === "plural") {
        out.set(n.name, "number");
        for (const c of Object.values(n.cases)) walk(c);
      } else if (n.t === "select") {
        out.set(n.name, `select:${Object.keys(n.cases).sort().join("|")}`);
        for (const c of Object.values(n.cases)) walk(c);
      }
    }
  };
  walk(ast);
  return out;
}

export interface FormatContext {
  locale: string;
  number(n: number): string;
}

export function formatNodes(ast: readonly Node[], values: MessageValues, ctx: FormatContext, source: string, pound?: number): string {
  let out = "";
  const need = (name: string): MessageValue => {
    const v = values[name];
    if (v === undefined) throw new Error(`i18n: message "${source}" needs a value for "${name}"`);
    return v;
  };
  const num = (name: string): number => {
    const v = need(name);
    if (typeof v !== "number" || !Number.isFinite(v)) throw new TypeError(`i18n: "${name}" must be a finite number in message "${source}", got ${String(v)}`);
    return v;
  };
  for (const n of ast) {
    switch (n.t) {
      case "text":
        out += n.s;
        break;
      case "arg": {
        const v = need(n.name);
        out += typeof v === "number" ? ctx.number(v) : v;
        break;
      }
      case "number":
        out += ctx.number(num(n.name));
        break;
      case "pound":
        if (pound === undefined) throw new Error(`i18n: # outside a plural in "${source}"`);
        out += ctx.number(pound);
        break;
      case "plural": {
        const v = num(n.name);
        const adj = v - n.offset;
        const body =
          n.cases[`=${v}`] ??
          n.cases[new Intl.PluralRules(ctx.locale, n.ordinal ? { type: "ordinal" } : undefined).select(adj)] ??
          n.cases.other!;
        out += formatNodes(body, values, ctx, source, adj);
        break;
      }
      case "select": {
        const v = String(need(n.name));
        out += formatNodes(n.cases[v] ?? n.cases.other!, values, ctx, source, pound);
        break;
      }
    }
  }
  return out;
}
