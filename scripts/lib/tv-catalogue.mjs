// The TradingView catalogue the parity check measures against: what TradingView's chart offers, one row per
// item, mapped to the id of what alphacharts has. Sources: TradingView's Charting Library "Drawings List" and
// "Indicators List", and its support pages for drawing tools, chart types and the indicators dialog.
//
// A row is [tradingview name, our id | null, note?]. A null id is a gap, unless the section lists the name in
// its `cut` or `defer` set (a decision, with the reason beside it). Nothing here says an item exists: the
// checker (scripts/tv-parity.mjs) looks every id up in the built packages and fails on one that is not there.

/** Drawing tools, by TradingView's toolbar category. `ours` is a ToolDef id of @alphacharts/drawings. */
export const DRAWINGS = {
  "Trend": [
    ["Trendline", "trendLine"], ["Arrow", "arrow"], ["Ray", "ray"], ["Info line", "infoLine"], ["Extended line", "extendedLine"],
    ["Trend angle", "trendAngle"], ["Horizontal line", "horizontalLine"], ["Horizontal ray", "horizontalRay"], ["Vertical line", "verticalLine"], ["Crossline", "crossLine"],
    ["Parallel channel", "parallelChannel"], ["Regression trend", "regressionTrendChannel"], ["Flat top/bottom", "flatTopBottom"], ["Disjoint channel", "disjointChannel"],
    ["Anchored VWAP", "anchoredVwap"],
  ],
  "Gann and Fibonacci": [
    ["Fib retracement", "fibRetracement"], ["Trend-based fib extension", "fibExtension"], ["Pitchfork", "pitchfork"], ["Schiff pitchfork", "schiffPitchfork"],
    ["Modified Schiff pitchfork", "modifiedSchiffPitchfork"], ["Inside pitchfork", "insidePitchfork"], ["Fib channel", "fibChannel"], ["Fib time zone", "fibTimeZone"],
    ["Gann box", "gannBox"], ["Gann square fixed", "gannSquareFixed"], ["Gann square", "gannSquare"], ["Gann fan", "gannFan"],
    ["Fib speed resistance fan", "fibSpeedFan"], ["Trend-based fib time", "fibTrendTime"], ["Fib circles", "fibCircles"], ["Pitchfan", "pitchfan"],
    ["Fib spiral", "fibSpiral"], ["Fib speed resistance arcs", "fibSpeedArcs"], ["Fib wedge", "fibWedge"],
  ],
  "Geometric shapes": [
    ["Brush", "brush"], ["Highlighter", "highlighter"], ["Rectangle", "rectangle"], ["Circle", "circle"], ["Ellipse", "ellipse"], ["Path", "path"],
    ["Curve", "curve"], ["Polyline", "polyline"], ["Triangle", "triangle"], ["Rotated rectangle", "rotatedRectangle"], ["Arc", "arc"], ["Double curve", "doubleCurve"],
  ],
  "Annotation": [
    ["Text", "text"], ["Note", "note"], ["Anchored note", "anchoredNote"], ["Signpost", "signpost"], ["Callout", "callout"], ["Comment", "comment"],
    ["Price label", "priceLabel"], ["Price note", "priceNote"], ["Arrow marker", "arrowMarker"], ["Arrow mark left", "arrowMarkLeft"], ["Arrow mark right", "arrowMarkRight"],
    ["Arrow mark up", "arrowMarkUp"], ["Arrow mark down", "arrowMarkDown"], ["Flag mark", "flagMark"], ["Pin", "pin"], ["Table", "table"],
  ],
  "Chart patterns": [
    ["XABCD pattern", "xabcd"], ["Cypher pattern", "cypher"], ["ABCD pattern", "abcd"], ["Triangle pattern", "trianglePattern"], ["Three drives pattern", "threeDrives"],
    ["Head and shoulders", "headAndShoulders"], ["Elliott impulse wave (12345)", "elliottImpulse"], ["Elliott triangle wave (ABCDE)", "elliottTriangle"],
    ["Elliott triple combo wave (WXYXZ)", "elliottTripleCombo"], ["Elliott correction wave (ABC)", "elliottCorrection"], ["Elliott double combo wave (WXY)", "elliottDoubleCombo"],
    ["Cyclic lines", "cyclicLines"], ["Time cycles", "timeCycles"], ["Sine line", "sineLine"],
  ],
  "Predictions and measurement": [
    ["Long position", "longPosition"], ["Short position", "shortPosition"], ["Position forecast", "forecast"], ["Date range", "dateRange"], ["Price range", "priceRange"],
    ["Date and price range", "dateAndPriceRange"], ["Bars pattern", "barsPattern"], ["Ghost feed", "ghostFeed"], ["Sector", "sector"],
    ["Fixed range volume profile", "volumeProfile"], ["Anchored volume profile", "anchoredVolumeProfile"],
  ],
  "Content": [
    ["Image", null, "needs an image shape in the renderer"], ["Icons", "icon"], ["Stickers", null, "raster stickers need an image shape; glyphs are the icon tool"], ["Emojis", "icon", "an emoji is a glyph of the icon tool"], ["X posts and ideas", null],
  ],
};

