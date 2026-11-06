# @alphacharts/script

A small Pine-like indicator language for alphacharts. A script compiles to a study definition for
`@alphacharts/indicators`, so its numbers come from the same incremental engine and kernels as the built-in
studies (a script that is `ta.sma(close, 20)` is bit-identical to the `sma` study). User code runs only in a
dedicated Web Worker.

```ts
import { compile, runScript, ScriptRunner, restoreScript } from "@alphacharts/script";
import { createScriptEditorAdapter } from "@alphacharts/script/editor"; // CodeMirror 6, this subpath only

const r = compile(source);                    // { ok: true, study, inputs, colorInputs, ... } | { ok: false, diagnostics }
const h = runScript(chart, candles, source, { len: 14 }, { volume, workerFactory });   // sandboxed; returns a handle
h.setInputs({ len: 21 }); h.study.setVisible(false); h.remove();
h.toJSON();                                   // { source, inputs, series ids, visible }  -> restoreScript(chart, saved)
```

`compile(...).plan` is the checked program as data for the host app (`{ overlay, scale, needs, dependencies, plots: [{kind, title, expr}], body }`; `needs` is `"ohlcv"`
when the script reads volume; `dependencies` lists every `outside(...)` call, see below; plot kinds include `barcolor` and `bgcolor`). Its nodes are the syntax tree with names resolved (`id.sym` is one object per variable, `ty` on every expression);
it is read-only and shared with the compiled study.

`compile` never executes anything: it lexes, parses, checks and builds closures from the syntax tree. `runScript`
throws `ScriptDiagnosticsError` (with `.diagnostics`) when the script does not compile, and runs the computation
(batch and every tick) in the worker (`@alphacharts/script/worker`; pass `workerFactory`, `() => new Worker(new URL("@alphacharts/script/worker", import.meta.url), { type: "module" })`, or a shared `runner`: the package never guesses where its worker lives). A run-time failure (budget, runtime error, killed worker) goes to
`onError(diagnostic)` and `handle.error`; the study stops following the source until inputs change.
`compile(...).study` can also be given to `addStudy` directly (trusted code only: it then runs on the calling thread).

## The language

```
indicator("Bands", overlay=true)
len  = input.int(20, "Length", minval=2, maxval=200)
mult = input.float(2.0, "Mult", 0.5, 5, 0.5)
[mid, up, lo] = ta.bb(close, len, mult)
p1 = plot(up, "Upper", color.blue)
p2 = plot(lo, "Lower", color.blue)
fill(p1, p2, color.new(color.blue, 90))
plot(mid, "Basis", color.orange)
plotshape(ta.crossover(close, up), "Break", shape.triangleup, location.belowbar, color.green)
```

- **Blocks** by indentation (spaces; tabs are an error). Lines inside `()` / `[]` continue. `//` comments.
- **Types**: `int float bool string color`, each with a qualifier: *const* (literal), *input* (known when the study is
  built) and *series* (varies per bar). Declarations infer; `float x = na` declares an `na` of a type. A number written with a dot or an exponent (`0.0`, `1.`, `1e3`) is a float, whatever its value; there is no `int()`. `ta.highestbars/lowestbars`, `bar_index` and `input.int` are int. Nothing coerces:
  a number is not a condition, a bool is not a number (use `?:`), `int` does not silently take a float.
- **Series and history**: every name is a series with implicit bar iteration; `x[n]` is `n` bars back (`na` before the
  first). `n` may be an expression; it must be an integer in 0..1,000,000 (checked at run time when dynamic).
- **na semantics**: arithmetic with `na` is `na`; every comparison with `na` is false (including `!=`); `x / 0` and `x % 0` are
  `na`; `math.*` results that are not finite are `na`; `nz(x, r)` replaces `na`, `na(x)` tests it.
