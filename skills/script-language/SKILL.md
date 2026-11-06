---
name: alphacharts-script-language
description: >
    The whole script language: types and qualifiers, no coercion, series and history, na, state and var, loops, inputs,
    the grammar, limits and what is refused. Load before writing any script that is more than one study call.
version: 1.0
api_version: 0.x
depends_on:
    - alphacharts-core
status: stable
---

# alphacharts Script language

## 1. When to use this skill

Load it before writing a computed series, anything with `var`, loops, `x[n]` history or `na` handling, and whenever a
diagnostic mentions types, state or history. A one-line study call needs only core and studies.

## 2. Domain overview

**Shape.** One statement per line. Blocks are indented with spaces (a tab is an error). `//` starts a comment. A line inside
`(` `)` or `[` `]` continues. Names are ASCII, case-sensitive, and cannot reuse a built-in name. Output statements
(`indicator`, `input.*`, `plot`, `hline`, `fill`, `plotshape`) are top-level only.

**Types.** `int float bool string color`, each with a qualifier: *const* (a literal), *input* (known when the script is
built) and *series* (differs per bar). A declaration infers its type; `float x = na` declares one. Nothing coerces: a number
is not a condition, a bool is not a number (use `c ? 1 : 0`), a float never narrows to int, an int widens to float. `/` is
always float; int with int stays int for `+ - * %`; `%` takes the sign of the left side. A literal whose value is whole is an
int even when written `2.0` or `1e3`, so declare fractional state with a type: `var float x = 0`.

<!-- skill: expect: {"half": {"all": 2.5}, "rem": {"all": -1}, "whole": {"all": 3}} -->
```alphacharts
plot(5 / 2, "half")
plot(-7 % 3, "rem")
float f = 3
plot(f, "whole")
```

**Series and history.** Every name is a series evaluated oldest bar first. `x[n]` is `n` bars back (`x[0]` is `x`), `na`
before the first bar. `n` is an int: a literal, an input, a loop counter or any int expression, 0 to 1,000,000. `x` must be
a plain series or a top-level variable, not a block variable, a loop counter or an expression of those.

**na.** Arithmetic with `na` is `na`. Every comparison with `na` is false, `!=` included, so `close == na` is never true: test
with `na(x)`. `x / 0` and `x % 0` are `na`; a `math.*` result that is not finite is `na`. `nz(x, replacement)` replaces `na` with `replacement`
(default 0). A `ta.*` window containing `na` is `na` until the window is clean. A `na` branch of `?:` takes the other
branch's type. Warm-up bars are `na`, and a comparison on them is false, not `na`.

<!-- skill: expect: {"div": {"all": "na"}, "eq": {"all": 0}, "ne": {"all": 0}, "nz": {"at": {"0": 0}}, "nz7": {"at": {"0": 7}}} -->
```alphacharts
plot(1 / 0, "div")
plot(close == na ? 1 : 0, "eq")
plot(close != na ? 1 : 0, "ne")
plot(nz(close[1]), "nz")
plot(nz(close[1], 7), "nz7")
```

**Pure and state.** A *pure* value depends only on bars and inputs; the engine computes it as whole columns with the same
kernels as the built-in studies. A *state* value depends on a variable that is declared `var` or assigned with `:=`, `+=`,
`-=`, `*=`, `/=` or `%=`, on a block variable, or on a loop counter. Rules that follow:

- `ta.*` and `math.sum` arguments must be pure. A `ta.*` call cannot take state, so it cannot smooth a state variable.
- `x[n]`, `ta.change`, `ta.crossover`, `ta.crossunder` and `ta.cross` accept a top-level state variable but not an
  expression of one. Assign the expression to a top-level variable first.
- To smooth state, write the recursion yourself with `var` (see the Kalman and CVD recipes).

<!-- skill: invalid: argument "source" of ta.sma depends on a variable that is declared var, assigned with :=, or is a block variable / loop counter. ta.sma runs over whole columns, so its inputs must be known before the bar is evaluated -->
```alphacharts
var float s = 0
s := s + close
plot(ta.sma(s, 3))
```

