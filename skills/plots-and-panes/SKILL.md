---
name: alphacharts-plots-and-panes
description: >
    Drawing a script's output: plot, plot styles, hline, fill, plotshape, overlay versus own pane, colours as constants,
    input.* controls, and a line shown only where a condition holds with two gapped plots.
version: 1.0
api_version: 0.x
depends_on:
    - alphacharts-core
    - alphacharts-script-language
status: stable
---

# alphacharts Plots and panes

## 1. When to use this skill

Load it when a request is about how something looks: a line style, a histogram, a shaded band, markers on bars, a level
line, colours, or user-adjustable settings. Every script uses `plot`, so load it with any script that is not a bare study.

## 2. Domain overview

**Where it draws.** `indicator("Title", overlay=true)` puts every output on the price scale; the default
`overlay=false` gives one own pane for the whole script. A second argument `shorttitle` replaces the title. `scale="left"`
puts the script's series on the chart's left axis (see colour-and-shading). `indicator` may appear once.

**Output statements** are top-level only. Give each plot its own title (an untitled plot is `Plot N`; two plots with the same title get distinct internal keys but are hard to tell apart). At most 64 per script.

- `plot(series, title, color, linewidth, style, offset, color_down)` draws a number series. It returns a handle for `fill`.
  `style` is `plot.style_line`, `plot.style_histogram` or `plot.style_area`. `linewidth` is 1 to 8. `offset` shifts the
  plot by bars (positive moves it into the future), -5000 to 5000. `color_down` colours histogram bars below zero.
- `hline(price, title, color, linestyle)` draws a horizontal line at a literal or an input; `linestyle` is
  `hline.style_solid`, `hline.style_dashed` or `hline.style_dotted`. A level that depends on bars is a `plot`.
- `fill(plot1, plot2, color, title)` shades between two line plots, given as handles `p = plot(...)`. Histograms, areas,
  hlines and markers cannot be filled, and the two plots must differ.
- `plotshape(series, title, style, location, color, offset)` marks bars. With a bool series it marks bars where it is true
  (`location.abovebar` or `location.belowbar`). With a number series it marks that price (`location.absolute`), and `na`
  leaves the bar unmarked. Styles: `shape.circle shape.square shape.diamond shape.triangleup shape.triangledown
  shape.arrowup shape.arrowdown shape.xcross shape.cross`.

**Colours are constants.** `color.aqua color.black color.blue color.fuchsia color.gray color.green color.lime color.maroon
color.navy color.olive color.orange color.purple color.red color.silver color.teal color.white color.yellow`, a hex
`#rrggbb` or `#rrggbbaa`, `color.new(color, transp)` (0 opaque to 100 invisible; the colour must be a constant), or an
`input.color` variable. A line's colour may depend on the bar, written `cond ? colorA : colorB`; candles and the
background are coloured with `barcolor` and `bgcolor` ([colour-and-shading](../colour-and-shading/SKILL.md)).

**A line shown only where a condition holds.** Draw two plots and give each `na` where it should not show. Include the bar
where the direction flips in both, so the line has no hole. The file [two-colour-line.acs](examples/two-colour-line.acs) is
checked against a plain-JavaScript recomputation. To change only the colour of one continuous line, use the colour form
in colour-and-shading.

**Controls.** `input.int`, `input.float`, `input.bool`, `input.string(options=[...])`, `input.source` and `input.color`
declare settings the user can change; `input.color` recolours the plots that use it.

## 3. API reference

Generated signatures: [builtins.md](../script-language/reference/builtins.md). Argument order is as written above; every
argument after the series is optional and can be passed by name.

## 4. Standard workflow

1. Choose `overlay` from the units of the main output.
2. Keep each plot's series numeric: convert a bool with `c ? 1 : 0`, or use `plotshape` for events.
3. Give every plot a distinct title and a colour; use `color.new` with a high transparency for fills.
4. Put reference levels in `hline`; put computed levels in `plot`.
5. Make lengths, multiples and levels inputs.

## 5. Examples

A band with a fill and a heavier basis:

```alphacharts
indicator("Channel", overlay=true)
len = input.int(20, "Length", minval=2, maxval=500)
mid = ta.sma(close, len)
dev = 2 * ta.stdev(close, len)
upper = plot(mid + dev, "Upper", color.blue)
lower = plot(mid - dev, "Lower", color.blue)
fill(upper, lower, color.new(color.blue, 90))
plot(mid, "Basis", color.orange, linewidth=2)
```

A histogram with its own colour below zero, and a user-set level:

```alphacharts
indicator("Momentum")
len = input.int(10, "Length", minval=1, maxval=200)
lvl = input.float(0, "Level")
plot(ta.mom(close, len), "Momentum", color.green, style=plot.style_histogram, color_down=color.red)
hline(lvl, "Level", color.gray, hline.style_dotted)
```

A user-chosen colour, and events as markers, one on a bool and one on a price:

```alphacharts
indicator("Breakouts", overlay=true)
tone = input.color(color.blue, "Line colour")
len = input.int(20, "Length", minval=2, maxval=500)
m = ta.sma(close, len)
plot(m, "Average", tone)
plotshape(ta.crossover(close, m), "Cross up", shape.triangleup, location.belowbar, color.green)
plotshape(ta.crossunder(close, m), "Cross down", shape.triangledown, location.abovebar, color.red)
plotshape(ta.highest(high, len) == high ? high : na, "New high", shape.circle, location.absolute, color.orange)
```

Not possible, with the diagnostics:

<!-- skill: invalid: argument "plot2" of fill must be a plot handle: p = plot(...) -->
```alphacharts
p = plot(close)
fill(p, close)
```

<!-- skill: invalid: plot() is only allowed as a statement at the top level of the script -->
```alphacharts
if close > open
    plot(close)
```

<!-- skill: invalid: argument "series" of plot must be a number series, got series bool -->
```alphacharts
plot(close > open)
```

## 6. Composition

Study outputs and recipe formulas are plotted here. Colour that follows a condition: colour-and-shading. Markers need
a bool or a price; combine a pattern study with a comparison, `ta.cdl_hammer() > 0`.

## 7. Constraints and correctness

- Line widths, styles, `offset`, titles and `hline` prices are literals or inputs, never series. Colours are constants or
  inputs, except the `cond ? colorA : colorB` form of a line's colour.
- `na` leaves a gap in a line and no bar in a histogram; it is never drawn as zero.
- Fills, markers and plots shifted back in time (negative `offset`) are drawn on the overlay and do not take part in autoscale.
- One pane per script; scale differences between plots in the same pane are the user's problem, so split by units.
- Titles name plots in the legend; keep them distinct.

## 8. Common mistakes

- `plot(close > open)`: bool is not a number.
- A per-bar colour on a histogram or area (`color = cond ? ...`): only line plots take it; a histogram has `color_down`.
- `plot` inside `if` or `for`: output is top-level only.
- `fill` between a histogram, an area or an `hline`: line plots only.
- `plotshape` of a price without `location.absolute`: a number needs the absolute location, a bool the bar locations.

## 9. Validation

The browser compiles the script and diagnostics come back. Then check that the pane matches the units, that every plot has
a title, and that a gapped pair share the flip bar. Axis: `indicator(..., scale="left")` puts the script on the left axis.

## 10. Related skills

[Core](../core/SKILL.md), [Script language](../script-language/SKILL.md), [Studies](../studies/SKILL.md), [Quant recipes](../quant-recipes/SKILL.md), [Troubleshooting](../troubleshooting/SKILL.md).
