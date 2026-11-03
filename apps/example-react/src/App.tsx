import { Chart, Dashboard, DashboardCell, PriceLine, Series, SyncGroup, useChart } from "@alphacharts/react";
import type { OhlcBar, ValuePoint } from "@alphacharts/core";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { CELLS, cellData, history, Stream } from "../../example-shared/data.js";
import { autoTicks, track } from "../../example-shared/track.js";

const data = history();
const cells = CELLS.map((c) => ({ ...c, data: cellData(c) }));
const last = data.candles[data.candles.length - 1]!;

/** Records the enclosing chart for the browser tests. */
function Track() {
  const chart = useChart();
  useEffect(() => track(chart), [chart]);
  return null;
}

export function App() {
  const [bar, setBar] = useState<OhlcBar>();
  const [volume, setVolume] = useState<ValuePoint>();
  const [ticks, setTicks] = useState(0);
  const stream = useRef<Stream>(null);

  useEffect(() => {
    const s = (stream.current = new Stream(last));
    let n = 0;
    const tick = () => {
      const t = s.next();
      // One tick per commit: the live bar goes through <Series update>, one series.update() each.
      flushSync(() => {
        setBar(t.bar);
        setVolume(t.volume);
        setTicks(++n);
      });
    };
    window.__tick = async (k) => {
      for (let i = 0; i < k; i++) tick();
    };
    const id = autoTicks() ? setInterval(tick, 100) : undefined;
    return () => clearInterval(id);
  }, []);

  return (
    <div className="page">
      <header>
        <b>React</b>
        <span>candles + volume, live ticks, price line, synced dashboard</span>
        <span className="stat" id="stat">{ticks} ticks</span>
      </header>
      <section className="main">
        <Chart className="fill" options={{ theme: "dark", timeZone: "UTC" }}>
          <Track />
          <Series type="candles" data={data.candles} update={bar} options={{ title: "SYNTH", priceFormat: { type: "price", minMove: 0.05 } }}>
            <PriceLine price={last.close * 0.9985} color="#f7a600" title="target" />
          </Series>
          <Series
            type="histogram"
            data={data.volume}
            update={volume}
            options={{ priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false, priceFormat: { type: "volume" } }}
            priceScale={{ marginTop: 0.8, marginBottom: 0 }}
          />
        </Chart>
      </section>
      <section className="dash">
        <Dashboard className="fill cells">
          <SyncGroup>
            {cells.map((c) => (
              <DashboardCell key={c.id} options={{ theme: "dark", timeZone: "UTC" }}>
                <Track />
                <Series type={c.type} data={c.data as never} options={{ title: c.id, priceFormat: { type: "price", minMove: 0.05 } }} />
              </DashboardCell>
            ))}
          </SyncGroup>
        </Dashboard>
      </section>
    </div>
  );
}
