---
name: alphacharts-quant-recipes
description: >
    Worked, numerically verified scripts for quant measures: z-score of returns, realised volatility, HV ratio, rolling Sharpe,
    beta and correlation on a series' own lag, autocorrelation, ADX/EMA regime, distance in ATR units, range expansion,
    breakout share, cumulative volume delta, session VWAP, a Kalman-style filter.
version: 1.0
api_version: 0.x
depends_on:
    - alphacharts-core
    - alphacharts-script-language
    - alphacharts-studies
    - alphacharts-plots-and-panes
status: stable
---

# alphacharts Quant recipes

## 1. When to use this skill

Load it when the request is a statistic or a state machine on one instrument's bars rather than a named indicator. Adapt
the closest recipe: change the inputs and titles, keep the formula. Each script below is compiled, run, and compared with
an independent plain-JavaScript calculation on seeded bars, so the arithmetic is the stated one.

## 2. Domain overview

Conventions every recipe follows:

- Simple return `close / close[1] - 1`; log return `math.log(close / close[1])`. Bar 0 has no return (`na`).
- Rolling statistics use the kernels. `ta.stdev` and `ta.variance` divide by n (population). For the sample deviation
  multiply by `math.sqrt(n / (n - 1))`.
- A rolling window containing `na` is `na`, so a statistic of returns first appears at bar `length`.
- Annualise by the square root of the bars per year (`math.sqrt`): 252 for daily bars; intraday it is bars per session times sessions per year.
- Pairs of series come from the same bars: this language has no other symbol, so "beta" and "correlation" are of a series on
  its own lag, or on a named built-in (`ta.correl`, `ta.beta` take `source2` as a string such as `"volume"`).
- Recursions use `var float` state and run once per bar, oldest first.

## 3. API reference

| Recipe | Output | Notes |
| --- | --- | --- |
| Z-score of returns | z in standard deviations | zero deviation gives `na` |
| Realised volatility | percent, annualised | log returns |
| HV ratio | short over long volatility | annualisation cancels |
| Rolling Sharpe | annualised, zero risk-free rate | simple returns |
| Beta and correlation on own lag | slope and Pearson r of `r` on `r[lag]` | `lag` input |
| Autocorrelation lag 1 | Pearson r of `r` and `r[1]` | |
| Regime | -1, 0, 1 | ADX above a level, side by EMA |
| Distance in ATR | (close - SMA) / ATR | Wilder ATR |
| Range expansion | 1 when the bar's range exceeds a multiple of its average | flag and markers |
| Breakout share | percent of bars closing above the previous high | |
| Cumulative volume delta | running sum of signed volume | approximation, see below |
| Session VWAP | VWAP restarting at each UTC-shifted day | `time` is milliseconds |
| Kalman-style filter | recursive estimate of the close | `var` state |

## 4. Standard workflow

1. Find the recipe; copy it; rename the title and keep the plot titles meaningful.
2. Change inputs, not formulas. If the formula must change, keep the pure/state split of script-language.
3. Choose overlay from the units: price-unit outputs overlay, the rest in a pane.
4. State what the number is and its assumptions in the reply (population deviation, annualisation base, approximation).

## 5. Examples

**Z-score of returns.** How far this bar's return is from its mean, in standard deviations.

<!-- skill: file: recipes/zscore-returns.acs -->
```alphacharts
indicator("Z-score of returns")
len = input.int(20, "Length", minval=2, maxval=500)
ret = close / close[1] - 1
z = (ret - ta.sma(ret, len)) / ta.stdev(ret, len)
plot(z, "Z", color.blue)
hline(2, "Plus 2", color.gray, hline.style_dashed)
hline(-2, "Minus 2", color.gray, hline.style_dashed)
```

**Realised volatility.** Standard deviation of log returns, annualised, in percent.

<!-- skill: file: recipes/realised-vol.acs -->
```alphacharts
indicator("Realised volatility (annualised, percent)")
len = input.int(20, "Length", minval=2, maxval=500)
ann = input.int(252, "Bars per year", minval=1, maxval=1000000)
r = math.log(close / close[1])
hv = ta.stdev(r, len) * math.sqrt(ann) * 100
plot(hv, "HV", color.purple)
```

**HV ratio.** Short over long volatility; above 1 means volatility is expanding.

