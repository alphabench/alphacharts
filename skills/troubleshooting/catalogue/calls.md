# Calls, arguments and state

Each row: the message (`{...}` stands for text that varies), its cause, the fix. `[host]` marks a message a script cannot produce itself.

- `positional arguments must come before named ones` — A positional argument follows `name=value`. Fix: reorder.
- `{sig.name} takes at most {sig.params.length} argument, got {c.args.length}` — Too many arguments for a one-parameter function. Fix: drop the extra ones; check the signature.
- `{sig.name} takes at most {sig.params.length} arguments, got {c.args.length}` — Too many arguments. Fix: check the signature in the references; the order is source first, then the study's parameters.
- `parameter "{a.name}" is given twice` — Both by position and by name, or the same name twice. Fix: give it once.
- `{sig.name} needs the argument "{p.name}"` — A required argument is missing (kernels need `length`). Fix: pass it.
- `argument "{p.name}" of {sig.name} must be a value` — A tuple, plot handle or nothing was passed. Fix: pass one series.
- `argument "{p.name}" of {sig.name} must be a number, got {...}` — A bool, string or colour was passed for a number. Fix: pass a literal or input number.
- `argument "{p.name}" of {sig.name} must be a {p.kind}, got {...}` — Wrong type for a bool, string or colour parameter. Fix: pass that type as a literal or input.
- `argument "{p.name}" of {sig.name} must be one of {...}, got {...}` — A select parameter got a string outside its list. Fix: copy one of the allowed strings, lower case, from the reference.
- `argument "{p.name}" of {sig.name} must be one of {ns}` — An enum parameter needs the namespace constants. Fix: `plot.style_*`, `hline.style_*`, `shape.*` or `location.*`, not a string.
- `argument "{p.name}" of {sig.name} must be a plot handle: p = plot(...)` — `fill` got something that is not `p = plot(...)` or `h = hline(...)`. Fix: store both in variables first.
- `only named functions can be called` — The callee is an expression, e.g. `f(1)(2)`. Fix: call a built-in by name.
- `ta.change needs a plain series or a top-level variable, not an expression of changing variables` — `ta.change` was given an expression of state. Fix: assign it to a top-level variable first.
- `{sig.name} needs plain series or top-level variables, not expressions of changing variables; assign the value to a variable first` — A crossover argument is an expression of state. Fix: assign each side to a top-level variable.
- `ta.bb needs inputs known before the bar is evaluated (no var / := / block variables)` — `ta.bb` received state. Fix: use bars-only arguments.
