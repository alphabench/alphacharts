# @alphacharts/indicators

Technical studies for alphacharts: a typed study model, an incremental engine over the core's
columnar data, a Web Worker runner, chart integration through the core plugin API, and
210 studies (TA-Lib's catalogue plus TradingView's built-ins).

## Use

```ts
import { addStudy } from "@alphacharts/indicators";
import { rsi, macd, bbands } from "@alphacharts/indicators/studies"; // import only what you use

const bb = addStudy(chart, candles, bbands, { length: 20 });               // overlay on the candles' pane
const r = addStudy(chart, candles, rsi, { length: 14 });                   // own pane
addStudy(chart, candles, "obv", {}, { volume: volumeSeries });            // by id: needs registerAllStudies()
r.setInputs({ length: 21 }); r.setVisible(false); r.remove();              // re-parameterise, hide, remove
chart.saveState(); chart.restoreState(saved);                               // studies are in the layout (installStudies(chart) first on a fresh chart)
```

`addStudy` throws on an unknown input, a value outside min/max/step type, or a source that lacks what the
study needs (volume, OHLC). `await study.ready()` resolves when the last computation is on the chart.
Subpaths: `.` (engine, runner, plugin), `./studies` (every study as a named export), `./all`
(`ALL_STUDIES`, `registerAllStudies`), `./worker` (worker entry). Studies are plain objects in group modules
(`src/studies/*.ts`), so a bundler keeps only those imported (one module per family rather than per study).

## How it works

- **Model** (`src/types.ts`): `StudyDef { id, name, family, inputs (int/float/bool/source/select with default, min, max,
  step, options), needs, pane: overlay|new, columns, plots (line, histogram, area, band, fill, hline, markers, zigzag),
  build }`. `build(graph, params)` declares nodes and returns the output columns.
