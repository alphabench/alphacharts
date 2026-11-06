---
name: alphacharts-core
description: >
    Decide how to answer a chart request: a built-in study, a computed series, or a refusal; overlay or own pane; what the
    script language cannot do.
version: 1.0
api_version: 0.x
depends_on: []
status: stable
---

# alphacharts Core

## 1. When to use this skill

This text is always in your instructions; load the other skills together, in one step. It applies to any request to draw, add or change an indicator on one chart. It decides the approach and names the
other skills to load. It does not teach syntax (script-language), study parameters (studies) or styling (plots-and-panes).

## 2. Domain overview

A script is written in a small Pine-like language and compiled in the browser, which computes every number from the
chart's own bars. There are three answers:

1. **Built-in study.** The request names a standard indicator (RSI, MACD, Bollinger, ADX, VWAP, Supertrend, a candlestick
   pattern): call `ta.<id>`.
2. **Computed series.** Anything else that is arithmetic on bars (z-score, realised volatility, regime flag, a recursive
   filter): write the formula with `ta.*` kernels, `math.*`, `var` state and loops.
3. **Say what cannot be done.** When part of the request can be drawn, draw that part and say plainly what was left out;
   refuse only when none of it can be drawn. Either way one sentence, with the nearest thing the language can do.

The language reads one instrument's own bars: `open high low close volume time`. It cannot do: user functions, arrays,
string operations, `while` or `break`, other symbols or timeframes, per-bar colours, labels, lines or boxes, alerts or
orders, and it cannot know which bar is the last, so "the last N bars" cannot be cut off exactly. Say so plainly; do not
fake one with a near miss. Day and session logic from `time` is possible (quant-recipes: previous session, opening range).

One script draws into one place. `indicator("Title", overlay=true)` draws on the price scale: moving averages, bands,
channels, VWAP, SAR, levels. The default `overlay=false` gives an own pane: oscillators, ratios, z-scores, volume,
anything not in price units. Two units means two scripts.

## 3. API reference

| Need | Skill |
| --- | --- |
| Types, `na`, state, loops, inputs, the grammar | [script-language](../script-language/SKILL.md) |
| A standard indicator: exact `ta.*` names, parameters, outputs | [studies](../studies/SKILL.md) |
| `plot`, `hline`, `fill`, `plotshape`, colours, `input.*` | [plots-and-panes](../plots-and-panes/SKILL.md) |
| Verified formulas for quant measures | [quant-recipes](../quant-recipes/SKILL.md) |
| A compile error came back | [troubleshooting](../troubleshooting/SKILL.md) |

## 4. Standard workflow

1. Pick the answer: study, computed, or refuse.
2. Load only the skills the table names; `studies` before writing any `ta.<id>` call.
3. Write the script: `indicator(...)` first, an input for every number the user may want to change, then the logic, then
   `plot`.
4. Compute levels from bars (a rolling high, an average, a multiple of ATR) rather than typing a number you were not given.
5. On a diagnostic, load troubleshooting and repair; do not guess.

## 5. Examples

A request for RSI is a study:

```alphacharts
indicator("RSI")
len = input.int(14, "Length", minval=2, maxval=200)
plot(ta.rsi(close, len), "RSI", color.purple)
hline(70, "Upper", color.gray, hline.style_dashed)
hline(30, "Lower", color.gray, hline.style_dashed)
```

"Distance of price from its 20-bar average, in percent" is computed, and sits in its own pane:

```alphacharts
indicator("Distance from average, percent")
len = input.int(20, "Length", minval=2, maxval=500)
plot(100 * (close / ta.sma(close, len) - 1), "Distance", color.blue)
```

"Colour the line green when above the average" is not available per bar, and the compiler says so:

<!-- skill: invalid: argument "color" of plot must be a literal or an input, not a series value -->
```alphacharts
plot(close, color = close > ta.sma(close, 20) ? color.green : color.red)
```

The nearest thing is two gapped plots, taught in plots-and-panes.

## 6. Composition

core names the other skills. script-language is needed by every skill that writes code; studies supplies `ta.*`
signatures; plots-and-panes supplies the output statements; quant-recipes holds finished formulas to adapt.

## 7. Constraints and correctness

- Every number comes from the bars. The bars of a window that is not yet full are `na` and draw as gaps, not zero.
- `ta.stdev` and `ta.variance` divide by n (population).
- A window plus an average of it needs window + average bars of history: a 20-bar z-score of returns averaged over 50 bars first has a value at bar 70. A script that needs more bars than are loaded draws nothing at all. Say how many bars it needs, and keep a request that is long (a 4,500-bar window) shorter than the history the chart can load.
- `time` is UTC milliseconds.
- A script is at most 200,000 characters, 64 plots and 512 computed columns.

## 8. Common mistakes

- Plotting a bool: `plot(close > open)` fails; write `close > open ? 1 : 0`.
- Guessing study parameters, as in `ta.stoch(close, 14)`: read the reference first.
- Putting price-scale and oscillator values in one script.
- Hard-coding a level nobody gave.
- Stacking a window on an average of it (a 200-bar average of a 100-bar statistic) without counting the bars it needs.

## 9. Validation

The browser compiles the script and diagnostics come back with line and column. Repair them with the troubleshooting
skill.

## 10. Related skills

[Script language](../script-language/SKILL.md), [Studies](../studies/SKILL.md), [Plots and panes](../plots-and-panes/SKILL.md), [Quant recipes](../quant-recipes/SKILL.md), [Troubleshooting](../troubleshooting/SKILL.md).
