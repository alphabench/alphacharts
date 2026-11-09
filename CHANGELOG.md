# Changelog

## Unreleased

Theming (shadcn):
- `core`: **colour slots**: a colour may name a role (`"chart-1"` … `"chart-5"`, `"chart-up"`, `"chart-down"`, `"muted"`, `"foreground"`, optionally `"/0.35"`) and draws with the chart's current theme, live. Series options, price lines, markers, drawing styles and study plots accept them; `resolveColor`, `resolveColors`, `slotAlpha`, `paletteOf`, `isColorSlot`. `Theme.palette` (shadcn's `--chart-1` … `--chart-5`, read by `themeFromCss`), a `themeChange` chart event, and `theme` on `PluginApi` and `PaneView`.
- `core`: the CSS overrides are named after the token they override: `--ac-foreground`, `--ac-muted-foreground`, `--ac-primary`, `--ac-chart-up`, `--ac-chart-down`, `--ac-font-sans` (they were `--ac-text`, `--ac-text-muted`, `--ac-accent`, `--ac-up`, `--ac-down`, `--ac-font-family`; unreleased). `LUMA_TOKENS` holds every Luma token, light and dark (dark on pure black). A price line's default colour is `"muted"` (it was a fixed grey).
- `indicators`, `drawings`, `orderflow`, `alerts`, `script`, `extend`: no TradingView colour is left. Study defaults (`COLORS`), Fibonacci levels, positions, arrow marks, volume and order-flow profiles, script plots without a colour and automatic trend lines use colour slots, so they take the page's chart palette and up/down colours. **Indicator colours change**: the default palette is Luma's neutral greys unless the page defines `--chart-1` … `--chart-5`.
- `plot`: `theme: "inherit"` and `plotThemeFromCss(el)`: the page's variables at the plot, followed live; the tooltip is shadcn's popover. The default categorical palette is the core theme's (Luma greys).
- `ui` (private): rebuilt on shadcn's Luma recipes (buttons, toggles, toggle groups, menus, dialogs and a bottom drawer, command palettes for symbols, intervals and indicators, tabs, fields, a listbox select, checkbox, switch, tooltips, Sonner-style toasts). The shell reads every shadcn token live through its shadow root; `--ac-<token>` overrides one; every element has `data-slot`/`part`; new options `styles` and `stylesheet: "none"`, and `@alphacharts/ui/styles.css`. Every drawing tool has its own icon.

