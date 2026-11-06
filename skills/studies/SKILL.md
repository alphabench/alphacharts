---
name: alphacharts-studies
description: >
    How to call any built-in study as ta.<id>: the index by purpose, the calling rules, and per-family references with every
    parameter, default, range, option and output. Load before writing a ta.<id> call.
version: 1.0
api_version: 0.x
depends_on:
    - alphacharts-core
    - alphacharts-script-language
status: stable
---

# alphacharts Studies

## 1. When to use this skill

Load it before writing any `ta.<id>` call other than a kernel you already know (`ta.sma`, `ta.ema`, `ta.stdev`,
`ta.highest`...). Pick the id from the index here, then read only that family's reference file for the exact parameters.

## 2. Domain overview

Every non-math study of the indicators package is callable as `ta.<id>` with `-` written `_` (`ht-dcperiod` is
`ta.ht_dcperiod`), except `ta.var`, whose name is a reserved word. The call builds the study's own computation on the script's graph, so the numbers equal the built-in
study's. Rules:

- **Order.** A `source` parameter, when the study has one, comes first and takes any numeric series; the rest follow in the
  order of the reference line. Arguments go by position or by name (`ta.macd(close, fast=8)`), positional first. Every study
  parameter is optional and defaults as the reference says; the kernels `ta.sma ta.ema ta.wma ta.atr` require `length`.
- **Outputs.** One column is a series. Several columns are a tuple that must be destructured in the listed order:
  `[macd_line, signal_line, hist] = ta.macd(close)`. A tuple cannot be plotted or used in arithmetic.
- **Parameters are literals or inputs**, never series. A `select` parameter takes a string from its list; a `source2` select
  names a built-in series as a string (`"volume"`), so it cannot take a computed series.
- **Data.** `needs ohlc` studies read open/high/low/close, `needs volume` read volume; the chart's bars must carry them.
- **Placement.** `overlay` studies are in price units, `own pane` studies are not; set `indicator(overlay=...)` to match.
- **Warm-up** bars are `na`. Candlestick patterns return `0` for no pattern, a positive value for a bullish pattern, a negative one for a bearish pattern.
- Math-family ids are not callable (list below); use `math.*` or operators. `ta.var` cannot be written either (below).

## 3. API reference

One generated file per family, each line `ta.<id>(parameters) -> outputs · placement · needs · title`. Legend:
`name:type=default[min..max]`; `select` shows `{allowed|values}`; no `=default` means required; `[a, b]` is a tuple.

| Family | File |
| --- | --- |
| Overlap: moving averages, bands, SAR | [overlap](reference/overlap.md) |
| Momentum and trend strength | [momentum](reference/momentum.md) |
| Volatility | [volatility](reference/volatility.md) |
| Volume | [volume](reference/volume.md) |
| Price transforms | [price](reference/price.md) |
| Statistics | [statistic](reference/statistic.md) |
| Cycle (Hilbert) | [cycle](reference/cycle.md) |
| TradingView set | [tv](reference/tv.md) |
| Candlestick patterns | [pattern](reference/pattern.md) |
| Math ids (not callable) | [math](reference/math.md) |

**Index by purpose.** Open the file of the family in brackets.

- Moving averages (overlap, tv): `ta.sma ta.ema ta.wma ta.dema ta.tema ta.trima ta.kama ta.t3 ta.ma ta.mama ta.hma
  ta.alma ta.lsma ta.smma ta.vwma ta.mcginley ta.ma_ribbon ta.ma_cross ta.ht_trendline`. `ta.ma(source, length, type)`
  picks the kind by string.
- Bands and channels (overlap, tv): `ta.bbands ta.bbpb ta.bbw ta.envelopes ta.keltner ta.donchian ta.price_channel
  ta.chande_kroll_stop ta.linreg_channel ta.ichimoku ta.alligator`. Bollinger with defaults is
  `[upper, middle, lower] = ta.bbands(close)`; the kernel `ta.bb` has basis first.
- Trend following and stops (overlap, tv): `ta.supertrend ta.sar ta.sarext ta.zigzag ta.fractals ta.pivot_points
  ta.midpoint ta.midprice ta.median`.
- Momentum oscillators (momentum, tv): `ta.rsi ta.stochrsi ta.stoch ta.stochf ta.stoch_tv ta.macd ta.macdext ta.macdfix
  ta.ppo ta.apo ta.mom ta.roc ta.rocp ta.rocr ta.rocr100 ta.cmo ta.cci ta.willr ta.ultosc ta.trix ta.tsi ta.kst
  ta.coppock ta.connors_rsi ta.fisher ta.awesome ta.accelerator ta.bull_bear_power ta.dpo ta.schaff_tc ta.smi_ergodic
  ta.rvi_vigor ta.rank_corr ta.bop`.
