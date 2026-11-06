---
name: alphacharts-troubleshooting
description: >
    Every diagnostic the compiler and the runtime can emit, with its cause and fix; the common ones here, the rest by phase
    in the catalogue files.
version: 1.0
api_version: 0.x
depends_on:
    - alphacharts-core
    - alphacharts-script-language
status: stable
---

# alphacharts Troubleshooting

## 1. When to use this skill

Load it when a compile or run diagnostic came back, or a script compiles but draws nothing useful. Find the message below
(or in the catalogue), apply the fix, recompile.

## 2. Domain overview

A diagnostic is `line:column message`, with the line and column of the offending code (1-based). The compiler reports every
independent error in one pass (at most 50), so fix from the first one down: a later message is often a consequence of an
earlier one (a failed line leaves its block empty and adds `a block needs at least one statement`). Messages are exact
text; `{...}` in the rows below stands for the part that varies.

Phases, in the order they fire: lexing and parsing (syntax), type and name checking, call checking (arguments, state),
output statements and inputs, then building and running on the bars (limits, history offsets, budgets). A build or run
failure is reported with the same shape.

## 3. API reference

The common messages are listed here. Everything else is in the catalogue, by phase: [syntax](catalogue/syntax.md),
[names and types](catalogue/names-and-types.md), [calls and state](catalogue/calls.md),
[output and inputs](catalogue/output-and-inputs.md), [limits and run time](catalogue/limits-and-runtime.md).

- `expected an expression, found {...}` — A value is missing: often a trailing operator, an empty argument or an unfinished line. Fix: complete the expression at the reported column.
- `"{name}" is a built-in name and cannot be redeclared` — The name belongs to a series, namespace or function (`close`, `volume`, `ta`, `plot`, `nz`...). Fix: rename the variable.
- `this call returns {...} values; destructure them: [a, b, ...] = ...` — A study or `ta.bb` returns several columns. Fix: `[a, b, c] = ta.<id>(...)` with exactly that many names, in the listed order.
- `cannot assign {...} to {sym.ty.b} "{s.name}" (declare it float: e.g. x = 0.0)` — A variable fixed as int received a fraction (a literal such as `0.0` is an int). Fix: declare it float: `var float x = 0`.
- `the condition of if must be bool, got {...}` — A number was used as a condition. Fix: compare it, `if x > 0`.
- `unknown name "{e.name}"` — The name is not declared before this line and is not built in. Fix: declare it above, or fix the spelling; check the builtins reference.
- `unknown name "{e.obj.name}.{e.name}"` — The namespace has no such member. Fix: check the spelling against the builtins and studies references (`color.red`, `shape.circle`, `ta.sma`).
- `"{e.op}" needs numbers, got {...} and {...} (a bool is not a number: use a ternary)` — Arithmetic or comparison on a bool. Fix: `(cond ? 1 : 0)` first.
- `the condition of ?: must be bool, got {...}` — The first part of `?:` is not a comparison. Fix: `x > 0 ? a : b`.
- `the history offset must be an int, got {...}` — `x[1.5]` or a float offset. Fix: an int literal, an int input or an int expression.
- `{sig.name} has no parameter "{a.name}" (parameters: {...})` — A named argument does not exist on that function. Fix: use a name from the listed parameters.
- `argument "{p.name}" of {sig.name} must be a literal or an input, not a series value` — A series was given where a fixed value is required (lengths, multiples, colours, titles). Fix: use a literal or `input.*`.
- `argument "{p.name}" of {sig.name} must be a number series, got {...}` — A bool, string, colour, tuple or nothing was given as a series. Fix: pass a numeric series; convert a bool with `c ? 1 : 0`; destructure a tuple.
- `argument "{p.name}" of {sig.name} must be an int, got {...}` — A float where a whole number is required (a length). Fix: `14`, not `14.5`; an `input.int`.
- `argument "{p.name}" of {sig.name} must be between {...} and {...}, got {cv}` — A literal outside the accepted range (a length of 0 or 6000, transparency over 100...). Fix: use a value inside the range shown.
- `unknown function "{name}"{...}` — A wrong or missing prefix. Fix: use the suggested name; kernels and studies are `ta.<id>`, maths `math.<name>`.
- `argument "{p.name}" of {sig.name} depends on a variable that is declared var, assigned with :=, or is a block variable / loop counter. {sig.name} runs over whole columns, so its inputs must be known before the bar is evaluated` — A `ta.*` call received state. Fix: compute the value from bars only, or write the recursion with `var` yourself.
- `a color here must be a constant (color.red, #rrggbb, color.new(...)) or an input.color variable` — The colour is per bar or computed. Fix: a `color.*` constant, `#rrggbb`, `color.new` of a constant, or an `input.color`. For a changing colour use two plots.
- `unknown function "{name}"` — No such function. Fix: check the studies and builtins references; math-family ids are not callable.
- `the script draws nothing: add plot(...)` — No `plot`, `hline` or `plotshape` output. Fix: add `plot(...)` of the series to show.

