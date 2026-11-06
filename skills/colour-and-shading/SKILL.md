---
name: alphacharts-colour-and-shading
description: >
    Colour that depends on the bar: barcolor to colour candles, bgcolor to shade the background of a pane, a line coloured by
    a condition, and indicator(scale="left") to draw a series of another magnitude on the left axis.
version: 1.0
api_version: 0.x
depends_on:
    - alphacharts-core
    - alphacharts-script-language
    - alphacharts-plots-and-panes
status: stable
---

# alphacharts Colour and shading

## 1. When to use this skill

Load it when the request is to colour candles or bars where a condition holds, shade the background of the price chart or
of an indicator's pane, change the colour of a line by a condition, or put a series on its own axis next to the price.

## 2. Domain overview

Three output statements and one line colour, all top level, all driven by a bool series:

- `barcolor(condition, color)` colours the **candles (or bars) of the chart** on every bar where the condition is true.
  Candles with no applicable `barcolor` keep their up/down colours. Wick and body take the colour.
- `bgcolor(condition, color)` shades the **background of the pane the script draws in** on every bar where the condition is
  true: the price chart for `overlay=true`, the script's own pane otherwise. It does not move the scale.
- `plot(series, title, color = condition ? colorA : colorB)` colours a line per bar: a segment takes the colour of the bar it
  arrives at. Both colours are constants (`color.*`, `#rrggbb[aa]`, `color.new(...)`), not an `input.color`, and the form is
  for line plots (`plot.style_line`).
- `indicator(title, shorttitle, overlay, scale)` with `scale = "left"` draws the script's series on the chart's left axis
  (the right is the default), so an oscillator or a ratio shares a pane with the price without flattening it.

Rules that hold for all of them:

- A colour is a constant, `color.new(color, transp)` of a constant, or an `input.color` variable (not in the line form above).
  Transparent colours (`color.new(color.red, 85)`) suit shading.
- Several `barcolor` statements, and the `barcolor` of several scripts on one chart, compose: on a bar the later one that
  applies wins. Removing a script restores the candles exactly.
- The condition is evaluated on every bar, history and live: when the live bar's price changes the colour follows.
- `barcolor` needs a candle or bar chart. On a line or area chart it cannot colour anything and the app says so.
- A script in its own pane (`overlay=false`) that uses `bgcolor` needs a `plot` of a line, histogram or area to hold the pane.

## 3. API reference

Generated signatures: [builtins.md](../script-language/reference/builtins.md). `barcolor(condition, color)` and
`bgcolor(condition, color)` take exactly those two arguments, by position or by name. The condition must be a bool.

## 4. Standard workflow

1. Say what the colour means in the reply (what the condition is).
2. For candles use `barcolor` in an `overlay=true` script; the script may draw nothing else.
3. For a zone in an indicator pane, plot the indicator and `bgcolor` the zone with a transparent colour.
4. For colour along one line, use the ternary colour; for a line that exists only on some bars, two plots with `na`.
5. For another magnitude next to price, `overlay=true` with `scale="left"`.

## 5. Examples

Candles of rising closes above the 20-bar average in yellow, others unchanged:

```alphacharts
indicator("Strong closes", overlay=true)
len = input.int(20, "Length", minval=2, maxval=500)
barcolor(close > open and close > ta.sma(close, len), color.yellow)
```

An RSI pane with the overbought and oversold zones shaded:

```alphacharts
indicator("RSI zones")
len = input.int(14, "Length", minval=2, maxval=200)
rsi = ta.rsi(close, len)
plot(rsi, "RSI", color.purple)
bgcolor(rsi > 70, color.new(color.red, 85))
bgcolor(rsi < 30, color.new(color.green, 85))
hline(70, "Upper", color.gray, hline.style_dashed)
hline(30, "Lower", color.gray, hline.style_dashed)
```

A line coloured by direction, and the price chart tinted while volume is above its average:

```alphacharts
indicator("Trend colour", overlay=true)
len = input.int(20, "Length", minval=2, maxval=500)
m = ta.sma(close, len)
plot(m, "Average", color = m > m[1] ? color.green : color.red, linewidth = 2)
bgcolor(volume > 2 * ta.sma(volume, len), color.new(color.blue, 90))
```

A series on the left axis (RSI beside the price, in the price pane):

```alphacharts
indicator("RSI on the left axis", overlay=true, scale="left")
plot(ta.rsi(close, 14), "RSI", color.purple)
```

What a condition that never holds draws (the column is `na` on every bar):

<!-- skill: expect: {"Bar color 1": {"all": "na"}, "Background 2": {"all": 1}} -->
```alphacharts
indicator("Never and always", overlay=true)
barcolor(close > close, color.red)
bgcolor(close == close, color.new(color.gray, 90))
```

Not allowed, with the diagnostics:

<!-- skill: invalid: barcolor needs a bool condition, got series float -->
```alphacharts
barcolor(close, color.red)
```

<!-- skill: invalid: a color that depends on the bar is for line plots; histogram and area take a constant color (a histogram can use color_down for negative values) -->
```alphacharts
plot(close, style = plot.style_histogram, color = close > open ? color.green : color.red)
```

<!-- skill: invalid: both colors of a color that depends on the bar must be constants (color.red, #rrggbb, color.new(...)), not an input.color -->
```alphacharts
tone = input.color(color.green)
plot(close, color = close > open ? tone : color.red)
```

<!-- skill: invalid: bgcolor shades the pane the script draws in, and with overlay=false the script has a pane only if it plots a line, histogram or area: add a plot(...), or use indicator(..., overlay=true) to shade the price chart -->
```alphacharts
bgcolor(close > open, color.new(color.green, 90))
```

## 6. Composition

Any boolean from studies, recipes or [outside-series](../outside-series/SKILL.md) can drive a colour:
`bgcolor(ta.crossover(close, ta.sma(close, 50)), ...)`, `barcolor(close > outside("AAA") * 2, ...)`. The line colour form
replaces the older two-gapped-plots technique when only the colour changes; two plots remain for a line that should not
exist on some bars (plots-and-panes).

## 7. Constraints and correctness

- `bgcolor` and `barcolor` take a bool: compare a number first.
- `bgcolor`, fills and markers do not take part in autoscale; a coloured line does (it is a line).
- Candles drawn zoomed far out show a bucket's colour if any bar in it is coloured.
- The line colour condition may use `var` state; the colours are constants.
- `scale="left"` needs the chart to show a left axis; the app that shows the chart decides, and says so when it cannot.

## 8. Common mistakes

- `barcolor(close, color.red)`: not a bool.
- `plot(close, color = cond ? input_colour : color.red)`: both branches constants.
- A colour ternary on a histogram or an area: lines only.
- `bgcolor` in an own-pane script with no `plot`.
- Shading with an opaque colour: it hides the grid and the bars behind; use a transparency of 80 to 95.

## 9. Validation

The browser compiles the script. Check on the chart that the colour appears on the bars where the condition is true and
nowhere else, that removing the script restores the candles, and that nothing moved the price scale.

## 10. Related skills

[Core](../core/SKILL.md), [Script language](../script-language/SKILL.md), [Plots and panes](../plots-and-panes/SKILL.md), [Outside series](../outside-series/SKILL.md), [Troubleshooting](../troubleshooting/SKILL.md).
