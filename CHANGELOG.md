# Changelog

## Unreleased

- `core`: per-bar colour for candles and bars (`Series.setBarColors`, `clearBarColors`, `OhlcBar.color`, `ColumnarOhlc.color`), per-segment colour on lines, the `BarShading` primitive.
- `indicators`: studies read outside series (`Study.setFeed`, `pushFeedBar`), `barcolor` / `bgcolor` plots, `colorBy` on lines, `StudyDef.scale`.
- `script`: `outside(symbol, field, timeframe)`, `barcolor`, `bgcolor`, a colour that depends on the bar, `indicator(scale=)`, `plan.dependencies`, `handle.setSeries` / `pushSeries`.
- `skills`: `colour-and-shading` and `outside-series`.

## core 0.1.1

`@alphacharts/core` adds an internal fault emitter used by the optional `@alphacharts/report`; no public API change.
The other packages stay at 0.1.0.

## 0.1.0

First public release. Packages: `core`, `plot`, `react`, `vue`, `svelte`, `i18n`, `chart-types`, `orderflow`,
`indicators`, `wasm`, `drawings`, `alerts`. The API may change before 1.0.
