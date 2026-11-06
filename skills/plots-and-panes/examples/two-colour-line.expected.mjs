// The two plots share the bar where the direction flips, so the line has no one-bar hole.
const NA = Number.NaN;
export const inputs = { len: 10 };

export function expected(bars, { len }) {
  const n = bars.close.length;
  const m = Array.from({ length: n }, (_, i) => (i < len - 1 ? NA : bars.close.slice(i - len + 1, i + 1).reduce((a, b) => a + b, 0) / len));
  // a comparison with na is false, so a bar is "rising" only when both averages exist and the average went up
  const rising = m.map((x, i) => i > 0 && !Number.isNaN(x) && !Number.isNaN(m[i - 1]) && x > m[i - 1]);
  const was = (i) => (i > 0 ? rising[i - 1] : false);
  return {
    Rising: m.map((x, i) => (rising[i] || was(i) ? x : NA)),
    Falling: m.map((x, i) => (!rising[i] || !was(i) ? x : NA)),
  };
}
