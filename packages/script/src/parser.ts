// Recursive-descent parser with error recovery: a bad statement is reported and
// skipped to the end of its line (and its indented block), so one run reports
// every independent mistake.
//
// Grammar (the same text is in the README):
//
//   program   = { statement } ;
//   statement = declaration | tuple | assignment | if | for | call NEWLINE ;
//   declaration = [ "var" ] [ type ] IDENT "=" expr NEWLINE ;
//   tuple     = "[" IDENT { "," IDENT } "]" "=" expr NEWLINE ;
//   assignment = IDENT ( ":=" | "+=" | "-=" | "*=" | "/=" | "%=" ) expr NEWLINE ;
//   if        = "if" expr block [ "else" ( if | block ) ] ;
//   for       = "for" IDENT "=" expr "to" expr [ "by" expr ] block ;
//   block     = NEWLINE INDENT statement { statement } DEDENT ;
//   expr      = ternary ;
//   ternary   = or [ "?" expr ":" expr ] ;
//   or        = and { "or" and } ;   and = not { "and" not } ;   not = "not" not | cmp ;
//   cmp       = add [ ( "==" | "!=" | "<" | "<=" | ">" | ">=" ) add ] ;
//   add       = mul { ( "+" | "-" ) mul } ;   mul = unary { ( "*" | "/" | "%" ) unary } ;
//   unary     = ( "-" | "+" ) unary | postfix ;
//   postfix   = primary { "(" [ args ] ")" | "[" expr "]" | "." IDENT } ;
//   args      = arg { "," arg } ;   arg = [ IDENT "=" ] expr ;
//   primary   = NUMBER | STRING | COLOR | "true" | "false" | IDENT | "(" expr ")" | "[" [ expr { "," expr } ] "]" ;

import type { Reporter, Span } from "./diag.js";
import type { Arg, Expr, Program, Stmt, TypeName } from "./ast.js";
import { lex, type Token } from "./lexer.js";

const TYPE_NAMES: ReadonlySet<string> = new Set(["int", "float", "bool", "string", "color"]);
const ASSIGN_OPS: ReadonlySet<string> = new Set([":=", "+=", "-=", "*=", "/=", "%="]);
/** Nesting deeper than this is refused (a recursion guard, not a language limit anyone meets). */
const MAX_DEPTH = 100;

class Bail extends Error {}

class Parser {
  private p = 0;
  private depth = 0;
  constructor(private readonly t: Token[], private readonly rep: Reporter) {}

  private get tok(): Token { return this.t[this.p]!; }
  private kind(): string { return this.t[this.p]!.kind; }
  private peek(k = 1): Token { return this.t[Math.min(this.p + k, this.t.length - 1)]!; }
  private next(): Token { const x = this.tok; if (x.kind !== "eof") this.p++; return x; }
  private isOp(text: string, tok = this.tok): boolean { return tok.kind === "op" && tok.text === text; }
  private isKw(text: string, tok = this.tok): boolean { return tok.kind === "kw" && tok.text === text; }
  private fail(message: string, span: Span = this.tok): never {
    this.rep.error(message, span.from === span.to && this.tok.kind === "newline" ? { from: span.from, to: span.from } : span);
    throw new Bail();
  }
  private expectOp(text: string, what = `"${text}"`): Token {
    if (!this.isOp(text)) this.fail(`expected ${what}, found ${this.describe()}`);
    return this.next();
  }
  private describe(t = this.tok): string {
    switch (t.kind) {
      case "eof": return "end of input";
      case "newline": return "end of line";
      case "indent": return "an unexpected indent";
      case "dedent": return "end of block";
      case "str": return "a string";
      case "num": return `"${t.text}"`;
      default: return `"${t.text}"`;
    }
  }

  program(): Program {
    const body: Stmt[] = [];
    while (this.tok.kind !== "eof") {
      if (this.tok.kind === "newline") { this.next(); continue; }
      if (this.kind() === "indent") {
        this.rep.error("unexpected indent", this.tok);
        this.skipBlock();
        continue;
      }
      if (this.kind() === "dedent") { this.next(); continue; }
      this.statementRecovering(body);
    }
    return { body };
  }

  private statementRecovering(into: Stmt[]): void {
    try {
      into.push(this.statement());
    } catch (e) {
      if (!(e instanceof Bail)) throw e;
      this.sync();
    }
  }

  /** Skip to the end of the current line, then over an indented block that follows it. */
  private sync(): void {
    while (this.tok.kind !== "newline" && this.tok.kind !== "eof" && this.tok.kind !== "dedent") this.next();
    if (this.tok.kind === "newline") this.next();
    if (this.kind() === "indent") this.skipBlock();
  }

  private skipBlock(): void {
    let depth = 0;
    do {
      if (this.kind() === "indent") depth++;
      else if (this.kind() === "dedent") depth--;
      this.next();
    } while (depth > 0 && this.tok.kind !== "eof");
  }

