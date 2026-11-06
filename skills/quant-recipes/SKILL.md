---
name: alphacharts-quant-recipes
description: >
    Verified formulas to adapt, for statistics and session levels on one instrument's bars: gap from the previous close, previous
    session's high, low, close and VWAP, opening range, swing highs and lows, VWAP from a swing, z-score, realised volatility,
    rolling Sharpe, beta, autocorrelation, regime, ATR distance, range expansion, volume delta, Kalman filter. Load it for any
    such value, also when the request is to colour or highlight it.
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
- Annualise by the square root of the bars per year (`math.sqrt`). One convention everywhere: 252 trading days a year,
  so bars per year = bars per session * 252. Daily bars: 252. A 5-minute NSE chart (75 bars a session): 75 * 252 = 18,900.
  Set the `Bars per year` input to that value for the chart's bar size and say which you used.
- A period the trader names in days or sessions ("60-day volatility") is counted in bars by the script. On daily bars the
  length is that number; on an intraday chart it is the number of days times the bars per session, when that fits the
  length limits, and the reply says the conversion. Never let the number of days stand as a number of bars.
- Give every parameter its own input. A parameter the trader did not name (an ATR length beside the average's) is never
  tied to one they did: it gets its own input with the usual default.
- Pairs of series on this chart's bars: "beta" and "correlation" are of a series on its own lag, or on a named built-in
  (`ta.correl`, `ta.beta` take `source2` as a string such as `"volume"`). Against another symbol or timeframe, load
  [outside-series](../outside-series/SKILL.md), which has rolling beta, correlation, residual, spread z-score and relative strength.
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
| Distance in ATR | (close - SMA) / ATR | Wilder ATR, its own length |
| Previous session's high, low, close | three stepped lines | any bar size, daily included |
| Opening range of the session | stepped high and low from the first minutes after the session's first bar | no session start typed in |
| Range expansion | the bar's range exceeds a multiple of its average | markers |
| Breakout share | percent of bars closing above the previous high | |
| Cumulative volume delta | running sum of signed volume | approximation, see below |
| Session VWAP | VWAP restarting at each exchange-clock day | `time` is milliseconds |
| Previous session's VWAP | the finished session's VWAP, held as a level | not `vwap[1]` |
| Gap from the previous close | percent from the last bar of the previous session to the session's first open, held all day | session-day rule; no daily series |
| Swing highs and lows | last and previous swing level, held | known `right` bars late |
| VWAP anchored at the last swing low | VWAP from the swing low's bar | uses the swing recipe |
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

**Distance from the average in ATR units.** The average and the ATR have a length each: a request that names only the
average's length changes only `len`.

<!-- skill: file: recipes/atr-distance.acs -->
```alphacharts
indicator("Distance from SMA in ATR units")
len = input.int(20, "Average length", minval=2, maxval=500)
atrLen = input.int(14, "ATR length", minval=2, maxval=500)
dist = (close - ta.sma(close, len)) / ta.atr(atrLen)
plot(dist, "Distance", color.blue)
hline(0, "Zero", color.gray)
```

**Range expansion flag.** A marker under bars whose high-low range exceeds `mult` times its own average. The 0/1 flag is the script's own and is not plotted: on the price pane it would be drawn as the prices 0 and 1.

<!-- skill: file: recipes/range-expansion.acs -->
```alphacharts
indicator("Range expansion flag", overlay=true)
len = input.int(20, "Average length", minval=2, maxval=500)
mult = input.float(1.5, "Multiple", minval=0.5, maxval=10, step=0.1)
rng = high - low
avg = ta.sma(rng, len)
flag = na(avg) ? na : (rng > mult * avg ? 1 : 0)
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

**VWAP restarting each session.** A session here is the calendar day of `time` (UTC milliseconds) shifted by `off` minutes. `off` is the
exchange clock's offset from UTC, east positive, and matters only for a session that crosses 00:00 UTC (leave 0 for NSE, BSE, MCX
and US cash sessions, which all sit inside one UTC day). Never write a session start such as 555; do not type one into it. `ta.vwap(source, anchor, bandMult,
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

**Previous session's VWAP.** The VWAP of the session that just finished, held as a level for the whole of the next one. Add up price times
volume and volume per session, and when a new session starts keep the finished session's ratio before the sums restart. `vwap[1]` is the
previous BAR's VWAP, which on a 5-minute chart is a line that looks plausible and is wrong. If the instrument has no volume (an index)
the ratio is `na` and the line draws nothing: say so instead of plotting a substitute.

<!-- skill: file: recipes/prev-session-vwap.acs -->
```alphacharts
indicator("Previous session's VWAP", overlay=true)
off = input.int(0, "UTC offset of the exchange clock, minutes", minval=-720, maxval=840)
day = math.floor((time + off * 60000) / 86400000)
fresh = day != day[1]
var float pv = 0.0
var float vol = 0.0
var float prevVwap = na
if fresh
    prevVwap := pv / vol
    pv := 0.0
    vol := 0.0
pv += hlc3 * volume
vol += volume
plot(pv / vol, "Session VWAP", color.blue)
plot(prevVwap, "Previous session VWAP", color.orange)
```

**Swing highs and lows.** A bar is a swing high when it is the highest of the `left` bars before it, itself and the `right` bars after it.
So it can only be known `right` bars later, and every level below appears with that lag: the marker is on the confirming bar, not on the
swing. The test is `high[right] == ta.highest(high, left + right + 1)`: the window ends on the current bar and the candidate sits `right`
bars back in it. There is no swing function (`ta.pivot_points` is the floor-trader pivot level of a session, not a swing). The last and the previous swing levels are held in `var` and step at each new swing. The default is `left = right = 5`; say so in the reply.

<!-- skill: file: recipes/swing-points.acs -->
```alphacharts
indicator("Swing highs and lows", overlay=true)
left = input.int(5, "Bars to the left", minval=1, maxval=200)
right = input.int(5, "Bars to the right (the confirmation lag)", minval=1, maxval=200)
isHigh = high[right] == ta.highest(high, left + right + 1)
isLow = low[right] == ta.lowest(low, left + right + 1)
var float lastHigh = na
var float prevHigh = na
var float lastLow = na
var float prevLow = na
if isHigh
    prevHigh := lastHigh
    lastHigh := high[right]
if isLow
    prevLow := lastLow
    lastLow := low[right]
plot(lastHigh, "Last swing high", color.red)
plot(prevHigh, "Previous swing high", color.maroon)
plot(lastLow, "Last swing low", color.green)
plot(prevLow, "Previous swing low", color.teal)
plotshape(isHigh, "Swing high confirmed", shape.triangledown, location.abovebar, color.red)
plotshape(isLow, "Swing low confirmed", shape.triangleup, location.belowbar, color.green)
```

**VWAP anchored at the last swing low.** The average runs from the swing low's own bar to the current bar and restarts at each new
swing low. The swing is confirmed `right` bars after it, so the line starts then, and the loop adds the `right` bars between the
swing and the confirming bar so the average does count the swing bar itself.

<!-- skill: file: recipes/anchored-vwap-swing-low.acs -->
```alphacharts
indicator("VWAP anchored at the last swing low", overlay=true)
left = input.int(5, "Bars to the left", minval=1, maxval=200)
right = input.int(5, "Bars to the right (the confirmation lag)", minval=1, maxval=200)
isLow = low[right] == ta.lowest(low, left + right + 1)
var float pv = na
var float vol = na
if isLow
    pv := 0.0
    vol := 0.0
    for k = 0 to right
        pv += hlc3[k] * volume[k]
        vol += volume[k]
else
    pv += hlc3 * volume
    vol += volume
plot(pv / vol, "Anchored VWAP", color.purple)
```

**Previous session's high, low and close.** A new session starts where the day number changes: the calendar day of `time`
shifted by `off` minutes (the exchange clock's offset from UTC, east positive). Compare the day number, never the time of
day: a test such as "the time of day went down" never fires on daily bars, where every bar is one day and the script would
draw nothing. Here every bar of a daily chart is a new session, so the lines read the previous bar, and an intraday chart
reads the previous day. The first session loaded may be partial.

<!-- skill: file: recipes/prev-session-levels.acs -->
```alphacharts
indicator("Previous session's high, low and close", overlay=true)
off = input.int(0, "UTC offset of the exchange clock, minutes", minval=-720, maxval=840)
day = math.floor((time + off * 60000) / 86400000)
fresh = day != day[1]
var float runHigh = high
var float runLow = low
var float prevHigh = na
var float prevLow = na
var float prevClose = na
if fresh
    prevHigh := runHigh
    prevLow := runLow
    prevClose := close[1]
    runHigh := high
    runLow := low
else
    runHigh := math.max(runHigh, high)
    runLow := math.min(runLow, low)
plot(prevHigh, "Previous high", color.green)
plot(prevLow, "Previous low", color.red)
plot(prevClose, "Previous close", color.blue)
```

**Opening range of the session.** The high and low of the bars in the first `span` minutes after the session's first bar. They build up
during the range and then stay level until the next session, which is what "extend the high and low" means on a chart. The session's
first bar is the bar where the day number changes, and the range is measured from that bar's own `time`, so no session start is typed in:
it is right on NSE (09:15), MCX (09:00) and anywhere else a preset is applied. Never write a session start such as 555 (09:15): on an
exchange that opens at another time the range silently covers the wrong bars. It works at any bar size that divides the range; on
daily bars the first bar alone is in it. The first session loaded is usually partial and draws nothing, because its first bar is not
a session start.

<!-- skill: file: recipes/opening-range.acs -->
```alphacharts
indicator("Opening range of the session", overlay=true)
off = input.int(0, "UTC offset of the exchange clock, minutes", minval=-720, maxval=840)
span = input.int(30, "Range length, minutes", minval=1, maxval=600)
day = math.floor((time + off * 60000) / 86400000)
fresh = day != day[1]
var float sessionStart = na
var float orHigh = na
var float orLow = na
if fresh
    sessionStart := time
    orHigh := na
    orLow := na
if time - sessionStart < span * 60000
    orHigh := na(orHigh) ? high : math.max(orHigh, high)
    orLow := na(orLow) ? low : math.min(orLow, low)
plot(orHigh, "Opening range high", color.green)
plot(orLow, "Opening range low", color.red)
```

**Gap from the previous close to today's open.** The session's first open against the close of the bar before it, in percent, held for
the whole session. Both come from the chart's own bars at the bar where the day number changes (the same rule as the previous session's
levels), so it is right on every bar size and on a daily chart, where each bar is a session. Today's open is never taken from a daily
series: `outside(timeframe = "1d", field = "open")` is yesterday's open, because only finished days are visible (outside-series). The first
session loaded has no previous close and draws nothing. "Highlight a gap over 1%" is the `bgcolor` where the size of the gap passes the input.

<!-- skill: file: recipes/gap.acs -->
```alphacharts
indicator("Gap from the previous close to today's open")
off = input.int(0, "UTC offset of the exchange clock, minutes", minval=-720, maxval=840)
minGap = input.float(1.0, "Smallest gap to highlight, percent", minval=0.0, maxval=50.0)
day = math.floor((time + off * 60000) / 86400000)
fresh = day != day[1]
var float prevClose = na
var float todayOpen = na
if fresh
    prevClose := close[1]
    todayOpen := open
gap = 100 * (todayOpen / prevClose - 1)
plot(gap, "Gap, percent", color.blue)
bgcolor(math.abs(gap) > minGap, color.new(color.orange, 85))
hline(0, "Even", color.gray, hline.style_dashed)
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
- A swing is known only `right` bars after it happened: a level from the swing recipe is never available on the swing bar, and the last `right` bars of a chart have no confirmed swing yet.
- `var` state starts at the first loaded bar. A chart that loads more history later can change a cumulative value.
- A script does not know which bar is the last one or how many bars are loaded. "The last three touches" or "the last 100
  bars" of a marker is `plotshape(series, ..., last=3)` or `within=100` (plots-and-panes). A line, a fill or a colour
  cannot be cut that way: draw the measure on every loaded bar and say that the limit is not applied.
- Not possible here: tick-level
  order flow, a Kalman filter with a matrix state, and any measure that needs an array.
- `ta.correl(source, length, "open")` correlates with a built-in series of the same chart only.

## 8. Common mistakes

- Dividing by the sample deviation by hand and the population one again.
- Using `ta.sma` on a `var` accumulator (refused) instead of keeping a second accumulator.
- Annualising with the wrong bars-per-year for the interval (bars per session * 252; plain 252 is for daily bars), or counting "days" as bars.
- One `len` input shared by two different parameters.
- Detecting a new day by a fall in the time of day: it never fires on daily bars.
- A swing written as `high[right] == ta.highest(high, left + right + 1)[right]`: that window ends `right` bars back, so it never sees the bars after the candidate and finds a new high instead of a swing. Write `high[right] == ta.highest(high, left + right + 1)`. There is no swing function to call.
- `plot(vwap[1], "Previous session VWAP")`: that is the previous bar's VWAP. Keep the finished session's VWAP in a `var` when the day changes (previous-session recipe).
- A session start typed as a number of minutes (`start = 555`): it is wrong on every exchange that opens at another time. Measure from the session's first bar.
- Calling the cumulative volume delta order flow; it is a bar-direction approximation.

## 9. Validation

The browser compiles the script and diagnostics come back. Each recipe here was also checked numerically against an
independent calculation; after adapting one, re-check the first non-`na` bar and one value by hand.

## 10. Related skills

[Core](../core/SKILL.md), [Script language](../script-language/SKILL.md), [Studies](../studies/SKILL.md), [Plots and panes](../plots-and-panes/SKILL.md), [Troubleshooting](../troubleshooting/SKILL.md).
