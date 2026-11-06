// The syntax tree. Checker results are written onto the nodes (`ty`, `st`, `ref`).

import type { Span } from "./diag.js";

export type Base = "int" | "float" | "bool" | "string" | "color" | "na" | "plot" | "void" | "tuple";
/** const: a literal; input: known when the study is built; series: varies per bar. */
export type Qual = "const" | "input" | "series";
export interface Ty {
  b: Base;
  q: Qual;
  elems?: Ty[];
}

export interface Sym {
  name: string;
  kind: "builtin" | "input" | "simple" | "pure" | "state" | "local" | "loop" | "plot";
  ty: Ty;
  /** Builtin source name, input key, or slot / plot index. */
  key?: string;
  slot?: number;
  /** A top-level variable kept in the exec program (var, or assigned with :=). */
  isVar?: boolean;
  decl?: Span;
  /** A pure variable's domain (see `Base_.dom`). */
  dom?: string;
}

interface Base_ extends Span {
  /** Type, set by the checker. */
  ty?: Ty;
  /** Depends on a variable that changes while a bar is evaluated (state, locals, loop counters). */
  st?: boolean;
  /**
   * Whose bars the value lives on, set by the checker: "~" a constant (no bars of its own), "@" the chart's bars (the
   * default), or the key of the outside series whose own bars it is computed on. See check.ts, `combineDom`.
   */
  dom?: string;
}

/** `float` is how the literal was written: with a dot or an exponent (0.0, 1., 1e3) it is a float whatever its value. */
export interface NumLit extends Base_ { k: "num"; value: number; float: boolean }
export interface StrLit extends Base_ { k: "str"; value: string }
export interface BoolLit extends Base_ { k: "bool"; value: boolean }
export interface ColorLit extends Base_ { k: "color"; value: string }
export interface Ident extends Base_ { k: "id"; name: string; sym?: Sym }
export interface Unary extends Base_ { k: "un"; op: "-" | "+" | "not"; x: Expr }
export interface Binary extends Base_ { k: "bin"; op: string; a: Expr; b: Expr }
export interface Ternary extends Base_ { k: "tern"; c: Expr; a: Expr; b: Expr }
export interface Arg { name: string | null; nameSpan?: Span; value: Expr }
export interface Call extends Base_ { k: "call"; callee: Expr; /** For outside(): the key of the series it reads, and whether it has a timeframe of its own (then what is computed on it runs on its own bars). */ feed?: string; own?: boolean; args: Arg[]; /** Resolved signature name, e.g. "ta.sma". */ fn?: string; /** Arguments in parameter order (null = omitted). */ bound?: (Expr | null)[] }
export interface Member extends Base_ { k: "mem"; obj: Expr; name: string; nameSpan: Span; /** A namespace constant's value (math.pi, color.red, plot.style_line). */ cv?: number | string }
export interface Index extends Base_ { k: "idx"; x: Expr; i: Expr }
export interface ArrayLit extends Base_ { k: "arr"; items: Expr[] }
export type Expr = NumLit | StrLit | BoolLit | ColorLit | Ident | Unary | Binary | Ternary | Call | Member | Index | ArrayLit;

export type TypeName = "int" | "float" | "bool" | "string" | "color";

export interface VarDecl extends Span { k: "decl"; isVar: boolean; type: TypeName | null; name: string; nameSpan: Span; init: Expr; sym?: Sym }
export interface TupleDecl extends Span { k: "tuple"; names: { name: string; span: Span }[]; init: Expr; syms?: Sym[] }
export interface Assign extends Span { k: "assign"; name: string; nameSpan: Span; op: ":=" | "+=" | "-=" | "*=" | "/=" | "%="; value: Expr; sym?: Sym }
export interface If extends Span { k: "if"; cond: Expr; then: Stmt[]; else: Stmt[] | null }
export interface For extends Span { k: "for"; name: string; nameSpan: Span; lo: Expr; hi: Expr; by: Expr | null; body: Stmt[]; sym?: Sym }
export interface ExprStmt extends Span { k: "expr"; expr: Expr }
export type Stmt = VarDecl | TupleDecl | Assign | If | For | ExprStmt;

export interface Program {
  body: Stmt[];
}