## 4. Standard workflow

1. Read every diagnostic; start with the first.
2. Find its row by its fixed words; apply the fix to that line only.
3. Recompile. If the same message returns, re-read the cause: the fix may belong to a different line (a `ta.*` call cannot be
   fixed by editing the line that uses its result).
4. When the message names a parameter, copy the parameter list from the studies reference instead of guessing.
5. When a fix would need something the language lacks (per-bar colour, arrays, other symbols), stop and say so.

## 5. Examples

A bool plotted, and the repair:

<!-- skill: invalid: argument "series" of plot must be a number series, got series bool -->
```alphacharts
plot(close > open)
```

```alphacharts
plot(close > open ? 1 : 0, "Up bar", style=plot.style_histogram)
```

A tuple used as a series, and the repair:

<!-- skill: invalid: this call returns 3 values; destructure them: [a, b, ...] = ... -->
```alphacharts
macd_line = ta.macd(close)
plot(macd_line)
```

```alphacharts
[macd_line, signal_line, hist] = ta.macd(close)
plot(macd_line, "MACD")
```

A `ta.*` call on a variable that changes with state, and the repair (recurse by hand instead):

<!-- skill: invalid: argument "source" of ta.ema depends on a variable that is declared var, assigned with :=, or is a block variable / loop counter. ta.ema runs over whole columns, so its inputs must be known before the bar is evaluated -->
```alphacharts
var float s = 0
s := s + (close > open ? 1 : -1)
plot(ta.ema(s, 10))
```

```alphacharts
var float s = 0
var float smooth = 0
s := s + (close > open ? 1 : -1)
smooth := smooth + (2 / 11) * (s - smooth)
plot(smooth, "Smoothed")
```

## 6. Composition

Most repairs need script-language (types, state) or studies (parameter lists). Output statement repairs need
plots-and-panes.

## 7. Constraints and correctness

A script can compile and still look wrong. Check, in this order:

- Everything is a gap: the first values are `na` until the longest window is full (a statistic of returns starts one bar
  later than one of prices); a divisor of 0 gives `na`; a `ta.*` window holding one `na` is `na`.
- A study draws in the wrong place: `overlay` must match the units (price-scale values need `overlay=true`).
- A constant line: a `ta.sma` of a number such as `14` (the source was left out) averages the constant.
- A histogram has one colour: `color_down` is not set.

## 8. Common mistakes

- Fixing the symptom line instead of the declaration it depends on.
- Adding `ta.` to a kernel that is already prefixed, or dropping it from a study.
- Replacing a diagnostic with a guess: re-read the row.
- Silencing `na` with `nz` everywhere; it turns warm-up into zeros.

## 9. Validation

The browser compiles the script and diagnostics come back. A repaired script should compile with no diagnostics and draw
something at the bars where its longest window is full.

## 10. Related skills

[Core](../core/SKILL.md), [Script language](../script-language/SKILL.md), [Studies](../studies/SKILL.md), [Plots and panes](../plots-and-panes/SKILL.md).
