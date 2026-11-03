// A series' columnar store is public so study packages can read bars without
// copying them into objects.
import { describe, expect, it } from "vitest";
import { DataModel, COL_C } from "../src/data/model.js";
import { Series, type SeriesHost } from "../src/chart/series.js";
import { DARK } from "../src/chart/theme.js";

describe("Series.data", () => {
  it("exposes the columns the series was filled with", () => {
    const m = new DataModel();
    const data = m.add("ohlc");
    const host = { locale: undefined } as unknown as SeriesHost;
    const s = new Series("candles", data, host, {}, DARK);
    m.setData(data, [{ time: 1, open: 1, high: 3, low: 0.5, close: 2 }, { time: 2, open: 2, high: 4, low: 1, close: 3 }]);
    const st = s.data.store;
    expect(st.length).toBe(2);
    expect(st.cols[COL_C]![st.pos(st.first + 1)]).toBe(3);
  });
});