Quantitative checks and fixes:
- `indicators`: **Woodie pivot points follow TradingView's definition**: the pivot is `(H + L + 2 * current open) / 4` (it used the previous close) and `R3 = H + 2 (P - L)`, `S3 = L - 2 (H - P)` (they were `H + 2 (H - L)` and `L - 2 (H - L)`). R4 and S4 move with them. Levels differ from earlier releases for `kind: "woodie"`.
- `indicators`: `test/reference.test.ts`: 62 studies checked bar for bar (1e-9, same warm-up) against independent numpy implementations (`scripts/gen_reference.py`, `pnpm fixtures:reference`), among them every pivot kind.
- `core`: the price formatter no longer prints `-0.00` (or `-0`) for a value that rounds to zero; `test/resample-reference.test.ts` compares the Resampler with pandas (minutes to quarters, UTC and Asia/Kolkata, gappy bars).
- `chart-types`: `barSource = "close"` on Renko, Kagi, Point and Figure and Range bars reads closes only (TradingView's default source); the default stays the OHLC path.
- `orderflow`: the value area is tested against the written-out market-profile rule on 400 random volume columns.
- `ui`: the snapshot image carries a header (symbol, interval, last bar, indicators; `snapshotHeader: false` turns it off), a new button copies the image to the clipboard, and `onSnapshot` receives `"download"` or `"copy"` as its second argument.

- `scripts/tv-parity.mjs` (`pnpm gen:parity`, `pnpm check:parity`): measures the drawing tools, studies, chart types and chart features against TradingView's catalogue (`scripts/lib/tv-catalogue.mjs`) and writes `docs/PARITY.md`.
- `indicators`: sixteen studies (211 to 227; the README lists them), among them `hamming-ma` and the volatility estimators `vol-close-to-close`, `vol-zero-trend`, `vol-parkinson`, `vol-garman-klass`, `vol-rogers-satchell`: `chaikin-vol`, `std-error`, `ulcer-index`, `smi` (Stochastic Momentum Index), `trend-strength` (correlation of closes with bar position) and `rvol` (volume over its simple average). Hand-checked fixtures plus a plain-JS recomputation in `test/tv-stat.test.ts`.
- `drawings`: eight new tools (82 to 90): `trendAngle`, `sector`, `arrowMarkLeft`, `arrowMarkRight`, `pin`, `table` (`props.cells`), `icon` (`props.glyph`, any text or emoji; the host chooses which it offers) and `anchoredVolumeProfile`. Not yet: image and raster stickers (they need an image shape in the renderer).
- `drawings`: undo history can be ordered against a host's own (`DrawingsOptions.clock`, `nextUndoAt`, `nextRedoAt`) and Ctrl/Cmd+Z can be routed to the host (`onUndo`, `onRedo`); `ui` uses both so one undo covers indicators and drawings in the order they happened.
- `drawings`: `DrawingsPlugin.addMany(specs)` adds several drawings as one undo step; all are valid or none is added (no history entry, no event).
- `extend` (new, private): adapters for host-supplied drawing tools, studies, analyses and a natural-language assistant (`createAdapterRegistry`, `runAssistant`, `runAnalysis`). The assistant's script is compiled by the host before it is returned; no model, vendor or endpoint is built in.
- `ui` (private): `assistant` option, the "describe an indicator" box in the Indicators dialog. The host's `ask` returns a script that compiles; the shell shows it and runs it only on Add (through `scriptRunner`, which `assistant` requires). Drawing tools the host adds through `tools` that no built-in group holds appear in a Custom group of the drawing bar.
- README: the known-limits line saying log, percent and indexed price scales are not built was stale; they are (`PriceScaleMode`).

## 0.1.1 (core, indicators, drawings) and 0.1.0 (script, report)

New packages: `@alphacharts/script` (the indicator language) and `@alphacharts/report` (opt-in crash reports; no default server, you pass your own PostHog `endpoint` and `key`).

- `core` 0.1.1: an internal fault emitter used by the optional `@alphacharts/report` (`@alphacharts/core/internal`).
- `core`: per-bar colour for candles and bars (`Series.setBarColors`, `clearBarColors`, `OhlcBar.color`, `ColumnarOhlc.color`), per-segment colour on lines, the `BarShading` primitive.
- `indicators`: studies read outside series (`Study.setFeed`, `pushFeedBar`), `barcolor` / `bgcolor` plots, `colorBy` on lines, `StudyDef.scale`.
- `script`: `outside(symbol, field, timeframe)`, `barcolor`, `bgcolor`, a colour that depends on the bar, `indicator(scale=)`, `plan.dependencies`, `handle.setSeries` / `pushSeries`.
- `drawings`: `readOnly` option: a plugin the host drives by code takes no press, key or cursor.
- `script`, `indicators`: `plotshape(..., last=N, within=M)` keeps only the newest marks; `markerFloor`.
- `script`, `indicators`: `plot` and `plotshape` `offset=` takes an int input expression known when the study is built (`offset=-right`); `PlotDef.offset` may be a function of the study's inputs. The swing and higher-high recipes mark the swing bar itself.
- `skills`: `colour-and-shading` and `outside-series`.
- `indicators` 0.1.1 needs `@alphacharts/core` ^0.1.1 (peer). Behaviour: `atr`/`natr` are Wilder's (bar 0's true range is high - low), `rsi` is 100 on an undefined opening. New: `stdev`/`variance` take `sample`, `bars_per_year`.

## 0.1.0

First public release. Packages: `core`, `plot`, `react`, `vue`, `svelte`, `i18n`, `chart-types`, `orderflow`,
`indicators`, `wasm`, `drawings`, `alerts`. The API may change before 1.0.
