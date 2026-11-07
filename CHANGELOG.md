# Changelog

## Unreleased

- `core`: per-bar colour for candles and bars (`Series.setBarColors`, `clearBarColors`, `OhlcBar.color`, `ColumnarOhlc.color`), per-segment colour on lines, the `BarShading` primitive.
- `indicators`: studies read outside series (`Study.setFeed`, `pushFeedBar`), `barcolor` / `bgcolor` plots, `colorBy` on lines, `StudyDef.scale`.
- `script`: `outside(symbol, field, timeframe)`, `barcolor`, `bgcolor`, a colour that depends on the bar, `indicator(scale=)`, `plan.dependencies`, `handle.setSeries` / `pushSeries`.
- `drawings`: `readOnly` option: a plugin the host drives by code takes no press, key or cursor.
- `script`, `indicators`: `plotshape(..., last=N, within=M)` keeps only the newest marks; `markerFloor`.
- `script`, `indicators`: `plot` and `plotshape` `offset=` takes an int input expression known when the study is built (`offset=-right`); `PlotDef.offset` may be a function of the study's inputs. The swing and higher-high recipes mark the swing bar itself.
- `skills`: `colour-and-shading` and `outside-series`.

## core 0.1.1

`@alphacharts/core` adds an internal fault emitter used by the optional `@alphacharts/report`; no public API change.
The other packages stay at 0.1.0.

## 0.1.0

First public release. Packages: `core`, `plot`, `react`, `vue`, `svelte`, `i18n`, `chart-types`, `orderflow`,
`indicators`, `wasm`, `drawings`, `alerts`. The API may change before 1.0.