- Trend strength and direction (momentum, tv): `ta.adx ta.adxr ta.dx ta.plus_di ta.minus_di ta.plus_dm ta.minus_dm
  ta.aroon ta.aroonosc ta.vortex ta.choppiness`.
- Volatility (volatility, tv, statistic): `ta.atr ta.natr ta.trange ta.adr ta.hist_vol ta.stddev ta.var
  ta.rvi_volatility ta.mass_index`. For a plain rolling deviation use the kernels `ta.stdev` and `ta.variance`.
- Volume (volume, tv): `ta.volume ta.obv ta.ad ta.adosc ta.mfi ta.chaikin_mf ta.elder_force ta.eom ta.klinger
  ta.net_volume ta.pvt ta.volume_osc ta.vwap ta.anchored_vwap`. `ta.vwap` is the **Session VWAP**: it restarts at each session (day, or week,
  month, year by `anchor`), which is what VWAP means on an intraday chart; it is never one running average over the whole chart. For a start
  you choose use `ta.anchored_vwap`.
- Annualisation (tv): `ta.bars_per_year(source, utcOffsetMinutes)` is the built-in series `bars_per_year`; give it an outside series to count that series' bars.
- Price transforms (price): `ta.avgprice ta.medprice ta.typprice ta.wclprice`.
- Statistics (statistic): `ta.linearreg ta.linearreg_angle ta.linearreg_slope ta.linearreg_intercept ta.tsf ta.correl
  ta.beta`.
- Cycle (cycle): `ta.ht_dcperiod ta.ht_dcphase ta.ht_phasor ta.ht_sine ta.ht_trendmode`.
- Candlestick patterns (pattern), all argument-free unless the file shows `penetration`: `ta.cdl_2crows ta.cdl_3blackcrows
  ta.cdl_3inside ta.cdl_3linestrike ta.cdl_3outside ta.cdl_3starsinsouth ta.cdl_3whitesoldiers ta.cdl_abandonedbaby
  ta.cdl_advanceblock ta.cdl_belthold ta.cdl_breakaway ta.cdl_closingmarubozu ta.cdl_concealbabyswall ta.cdl_counterattack
  ta.cdl_darkcloudcover ta.cdl_doji ta.cdl_dojistar ta.cdl_dragonflydoji ta.cdl_engulfing ta.cdl_eveningdojistar
  ta.cdl_eveningstar ta.cdl_gapsidesidewhite ta.cdl_gravestonedoji ta.cdl_hammer ta.cdl_hangingman ta.cdl_harami
  ta.cdl_haramicross ta.cdl_highwave ta.cdl_hikkake ta.cdl_hikkakemod ta.cdl_homingpigeon ta.cdl_identical3crows
  ta.cdl_inneck ta.cdl_invertedhammer ta.cdl_kicking ta.cdl_kickingbylength ta.cdl_ladderbottom ta.cdl_longleggeddoji
  ta.cdl_longline ta.cdl_marubozu ta.cdl_matchinglow ta.cdl_mathold ta.cdl_morningdojistar ta.cdl_morningstar
  ta.cdl_onneck ta.cdl_piercing ta.cdl_rickshawman ta.cdl_risefall3methods ta.cdl_separatinglines ta.cdl_shootingstar
  ta.cdl_shortline ta.cdl_spinningtop ta.cdl_stalledpattern ta.cdl_sticksandwich ta.cdl_takuri ta.cdl_tasukigap
  ta.cdl_thrusting ta.cdl_tristar ta.cdl_unique3river ta.cdl_upsidegap2crows ta.cdl_xsidegap3methods`.
- Math ids that are not callable, and what to use instead: `acos asin atan ceil cos cosh exp floor sin sinh sqrt tan tanh`
  are `math.<id>`; `ln` is `math.log`, `log10` is `math.log10`; `add sub mult div` are `+ - * /`; `max` and `min`
  over a window are `ta.highest` and `ta.lowest`, over two values `math.max` and `math.min`; `sum` is `ta.sum`;
  `maxindex minindex minmax minmaxindex` have no equivalent (`ta.highestbars` gives bars since the high, not an index).

## 4. Standard workflow

1. Find the id in the index; open its family file and copy the parameter names and order.
2. Call it with the parameters the user asked for; leave the rest at their defaults. A study that restarts each session,
   week, month or year (`ta.vwap`, `ta.pivot_points`) takes `utcOffsetMinutes`: the exchange clock's offset from UTC in
   minutes, east positive, and a period begins at midnight of that clock. The default 0 is UTC midnight; pass the exchange's
   own offset.
