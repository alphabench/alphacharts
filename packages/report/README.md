# @alphacharts/report

Opt-in, anonymous crash reports for alphacharts. **Off by default.** Importing this package does nothing: no
listener, no timer, no network, no global `window.onerror` or `unhandledrejection` handler. Reporting starts only
when you call `enableCrashReporting()` with the endpoint and key of **your own** PostHog project. There is no
default server: without both, it throws and sends nothing.

```ts
import { enableCrashReporting } from "@alphacharts/report";

const disable = enableCrashReporting({
  endpoint: "https://your-posthog.example/batch", // required; full URL, used exactly as given: no path is appended
  key: "phc_...",                                  // required; that project's public capture key
  maxReports: 5,                                   // optional; per page load (default 5)
});
// disable() stops it.
```

It reports faults the core catches at its own entry points: the shared draw loop, the chart constructor, WebGL
context loss and restore, and shader compile or link failures. To also report errors your code already receives:

```ts
import { errorForwarder, plotErrorForwarder } from "@alphacharts/report";

plot.on("error", plotErrorForwarder());
new DrawingsPlugin({ onError: errorForwarder("drawings", (e) => console.error(e)) });
new AlertsPlugin({ onError: errorForwarder("alerts") });
// datafeed: { onError: errorForwarder("feed") }
```

A forwarder reads only its first argument. The drawing object that `DrawingsOptions.onError` passes second is never
read. The optional callback you pass receives the error only, so keep your own handler if you need the drawing.

## What is sent

One PostHog `$exception` event, `POST` as `text/plain` JSON by `navigator.sendBeacon`, else `fetch` with `keepalive`.
Failures are ignored. Per page load: the same fault is sent once and at most `maxReports` are sent.

| Field | Value |
|---|---|
| `distinct_id` | random UUID, new on every page load, never stored |
| `project` | `alphacharts` |
| `version`, `report_version` | the `@alphacharts/core` version that faulted; this package's version |
| `error_type` | the error's class name (`TypeError`), or `NonError` / `None` |
| `source` | `draw-loop`, `ctor`, `context-lost`, `shader`, `plot`, `drawings`, `alerts`, `feed` |
| `renderer` | `webgl` or `canvas2d`, when known |
| `webgl2`, `context_lost` | booleans |
| `browser`, `os` | family and major version (`Chrome 126`), OS family |
| `$exception_list` | one entry: the error type and the fixed label `alphacharts fault: <source>`. No message, no stack frames, no file names |
| `$process_person_profile`, `$geoip_disable` | `false`, `true` |

Never sent: error messages, option, data, series, plugin or marker ids, symbols, prices, GPU vendor strings, page URL,
cookies or any stored id. Your server still sees the sender's IP address; turn on your project's "discard client IP
data" setting.

MIT licence.