- **State**: `var x = init` initialises on the first bar and persists; `x := e`, `+= -= *= /= %=` assign. A variable assigned
  with `:=` (or declared `var`) is *state*; `if / else if / else` and bounded `for i = a to b [by s]` (inclusive, at most 10,000
  iterations) change state. Block variables are local to their block. `var` is top-level only.
- **Pure vs state**: everything that does not depend on state is evaluated as whole columns by the engine's kernels. `ta.*`
  calls therefore take only arguments known before the bar is evaluated (no `var`/`:=` variables, block variables or loop counters);
  the compiler says so. `x[n]`, `ta.change` and `ta.crossover/under/cross` accept a top-level state variable, not an expression of one.
- **Inputs**: `name = input.int|float|bool|string|source|color(defval, title, ...)` as the whole right-hand side of a top-level
  declaration; the variable name is the input key. `string` needs `options=[...]` (a select). `color` inputs are not part of the study
  input schema (the engine has no colour type): they are reported in `compile().colorInputs` and applied as the colour of the plots that use them.
- **Output**: `plot(series, title, color, linewidth, style, offset, color_down)` (`plot.style_line|histogram|area`), `hline(price, title, color, linestyle)`,
  `fill(plotA, plotB, color)` (both are handles: `p = plot(...)` and `h = hline(...)`; a fill may join two lines, a line and a level, or two levels, and a level it joins is a column, constant on every bar, named `<hline key>~level`), `plotshape(cond, title, style, location, color, offset, last, within)` (`last=N` keeps the N newest marks, `within=M` only marks on the final M bars; integer literals, markers only), `indicator(title, shorttitle, overlay, scale)` (`scale="left"` draws on the
  chart's left axis), `barcolor(cond, color)` (colours the chart's candles or bars), `bgcolor(cond, color)` (shades the background of the pane the script draws in).
  Colours are constants (`color.red`, `#rrggbb[aa]`, `color.new(c, transp)`) or an `input.color`; a line plot's colour may depend on the bar,
  `plot(x, color = cond ? colorA : colorB)` (constant colours, bool series condition). Output statements are top-level only.