  private endStatement(): void {
    if (this.tok.kind === "newline") { this.next(); return; }
    if (this.tok.kind === "eof" || this.tok.kind === "dedent") return;
    this.fail(`unexpected ${this.describe()}; expected end of line`);
  }

  private block(): Stmt[] {
    if (this.tok.kind !== "newline") this.fail(`expected end of line before the indented block, found ${this.describe()}`);
    this.next();
    if (this.kind() !== "indent") this.fail("expected an indented block");
    this.next();
    const body: Stmt[] = [];
    while (this.kind() !== "dedent" && this.kind() !== "eof") {
      if (this.tok.kind === "newline") { this.next(); continue; }
      if (this.kind() === "indent") {
        this.rep.error("unexpected indent", this.tok);
        this.skipBlock();
        continue;
      }
      this.statementRecovering(body);
    }
    if (this.kind() === "dedent") this.next();
    if (body.length === 0) this.rep.error("a block needs at least one statement", this.t[Math.max(0, this.p - 1)]!);
    return body;
  }

  private statement(): Stmt {
    const t = this.tok;
    // a reserved word was already reported by the lexer
    if (t.kind === "ident" && t.text === "_reserved") throw new Bail();
    if (this.isKw("if")) return this.ifStmt();
    if (this.isKw("for")) return this.forStmt();
    if (this.isKw("var")) {
      this.next();
      return this.declaration(t.from, true);
    }
    if (t.kind === "ident") {
      const n = this.peek();
      if (TYPE_NAMES.has(t.text) && n.kind === "ident" && this.isOp("=", this.peek(2))) return this.declaration(t.from, false);
      if (this.isOp("=", n)) return this.declaration(t.from, false);
      if (n.kind === "op" && ASSIGN_OPS.has(n.text)) {
        this.next();
        const op = this.next().text as ":=";
        const value = this.expr();
        const end = this.tok.from;
        this.endStatement();
        return { k: "assign", name: t.text, nameSpan: t, op, value, from: t.from, to: Math.max(value.to, end) };
      }
    }
    if (this.isOp("[")) {
      // a tuple declaration starts with "[" IDENT {"," IDENT} "]" "="
      const names: { name: string; span: Span }[] = [];
      this.next();
      for (;;) {
        if (this.tok.kind !== "ident") this.fail(`expected a name, found ${this.describe()}`);
        const nm = this.next();
        names.push({ name: nm.text, span: nm });
        if (this.isOp(",")) { this.next(); continue; }
        break;
      }
      this.expectOp("]");
      this.expectOp("=", '"=" (a tuple of names must be assigned)');
      const init = this.expr();
      this.endStatement();
      return { k: "tuple", names, init, from: t.from, to: init.to };
    }
    const e = this.expr();
    if (e.k !== "call") this.fail("this expression has no effect; a statement is a declaration, an assignment, if, for or a call", e);
    this.endStatement();
    return { k: "expr", expr: e, from: e.from, to: e.to };
  }

  private declaration(from: number, isVar: boolean): Stmt {
    let type: TypeName | null = null;
    if (this.tok.kind === "ident" && TYPE_NAMES.has(this.tok.text) && this.peek().kind === "ident") type = this.next().text as TypeName;
    if (this.tok.kind !== "ident") this.fail(`expected a variable name, found ${this.describe()}`);
    const name = this.next();
    this.expectOp("=");
    const init = this.expr();
    this.endStatement();
    return { k: "decl", isVar, type, name: name.text, nameSpan: name, init, from, to: init.to };
  }

  private ifStmt(): Stmt {
    const start = this.next();
    const cond = this.expr();
    const then = this.block();
    let els: Stmt[] | null = null;
    if (this.isKw("else")) {
      this.next();
      if (this.isKw("if")) els = [this.ifStmt()];
      else els = this.block();
    }
    return { k: "if", cond, then, else: els, from: start.from, to: this.t[this.p - 1]!.to };
  }

  private forStmt(): Stmt {
    const start = this.next();
    if (this.tok.kind !== "ident") this.fail(`expected a loop variable name, found ${this.describe()}`);
    const name = this.next();
    this.expectOp("=");
    const lo = this.expr();
    if (!this.isKw("to")) this.fail(`expected "to", found ${this.describe()}`);
    this.next();
    const hi = this.expr();
    let by: Expr | null = null;
    if (this.isKw("by")) { this.next(); by = this.expr(); }
    const body = this.block();
    return { k: "for", name: name.text, nameSpan: name, lo, hi, by, body, from: start.from, to: this.t[this.p - 1]!.to };
  }

  // ---- expressions ------------------------------------------------------------

  expr(): Expr {
    if (++this.depth > MAX_DEPTH) this.fail("expression is nested too deeply");
    try {
      return this.ternary();
    } finally {
      this.depth--;
    }
  }

  private ternary(): Expr {
    const c = this.or();
    if (!this.isOp("?")) return c;
    this.next();
    const a = this.expr();
    this.expectOp(":", '":" of the ternary');
    const b = this.expr();
    return { k: "tern", c, a, b, from: c.from, to: b.to };
  }

