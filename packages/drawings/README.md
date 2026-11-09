# @alphacharts/drawings

One chart plugin, `DrawingsPlugin`, owns every drawing on a chart. 90 tools.

```ts
import { createChart } from "@alphacharts/core";
import { DrawingsPlugin, ArrayBarSource, allTools } from "@alphacharts/drawings";

const source = new ArrayBarSource({ time, open, high, low, close, volume }); // columnar arrays you also pass to the series
const drawings = new DrawingsPlugin({ tools: allTools, source, interval: 60_000, magnet: "weak" });
chart.addPlugin(drawings);

drawings.setTool("trendLine");               // the user clicks/drags; Esc cancels
drawings.add({ tool: "fibRetracement", anchors: [{ time: t0, price: 120 }, { time: t1, price: 100 }] });
drawings.events.on("created", (d) => save(d));
chart.saveState();                           // includes drawings.toJSON(); restoreState() brings them back
```

Import named tools (`import { trendLine } from "@alphacharts/drawings"`) and pass
only those in `tools` to keep the rest out of the bundle; `allTools` is 28 KB gzip.

## What is anchored to what

Every drawing is JSON: a tool id, **anchors of (time, price)** (never a timeline
index, so prepending history or replacing data moves nothing), a style and
tool props. Every number a tool prints (Δ price, %, bars, Fib level prices, Gann
levels, risk/reward, quantity, VWAP, ratios) is arithmetic on the anchors and
goes through the chart's price formatter. A ratio over a zero move is "n/a",
a bar count without a `BarSource` is omitted; nothing is estimated. Invalid
drawings (wrong anchor count, long position with the stop above the entry,
non-finite numbers, a bar-reading tool without a source) throw with context.
A tool that throws while drawing is reported once through `onError` and
skipped; the other drawings keep drawing.

Two deliberate exceptions to "time + price": **anchored text/note** are
positioned on the pane (props `fx`, `fy`, fractions of its size) and stay put
while the chart pans; **Gann square fixed** is square in screen pixels.

## Machinery

- Tool API (`ToolDef`): anchor count, gesture (`drag`, `clicks`, `single`,
  `freehand`, variable-length with double-click/Enter to finish), `shapes()`
  in CSS px, `validate`, `constrain`, `handlePoints`. Drawing, hit-testing,
  box select and handles are generic over the returned `Shape`s.
- Styles: color, width, dash, fill, text colour/size/bold/italic, text,
  extend left/right (in time terms).
- Magnet `off | weak | strong`: snaps to the nearest bar's open/high/low/close
  (weak: within 16 px).
- Lock, hide, visibility per chart interval (`setInterval`), multi-select
  (shift-click, shift-drag box), copy/paste (at the pointer), duplicate (5
  bars later, same price), delete, z-order (front/back/forward/backward).
- Undo/redo: every mutation is a command with an exact inverse (add remembers
  its index, remove its indices, patch full snapshots, reorder both orders); a
  drag is one step.
- Templates and favourite tools in any core `LayoutStore`.
- Keyboard: Delete/Backspace, Esc, Ctrl/Cmd+Z, +Shift+Z (or +Y), +C, +V, +D, Enter.
- Events: `created`, `changed`, `removed`, `selected`, `tool`, `history`.
- JSON: `toJSON()` / `fromJSON()`, schema version 1; a newer version is refused,
  nothing is replaced unless the whole state validates.

## Tools (90)

| Family | Tools |
|---|---|
| lines (9) | trendLine, trendAngle, ray, infoLine, extendedLine, horizontalLine, horizontalRay, verticalLine, crossLine |
| channels (4) | parallelChannel, regressionTrendChannel, flatTopBottom, disjointChannel |
| pitchforks (5) | pitchfork, schiffPitchfork, modifiedSchiffPitchfork, insidePitchfork, pitchfan |
| fibonacci (10) | fibRetracement, fibExtension (trend-based), fibChannel, fibTimeZone, fibSpeedFan, fibTrendTime, fibCircles, fibSpiral, fibSpeedArcs, fibWedge |
| gann (4) | gannBox, gannSquareFixed, gannSquare, gannFan |
| shapes (12) | rectangle, rotatedRectangle, ellipse, circle, triangle, arc, curve, doubleCurve, polyline, path, brush, highlighter |
| annotations (19) | text, anchoredText, note, anchoredNote, callout, comment, priceLabel, priceNote, signpost, flagMark, arrow, arrowMarker, arrowMarkUp, arrowMarkDown, arrowMarkLeft, arrowMarkRight, pin, table (props.cells), icon (props.glyph) |
| position (6) | longPosition, shortPosition, forecast, projection, barsPattern, ghostFeed |
| measure (4) | dateRange, priceRange, dateAndPriceRange, sector |
| patterns (6) | xabcd, cypher, abcd, trianglePattern, threeDrives, headAndShoulders |
| elliott (5) | elliottImpulse, elliottCorrection, elliottTriangle, elliottDoubleCombo, elliottTripleCombo |
| cycles (3) | cyclicLines, timeCycles, sineLine |
| volume (3) | anchoredVwap, volumeProfile, anchoredVolumeProfile |

## Definitions this library chose

Where a tool has no single canonical definition, this is what is drawn (and tested):

- Fib retracement: level 0 at the end anchor, 1 at the start. Extension: `c + (b − a)·r`.
- Pitchforks: the median always runs to the midpoint of B and C. Schiff starts it at
  (A.x, mid-price of A and B); modified Schiff at the midpoint of A and B; inside keeps
  A as the origin and puts the outer tines through the midpoints of A–B and A–C.
- Gann fan: the n×m line has the 1×1 slope (anchor 0 → anchor 1) times n/m.
- Position quantity: `floor(accountSize · riskPercent / 100 / |entry − stop| / lot) · lot`,
  shown only when `accountSize` is given. A 1e-9 relative guard keeps 0.3 / 0.1 from
  flooring to 2.
- Anchored VWAP: Σ(typical·volume) / Σ(volume), typical = (H + L + C) / 3, from the bar at or
  before the anchor.
- **Volume profile is a bar-level approximation** (a bar's volume is spread over the rows its
  high–low range overlaps); the tool's label says so. A bar series has no traded-at-price data.
- Ghost feed: bars resampled (seeded, deterministic) from the bars between the first two
  anchors, chained from the third anchor's price. Bars pattern: those bars moved so the
  first close sits at the third anchor's price.
- Bar counts are positions in the bar sequence (`BarSource.logical`), fractional between bars.

## Not done / limits

- Text and note content is edited with `update(id, { style: { text } })`; there is no
  in-canvas text editor, no toolbar, no settings dialog.
- Handles exist for anchors only (a rectangle has two corner handles, not eight).
- Straight segments on a log or percent price scale are straight in pixels between the mapped
  anchors; level prices are still exact arithmetic on prices.
- The magnet and bar counts need a `BarSource`; the core has no public range iteration over
  series data, so the integrator hands one in (`ArrayBarSource` mirrors `setData/update/prepend`).
