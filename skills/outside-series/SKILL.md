---
name: alphacharts-outside-series
description: >
    Reading another instrument or another timeframe from a script with outside(symbol, field, timeframe): ratios, spreads,
    relative strength, beta, market-neutral price, correlation, residuals, a Kalman filter on two series, multi-timeframe indicators, daily returns and N-day statistics (Sharpe, volatility) on an intraday chart, previous-day
    levels, and the exact rules that decide which of its bars a chart bar sees.
version: 1.0
api_version: 0.x
depends_on:
    - alphacharts-core
    - alphacharts-script-language
    - alphacharts-studies
    - alphacharts-plots-and-panes
status: stable
---

# alphacharts Outside series

## 1. When to use this skill

Load it when the request involves a second series: "against the index", "spread", "ratio", "relative strength", "beta",
"correlation", "the sector", "on the hourly", "daily RSI on a 5-minute chart", "yesterday's high", "daily returns on an
intraday chart". The numbers of the recipes below are checked against an independent plain-JavaScript calculation.

## 2. Domain overview

`outside(symbol, field, timeframe)` is a number series of another instrument and/or another timeframe. It is a series
like `close`: use it in arithmetic and as the source of any `ta.*` call.

- `symbol` is a string literal, or `na` or left out for the chart's own instrument. The script only names it; the app
  that shows the chart finds the instrument, so use the name the user gave, exactly. Never invent a code. When the app
  cannot find it, nothing is drawn and the user is told which name failed.
