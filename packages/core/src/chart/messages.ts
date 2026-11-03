// User-visible strings the chart itself produces (aria labels, the
// screen-reader readout and table, the countdown's day suffix). They go
// through one injectable function so a UI shell can translate them; the
// English defaults here are what the chart says without one.
//
// `{name}` placeholders are filled by the chart. A custom function receives
// the key and the raw values and returns the finished text; it should throw
// on a key it does not know rather than return something wrong.

export const CHART_MESSAGES = {
  "chart.ariaLabel": "Price chart",
  "chart.readout.ohlc": "{name} open {open} high {high} low {low} close {close}",
  "chart.readout.value": "{name} {value}",
  "chart.table.time": "Time",
  "chart.table.open": "Open",
  "chart.table.high": "High",
  "chart.table.low": "Low",
  "chart.table.close": "Close",
  "chart.table.value": "Value",
  "chart.table.caption": "{label}: {name}, visible bars, newest first",
  "chart.countdown.days": "{n}d",
} as const;

export type ChartMessageKey = keyof typeof CHART_MESSAGES;
export type ChartMessageValues = Readonly<Record<string, string | number>>;
export type ChartMessages = (key: ChartMessageKey, values?: ChartMessageValues) => string;

/** English defaults: substitutes `{name}` placeholders, throws on an unknown key. */
export const defaultMessages: ChartMessages = (key, values = {}) => {
  const template = CHART_MESSAGES[key] as string | undefined;
  if (template === undefined) throw new Error(`alphacharts: unknown chart message key "${key}"`);
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = values[name];
    if (v === undefined) throw new Error(`alphacharts: chart message "${key}" needs a value for "${name}"`);
    return String(v);
  });
};