- **Engine** (`src/engine/graph.ts`): every value lives in a Float64Array column; a node writes only bar `i` and reads
  `<= i` of its inputs and `<= i-1` of its own columns. So one code path is the batch (`run(0, n)`), an appended bar
  (`run(n, n+1)`) and a tick revision (re-`run(n-1, n)`): per-bar cost does not depend on the series length
  (O(1) for recursive and running-sum nodes, O(period) for window scans), and a revision recomputes from committed
  state. Warm-up is NaN; absent values never become 0 (except where TA-Lib defines 0, noted in the study's reference).
  setData/prepend on the source recompute fully.
- **Runner** (`src/runner.ts`): `createRunner(ids)` gives a `WorkerRunner` (arrays transferred, chunks of 65,536
  bars so a `cancel` is serviced within a chunk; protocol documented in the file header) or the `InlineRunner`
  when Workers are unavailable. The worker returns every graph column; the main thread adopts them and keeps
  streaming ticks. Studies not built in (defined at runtime) run inline (`canRun`).
- **Chart integration** (`src/chart/studies.ts`): one core series per drawn plot (pane = the source's for overlays,
  the lowest free pane otherwise), the rest drawn on the overlay (fills, markers, ZigZag, lines shifted back in time
  or joined across gaps; these do not take part in autoscale). Layout JSON is keyed by study instance id.
- **WASM** (`src/engine/kernels.ts`, `enableWasm()` from `src/wasm.ts`): optional batch kernels from `@alphacharts/wasm`
  for running sum, variance/stddev, rolling highest/lowest (+ bars) and linear regression, the kernels that won at 1M
  and 10M bars in its benchmark. They are bit-identical to the JS loops (test/wasm.test.ts runs every study both
  ways). Not used: EMA/RMA/WMA (no win), chunked runs (worker), series under 4,096 bars.

## Verification

Run `pnpm -C packages/indicators test`.
- **TA-Lib** (`test/talib.test.ts`): fixtures generated offline by `scripts/gen_fixtures.py` (TA-Lib 0.8.2 in a
  Python venv, see below) from `fixtures/cases/*.json` on a seeded 400-bar OHLCV set (`fixtures/dataset.json`;
  3,000 bars of mixed candle shapes for the patterns). Compared at 1e-9 relative (+1e-12 absolute floor), NaN positions
  must be identical; patterns are integers compared exactly. Case flags: `lead` (our study has valid values earlier
  than TA-Lib's first output, e.g. MACD's line before its signal), `abs` (a value that is numerical noise around 0).
- **TradingView-only** studies: hand-computed fixtures with the arithmetic in the test comments, plus invariants
  (`test/tv-*.test.ts`).
- **Incremental == batch** (`test/incremental.test.ts`): every study, seeded random appends with random last-bar
  revisions, exact equality.
- Runner protocol, worker/inline parity and cancellation: `test/runner.test.ts`. Browser: `bench/tests/indicators.spec.ts`.

Where a study is not TA-Lib's arithmetic it says so in its `reference` field. Known differences:
MACD/APO/PPO seed like TA-Lib (fast EMA at the slow EMA's first bar), TradingView seeds at bar 0 (gap < 1e-9 after
~150 bars); `cmo` defaults to TradingView's window-sum form (`method: "wilder"` is TA-Lib's); the linear regression
studies are TA-Lib's (checked against numpy polyfit); `ht-trendmode` reports TA-Lib's 0 inside its warm-up;
`mavp` (TA-Lib's moving average with a per-bar period series) is not implemented: it needs a second input series.
Not checked against TradingView itself (no access): the TradingView-only studies follow the definitions cited in their
`reference` field; pivot formulas, Klinger, Schaff, the Relative Volatility form and Fractals tie rules were written
from memory of TradingView's scripts and are verified only by the hand-computed tests.

## Studies (210)

- **Overlap (TA-Lib + MAs, bands, SAR)** (17): `sma`, `ema`, `wma`, `dema`, `tema`, `trima`, `kama`, `t3`, `ma`, `bbands`, `bbpb`, `bbw`, `midpoint`, `midprice`, `mama`, `sar`, `sarext`
- **Momentum (TA-Lib)** (30): `rsi`, `cmo`, `mom`, `roc`, `rocp`, `rocr`, `rocr100`, `trix`, `apo`, `ppo`, `macd`, `macdfix`, `macdext`, `stoch`, `stochf`, `stochrsi`, `willr`, `cci`, `bop`, `mfi`, `ultosc`, `aroon`, `aroonosc`, `adx`, `adxr`, `dx`, `plus-di`, `minus-di`, `plus-dm`, `minus-dm`
- **Volume (TA-Lib)** (3): `ad`, `adosc`, `obv`
- **Volatility (TA-Lib)** (3): `trange`, `atr`, `natr`
- **Price transforms (TA-Lib)** (4): `avgprice`, `medprice`, `typprice`, `wclprice`
- **Statistics (TA-Lib)** (9): `linearreg`, `linearreg-slope`, `linearreg-intercept`, `linearreg-angle`, `tsf`, `stddev`, `var`, `correl`, `beta`
- **Math transforms and operators (TA-Lib)** (26): `acos`, `asin`, `atan`, `ceil`, `cos`, `cosh`, `exp`, `floor`, `ln`, `log10`, `sin`, `sinh`, `sqrt`, `tan`, `tanh`, `add`, `sub`, `mult`, `div`, `max`, `min`, `sum`, `maxindex`, `minindex`, `minmax`, `minmaxindex`
- **Cycle / Hilbert (TA-Lib)** (6): `ht-dcperiod`, `ht-dcphase`, `ht-phasor`, `ht-sine`, `ht-trendline`, `ht-trendmode`
- **TradingView-only** (51): `smma`, `vwma`, `hma`, `alma`, `lsma`, `mcginley`, `ma-ribbon`, `ma-cross`, `envelopes`, `keltner`, `donchian`, `price-channel`, `chande-kroll-stop`, `linreg-channel`, `median`, `ichimoku`, `supertrend`, `alligator`, `fractals`, `zigzag`, `fisher`, `kst`, `tsi`, `vortex`, `coppock`, `connors-rsi`, `choppiness`, `rvi-vigor`, `rvi-volatility`, `smi-ergodic`, `rank-corr`, `bull-bear-power`, `awesome`, `accelerator`, `mass-index`, `dpo`, `schaff-tc`, `stoch-tv`, `volume`, `volume-osc`, `pvt`, `net-volume`, `elder-force`, `eom`, `chaikin-mf`, `klinger`, `vwap`, `anchored-vwap`, `pivot-points`, `hist-vol`, `adr`
- **Candlestick patterns (TA-Lib CDL*)** (61): `cdl-<name>` for every TA-Lib pattern, e.g. `cdl-2crows`, `cdl-3blackcrows`, `cdl-3inside`, `cdl-3linestrike`, `cdl-3outside`, ...

## Regenerating the TA-Lib fixtures

Only needed when a case changes. From `packages/indicators`:

```
python -m venv .venv && . .venv/bin/activate
pip install TA-Lib numpy        # TA-Lib needs the C library (brew install ta-lib)
pnpm fixtures                   # python scripts/gen_fixtures.py [group ...]
python scripts/gen_cdl_dataset.py   # only to rebuild fixtures/dataset-cdl.json
```

The fixtures are TA-Lib's output (BSD licence), see `NOTICE` at the repository root.