**var.** `var float x = init` evaluates `init` on the first bar only and keeps the value across bars; the statements below it
then run on every bar, the first included. A variable that is assigned but not `var` restarts from its initial expression on
every bar. `var` is top-level only and may not be a plot handle.

<!-- skill: expect: {"kept": {"at": {"0": 1, "1": 2, "9": 10}}, "restarted": {"all": 1}} -->
```alphacharts
var int kept = 0
kept += 1
fresh = 0
fresh += 1
plot(kept, "kept")
plot(fresh, "restarted")
```

**Control flow.** `if cond`, `else if cond`, `else`: the condition must be bool. `for i = a to b` and `for i = a to b by s`
run inclusive, with int bounds (literals, inputs, `bar_index` or int expressions) and a negative step to count down; at most
10,000 iterations per loop and 2,000,000 loop steps per bar. A block's variables are local. There is no `while`, `break`,
`continue`, function, class, switch or array.

<!-- skill: expect: {"sum": {"all": 15}} -->
```alphacharts
total = 0
for i = 5 to 1 by -1
    total += i
plot(total, "sum")
```

**Inputs.** `name = input.int(defval, "Title", minval=, maxval=)` is the whole right-hand side of a top-level declaration;
`name` is the input's key. Kinds are `input.int`, `input.float`, `input.bool`, `input.string` (needs `options=[...]`),
`input.source` (default one of `close open high low hl2 hlc3 ohlc4 hlcc4`) and `input.color`. Bounds and defaults are
literals. A string exists only as an input compared with a constant; a string series (`s = c ? "a" : "b"`) compiles but fails when the script runs, used or not.

**Strings and colours.** `==` and `!=` work on strings and colours that are constants or inputs; there are no other string
operations.

## 3. API reference

The signatures are generated from the compiler: [builtins.md](reference/builtins.md). Names by group:

- Series: `open high low close volume time bar_index hl2 hlc3 ohlc4 hlcc4 ta.tr`. `volume` needs volume data; `time` is
  UTC milliseconds; `bar_index` is the int bar number from 0; `ta.tr` is `na` on bar 0.
- Math: `math.abs math.sqrt math.pow math.log math.log10 math.exp math.sin math.cos math.tan math.asin math.acos math.atan
  math.sinh math.cosh math.tanh math.ceil math.floor math.trunc math.round math.sign math.max math.min math.avg
  math.toradians math.todegrees`, constants `math.pi math.e`. `math.max`, `math.min` and `math.avg` take two arguments and
  are `na` if either is. `math.round` rounds halves up. `math.sum(source, length)` equals `ta.sum`, checked in kernels.acs.
- Helpers: `nz(x, replacement)`, `na(x)`.
- Kernels (any series, `length` 1 to 5000; `ta.linreg` needs 2 or more): `ta.sma ta.ema ta.wma ta.rma ta.highest ta.lowest ta.highestbars ta.lowestbars
  ta.stdev ta.variance ta.sum ta.linreg`, `ta.atr(length)`, `ta.change(source, length)`, `ta.crossover(a, b)`,
  `ta.crossunder(a, b)`, `ta.cross(a, b)` and `[basis, upper, lower] = ta.bb(source, length, mult)`.
- Declarations: `indicator`, `input.int input.float input.bool input.string input.source input.color`, and the output
  statements of [plots-and-panes](../plots-and-panes/SKILL.md).

Semantics, each checked against a plain-JavaScript recomputation in [kernels.acs](examples/kernels.acs): `ta.stdev` and
`ta.variance` divide by n; `ta.ema` and `ta.rma` start from the SMA of the first `length` values; `ta.highestbars` and
`ta.lowestbars` count bars since the extreme (0 is this bar); `ta.linreg` is the least-squares line read at the last bar;
`ta.wma` weights the newest bar `length`; `ta.change(source, length)` is `source - source[length]`; `ta.atr` is Wilder's, first value at bar
`length`; `ta.bb` uses the population deviation, `basis` is the SMA.