- `field` is one of `"open"`, `"high"`, `"low"`, `"close"`, `"volume"`; the default is `"close"`.
- `timeframe` is a string literal written `<n><unit>` with the unit `m`, `h`, `d` or `w`: `"5m"`, `"15m"`, `"1h"`,
  `"4h"`, `"1d"`, `"1w"`; `na` or left out means the chart's own timeframe. At least one of `symbol` and `timeframe` is
  needed (`close` is the chart's own).
- Both must be literals: the app reads them from the script before anything runs, loads those series, and refuses the
  script in words if one cannot be had. A script reads at most 8 distinct (symbol, timeframe) pairs.
- A timeframe shorter than the chart's is refused: the chart cannot have finer bars than it shows. The chart's own
  length or a longer one is fine. On a 5m chart `"5m"`, `"15m"`, `"1h"`, `"4h"`, `"1d"` and `"1w"` are all allowed (a 4-hour RSI
  and a daily RSI on a 5m chart are both fine); on a 1d chart `"4h"` is refused and `"1d"` and `"1w"` are allowed.

**Which bar a chart bar sees (exact rules).**

1. *Same timeframe* (no `timeframe`, or one equal to the chart's): the chart bar sees the other series' bar with exactly
   the same start time. If there is none (the other instrument did not trade in that bar), the value is `na`. Nothing is
   carried over from an earlier bar, a session or another day.
2. *Longer timeframe*: the chart bar sees the latest bar of that series that has already finished, that is, whose start plus
   its length is not after the chart bar's start. A bar that is still forming is never shown, so on the live bar the value
   is the last finished one, and no value on any bar contains data from after that bar. Until the first such bar exists the
   value is `na`. A daily bar is visible from the next day's first bar; the previous day's high is
   `outside(timeframe = "1d", field = "high")`.
3. A bar may be shown a little later than it closed (the last hour of a session is shown from the next session), never earlier.

**Where a calculation runs.** A series *with* a timeframe lives on its own bars: arithmetic, `ta.*`, `math.*` and `x[n]`
of it run on those bars, so `ta.rsi(outside(timeframe = "1h"), 14)` is the 14-bar RSI of hourly bars, whatever the chart's
bar size, and `d / d[1] - 1` of a daily series is the daily return. The result then meets the chart's bars by rule 2. A
series *without* a timeframe lives on the chart's bars: its windows count chart bars, and a missing bar is a gap in them.
Combining a series with the chart's own series (`close`, `bar_index`), with a different series, or with `var` state, first
puts each operand on the chart's bars (by the rules above) and computes there.

## 3. API reference

| Call | Meaning |
| --- | --- |
| `outside("AAA")` | close of another instrument, same timeframe |
| `outside("AAA", "volume")` | its volume (an index may have none: the app says so) |
| `outside(timeframe = "1d", field = "high")` | the chart's instrument, daily high, last finished day |
| `outside("AAA", "close", "1h")` | another instrument on hourly bars |

Generated signature: [builtins.md](../script-language/reference/builtins.md). The recipe scripts are in `recipes/`.

## 4. Standard workflow

1. Name each instrument exactly as the user did; one literal per series, written once in a variable when used often.
2. Decide the timeframe: none for "against another instrument now", a literal for "on the hourly / daily".
3. For a statistic over a window, say which bars it counts (the chart's, or the series' own) in the reply.
4. Put the result in its own pane unless it is in price units (`overlay=true` only for levels and prices).
5. Mention that the first bars are `na` until the other series and the window have enough history.

## 5. Examples

**Relative strength.** The price ratio against a benchmark, rebased to 100 `len` bars ago.

<!-- skill: file: recipes/relative-strength.acs -->
```alphacharts
indicator("Relative strength vs a benchmark")
len = input.int(20, "Rebase length", minval=1, maxval=500)
rs = close / outside("IDX")
plot(100 * rs / rs[len], "Relative strength", color.blue)
hline(100, "Even", color.gray, hline.style_dashed)
```

**Another series on the left axis (a dual axis).** The chart's own price stays on the right axis and is already drawn; the other series is its
own script, with `scale="left"` in `indicator`, so the two have scales of their own. One script that plots `close` and the other series
together puts both on one scale. Say in the reply only what the script does: "on the left axis" only with `scale="left"`.

<!-- skill: file: recipes/dual-axis.acs -->
```alphacharts
indicator("Another series on the left axis", overlay=true, scale="left")
plot(outside("IDX"), "Other series", color.orange)
```

**Ratio with its average.**

<!-- skill: file: recipes/ratio-sma.acs -->
```alphacharts
indicator("Ratio with its average")
len = input.int(20, "Average length", minval=2, maxval=500)
ratio = close / outside("IDX")
plot(ratio, "Ratio", color.blue)
plot(ta.sma(ratio, len), "Average", color.orange)
```

**Spread z-score.** The spread of two instruments (hedge ratio 1.5 here), in standard deviations from its average.

<!-- skill: file: recipes/spread-zscore.acs -->
```alphacharts
indicator("Spread z-score")
len = input.int(30, "Length", minval=2, maxval=500)
hedge = input.float(1.5, "Hedge ratio", minval=0.01, maxval=100, step=0.01)
spread = close - hedge * outside("AAA")
z = (spread - ta.sma(spread, len)) / ta.stdev(spread, len)
plot(z, "Z", color.blue)
hline(2, "Plus 2", color.gray, hline.style_dashed)
hline(-2, "Minus 2", color.gray, hline.style_dashed)
```

**Rolling beta.** Covariance of the two return series over the variance of the benchmark's, all population.

<!-- skill: file: recipes/rolling-beta.acs -->
```alphacharts
indicator("Rolling beta to a benchmark")
len = input.int(30, "Length", minval=3, maxval=500)
ra = close / close[1] - 1
rb = outside("IDX") / outside("IDX")[1] - 1
beta = (ta.sma(ra * rb, len) - ta.sma(ra, len) * ta.sma(rb, len)) / ta.variance(rb, len)
plot(beta, "Beta", color.purple)
hline(1, "Market", color.gray, hline.style_dashed)
```

**Rolling correlation.**

<!-- skill: file: recipes/rolling-correlation.acs -->
```alphacharts
indicator("Rolling correlation with another instrument")
len = input.int(30, "Length", minval=3, maxval=500)
ra = close / close[1] - 1
rb = outside("AAA") / outside("AAA")[1] - 1
cov = ta.sma(ra * rb, len) - ta.sma(ra, len) * ta.sma(rb, len)
plot(cov / (ta.stdev(ra, len) * ta.stdev(rb, len)), "Correlation", color.teal)
hline(0, "Zero", color.gray, hline.style_dashed)
```

**Market-neutral price.** What the phrases "beta-adjusted price" and "price without the market" mean here, taken without asking: a price line
that moves only by what the index does not explain. Each bar's return is the stock's simple return less its rolling beta times the index's
simple return (beta is the covariance of the two over the variance of the index's, 60 bars unless a length is said), and the line compounds
those hedged returns from a base, the close of the first bar whose beta is known. Do not subtract beta times the index LEVEL from the price: a
beta is a ratio of returns, so a return beta times an index level (close 2,500, index 24,000, beta 1.1 gives -23,900) is a number in no unit.
A bar with no hedged return (the index has no bar, or beta is not known yet) draws nothing and adds nothing to the line. Name the index in the
reply ("the index" is Nifty 50) and say the meaning that was taken.

<!-- skill: file: recipes/market-neutral-price.acs -->
```alphacharts
indicator("Market-neutral price", overlay=true)
len = input.int(60, "Beta length", minval=3, maxval=500)
idx = outside("IDX")
ra = close / close[1] - 1
rb = idx / idx[1] - 1
beta = (ta.sma(ra * rb, len) - ta.sma(ra, len) * ta.sma(rb, len)) / ta.variance(rb, len)
excess = ra - beta * rb
var float level = na
if not na(excess)
    level := na(level) ? close : level * (1 + excess)
plot(na(excess) ? na : level, "Market-neutral price", color.blue)
```

**Regression residual.** The price minus its rolling least-squares fit on the other instrument.

<!-- skill: file: recipes/regression-residual.acs -->
```alphacharts
indicator("Residual of price on another instrument")
len = input.int(50, "Length", minval=3, maxval=500)
x = outside("AAA")
mx = ta.sma(x, len)
my = ta.sma(close, len)
slope = (ta.sma(x * close, len) - mx * my) / ta.variance(x, len)
plot(close - (my + slope * (x - mx)), "Residual", color.blue)
hline(0, "Fit", color.gray, hline.style_dashed)
```

**Kalman hedge ratio.** A scalar Kalman filter for `close = beta * other`, `beta` a random walk. A bar where either price
is `na` leaves the estimate where it was.

<!-- skill: file: recipes/kalman-beta.acs -->
```alphacharts
indicator("Kalman hedge ratio")
q = input.float(0.0001, "Process variance", minval=0.0000001, maxval=1, step=0.0001)
r = input.float(1.0, "Observation variance", minval=0.0001, maxval=1000, step=0.1)
x = outside("AAA")
var float beta = 1.0
var float p = 1.0
if not na(x) and not na(close)
    pp = p + q
    k = pp * x / (x * x * pp + r)
    beta := beta + k * (close - beta * x)
    p := (1 - k * x) * pp
plot(beta, "Beta", color.purple)
```

**RSI on three timeframes in one pane.** The hourly and daily RSI are computed on hourly and daily bars.

<!-- skill: file: recipes/mtf-rsi.acs -->
```alphacharts
indicator("RSI on three timeframes")
len = input.int(14, "Length", minval=2, maxval=200)
plot(ta.rsi(close, len), "RSI chart", color.blue)
plot(ta.rsi(outside(timeframe = "1h"), len), "RSI 1h", color.orange)
plot(ta.rsi(outside(timeframe = "1d"), len), "RSI 1d", color.red)
hline(70, "Upper", color.gray, hline.style_dashed)
hline(30, "Lower", color.gray, hline.style_dashed)
```

**Return minus sector return.** Over `len` bars, in percent.

<!-- skill: file: recipes/return-minus-sector.acs -->
```alphacharts
indicator("Return minus sector return")
len = input.int(20, "Length", minval=1, maxval=500)
sector = outside("SECT")
plot(100 * ((close / close[len] - 1) - (sector / sector[len] - 1)), "Excess return, percent", color.blue)
hline(0, "Even", color.gray, hline.style_dashed)
```

**Previous day's high, low and close.** From a daily series of the chart's own instrument, so it works on any intraday bar
size and needs no session logic, and the values are the broker's own daily bar (see the gap note in quant-recipes on why the
daily close is the official one). On a chart whose bars are a day or longer the daily series is the chart's own bars and
`outside(timeframe = "1d")` at a bar is that bar, not the day before, so the recipe reads one bar back there. It tells the two
apart with `bars_per_year` (400 or more is intraday; a daily chart is 252 or 365), so the same preset works on both and
draws nothing, rather than a wrong day, until that is known (the first day of an intraday chart, the first five bars of a daily one).

<!-- skill: file: recipes/previous-day-levels.acs -->
```alphacharts
indicator("Previous day high, low and close", overlay=true)
hi = outside(timeframe = "1d", field = "high")
lo = outside(timeframe = "1d", field = "low")
cl = outside(timeframe = "1d", field = "close")
intraday = bars_per_year >= 400
daily = bars_per_year < 400
plot(intraday ? hi : daily ? hi[1] : na, "Previous high", color.green)
plot(intraday ? lo : daily ? lo[1] : na, "Previous low", color.red)
plot(intraday ? cl : daily ? cl[1] : na, "Previous close", color.gray)
```

**Rolling Sharpe of daily returns on an intraday chart.** The days per year come from the daily series itself,
`ta.bars_per_year` given the daily series: 252 for a market that leaves weekends out, 365 for one that does not. Never a typed number.

<!-- skill: file: recipes/rolling-sharpe-daily.acs -->
```alphacharts
indicator("Rolling Sharpe of daily returns")
len = input.int(10, "Days", minval=3, maxval=250)
d = outside(timeframe = "1d")
r = d / d[1] - 1
plot(ta.sma(r, len) / ta.stdev(r, len, true) * math.sqrt(ta.bars_per_year(d)), "Sharpe", color.blue)
hline(0, "Zero", color.gray, hline.style_dashed)
```

Not allowed, with the diagnostics:

<!-- skill: invalid: outside() needs a symbol or a timeframe; this chart's own series are close, open, high, low and volume -->
```alphacharts
plot(outside())
```

<!-- skill: invalid: argument "field" of outside must be one of "open", "high", "low", "close", "volume", got "volume " -->
```alphacharts
plot(outside("AAA", "volume "))
```

<!-- skill: invalid: the symbol of outside() must be a string literal, or na for this chart's, not a computed value -->
```alphacharts
name = "AAA"
plot(outside(name))
```

<!-- skill: invalid: the timeframe "4 hours" is not written like 5m, 15m, 1h, 4h, 1d or 1w -->
```alphacharts
plot(outside("AAA", timeframe = "4 hours"))
```

<!-- skill: invalid: unknown function "security"; did you mean outside? -->
```alphacharts
plot(security("AAA", "D", close))
```

## 6. Composition

Recipes feed [plots-and-panes](../plots-and-panes/SKILL.md) for the pane and levels; bars of a statistic need the warm-up
rule of core. [Colour and shading](../colour-and-shading/SKILL.md) can shade where a ratio is stretched. Study references
are in [studies](../studies/SKILL.md): any `ta.<id>` that takes a `source` takes an outside series.

## 7. Constraints and correctness

- A same-timeframe series from an exchange on another clock never meets the chart: hourly bars open at 09:15 on NSE and 09:00 on MCX, so no
  bar has the other's time and every value is `na` (a blank chart is the correct result, not an error in the script). Read a longer
  timeframe, such as `1d`, or tell the user the two do not share bar times. The host can say how far apart they are (`describeJoin`).
- First values are `na` until both series have bars and the window is full. A window that reaches a missing bar of a
  same-timeframe series is `na`.
- No value on a bar uses data from after that bar. A longer-timeframe value changes only when a bar finishes.
- `outside` is data given by the app: it adds no way to reach the network, the page or any object from the script.
- A study that reads the chart's own highs and lows (`ta.atr`, `ta.supertrend`) is of the chart; to use another
  series' OHLC give the series as the source of a study that takes one (`ta.rsi`, `ta.ema`, `ta.macd`).
- Index volume: some instruments have no volume; the app says which instrument has none instead of drawing zero.
- Cost: every series is held twice (the worker and the page) in six columns of its length, plus what is computed on it.

## 8. Common mistakes

- Computing an indicator of a daily series by hand on chart bars: `ta.rsi(outside(timeframe = "1d"), 14)` already runs on
  daily bars. Do not pass the chart's `close` to it.
- Expecting today's daily bar on an intraday bar: only finished days are visible. Say so; "today so far" is the chart's own
  `high` and `low` from the day's first bar.
- Not saying that a longer timeframe lags: a weekly RSI on a daily chart shows the last *finished* week's value, and changes
  once a week, not each day. That is by design (nothing from after a bar is ever used), and the reply to the trader says so.
- Today's open, or any of today's values, from a daily series: `outside(timeframe = "1d", field = "open")` on an intraday
  chart is **yesterday's** open, and on a daily chart it is the chart's own bar. Today's open is the open of the chart's
  first bar of the session, found by the change of the day number (the gap recipe in quant-recipes). The **previous** close
  is the one thing the daily series gives, and it is the official one: `outside(timeframe = "1d")` on an intraday chart. `close[1]` at the first
  bar of an intraday session is only the last continuous trade, which can differ from the exchange's close (the gap recipe in quant-recipes says
  why); on a chart of daily bars `close[1]` is the official close.
- A new day detected as `time / 86400000 != time[1] / 86400000`: without `math.floor` the division is a fraction, so it is
  true on every bar. A day number is `math.floor((time + off * 60000) / 86400000)`.
- Typing a symbol the user did not give, or a code in the wrong form: use their words. There is no spot currency series: a
  currency (`outside("USDINR")`) is found as its listed futures contracts and the user picks one, so say in the reply that it
  is a futures contract and not spot. The same for any currency pair.
- A `timeframe` shorter than the chart's (`"4h"` on a 1d chart). The mistake is not the reverse: `"4h"` on a 5m chart is a longer
  timeframe, allowed, and its RSI is drawn; never leave it out for being "longer than the chart's bars".
- A value of the chart read as an instrument. On a chart that shows several values (FII and DII net buying) a value is the chart's
  `close` with the script's `on` naming it; `outside("FII")` is not that value, it is an instrument search for a symbol called FII.
- Rebasing with `rs[len]` when the first bars are `na`: the line starts `len` bars after both series exist.

## 9. Validation

The browser reads the dependencies from the compiled script, loads each series, then draws. A series that cannot be found or
loaded gives that script a message naming it, and nothing else on the chart changes. Check the first values against the
other instrument's chart at one bar.

## 10. Related skills

[Core](../core/SKILL.md), [Script language](../script-language/SKILL.md), [Studies](../studies/SKILL.md), [Plots and panes](../plots-and-panes/SKILL.md), [Colour and shading](../colour-and-shading/SKILL.md), [Quant recipes](../quant-recipes/SKILL.md), [Troubleshooting](../troubleshooting/SKILL.md).