<!-- skill: file: recipes/hv-ratio.acs -->
```alphacharts
indicator("HV ratio (short over long)")
fast = input.int(10, "Short length", minval=2, maxval=500)
slow = input.int(50, "Long length", minval=2, maxval=500)
r = math.log(close / close[1])
ratio = ta.stdev(r, fast) / ta.stdev(r, slow)
plot(ratio, "Ratio", color.orange)
hline(1, "Equal", color.gray, hline.style_dashed)
```

**Rolling Sharpe.** Mean over deviation of simple returns, annualised, risk-free rate zero. To subtract a rate, subtract it
per bar from `r`.

<!-- skill: file: recipes/rolling-sharpe.acs -->
```alphacharts
indicator("Rolling Sharpe (zero risk-free rate)")
len = input.int(60, "Length", minval=2, maxval=1000)
ann = input.int(252, "Bars per year", minval=1, maxval=1000000)
r = close / close[1] - 1
sharpe = ta.sma(r, len) / ta.stdev(r, len) * math.sqrt(ann)
plot(sharpe, "Sharpe", color.teal)
hline(0, "Zero", color.gray)
```

**Beta and correlation on the series' own lag.** Regress today's return on the return `lag` bars ago: beta is
`cov(r, r[lag]) / var(r[lag])`, correlation is `cov / (sd(r) * sd(r[lag]))`. Moments come from `ta.sma`, so no window needs
state.

<!-- skill: file: recipes/lag-regression.acs -->
```alphacharts
indicator("Rolling beta and correlation on the series' own lag")
len = input.int(30, "Length", minval=3, maxval=500)
lag = input.int(1, "Lag", minval=1, maxval=50)
r = close / close[1] - 1
rl = r[lag]
cov = ta.sma(r * rl, len) - ta.sma(r, len) * ta.sma(rl, len)
beta = cov / ta.variance(rl, len)
corr = cov / (ta.stdev(r, len) * ta.stdev(rl, len))
plot(beta, "Beta", color.blue)
plot(corr, "Correlation", color.orange)
hline(0, "Zero", color.gray)
```

**Autocorrelation at lag 1.** Positive means returns tend to continue, negative that they tend to reverse.

<!-- skill: file: recipes/autocorrelation-lag1.acs -->
```alphacharts
indicator("Autocorrelation of returns, lag 1")
len = input.int(30, "Length", minval=3, maxval=500)
r = close / close[1] - 1
r1 = r[1]
ac = (ta.sma(r * r1, len) - ta.sma(r, len) * ta.sma(r1, len)) / (ta.stdev(r, len) * ta.stdev(r1, len))
plot(ac, "Autocorrelation", color.purple)
hline(0, "Zero", color.gray)
```

**Regime.** `1` trending up (ADX above the level and close above its EMA), `-1` trending down, `0` no trend. `na` until both
the ADX and the EMA exist.

<!-- skill: file: recipes/regime-adx-ema.acs -->
```alphacharts
indicator("Regime: ADX strength, EMA side")
len = input.int(14, "ADX length", minval=2, maxval=200)
trend = input.int(25, "ADX trend level", minval=1, maxval=100)
span = input.int(50, "EMA length", minval=2, maxval=500)
[adx, plusdi, minusdi] = ta.adx(len)
e = ta.ema(close, span)
regime = na(adx) or na(e) ? na : (adx > trend ? (close > e ? 1 : -1) : 0)
plot(regime, "Regime", color.blue, style=plot.style_histogram)
```

**Distance from the average in ATR units.**

<!-- skill: file: recipes/atr-distance.acs -->
```alphacharts
indicator("Distance from SMA in ATR units")
len = input.int(20, "Length", minval=2, maxval=500)
dist = (close - ta.sma(close, len)) / ta.atr(len)
plot(dist, "Distance", color.blue)
hline(0, "Zero", color.gray)
```

**Range expansion flag.** `1` on bars whose high-low range exceeds `mult` times its own average.

<!-- skill: file: recipes/range-expansion.acs -->
```alphacharts
indicator("Range expansion flag", overlay=true)
len = input.int(20, "Average length", minval=2, maxval=500)
mult = input.float(1.5, "Multiple", minval=0.5, maxval=10, step=0.1)
rng = high - low
avg = ta.sma(rng, len)
flag = na(avg) ? na : (rng > mult * avg ? 1 : 0)
plot(flag, "Flag", color.orange, style=plot.style_histogram)
plotshape(flag == 1, "Wide bar", shape.triangleup, location.belowbar, color.orange)
```

**Share of bars closing above the previous high.** Bar 0 counts as no.

