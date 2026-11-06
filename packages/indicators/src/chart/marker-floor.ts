// Which marks of a markers plot are kept when it asks for only the most recent
// ones (`plotshape(cond, last=3)` keeps the last three marked bars,
// `within=100` the marks on the final hundred). Decided from the finished
// column each time marks are drawn, never stored, so a tick, an appended bar
// and a batch over all the bars give the same marks: a mark that falls out of
// the last N goes when a newer one arrives, and the live bar's mark comes and
// goes with its condition, as the condition does.

/** A mark is a present value (not NaN), and for a text mark a non-zero one. */
const marked = (v: number | undefined, text: boolean) => v !== undefined && v === v && !(text && v === 0);

/**
 * The first bar index whose mark is kept, over bars `[0, n)` of `col`: marks at
 * or after it are drawn, those before are not. 0 when the plot asks for no limit.
 */
export function markerFloor(col: ArrayLike<number>, n: number, o: { last?: number; within?: number; text?: boolean }): number {
  let floor = o.within !== undefined ? Math.max(0, n - o.within) : 0;
  if (o.last !== undefined) {
    let seen = 0;
    for (let j = n - 1; j >= floor; j--) {
      if (!marked(col[j], !!o.text)) continue;
      if (++seen === o.last) return j;
    }
  }
  return floor;
}