  private or(): Expr {
    let a = this.and();
    while (this.isKw("or")) { this.next(); const b = this.and(); a = { k: "bin", op: "or", a, b, from: a.from, to: b.to }; }
    return a;
  }

  private and(): Expr {
    let a = this.not();
    while (this.isKw("and")) { this.next(); const b = this.not(); a = { k: "bin", op: "and", a, b, from: a.from, to: b.to }; }
    return a;
  }

  private not(): Expr {
    if (this.isKw("not")) {
      const t = this.next();
      if (++this.depth > MAX_DEPTH) this.fail("expression is nested too deeply");
      try {
        const x = this.not();
        return { k: "un", op: "not", x, from: t.from, to: x.to };
      } finally { this.depth--; }
    }
    return this.cmp();
  }

  private cmp(): Expr {
    const a = this.add();
    const t = this.tok;
    if (t.kind === "op" && (t.text === "==" || t.text === "!=" || t.text === "<" || t.text === "<=" || t.text === ">" || t.text === ">=")) {
      this.next();
      const b = this.add();
      const e: Expr = { k: "bin", op: t.text, a, b, from: a.from, to: b.to };
      const t2 = this.tok;
      if (t2.kind === "op" && ["==", "!=", "<", "<=", ">", ">="].includes(t2.text)) this.fail("comparisons do not chain; combine them with 'and'", t2);
      return e;
    }
    return a;
  }

  private add(): Expr {
    let a = this.mul();
    while (this.isOp("+") || this.isOp("-")) { const op = this.next().text; const b = this.mul(); a = { k: "bin", op, a, b, from: a.from, to: b.to }; }
    return a;
  }

  private mul(): Expr {
    let a = this.unary();
    while (this.isOp("*") || this.isOp("/") || this.isOp("%")) { const op = this.next().text; const b = this.unary(); a = { k: "bin", op, a, b, from: a.from, to: b.to }; }
    return a;
  }

  private unary(): Expr {
    if (this.isOp("-") || this.isOp("+")) {
      const t = this.next();
      if (++this.depth > MAX_DEPTH) this.fail("expression is nested too deeply");
      try {
        const x = this.unary();
        return { k: "un", op: t.text as "-" | "+", x, from: t.from, to: x.to };
      } finally { this.depth--; }
    }
    return this.postfix();
  }

  private postfix(): Expr {
    let e = this.primary();
    for (;;) {
      if (this.isOp("(")) {
        this.next();
        const args = this.args();
        const close = this.expectOp(")", '")" to close the call');
        e = { k: "call", callee: e, args, from: e.from, to: close.to };
      } else if (this.isOp("[")) {
        this.next();
        const i = this.expr();
        const close = this.expectOp("]", '"]" to close the index');
        e = { k: "idx", x: e, i, from: e.from, to: close.to };
      } else if (this.isOp(".")) {
        this.next();
        if (this.tok.kind !== "ident") this.fail(`expected a name after ".", found ${this.describe()}`);
        const nm = this.next();
        e = { k: "mem", obj: e, name: nm.text, nameSpan: nm, from: e.from, to: nm.to };
      } else return e;
    }
  }

  private args(): Arg[] {
    const out: Arg[] = [];
    if (this.isOp(")")) return out;
    for (;;) {
      if (this.tok.kind === "ident" && this.isOp("=", this.peek())) {
        const nm = this.next();
        this.next();
        out.push({ name: nm.text, nameSpan: nm, value: this.expr() });
      } else {
        const v = this.expr();
        out.push({ name: null, value: v });
      }
      if (this.isOp(",")) { this.next(); continue; }
      return out;
    }
  }

  private primary(): Expr {
    const t = this.tok;
    switch (t.kind) {
      case "num": this.next(); return { k: "num", value: t.value!, float: /[.eE]/.test(t.text), from: t.from, to: t.to };
      case "str": this.next(); return { k: "str", value: t.text, from: t.from, to: t.to };
      case "color": this.next(); return { k: "color", value: t.text, from: t.from, to: t.to };
      case "ident": this.next(); return { k: "id", name: t.text, from: t.from, to: t.to };
      case "kw":
        if (t.text === "true" || t.text === "false") { this.next(); return { k: "bool", value: t.text === "true", from: t.from, to: t.to }; }
        break;
      case "op":
        if (t.text === "(") {
          this.next();
          const e = this.expr();
          const close = this.expectOp(")", '")"');
          return { ...e, from: t.from, to: close.to } as Expr;
        }
        if (t.text === "[") {
          this.next();
          const items: Expr[] = [];
          if (!this.isOp("]")) {
            for (;;) {
              items.push(this.expr());
              if (this.isOp(",")) { this.next(); continue; }
              break;
            }
          }
          const close = this.expectOp("]", '"]"');
          return { k: "arr", items, from: t.from, to: close.to };
        }
        break;
      default: break;
    }
    this.fail(`expected an expression, found ${this.describe()}`);
  }
}

export function parse(src: string, rep: Reporter): Program {
  const tokens = lex(src, rep);
  return new Parser(tokens, rep).program();
}
