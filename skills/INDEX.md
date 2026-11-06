# alphacharts Skill Registry

Each area of the script language has one `SKILL.md` that teaches a model that area and nothing else. Load only what the
request needs: read the entry below, load the skills it names, and follow their `depends_on` first. Start with
`alphacharts-core`.

`manifest.json` is the machine-readable form of this file. Generated references live in `reference/` folders
(`pnpm gen:skills` rewrites them and this registry; `pnpm check:skills --strict` proves the skills true).

<!-- registry:start -->

## Core

Decide how to answer a chart request: a built-in study, a computed series, or a refusal; overlay or own pane; what the script language cannot do.

Name: `alphacharts-core`  
Path: [core/SKILL.md](core/SKILL.md)  
Status: stable  
API version: 0.x  
Depends on: none

Load when:

- Any request to draw, add or change an indicator on one chart.
- Deciding between a built-in study, a computed series and a refusal.
- Choosing overlay or an own pane, or explaining what the language cannot do.

## Script language

The whole script language: types and qualifiers, no coercion, series and history, na, state and var, loops, inputs, the grammar, limits and what is refused. Load before writing any script that is more than one study call.

Name: `alphacharts-script-language`  
Path: [script-language/SKILL.md](script-language/SKILL.md)  
Status: stable  
API version: 0.x  
Depends on: alphacharts-core

Load when:

- Writing a computed series, anything with var, loops, x[n] history or na handling.
- A diagnostic mentions types, state or history.
- Looking up a math function, a kernel (ta.sma, ta.stdev, ta.highest) or a builtin series.

## Studies

How to call any built-in study as ta.<id>: the index by purpose, the calling rules, and per-family references with every parameter, default, range, option and output. Load before writing a ta.<id> call.

Name: `alphacharts-studies`  
Path: [studies/SKILL.md](studies/SKILL.md)  
Status: stable  
API version: 0.x  
Depends on: alphacharts-core, alphacharts-script-language

Load when:

- The request names a standard indicator (RSI, MACD, Bollinger, ADX, VWAP, Supertrend, a candlestick pattern).
- Writing any ta.<id> call and needing its exact parameters or outputs.
- Checking whether a study exists.

## Plots and panes

Drawing a script's output: plot, plot styles, hline, fill (shading zones such as RSI above 70), plotshape, overlay versus own pane, colours as constants, input.* controls, and a line shown only where a condition holds with two gapped plots.

Name: `alphacharts-plots-and-panes`  
Path: [plots-and-panes/SKILL.md](plots-and-panes/SKILL.md)  
Status: stable  
API version: 0.x  
Depends on: alphacharts-core, alphacharts-script-language

Load when:

- The request is about how something looks: line style, histogram, shaded band, markers, levels, colours.
- Adding user-adjustable settings (input.*).
- Showing a line only where a condition holds.

## Colour and shading

Colour that depends on the bar: barcolor to colour candles, bgcolor to shade the background of a pane, a line coloured by a condition, and indicator(scale="left") to draw a series of another magnitude on the left axis. It colours a condition and has no formulas for the gap, a previous close or any other level (quant-recipes).

Name: `alphacharts-colour-and-shading`  
Path: [colour-and-shading/SKILL.md](colour-and-shading/SKILL.md)  
Status: stable  
API version: 0.x  
Depends on: alphacharts-core, alphacharts-script-language, alphacharts-plots-and-panes

Load when:

- The request is to colour candles or bars where a condition holds.
- Shading the price chart or an indicator pane where a condition holds.
- Colouring a line by a condition, or drawing a series on the left axis.

## Outside series

Reading another instrument or another timeframe from a script with outside(symbol, field, timeframe): ratios, spreads, relative strength, beta, beta-adjusted price, correlation, residuals, a Kalman filter on two series, multi-timeframe indicators, previous-day levels, and the exact rules that decide which of its bars a chart bar sees.

Name: `alphacharts-outside-series`  
Path: [outside-series/SKILL.md](outside-series/SKILL.md)  
Status: stable  
API version: 0.x  
Depends on: alphacharts-core, alphacharts-script-language, alphacharts-studies, alphacharts-plots-and-panes

Load when:

- The request involves a second instrument: against the index, spread, ratio, relative strength, beta, correlation, the sector.
- The request names another timeframe: RSI on the hourly, daily levels on an intraday chart, daily returns.
- Previous day's high, low or close.

## Quant recipes

Verified formulas to adapt, for statistics and session levels on one instrument's bars: gap from the previous close, previous session's high, low, close and VWAP, opening range, swing highs and lows, VWAP from a swing, z-score, realised volatility, rolling Sharpe, beta, autocorrelation, regime, ATR distance, range expansion, volume delta, Kalman filter. Load it for any such value, also when the request is to colour or highlight it.

Name: `alphacharts-quant-recipes`  
Path: [quant-recipes/SKILL.md](quant-recipes/SKILL.md)  
Status: stable  
API version: 0.x  
Depends on: alphacharts-core, alphacharts-script-language, alphacharts-studies, alphacharts-plots-and-panes

Load when:

- The request is a statistic or state machine on one instrument's bars rather than a named indicator.
- Volatility, Sharpe, z-score, autocorrelation, regime, filter or volume-delta requests.
- Adapting a verified formula instead of deriving one.

## Troubleshooting

Every diagnostic the compiler and the runtime can emit, with its cause and fix; the common ones here, the rest by phase in the catalogue files.

Name: `alphacharts-troubleshooting`  
Path: [troubleshooting/SKILL.md](troubleshooting/SKILL.md)  
Status: stable  
API version: 0.x  
Depends on: alphacharts-core, alphacharts-script-language

Load when:

- A compile or run diagnostic came back for a script.
- A script compiles but shows nothing, all gaps, or the wrong scale.

<!-- registry:end -->
