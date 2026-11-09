# @alphacharts/extend

The one door for tools a host adds to an alphacharts chart: drawing tools, studies, analyses, and an assistant that turns
what the user types into a script. Not published yet (`private`).

An adapter is a manifest plus one payload. Everything an adapter returns is untrusted and is checked before it reaches the
chart; a failure names the adapter and what was wrong, and reaches the host as an `AdapterError`.

| kind | payload | what the host does with it |
|---|---|---|
| `drawing` | `tools: ToolDef[]` | pass `registry.tools()` next to the built-in tools |
| `study` | `studies: StudyDef[]` | pass `registry.studies()` next to the built-in studies |
| `analysis` | `run(ctx) => { drawings }` | `runAnalysis(adapter, { drawings, ... })` adds the drawings, all or none |
| `assistant` | `generate(request) => { script, explanation? }` | `runAssistant(adapter, request, { compile, ... })` returns a script that compiles |

```ts
import { createAdapterRegistry, runAssistant } from "@alphacharts/extend";
import { compile } from "@alphacharts/script";

const registry = createAdapterRegistry({ allow: ["bars"] });
registry.register({
  kind: "assistant",
  manifest: { id: "acme.nl", version: "1.0.0", name: "Ask for an indicator", permissions: [] },
  // Your model, your endpoint, your key. This package has none.
  generate: async ({ prompt, previous, signal }) => ({ script: await myModel(prompt, previous, signal) }),
});

const { script, attempts } = await runAssistant(registry.assistants()[0]!, { prompt: "20 bar EMA", symbol, interval }, {
  compile: (s) => { const r = compile(s); return r.ok ? { ok: true } : { ok: false, diagnostics: r.diagnostics }; },
  signal,
});
```

## Built-in analyses

`autoDrawings()` returns five analyses that draw what a trader would draw by hand, from the chart's swing highs and lows (`swings(bars, strength)`, default 5 bars each side): `auto.fib-retracement`, `auto.fib-extension`, `auto.trendlines`, `auto.key-levels` and `auto.pitchfork`. They ask for the `bars` permission, so the host must `allow` it. `analysisEntry(adapter, { allowBars })` turns one into what the shell's `analyses` option takes; each shows as a button in the Indicators dialog and its drawings are one undo step.

## Rules the registry enforces

- The manifest `id` is lower-case words joined by `-` or `.`; `version` is `1.2.3`.
- Every tool and study id an adapter defines starts with `<manifest.id>.`, so two adapters, or an adapter and a built-in, cannot collide. A duplicate adapter id is refused.
- Permissions are checked once, at `register()`, and what was checked is what is served: the permissions and the tool and study lists are copied then, so mutating the adapter afterwards widens nothing. `registry.mayReadBars(id)` is the grant; pass it as `allowBars` to the runners, which never read the adapter's own manifest. `bars` puts the chart's bars in what an analysis or assistant receives (without it they are absent); `network` is declared so a host can show it to the user, and cannot be enforced here because the adapter's code runs in the host's page. An adapter asking for a permission the host did not `allow` is refused.
- A study must pass the indicators package's own `validateDef`.

## Rules the runners enforce

- `runAssistant`: the host's `compile` must accept the script before it is returned. A failed compile goes back to `generate` as `request.previous` (the script and its diagnostics) for up to `maxRepairs` repairs (default 2, at most 5), then `AssistantFailed` carries the last diagnostics. An empty prompt, an empty or oversize script, and bars given to an adapter without the `bars` permission are refused.
- `runAnalysis`: the drawings go through the drawings plugin's own validation (`DrawingsPlugin.addMany`), so an analysis cannot put on the chart what a user could not draw. At most `maxDrawings` (default 500). All are added as one undo step, or none: a refusal leaves no drawing, no history entry, no event.
- Adapters live as long as the page; there is no unregister (the shell and the study registry keep what they were given).
- An aborted `signal` stops either runner and its `AbortError` is passed through unchanged.