/** Gaps that are a decision, not an omission. */
export const DRAWINGS_CUT = { "X posts and ideas": "needs a social platform behind it; not a charting-library concern (decided 9 Nov 2026)" };

/** Indicators of TradingView's built-in list. `ours` is a StudyDef id of @alphacharts/indicators. */
export const STUDIES = {
  "Moving averages": [
    ["Moving Average (simple)", "sma"], ["Moving Average Exponential", "ema"], ["Moving Average Weighted", "wma"], ["Volume Weighted Moving Average", "vwma"],
    ["Smoothed Moving Average", "smma"], ["Hull Moving Average", "hma"], ["Double EMA", "dema"], ["Triple EMA", "tema"], ["Arnaud Legoux Moving Average", "alma"],
    ["Least Squares Moving Average", "lsma"], ["McGinley Dynamic", "mcginley"], ["Guppy Multiple Moving Average", "guppy"], ["Moving Average Multiple", "ma-ribbon"],
    ["MA Cross", "ma-cross"], ["EMA Cross", "ma-cross"], ["MA with EMA Cross", "ma-ema-cross"], ["Moving Average Adaptive", "kama"], ["Moving Average Channel", "ma-channel"],
    ["Moving Average Double", null, "unverified against TradingView: dema is the double-exponential average, which may not be what its Double means"], ["Moving Average Triple", null, "unverified against TradingView: tema is the triple-exponential average, which may not be what its Triple means"], ["Moving Average Hamming", "hamming-ma", "textbook Hamming window; TradingView publishes no definition"], ["Linear Regression Curve", "linearreg"],
  ],
  "Momentum and oscillators": [
    ["Relative Strength Index", "rsi"], ["Stochastic", "stoch-tv"], ["Stochastic RSI", "stochrsi"], ["MACD", "macd"], ["Commodity Channel Index", "cci"],
    ["Rate Of Change", "roc"], ["Momentum", "mom"], ["Awesome Oscillator", "awesome"], ["Accelerator Oscillator", "accelerator"], ["Ultimate Oscillator", "ultosc"],
    ["Williams %R", "willr"], ["TRIX", "trix"], ["Know Sure Thing", "kst"], ["True Strength Indicator", "tsi"], ["Fisher Transform", "fisher"],
    ["Coppock Curve", "coppock"], ["Connors RSI", "connors-rsi"], ["Chande Momentum Oscillator", "cmo"], ["SMI Ergodic Indicator/Oscillator", "smi-ergodic"],
    ["Relative Vigor Index", "rvi-vigor"], ["Vortex Indicator", "vortex"], ["Aroon", "aroon"], ["Aroon Oscillator", "aroonosc"], ["Detrended Price Oscillator", "dpo"],
    ["Balance of Power", "bop"], ["Price Oscillator", "ppo"], ["Rank Correlation Index", "rank-corr"], ["Elder's Force Index", "elder-force"],
    ["Stochastic Momentum Index", "smi"], ["Trend Strength Index", "trend-strength"], ["Majority Rule", null, "no published definition found"],
  ],
  "Trend": [
    ["Average Directional Index", "adx"], ["Directional Movement", "adx", "the three DMI lines are the studies plus-di, minus-di and adx; dx is the single directional index"], ["SuperTrend", "supertrend"], ["Parabolic SAR", "sar"], ["Ichimoku Cloud", "ichimoku"],
    ["Chande Kroll Stop", "chande-kroll-stop"], ["Williams Alligator", "alligator"], ["Williams Fractal", "fractals"], ["Zig Zag", "zigzag"],
    ["Pivot Points Standard", "pivot-points"], ["Choppiness Index", "choppiness"], ["Chop Zone", null, "only community re-implementations with differing angle formulas; none is TradingView's"], ["Linear Regression Slope", "linearreg-slope"],
  ],
  "Volatility": [
    ["Average True Range", "atr"], ["Bollinger Bands", "bbands"], ["Bollinger Bands %B", "bbpb"], ["Bollinger Bands Width", "bbw"], ["Keltner Channels", "keltner"],
    ["Donchian Channels", "donchian"], ["Envelopes", "envelopes"], ["Price Channel", "price-channel"], ["Historical Volatility", "hist-vol"],
    ["Chaikin Volatility", "chaikin-vol"], ["Standard Deviation", "stddev"], ["Mass Index", "mass-index"], ["Relative Volatility Index", "rvi-volatility"],
    ["Standard Error", "std-error"], ["Standard Error Bands", null], ["Volatility Close-to-Close", "vol-close-to-close", "textbook estimator; TradingView publishes no definition"], ["Volatility Zero Trend Close-to-Close", "vol-zero-trend", "textbook estimator; TradingView publishes no definition"],
    ["Volatility O-H-L-C", "vol-garman-klass", "closest published OHLC estimator (also vol-parkinson, vol-rogers-satchell); TradingView publishes no definition"], ["Volatility Index", null], ["Average daily range", "adr"], ["Ulcer Index", "ulcer-index"],
  ],
  "Volume": [
    ["Volume", "volume"], ["On Balance Volume", "obv"], ["Accumulation/Distribution", "ad"], ["Chaikin Money Flow", "chaikin-mf"], ["Chaikin Oscillator", "adosc"],
    ["Money Flow Index", "mfi"], ["Ease of Movement", "eom"], ["Klinger Oscillator", "klinger"], ["Net Volume", "net-volume"], ["Price Volume Trend", "pvt"],
    ["Volume Oscillator", "volume-osc"], ["VWAP", "vwap"], ["Relative volume", "rvol", "ratio to a plain moving average, not the same-time-of-day variant"], ["24-hour volume", "volume-24h"],
    ["Session Volume Profile", null], ["Volume Profile Visible Range", null], ["Volume Profile Fixed Range", null],
  ],
  "Price and statistics": [
    ["Average Price", "avgprice"], ["Median Price", "medprice"], ["Typical Price", "typprice"], ["Correlation Coefficient", "correl"], ["Correlation - Log", null],
    ["Ratio", null], ["Spread", null], ["52 Week High/Low", null],
  ],
  "Market breadth": [
    ["Advance/Decline", null], ["Advance-decline line", null], ["Advance-decline ratio", null],
  ],
  "Auto drawings": [
    ["Auto fib retracement", "auto.fib-retracement"], ["Auto fib extension", "auto.fib-extension"], ["Auto pitchfork", "auto.pitchfork"], ["Auto trendlines", "auto.trendlines"], ["Auto key levels", "auto.key-levels"],
  ],
  "Candlestick patterns": [
    // TradingView's Patterns tab; alphacharts ships 61 cdl-* studies (TA-Lib's set). The list is not repeated here.
    ["Candlestick patterns (Patterns tab)", "cdl-engulfing", "61 cdl-* studies, not one row each"],
  ],
};