- **Outside series**: `outside(symbol, field="close", timeframe=na)` is a number series of another instrument and/or timeframe: `symbol` and `timeframe`
  are string literals (`na` or left out: the chart's own), `field` one of open, high, low, close, volume. The package names nothing and fetches nothing:
  `compile().plan.dependencies` lists each `{symbol, field, timeframe}` without running anything, `feedsOf(...)` groups them by series, and the host
  loads each and passes it with `handle.setSeries(key, bars)` (bars in the series' own time) and `handle.pushSeries(key, bar)` for live bars.
  `RunScriptOptions.intervalMs` (the chart's bar length) is required when the script reads any. The rules, which are the safety property:
  a same-length series joins on exactly equal bar time and is `na` where the other has no bar (nothing carried over); a longer one joins on the latest
  bar that has finished (open + length not after the chart bar's start), so history never holds a value from after its bar and the live bar shows the last
  finished one; a shorter one is refused. A series with a timeframe is computed on its own bars (`ta.rsi(outside(timeframe="1h"), 14)` is hourly RSI),
  one without on the chart's; mixing it with other series puts each on the chart's bars first. `indicators/src/engine/feed.ts` has the join.
- **Built-in series**: `open high low close volume time hl2 hlc3 ohlc4 hlcc4 bar_index`, `ta.tr`.
- **Functions**: `math.abs sqrt pow log log10 exp sin cos tan asin acos atan sinh cosh tanh ceil floor trunc round sign avg max min toradians todegrees`,
  `math.pi math.e`, `nz`, `na`, `color.new`, and `ta.*` below. There are no user functions, strings operations, arrays, `while`, `eval` or any
  way to name a host object: such words are refused with a diagnostic.

### `ta.*`

- Kernels (the graph's own): `sma ema wma rma highest lowest highestbars lowestbars stdev variance sum linreg` `(source, length)`, `atr(length)`, `ta.tr`,
  `change(source, length=1)`, `crossover / crossunder / cross(a, b)`, `bb(source, length, mult) -> [basis, upper, lower]`.
  `highestbars/lowestbars` are bars since the extreme (0 = this bar), as the built-in Aroon uses them (TradingView's are negated).
- **Every other study of `@alphacharts/indicators`** (all 200+ non-math ones, TA-Lib's catalogue and the TradingView set, candlestick patterns
  included) is `ta.<id>` with `-` written `_`: `ta.rsi(source, length)`, `ta.macd(source, fast, slow, signal) -> [macd, signal, histogram]`, `ta.bbands`,
  `ta.stoch()`, `ta.supertrend(atrLength, factor)`, `ta.cdl_doji()`, `ta.ht_dcperiod(source)`. A study with a `source` input takes it first (a series);
  the others follow in the study's own order, by position or by name, all optional with the study's defaults. A study with several columns returns a
  tuple: destructure it. The call builds that study's own nodes on the script's graph with the source series substituted, so there is one implementation.

### Grammar

```
program     = { statement } ;
statement   = declaration | tuple | assignment | if | for | call NEWLINE ;
declaration = [ "var" ] [ type ] IDENT "=" expr NEWLINE ;
tuple       = "[" IDENT { "," IDENT } "]" "=" expr NEWLINE ;
assignment  = IDENT ( ":=" | "+=" | "-=" | "*=" | "/=" | "%=" ) expr NEWLINE ;
if          = "if" expr block [ "else" ( if | block ) ] ;
for         = "for" IDENT "=" expr "to" expr [ "by" expr ] block ;
block       = NEWLINE INDENT statement { statement } DEDENT ;
expr        = or [ "?" expr ":" expr ] ;
or          = and { "or" and } ;      and = not { "and" not } ;      not = "not" not | cmp ;
cmp         = add [ ( "==" | "!=" | "<" | "<=" | ">" | ">=" ) add ] ;   (no chaining)
add         = mul { ( "+" | "-" ) mul } ;   mul = unary { ( "*" | "/" | "%" ) unary } ;
unary       = ( "-" | "+" ) unary | postfix ;
postfix     = primary { "(" [ arg { "," arg } ] ")" | "[" expr "]" | "." IDENT } ;
arg         = [ IDENT "=" ] expr ;
primary     = NUMBER | STRING | COLOR | "true" | "false" | IDENT | "(" expr ")" | "[" [ expr { "," expr } ] "]" ;
```
(array literals exist only for `options=[...]`.) Operators bind: `?:` < `or` < `and` < `not` < comparison < `+ -` < `* / %` < unary < postfix.

## Pipeline

`lexer.ts` (tokens with offsets, INDENT/DEDENT) -> `parser.ts` (recursive descent, recovers at the next line/block so one run reports every
independent error, at most 50) -> `check.ts` (types and qualifiers, signature table `builtins.ts`, plan: inputs, plots, program) -> `codegen.ts`
(a `StudyDef`). Diagnostics carry `line/column/endLine/endColumn` (1-based) and `from/to` offsets.

### How a script runs

Codegen emits **closures built from the syntax tree, never source text**: no identifier or string of a script is ever concatenated into code, so
injection is not possible by construction (test/injection.test.ts replaces `eval` and `Function` with throwing stubs and runs the whole corpus).
Pure statements become graph nodes (the same calls the built-in studies make, in the same arithmetic order: that is why results are bit-identical).
The state part is one per-bar node: a `var` lives in its own column, and bar *i* starts from bar *i-1*'s committed value, so appending a bar,
revising the last bar (a tick) and a batch run give identical columns, O(1) per new bar plus the work of the statements in it.

## Sandbox

`runScript` computes in a Web Worker (batch through a `StudyRunner`, ticks over a one-bar message; the main thread only mirrors the columns, with nodes
that compute nothing, and draws through the indicators plugin).

- **No host access from the language**: it cannot name `fetch`, `XMLHttpRequest`, `WebSocket`, `importScripts`, `EventSource`, `indexedDB`, `caches`, the DOM,
  `self/globalThis`, `Function`, `eval`, prototypes (`__proto__`, `constructor`, `prototype` are reserved words; name tables have no prototype), `Date`, `Math.random`.
  Output is deterministic: no clock or randomness exists in the language.
- **`lockdown(scope)`** (first thing in the worker): shadows those capabilities plus `Worker`, `SharedWorker`, `BroadcastChannel`, `Request`, `navigator`, `location`, ... with
  read-only, non-configurable `undefined`, makes `eval`, `Math.random` and `Date.now` throw, freezes the intrinsic prototypes. Reports what it could not shadow.
- **Outside series** reach the worker as transferred columns only; the language still names nothing, the lockdown is unchanged. They count against the limits:
  at most `maxFeeds` (8) series, each at most `maxBars` bars, and their bytes (a series is a graph of its own: its 6 columns and what is computed on them, 3 x, plus the
  page's copy of the bars) are added to the script's. A live bar of a series is answered like a tick (`tickMs` watchdog), with `idle` when nothing the chart's last bar sees changed.
- **Budgets** (`DEFAULT_LIMITS`, overridable per runner): loop iterations per loop (10,000) and per bar (2,000,000 steps) -> `execution budget exceeded`; columns (512), bytes
  (512 MiB = 3 x columns x bars x 8: the worker keeps a copy and a column grows by half on the first appended bar; every column, not only the plotted ones, is also mirrored on the main thread), bars (10M), period (5,000), history offset (1,000,000), source size (200,000 chars), expression nesting (100), plots (64). Each breach is a diagnostic naming the limit.
- **Watchdog**: the main thread terminates a worker that does not answer a batch within 8 s or a tick within 1 s, rejects with the budget error and starts a fresh worker for the next request.
- There are no arrays or other heap values in the language, so "huge arrays" reduce to huge periods, offsets, bars and column counts, which the limits above cover.

## Editor (`@alphacharts/script/editor`)

`createScriptEditorAdapter(): ScriptEditorAdapter` — `mount(el, { value, onChange, onRun, diagnostics }) -> { setDiagnostics, destroy }`. CodeMirror 6 (pinned,
dependencies of this subpath only): highlighting, inline lint markers from the diagnostics you pass, autocomplete of `ta.*`, `math.*`, `input.*`, constants,
built-in series and the names declared in the text, Ctrl/Cmd-Enter calls `onRun`, Tab inserts four spaces. Colours come from CSS variables (`--ac-script-*`).

## Verification

`pnpm -C packages/script test`: grammar corpus (`test/corpus.ts`, 113 invalid programs with their exact diagnostics in `corpus-invalid.json`, 85 valid programs run end to end),
type/semantics tests, 45 scripts reproducing built-in studies with exact equality (`equality.test.ts`), incremental == batch with random revisions
(`incremental.test.ts`), sandbox / limits / lockdown / runner watchdog (`sandbox.test.ts`), injection (`injection.test.ts`). Browser: `bench/tests/script.spec.ts`
(playground `?ex=script`) on Chrome, WebKit and Firefox.

## Known limits

- `ta.*` cannot take state-dependent arguments (see above); `x[n]` / `crossover` need a plain series or a top-level variable.
- No user functions, arrays, strings operations, `break`, drawings (labels/lines/boxes), alerts. A per-bar colour is for line plots (not histogram, area or markers).
- A same-timeframe outside series with holes gives windows that reach a hole `na` (a missing bar is never filled); a state variable (`var`, `:=`) runs on the chart's bars only.
- `input.color` and `input.string` are outside the study input schema's types (`InputType` has no colour/free-text): colours are handled through `colorInputs`, a string needs `options`.
- A chart layout saved with `chart.saveState()` holds the script's study id; restore scripts with `handle.toJSON()` / `restoreScript`, not by restoring the layout alone.
