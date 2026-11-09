# Changelog

## 0.1.1 (core, indicators, drawings) and 0.1.0 (script, report)

New packages: `@alphacharts/script` (the indicator language) and `@alphacharts/report` (opt-in crash reports; no default server, you pass your own PostHog `endpoint` and `key`).

- `core` 0.1.1: an internal fault emitter used by the optional `@alphacharts/report` (`@alphacharts/core/internal`).
- `core`: per-bar colour for candles and bars (`Series.setBarColors`, `clearBarColors`, `OhlcBar.color`, `ColumnarOhlc.color`), per-segment colour on lines, the `BarShading` primitive.
- `indicators`: studies read outside series (`Study.setFeed`, `pushFeedBar`), `barcolor` / `bgcolor` plots, `colorBy` on lines, `StudyDef.scale`.
- `script`: `outside(symbol, field, timeframe)`, `barcolor`, `bgcolor`, a colour that depends on the bar, `indicator(scale=)`, `plan.dependencies`, `handle.setSeries` / `pushSeries`.
- `drawings`: `readOnly` option: a plugin the host drives by code takes no press, key or cursor.
- `script`, `indicators`: `plotshape(..., last=N, within=M)` keeps only the newest marks; `markerFloor`.
- `script`, `indicators`: `plot` and `plotshape` `offset=` takes an int input expression known when the study is built (`offset=-right`); `PlotDef.offset` may be a function of the study's inputs. The swing and higher-high recipes mark the swing bar itself.
- `skills`: `colour-and-shading` and `outside-series`.
- `indicators` 0.1.1 needs `@alphacharts/core` ^0.1.1 (peer). Behaviour: `atr`/`natr` are Wilder's (bar 0's true range is high - low), `rsi` is 100 on an undefined opening. New: `stdev`/`variance` take `sample`, `bars_per_year`.

## 0.1.0

First public release. Packages: `core`, `plot`, `react`, `vue`, `svelte`, `i18n`, `chart-types`, `orderflow`,
`indicators`, `wasm`, `drawings`, `alerts`. The API may change before 1.0.
