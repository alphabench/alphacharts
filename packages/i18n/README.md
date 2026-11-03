# @alphacharts/i18n

Messages, locale formatting and text direction for AlphaCharts and the UI shell
built on it. Zero runtime dependencies (uses `Intl`).

## Use

```ts
import { createChart } from "@alphacharts/core";
import { createI18nAsync } from "@alphacharts/i18n";

const i18n = await createI18nAsync({ locale: "hi-IN" });   // loads the Hindi catalogue
const chart = createChart(el, { locale: i18n.locale, messages: i18n.chartMessages });

i18n.t("symbol.search.results", { count: 12 });             // "12 परिणाम"
i18n.on("localeChange", () => chart.applyOptions({ locale: i18n.locale, messages: i18n.chartMessages }));
await i18n.setLocale("en");                                  // loads on demand, then emits
```

`createI18n({ locale, fallback?, messages?, load?, onFallback?, nativeDigits? })`
is the synchronous form (English is built in; pass other catalogues in
`messages`). `createI18nAsync` fetches the built-in catalogue for the locale
first and lets `setLocale` load the others (`builtInLoaders`, one chunk each).

- `t(key, values)`: `key` is typed (`MessageKey`, the keys of `locales/en.ts`).
- Failure policy: a key outside the English schema always throws; a key missing
  from the active catalogue throws unless `fallback` was given (then
  `onFallback(key, locale, served)` fires for each message served from it);
  using a locale that was never loaded throws. Nothing falls back silently.
  Recommended: no `fallback` in development, `fallback: "en"` in production.
- `i18n.chartMessages` is the function the core's `messages` option takes.
- Bound formatters follow the active locale: `number`, `percent`, `volume`
  (suffixes from `unit.volume.*`, appended verbatim, so a word suffix carries
  its own leading space), `dateTime`, `relative`, `clock`, `list`.

### Message syntax

ICU subset, parsed by `icu.ts`: `{name}`, `{n, number}`,
`{n, plural, =0 {…} one {# bar} other {# bars}}` (with `offset:`),
`selectordinal`, `{k, select, a {…} other {…}}`; `'{'` quotes, `''` is an
apostrophe. A plural or select without `other` is a parse error.

## Formatting rules

Every helper in `format.ts` is a plain function of `(value, locale, options)`.

- Numbers are never altered. `formatNumber` writes exactly the digits the value
  has (no rounding unless you pass `fractionDigits` / `maxFractionDigits`) and
  `parseNumber(formatNumber(x, loc), loc) === x`, for Latin and native digits
  (fuzz-tested over 14 locales). A value needing more than 100 fraction digits
  throws rather than rounds. Non-finite values throw.
- Latin digits by default in every locale; `nativeDigits: true` switches to the
  language's own (Devanagari for hi, Arabic-Indic for ar, ...).
- Indian grouping (1,23,45,678) for `en-IN`, `hi-IN` and any Hindi locale;
  `formatVolume` writes K/L/Cr there and K/M/B/T elsewhere, matching the
  core's `volume` price format for the same locales (tested).
- Dates are Gregorian whatever the locale's default calendar, and always take
  an explicit time zone.
- `dir(locale)` is `"rtl"` for Arabic, Hebrew, Persian, Urdu (and Pashto,
  Sindhi, Uyghur, Yiddish, Dhivehi, Sorani; also any RTL script subtag).

## Catalogues

| locale | keys | status |
|---|---|---|
| en | the schema (`locales/en.ts`) | source strings |
| hi | complete, exactly English's keys | **needs native review** |

**The Hindi catalogue has not been reviewed by a native speaker.** It was
written to be natural Devanagari with Indian trading-app conventions (ओपन /
हाई / लो / क्लोज़ transliterated, indicator acronyms kept Latin, K / L / Cr
volume suffixes), but treat every string as a draft until a reviewer signs it
off. Arabic is not a catalogue: `apps/playground/src/ar-sample.ts` is a small
sample, also unreviewed, that exists only to prove right-to-left layout.

`test/catalogue.test.ts` fails if a catalogue lacks an English key, has an
extra key, has a message that does not parse, uses different placeholders (or
select options) than English, or is an untranslated copy; and it checks that
English's `chart.*` strings equal the core's built-in defaults. Add a locale by
creating `locales/<code>.ts` typed `Catalogue` (the compiler then enforces the
keys), adding it to `builtInLoaders` and to `CATALOGUES` in that test.

## Direction: a CSS guide for the UI shell

Set `lang` and `dir` on `<html>` (or the shell's root) from the active locale:

```ts
i18n.on("localeChange", (e) => { document.documentElement.lang = e.locale; document.documentElement.dir = e.dir; });
```

Then write shell CSS with logical properties only, so one stylesheet serves
both directions:

| physical (avoid) | logical (use) |
|---|---|
| `margin-left/right`, `padding-left/right` | `margin-inline-start/end`, `padding-inline-start/end` (shorthand `margin-inline`, `padding-inline`) |
| `margin-top/bottom` | `margin-block-start/end` |
| `left` / `right` | `inset-inline-start` / `inset-inline-end` |
| `top` / `bottom` | `inset-block-start` / `inset-block-end` |
| `width` / `height` | `inline-size` / `block-size` (`min-`/`max-` likewise) |
| `border-left`, `border-right` | `border-inline-start`, `border-inline-end` |
| `text-align: left/right` | `text-align: start/end` |
| `float: left/right` | `float: inline-start/inline-end` |
| `border-top-left-radius` | `border-start-start-radius` |

Also:

- Flex and grid reverse by themselves; do not reorder the DOM or use
  `row-reverse` for direction.
- Mirror directional icons (back/forward chevrons, undo/redo, "indent") with
  `[dir="rtl"] .icon-directional { transform: scaleX(-1) }`; do not mirror
  logos, clocks, play/pause, checkmarks or media controls.
- **Keep the chart left-to-right** (`dir="ltr"` on the chart's container, as
  the playground does): time runs left to right and price axes keep their
  sides in every locale. Chart text (readout, table, labels) is still
  translated and shaped by the browser.
- Numbers, symbols and tickers in running RTL text stay LTR; wrap them in
  `<bdi>` (or `unicode-bidi: isolate`) so punctuation does not jump.
- Do not rely on keyboard Left/Right meaning "back/forward" in RTL; the chart's
  key map is explicit and unaffected.

## Playground

`pnpm dev` then `?ex=i18n&locale=en|hi-IN|ar`. Shows the core readout and
screen-reader table, and a sample of shell strings, in the chosen locale and
direction; the buttons switch locale live. `bench/tests/i18n.spec.ts` snapshots
all three (chrome, webkit, firefox) and checks that switching locale updates
the aria label, table, live readout, `lang` and `dir`.

## Not here

The UI shell itself (this package only supplies its strings and formats);
pluralisation categories beyond what `Intl.PluralRules` knows; message
extraction tooling; locale detection (`navigator.language` handling is the
integrator's call); formatting of the core's axis tick numbers (the core still
writes prices itself, with Latin digits).
