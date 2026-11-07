# Output statements and inputs

Each row: the message (`{...}` stands for text that varies), its cause, the fix. `[host]` marks a message a script cannot produce itself.

- `input.* may only declare a top-level variable` — An input sits inside a block. Fix: move it to the top level.
- `{handleOf}() is only allowed at the top level of the script` — `plot` or `hline` was written as a handle declaration inside a block. Fix: compute inside the block, plot at the top level.
- `a plot handle cannot be declared var or typed` — `var p = plot(...)` or `float p = plot(...)`. Fix: `p = plot(...)`.
- `{name}() is only allowed as a statement at the top level of the script` — `plot`, `hline`, `fill`, `plotshape` or `indicator` sits in a block or an expression. Fix: write it as its own top-level line.
- `{name}() does not return a handle` — Only `plot` and `hline` return a handle. Fix: do not assign the others. [host]
- `input.* may only be the whole right-hand side of a top-level declaration: name = input.int(...)` — An input is part of an expression. Fix: `n = input.int(5)` on its own, then use `n`.
- `this must be a string literal` — A title or text depends on a variable. Fix: use a literal.
- `this must be a number literal` — `linewidth`, `last`, `within` or a bound is not a literal. Fix: write a number. (`offset` may be an int input or an expression of them, `offset=-right`.)
- `indicator() may be called only once` — Two `indicator` calls. Fix: keep one.
- `overlay must be true or false` — `overlay=` got something else. Fix: `true` or `false`.
- `color_down must be a constant color` — `color_down` is an input or expression. Fix: use a `color.*` constant.
- `fill needs line plots or hline levels (not histogram, area or markers)` — `fill` between a histogram, area or markers. Fix: use line plots or `h = hline(...)` levels.
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
- `{name} needs a bool condition, got {...}` — `barcolor` or `bgcolor` received a number. Fix: compare it, `barcolor(close > open, color.yellow)`.
- `bgcolor shades the pane the script draws in, and with overlay=false the script has a pane only if it plots a line, histogram or area: add a plot(...), or use indicator(..., overlay=true) to shade the price chart` — A script in its own pane has `bgcolor` and nothing to hold the pane. Fix: add a line plot, or `overlay=true`.
- `both colors of a color that depends on the bar must be constants (color.red, #rrggbb, color.new(...)), not an input.color` — `cond ? tone : color.red` with an input colour. Fix: constants in both branches.
- `a color that depends on the bar is for line plots; histogram and area take a constant color (a histogram can use color_down for negative values)` — `cond ? a : b` on a histogram or area plot. Fix: a line, or a constant colour, or `color_down`.
- `outside() needs a symbol or a timeframe; this chart's own series are close, open, high, low and volume` — `outside()` with neither. Fix: give a symbol, a timeframe, or use `close`.
- `the {what} of outside() must be a string literal, or na for this chart's, not a computed value` — The symbol is a variable or expression. Fix: write it as a literal in the call.
- `the {what} of outside() must be a string literal like "1d", or na for this chart's, not a computed value` — The timeframe is a variable, an input or an expression. Fix: a literal such as `"1d"`.
- `the symbol of outside() must be 1 to 128 printable characters` — An empty or very long symbol. Fix: the name the user gave.
- `the timeframe "{timeframe}" is not written like 5m, 15m, 1h, 4h, 1d or 1w` — A timeframe that is not `<n><m|h|d|w>`. Fix: write `"5m"`, `"1h"`, `"1d"`.
- `a script may read at most {this.limits.maxFeeds} outside series (distinct symbol and timeframe pairs)` — Too many series. Fix: fewer instruments or timeframes.