3. Destructure tuples in the listed order; plot the outputs the user needs.
4. Put `indicator(..., overlay=true)` for `overlay` studies, otherwise leave the default.
5. If the study is not here, compute it (quant-recipes) or say it is unavailable.

## 5. Examples

Tuple outputs, by position and by name:

```alphacharts
indicator("MACD")
[macd_line, signal_line, hist] = ta.macd(close, 12, 26, 9)
plot(macd_line, "MACD", color.blue)
plot(signal_line, "Signal", color.orange)
plot(hist, "Histogram", color.gray, style=plot.style_histogram)
```

```alphacharts
indicator("Bollinger", overlay=true)
len = input.int(20, "Length", minval=2, maxval=500)
[up, mid, lo] = ta.bbands(close, length=len, multUp=2, multDn=2, maType="ema")
plot(up, "Upper", color.teal)
plot(mid, "Middle", color.gray)
plot(lo, "Lower", color.teal)
```

Studies that read OHLC or volume, a select string, and a pattern marked where it is non-zero:

```alphacharts
indicator("Supertrend", overlay=true)
[up, down, direction] = ta.supertrend(10, 3)
plot(up, "Up", color.green)
plot(down, "Down", color.red)
plotshape(ta.cdl_engulfing() > 0, "Bullish engulfing", shape.triangleup, location.belowbar, color.green)
```

```alphacharts
indicator("Volume-weighted average, restarting each session", overlay=true)
[vwap, upper, lower] = ta.vwap(hlc3, "session", 1, 0)
plot(vwap, "VWAP", color.blue)
```

Using a study inside a formula (each output is an ordinary series):

```alphacharts
indicator("ADX-filtered momentum")
[strong, plus, minus] = ta.adx(14)
mom = ta.mom(close, 10)
plot(strong > 25 ? mom : na, "Momentum when ADX > 25", color.purple)
```

Wrong parameter name, and a tuple used as a series:

<!-- skill: invalid: ta.rsi has no parameter "period" (parameters: source, length) -->
```alphacharts
plot(ta.rsi(close, period=14))
```

<!-- skill: invalid: argument "series" of plot must be a number series, got a tuple of 3 values (destructure it: [a, b] = ...) -->
```alphacharts
plot(ta.macd(close))
```

## 6. Composition

Study outputs feed formulas, `?:`, `ta.crossover` and `plotshape`. A study's `length` may be an input. A `ta.<id>` call
cannot take a `var` variable as its source (script-language). Styling is in [plots-and-panes](../plots-and-panes/SKILL.md).

## 7. Constraints and correctness

- Ranges in the reference are enforced: `argument "length" of ta.sma must be between 1 and 5000, got 6000`.
- `ta.correl` and `ta.beta` correlate `source` with a named built-in series (`source2`); their default `"volume"` makes them
  need volume. A computed series cannot be the second input.
- Some tuples include internal columns (for example `ta.zigzag` returns `price, back, live, liveBack`); plot only what the
  user needs.
- Kernels and studies of the same name are the same computation; the reference shows the callable signature.
- Studies mirror TA-Lib or TradingView definitions (the registry's `reference` field says which); a study's warm-up is
  longer than its main length when it smooths (ADX needs about twice its length).
- Where a study is not TA-Lib's number, its `reference` says so. Three that matter for a quant: `ta.atr`, `ta.natr` and every ATR band
  (`ta.keltner`, `ta.supertrend`, `ta.chande_kroll_stop`, `ta.median`) are Wilder's ATR: the true range of bar 0 is high -
  low and the first value is at bar `length - 1` (TA-Lib skips bar 0, starts a bar later and differs by a different seed). the RSI reports 100, not
  TA-Lib's 0, while the first `length` changes are all zero (RS is 0/0; charting packages say 100). `ta.vwap` is session VWAP.

## 8. Common mistakes

- Positional arguments in another study's order. Always copy the line.
- Dropping the source: `ta.sma(14, 3)` compiles and averages the constant 14. Write the source first.
- Treating a tuple as a series, or destructuring the wrong number of names.
- Calling a math-family id, or writing a hyphen: an id such as `plus-di` is `ta.plus_di`.
- `ta.var` is registered but `var` is a reserved word, so it cannot be written; use the kernel `ta.variance`.
- Forgetting `overlay=true` for a price-scale study (the values are drawn in a separate pane scaled to price).

## 9. Validation

The browser compiles the script and diagnostics come back. Then look at the first non-`na` bar: it should match the study's
warm-up, and an `overlay` study should sit at the price level.

## 10. Related skills

[Core](../core/SKILL.md), [Script language](../script-language/SKILL.md), [Plots and panes](../plots-and-panes/SKILL.md), [Quant recipes](../quant-recipes/SKILL.md), [Troubleshooting](../troubleshooting/SKILL.md).