/** Gaps that need data alphacharts does not have, or are a product of their own (decided 9 Nov 2026). */
export const STUDIES_DEFER = {
  "Standard Error Bands": "no published definition found; not built rather than guessed",
  "Volatility Index": "no published definition found; not built rather than guessed",
  "Session Volume Profile": "a profile is not a time series: use the volumeProfile and anchoredVolumeProfile drawings or the orderflow package",
  "Volume Profile Visible Range": "a profile is not a time series: use the volumeProfile and anchoredVolumeProfile drawings or the orderflow package",
  "Volume Profile Fixed Range": "a profile is not a time series: the volumeProfile drawing covers the fixed range",
  "Majority Rule": "no published definition found; not built rather than guessed",
  "Chop Zone": "only community re-implementations with differing angle formulas; none is TradingView's",
  "Advance/Decline": "needs an exchange breadth feed the host owns",
  "Advance-decline line": "needs an exchange breadth feed the host owns",
  "Advance-decline ratio": "needs an exchange breadth feed the host owns",
  "52 Week High/Low": "needs a year of daily bars from the host; a study on daily data can do it",
  "Ratio": "two-symbol study; belongs with compare/spread (phase 5)",
  "Spread": "two-symbol study; belongs with compare/spread (phase 5)",
  "Correlation - Log": "two-symbol study; belongs with compare/spread (phase 5)",
};