<!-- skill: expect: {"same": {"all": 1}} -->
```alphacharts
m = ta.sma(close, 5)
up = ta.crossover(close, m)
by_hand = close > m and close[1] <= m[1]
plot(up == by_hand ? 1 : 0, "same")
```

## 4. Standard workflow

1. List the series the formula needs and write each as a pure expression first.
2. Put anything that accumulates or branches on previous output into `var` state.
3. Declare inputs for every length and multiple; keep lengths 1 to 5000.
4. Guard divisions that can be 0 or `na` only if the user needs a value there; `x / 0` is already `na`.
5. `plot` last, one title per plot.

## 5. Examples

An exponentially weighted variance, a loop-free state recursion:

```alphacharts
indicator("EWMA volatility of returns")
alpha = input.float(0.06, "Alpha", minval=0.001, maxval=1)
r = math.log(close / close[1])
var float v = 0
v := nz(alpha * r * r + (1 - alpha) * v)
plot(math.sqrt(v), "EWMA vol", color.purple)
```

A bounded loop over history, the loop counter used as the offset:

```alphacharts
indicator("Bars up out of the last 10")
count = 0
for i = 0 to 9
    count += close[i] > close[i + 1] ? 1 : 0
plot(count, "Up bars", color.green, style=plot.style_histogram)
```

`ta.linreg` is the one kernel whose length starts at 2, and the compiler does not know:

<!-- skill: invalid: the length of ta.linreg must be an integer between 2 and 5000, got 1 -->
```alphacharts
plot(ta.linreg(close, 1))
```

The float-literal trap, and its fix:

<!-- skill: invalid: cannot assign series float to int "x" (declare it float: e.g. x = 0.0) -->
```alphacharts
var x = 0.0
x := x + 0.5
plot(x)
```

```alphacharts
var float x = 0
x += 0.5
plot(x)
```

## 6. Composition

Inputs feed `ta.*` lengths directly, and `len * 2` or a declared `p = len + 1` are still pure. Studies
return series that can be used in formulas and in `?:`. The output statements consume series only at top level.

## 7. Constraints and correctness

- Limits: kernel `length` and study periods 1 to 5000 (some studies start at 2); history offset 0 to 1,000,000; 10,000
  iterations per loop; 2,000,000 loop steps per bar; 64 plots; 512 columns; 10,000,000 bars; source 200,000 characters;
  expression nesting 100; at most 50 errors are reported.
- `na` never becomes 0 unless `nz` or a TA-Lib definition says so (candlestick patterns return 0 for no pattern).
- A name may be declared once; `x := e` is the only way to change it. Inputs, loop counters, tuple outputs and built-ins
  cannot be assigned.
- Refused words: `while switch function return import export break continue class eval this null undefined constructor
  prototype __proto__`.
- Not in the language: arrays (only `options=[...]`), user functions, string operations, other symbols or timeframes,
  per-bar colour, drawings, alerts, randomness and clocks (output is deterministic).

## 8. Common mistakes

- `plot(close > open)`: bool is not a number. Write `plot(close > open ? 1 : 0)`.
- `if close`: the condition must be bool. Write `if close > open`.
- `int n = 2.5` or `n = input.int(5.5)`: no narrowing.
- A `ta.*` length that changes per bar: it must be a literal or an input (or an expression of those).
- `ta.sma(source, length)` with a `var` variable as the source: see Pure and state above.
- `s = close > open ? "up" : "down"`: strings are not series; the script compiles and fails when it runs.
- `ta.linreg(close, 1)`: the compiler accepts a length of 1 and the run refuses it.
- Reading `x[1]` of a loop-local value: assign it to a top-level variable first.

## 9. Validation

The browser compiles the script and diagnostics come back with line and column. Then check the first non-`na` bar: a
`ta.*` length of `n` produces its first value on bar `n - 1` (`n` for `ta.atr` and anything that needs a previous close).

## 10. Related skills

[Core](../core/SKILL.md), [Studies](../studies/SKILL.md), [Plots and panes](../plots-and-panes/SKILL.md), [Quant recipes](../quant-recipes/SKILL.md), [Troubleshooting](../troubleshooting/SKILL.md).
