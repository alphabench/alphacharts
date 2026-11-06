# Limits, run time and the host

Each row: the message (`{...}` stands for text that varies), its cause, the fix. `[host]` marks a message a script cannot produce itself.

- `this loop runs {trips} times; the limit is {this.limits.maxLoopIterations} iterations per loop` — The literal bounds exceed 10,000 iterations. Fix: shorten the range, or restructure with `ta.*` over the window.
- `a script may draw at most 64 plots` — More than 64 output statements. Fix: reduce.
- `a series is not available here` — Internal: a series was requested outside a graph. [host]
- `the script needs {cols} columns; the limit is {this.limits.maxColumns}` — More than 512 computed columns (every named series, `ta.*` result and intermediate). Fix: fewer distinct calls and variables.
- `execution budget exceeded: more than {this.limits.maxSteps} loop steps in one bar` — Loop work in one bar passed 2,000,000 steps (nested loops). Fix: shrink the loops or replace them with kernels.
- `loop bounds must be finite and the step non-zero` — A dynamic bound or step turned out `na`, infinite or 0. Fix: guard with `nz` and a non-zero step.
- `this loop would run {trips} times; the limit is {maxIt} iterations per loop` — Dynamic bounds exceed 10,000 iterations. Fix: cap the bound, e.g. a `math.min` of the bound and 1000.
- `{what} must be an integer between {min} and {max}, got {v}` — A computed length, offset or bound fell outside its integer range, e.g. `ta.sma(close, n * 5000)`. Fix: keep it within 1 to 5000.
- `{what} must be a number between {min} and {max}, got {v}` — A computed multiple fell outside its range (`ta.bb` mult 0 to 100). Fix: keep it inside.
- `{inp.key} of {sig.name} must be an integer{...}{...}, got {v}` — A computed study parameter is not a whole number inside its range. Fix: keep the parameter an int within the reference range.
- `{inp.key} of {sig.name} must be a number{...}{...}, got {v}` — A computed study parameter is outside its range. Fix: keep within the reference range.
- `{sig.name}: {...}` — The study itself rejected its parameters. Fix: use values from the reference. [host]
- `this string cannot be evaluated here` — Internal: a string reached numeric code. [host]
- `the history offset must be an integer between 0 and {MAX_HISTORY}, got {v}` — A dynamic offset `x[n]` was negative, fractional, `na` (for instance `ta.lowestbars` before its window is full) or over 1,000,000 on some bar. Fix: clamp it, `math.max(0, ...)`.
- `a string or color is not a number` — A string series was used as a number. Fix: strings exist only as constants; compare them and use `?:` for numbers. [host]
- `a string is not a number` — Same, for a string. Fix: as above. [host]
- `this name has no numeric value` — Internal: a name without a value was read. [host]
- `unknown operator {e.op}` — Internal: operator not handled. [host]
- `a color is not a number` — A colour was used as a number. Fix: do not plot or compute with colours. [host]
- `{sig.name} cannot be used as a value here` — Internal: a function used as a value. [host]
- `the script must be a string` — The host passed something that is not text. [host]
- `the script is {source.length} characters; the limit is {limits.maxSourceChars}` — Over 200,000 characters. Fix: shorten the script.
- `too many errors; stopped after {this.max}` — More than 50 diagnostics; later ones are dropped. Fix: fix the first errors and recompile.
- `the script runner was disposed` — The host closed the runner. Fix: reload the chart. [host]
- `script worker failed: {...}` — The sandbox worker crashed. Fix: retry; report if it repeats. [host]
- `not a script study` — The host asked the runner about a study that is not a script. [host]
- `a tick took longer than {this.limits.tickMs} ms; the script was terminated` — One tick exceeded its time budget (1 s) and the script was terminated. Fix: lighten per-bar work. [host]
- `the script worker was terminated` — The watchdog stopped the script after a batch passed 8 s. Fix: lighter loops, fewer bars. [host]
- `the script has no computed state in this worker (it was restarted); change an input to run it again` — The worker restarted and lost the script. Fix: change an input to recompute. [host]
- `out of sync with the chart: bar {m.index} arrived with {e.length} bars computed` — The chart and the worker disagree on the bar count. Fix: reload the chart. [host]
- `{n} bars exceed the limit of {limits.maxBars}` — More than 10,000,000 bars. Fix: load fewer bars. [host]
- `the script needs {...} MiB (3 x {e.graph.cols.length} columns x {n} bars x 8); the limit is {...} MiB` — Columns x bars x 8 x 3 passed 512 MiB. Fix: fewer columns or fewer bars. [host]
- `this script reads no outside series "{m.key}"` — The app sent a bar for a series the script does not read. Fix: reload the chart. [host]
- `{feeds.length} outside series exceed the limit of {limits.maxFeeds}` — More distinct series than the limit. Fix: fewer instruments or timeframes. [host]
- `an outside series has {rows} bars; the limit is {limits.maxBars}` — One series is longer than the limit. Fix: load fewer bars. [host]
- `the script and its {feeds.length} outside series need {...} MiB (3 x {e.graph.cols.length} columns x {n} bars x 8, and 3 x {feedCols} columns of {feedRows} outside bars in all, x 8, with a copy of their bars); the limit is {...} MiB` — The script and the series it reads pass the memory limit. Fix: fewer columns, fewer series, fewer bars. [host]