/** Chart types of TradingView's menu. `ours` is a ChartTypeId of packages/ui/src/model/chartTypes.ts. */
/** Chart types left out by decision, with the reason. */
export const CHART_TYPES_DEFER = {
  "Time price opportunity": "the orderflow package builds it from a trades feed (like the footprint); the shell does not offer it",
  "Session volume profile": "the orderflow package builds it from a trades feed (like the footprint); the shell does not offer it",
  "Volume candles": "needs per-bar volume in the series data model, which holds only OHLC",
  "Spread": "two-symbol series; belongs with compare",
};

export const CHART_TYPES = [
  ["Bars", "bars"], ["Candles", "candles"], ["Hollow candles", "hollowCandles", "a rising bar is hollow and the colour follows close vs open; TradingView colours by close vs the previous close and its wick treatment is not verified"], ["Volume candles", null], ["Line", "line"], ["Line with markers", "lineMarkers"],
  ["Step line", "stepLine"], ["Area", "area"], ["HLC area", "hlcArea"], ["Baseline", "baseline"], ["Columns", "columns"], ["High-low", "hiLo"],
  ["Heikin Ashi", "heikinAshi"], ["Renko", "renko"], ["Line break", "lineBreak"], ["Kagi", "kagi"], ["Point and figure", "pointFigure"], ["Range", "rangeBars"],
  ["Volume footprint", "footprint"], ["Time price opportunity", null], ["Session volume profile", null], ["Spread", null],
];

