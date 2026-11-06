# Names, types and declarations

Each row: the message (`{...}` stands for text that varies), its cause, the fix. `[host]` marks a message a script cannot produce itself.

- `"{name}" is already declared` — A name can be declared once, including inside blocks. Fix: reuse it with `:=`, or choose another name.
- `'var' is only allowed at the top level of the script` — `var` was used inside `if` or `for`. Fix: declare it at the top, assign inside the block with `:=`.
- `this expression has no value` — The right-hand side is a statement-only call (`hline`, `indicator`...). Fix: do not assign it.
- `a plot handle can only come from plot()` — A plot handle was copied or passed through an expression. Fix: use the variable that `plot` returned, directly in `fill`.
- `cannot assign {...} to {s.type} "{s.name}"` — The value does not fit the declared type. Fix: use the right type, or convert (`c ? 1 : 0` for bool to number).
- `cannot infer the type of "{s.name}" from na; declare it, e.g. float {s.name} = na` — `x = na` has no type. Fix: `float x = na`.
- `destructuring is only allowed at the top level of the script` — `[a, b] = ...` inside a block. Fix: destructure at the top level, use the names in the block.
- `only calls that return several values can be destructured` — The right-hand side is a single value. Fix: `x = ...` without brackets, or use a study that returns a tuple.
- `this call returns {...} values, {s.names.length} names given` — The number of names differs from the number of outputs. Fix: give exactly one name per output.
- `"{n.name}" is destructured from a call and cannot be assigned with :=` — A tuple output is read-only. Fix: copy it to another variable and assign that.
- `"{s.name}" is not declared; declare it first with {s.name} = ...` — `:=` or `+=` on a name never declared. Fix: declare it first, `var float x = 0`.
- `cannot assign to "{s.name}": it is {why}` — Inputs, loop counters, built-in series and plot handles cannot be assigned. Fix: assign a different variable.
- `"{s.op}" needs numbers, got {...} and {...}` — An operand is not a number: a string, colour, bool or tuple, or the left side of `+=` is not numeric. Fix: use numeric series; convert a bool with `c ? 1 : 0`.
- `a loop bound must be an int, got {...}` — A `for` bound is a float. Fix: use ints, or `math.floor(x)` into an int input.
- `the loop step cannot be 0` — `by 0`. Fix: a non-zero step.
- `array values are only allowed as options=[...] of input.string` — An array literal outside `options=[...]`. Fix: arrays do not exist; use separate variables.
- `"{e.name}" is a namespace; use {e.name}.<name>` — A bare namespace (`ta`, `math`...) was used as a value. Fix: `ta.sma`, `math.abs`.
- `"{e.name}" is a function; call it: {e.name}(...)` — A function name without parentheses. Fix: `nz(x)`, `na(x)`.
- `only namespace names can be followed by '.'` — A dot after a variable or call. Fix: only `ta.`, `math.`, `input.`, `color.`, `plot.`, `shape.`, `location.`, `hline.` take a dot.
- `"{e.obj.name}.{e.name}" is a function; call it: {e.obj.name}.{e.name}(...)` — A namespaced function without parentheses. Fix: add the call, `ta.tr` is the only series member.
- `"not" needs a bool, got {...}` — `not` was applied to a number. Fix: compare first, `not (x > 0)`.
- `unary "{e.op}" needs a number, got {...}` — A sign was applied to a bool or string. Fix: apply it to a number.
- `"{e.op}" needs bool operands, got {...} and {...}` — `and` / `or` with a number or series operand. Fix: compare each side: `x > 0 and y > 0`.
- `cannot compare {...} with {...}` — Mixed types in `==` or `!=`. Fix: compare like with like; a number with a bool needs `c ? 1 : 0`.
- `strings and colors can only be compared as constants or inputs` — A string or colour that varies per bar was compared. Fix: strings exist only as constants and inputs.
- `the branches of ?: have different types: {...} and {...}` — The two results differ in type. Fix: make both numbers (or both bool); use `na` for a missing branch.
- `only a series can be indexed with [ ], this is {...}` — `[n]` on a constant, input, tuple or string. Fix: index a series (a price, a study output, a computed value).
- `history [ ] needs a plain series or a top-level variable; a block variable, loop counter or an expression of those has no earlier values. Assign the value to a top-level variable first` — `x[n]` on a block variable, loop counter or an expression of changing variables. Fix: assign it to a top-level variable first, then index that.
- `the history offset must be between 0 and {MAX_HISTORY}, got {c}` — A literal negative or huge offset. Fix: 0 to 1,000,000; the future cannot be read.
