# Output statements and inputs

Each row: the message (`{...}` stands for text that varies), its cause, the fix. `[host]` marks a message a script cannot produce itself.

- `input.* may only declare a top-level variable` — An input sits inside a block. Fix: move it to the top level.
- `plot() is only allowed at the top level of the script` — `plot` was written as a handle declaration inside a block. Fix: compute inside the block, plot at the top level.
- `a plot handle cannot be declared var or typed` — `var p = plot(...)` or `float p = plot(...)`. Fix: `p = plot(...)`.
- `{name}() is only allowed as a statement at the top level of the script` — `plot`, `hline`, `fill`, `plotshape` or `indicator` sits in a block or an expression. Fix: write it as its own top-level line.
- `{name}() does not return a handle` — Only `plot` returns a handle. Fix: do not assign the others. [host]
- `input.* may only be the whole right-hand side of a top-level declaration: name = input.int(...)` — An input is part of an expression. Fix: `n = input.int(5)` on its own, then use `n`.
- `this must be a string literal` — A title or text depends on a variable. Fix: use a literal.
- `this must be a number literal` — `linewidth`, `offset` or a bound is not a literal. Fix: write a number.
- `indicator() may be called only once` — Two `indicator` calls. Fix: keep one.
- `overlay must be true or false` — `overlay=` got something else. Fix: `true` or `false`.
- `color_down must be a constant color` — `color_down` is an input or expression. Fix: use a `color.*` constant.
- `fill needs line plots (not hline, histogram, area or markers)` — `fill` between a histogram, area, hline or markers. Fix: use line plots.
- `fill needs two different plots` — Both handles are the same plot. Fix: pass two plots.
- `location.absolute needs a number (the price to mark), not a bool` — A bool with `location.absolute`. Fix: a bool uses `location.abovebar` or `location.belowbar`.
- `plotshape marks bars where a bool is true; for a number use location=location.absolute` — A number without `location.absolute`. Fix: pass a bool (compare it), or use `location.absolute` for a price.
- `plotshape needs a bool or a number, got {...}` — Something else (colour, string). Fix: a bool or a number series.
- `options must be a non-empty list of string literals: options=["a", "b"]` — `input.string` needs `options=["a", "b"]`, literal strings. Fix: give at least one.
- `{p.name} of {name} must be a literal` — An input's default, bounds or title is not a literal. Fix: write literals.
- `the default of input.source must be one of {...}` — `input.source` default is not a source name. Fix: close, open, high, low, hl2, hlc3, ohlc4 or hlcc4.
- `step must be positive` — `step=0` or negative. Fix: a positive step.
- `the default {dflt} is outside [{...}, {...}]` — The default is outside minval..maxval. Fix: move the default or the bounds.
- `minval is above maxval` — Bounds are reversed. Fix: swap them.
- `the default "{...}" is not one of the options` — An `input.string` default is not in `options`. Fix: use one of them.
- `the default must be a color` — An `input.color` default that is not a colour. Fix: a `color.*` constant. [host]