/** Chart features. `ours` is a path the checker greps for (a file and a word), or null for a gap. */
export const FEATURES = [
  // [name, null | [file under packages/, a word that must appear in it], note]
  ["Price scale: log", ["core/src/scale/price-scale.ts", '"log"']],
  ["Price scale: percent", ["core/src/scale/price-scale.ts", '"percent"']],
  ["Price scale: indexed to 100", ["core/src/scale/price-scale.ts", '"indexed"']],
  ["Magnet: weak and strong", ["drawings/src/plugin.ts", "MagnetMode"]],
  ["Magnet: snap to indicators", ["drawings/src/plugin.ts", "snapValues"]],
  ["Stay in drawing mode", ["ui/src/ui/drawingbar.tsx", "keepDrawing"]],
  ["Lock all drawings", ["ui/src/ui/drawingbar.tsx", "toggleLockAll"]],
  ["Hide all drawings", ["ui/src/ui/drawingbar.tsx", "toggleHideAll"]],
  ["Hide indicators", ["ui/src/engine/app.ts", "toggleHideIndicators"]],
  ["Remove drawings by type", ["ui/src/engine/app.ts", "removeDrawingsOfTool"]],
  ["Favourite tools (pinned in the drawing bar)", ["ui/src/ui/drawingbar.tsx", "favouriteTools"]],
  ["Cursor modes: cross and arrow", ["ui/src/engine/app.ts", "setCursorMode"]],
  ["Cursor modes: dot, demonstration, magic, eraser", null],
  ["Floating, draggable favourites bar", null],
  ["Sync drawings across layouts", ["ui/src/types.ts", '"drawings"']],
  ["Drawing templates", ["drawings/src/index.ts", "TemplateStore"]],
  ["Undo/redo for drawings", ["drawings/src/index.ts", "History"]],
  ["Undo/redo for indicators", ["ui/src/engine/instance.ts", "undoStudy"]],
  ["Per-timeframe drawing visibility", ["drawings/src/types.ts", "intervals"]],
  ["Drawing settings dialog", ["ui/src/ui/dialog-drawing.tsx", "DrawingDialog"]],
  ["Indicator picker with search and favourites", ["ui/src/ui/dialogs-study.tsx", "IndicatorsDialog"]],
  ["Indicator picker: Patterns tab", ["ui/src/model/studies.ts", '"pattern"']],
  ["Indicator picker: Profiles tab", null],
  ["Indicator picker: Strategies and Options tabs", null],
  ["Indicator picker: My scripts", ["ui/src/engine/app.ts", "saveScript"]],
  ["Natural-language indicator prompt in the shell", ["ui/src/ui/dialogs-study.tsx", "assistant-prompt"]],
  ["Third-party tool adapters", ["extend/src/registry.ts", "createAdapterRegistry"]],
  ["Object tree (indicators and drawings in one list)", ["ui/src/ui/dialog-objects.tsx", "ObjectsDialog"]],
  ["Data window (values at the crosshair)", ["ui/src/ui/legend.tsx", "Legend"]],
  ["Compare / overlay symbol", ["ui/src/engine/app.ts", "\"compare\""]],
  ["Multi-chart layouts", ["ui/src/model/grids.ts", "GRID_PRESETS"]],
  ["Alerts", ["alerts/src/index.ts", "AlertsPlugin"]],
  ["Snapshot", ["ui/src/engine/app.ts", "onSnapshot"]],
  ["Replay", null],
  ["Strategy tester", null],
  ["Options analytics tab", null],
  ["Fundamentals", null],
];

/** Features outside this library by decision (9 Nov 2026): each needs a backend or a simulator a charting library does not own. */
export const FEATURES_DEFER = {
  "Replay": "needs a datafeed that can serve history as of a time; decided in a later phase",
  "Strategy tester": "out of scope for the library: order-simulation semantics belong to the host",
  "Options analytics tab": "out of scope for the library: options analytics need a chain and greeks feed the host owns",
  "Fundamentals": "out of scope for the library: needs a fundamentals dataset the host owns",
  "Indicator picker: Strategies and Options tabs": "out of scope for the library: they need the strategy tester and options analytics",
  "Indicator picker: Profiles tab": "volume profiles are the volumeProfile and anchoredVolumeProfile drawings and the orderflow package; the picker lists studies only",
  "Cursor modes: dot, demonstration, magic, eraser": "pointer overlays and a click-to-erase mode are not built",
  "Floating, draggable favourites bar": "favourites are pinned in the drawing bar instead",
};
