# @alphacharts/alerts

Client-side alerts as a chart plugin, and a pure evaluator that runs the same
serialized definitions without a chart (so a backend re-evaluates exactly what
the chart does: the plugin delegates to `AlertEvaluator`).

```ts
import { AlertsPlugin, evaluate } from "@alphacharts/alerts";

const alerts = new AlertsPlugin({ drawings, source, onTrigger: (t) => notify(t) });
chart.addPlugin(alerts);
alerts.add({ id: "a", condition: { type: "crossing", price: 25_000, direction: "up" }, trigger: { mode: "oncePerBar" } });
alerts.tick({ time, price, bar });          // from your live feed
alerts.addDrawingAlert({ id: "t", drawingId: line.id, line: "main", op: "crossingUp", trigger: { mode: "once" } });

// server side, same definitions, no chart:
const triggers = evaluate(definitions, ticks, { indicators, logical });
```

A tick is `{ time, price, bar }`: `bar` is the open time of the bar it belongs
to. Ticks must be in time order and a bar never reopens; anything else throws.

## Conditions

| type | meaning |
|---|---|
| `crossing` (`direction: any/up/down`) | price crosses a level. A touch counts (99 → 100 crosses up 100); a touch then a retreat is a cross back. |
| `greaterThan`, `lessThan` | state: price > / < level (fires on every tick it holds; the trigger mode limits it) |
| `enteringChannel`, `exitingChannel` | outside → inside / inside → outside `[low, high]`, bounds inclusive |
| `moving` (`up/down`, `bars`, `amount` or `percent`) | state: price is at least the amount (or percent of the window extreme) above the lowest / below the highest price of the last N bars, the current one included |
| `indicator` (`id`, `op`, `value`) | an indicator from `EvalEnv.indicators` (a function, or `seriesIndicator(series)`) against a number or another indicator: crossing / up / down / greaterThan / lessThan. A tick with no value is skipped, never read as 0. |
| `drawing` (geometry, `line`, `op`) | price crossing (up/down), entering or exiting a line of a drawing, at the line's price for the tick's bar time. Supported: trendLine, ray, extendedLine, infoLine, horizontalLine, horizontalRay (line `main`), parallelChannel (`base`, `offset`, `middle`; entering/exiting between base and offset). |

Drawing alerts keep the drawing's geometry in the definition. In the plugin they
follow the drawing when it moves, and become `orphaned` (reported once, never
fire) when it is deleted. Pass `logical` (the plugin uses `BarSource.logical`) so a line
is straight in bar index, as drawn, rather than in time.

## Trigger modes

`once` (then status `triggered`), `oncePerBar` (first firing tick of each bar),
`oncePerBarClose` (the condition is evaluated on each bar's last tick, when the bar closes:
the next bar's first tick, or `closeBar(time)`; intrabar excursions are invisible),
`everyTime`. Options: `debounceMs` (in tick time; a suppressed trigger does not spend a
`once` alert), `expiresAt` (alert becomes `expired`).

Each `AlertTrigger` carries `alertId`, `time`, `bar`, `price`, `prevPrice`, `seq`, `mode`,
and `values` (the numbers compared: level, line price, indicator value, window low/high,
threshold).

## JSON

`AlertEvaluator.toJSON()` / `AlertsPlugin.toJSON()` are versioned (`version: 1`); the plugin
also saves each alert's status. A newer version or any invalid alert is refused before
anything is replaced.