<!-- skill: file: recipes/up-break-share.acs -->
```alphacharts
indicator("Share of bars closing above the previous high")
len = input.int(20, "Length", minval=2, maxval=500)
above = close > high[1] ? 1 : 0
share = 100 * ta.sum(above, len) / len
plot(share, "Percent", color.green)
hline(50, "Half", color.gray, hline.style_dashed)
```

**Cumulative volume delta from bar direction.** An approximation: the whole bar's volume is credited to the side its close
chose (up bar plus, down bar minus, doji zero). It is not tick-level buy/sell volume. The running total starts at the first
loaded bar, so its level depends on how much history is loaded; read its slope and the rolling delta.

<!-- skill: file: recipes/cumulative-volume-delta.acs -->
```alphacharts
indicator("Cumulative volume delta from bar direction (approximation)")
len = input.int(20, "Rolling length", minval=2, maxval=500)
delta = close > open ? volume : close < open ? -volume : 0
var float total = 0
total += delta
plot(total, "CVD", color.blue)
plot(ta.sum(delta, len), "Rolling delta", color.orange, style=plot.style_histogram)
```

**VWAP restarting each session.** A session here is the calendar day of `time` (UTC milliseconds) shifted by `off` minutes;
set `off` to minus the session start, in minutes after 00:00 UTC (a session starting 03:00 UTC is `off = -180`), so that day boundaries fall where the session starts. `ta.vwap(source, anchor, bandMult,
utcOffsetMinutes)` does the same with week, month and year anchors and bands.

<!-- skill: file: recipes/session-anchored-vwap.acs -->
```alphacharts
indicator("VWAP restarting each session day", overlay=true)
off = input.int(0, "UTC offset of the session, minutes", minval=-720, maxval=840)
day = math.floor((time + off * 60000) / 86400000)
fresh = day != day[1]
var float pv = 0
var float vol = 0
if fresh
    pv := 0
    vol := 0
pv += hlc3 * volume
vol += volume
plot(pv / vol, "VWAP", color.blue)
```

**Kalman-style filter.** Predict `err + q`, gain `pred / (pred + r)`, correct the estimate, shrink the error. Larger `q` or
smaller `r` follows price faster. `q` and `r` are in price-squared units, so scale them to the instrument.

<!-- skill: file: recipes/kalman-filter.acs -->
```alphacharts
indicator("Kalman-style filter of the close", overlay=true)
q = input.float(0.05, "Process noise", minval=0.0001, maxval=1000)
r = input.float(4, "Measurement noise", minval=0.0001, maxval=1000)
var float est = close
var float err = 1
pred = err + q
gain = pred / (pred + r)
est := est + gain * (close - est)
err := (1 - gain) * pred
plot(est, "Filter", color.blue)
```

A regression residual is the close less the fitted line read at the last bar:

```alphacharts
indicator("Residual from the regression line")
len = input.int(30, "Length", minval=2, maxval=500)
plot(close - ta.linreg(close, len), "Residual", color.purple, style=plot.style_histogram)
```

## 6. Composition

Take any recipe's output as a series in another formula, for example gate the regime with a volatility ratio. Plot a
recipe's level against price by making it `overlay=true` only when it is in price units (VWAP, the filter).

## 7. Constraints and correctness

- Population deviation everywhere; the first value of a rolling statistic is at bar `length` for returns (one bar later than
  for prices).
- `var` state starts at the first loaded bar. A chart that loads more history later can change a cumulative value.
- Not possible here: a rolling beta or correlation against another symbol or timeframe (no outside series), tick-level
  order flow, a Kalman filter with a matrix state, and any measure that needs an array.
- `ta.correl(source, length, "open")` correlates with a built-in series of the same chart only.

## 8. Common mistakes

- Dividing by the sample deviation by hand and the population one again.
- Using `ta.sma` on a `var` accumulator (refused) instead of keeping a second accumulator.
- Annualising with the wrong bars-per-year for the interval.
- Calling the cumulative volume delta order flow; it is a bar-direction approximation.

## 9. Validation

The browser compiles the script and diagnostics come back. Each recipe here was also checked numerically against an
independent calculation; after adapting one, re-check the first non-`na` bar and one value by hand.

## 10. Related skills

[Core](../core/SKILL.md), [Script language](../script-language/SKILL.md), [Studies](../studies/SKILL.md), [Plots and panes](../plots-and-panes/SKILL.md), [Troubleshooting](../troubleshooting/SKILL.md).
