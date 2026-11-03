import type { Chart as CoreChart, Dashboard as CoreDashboard, Series as CoreSeries, SeriesType, SyncGroup as CoreSyncGroup } from "@alphacharts/core";
import { getContext, setContext } from "svelte";

/**
 * A reactive cell holding a core object. `$state.raw`: core objects are
 * class instances with their own state and must never be proxied.
 */
export class Cell<T> {
  current: T | null = $state.raw(null);
}

const CHART = Symbol("alphacharts.chart");
const SERIES = Symbol("alphacharts.series");
const DASHBOARD = Symbol("alphacharts.dashboard");
const SYNC = Symbol("alphacharts.sync");

export const provideChart = (): Cell<CoreChart> => setContext(CHART, new Cell<CoreChart>());
export const provideSeries = (): Cell<CoreSeries<SeriesType>> => setContext(SERIES, new Cell<CoreSeries<SeriesType>>());
export const provideDashboard = (): Cell<CoreDashboard> => setContext(DASHBOARD, new Cell<CoreDashboard>());
export const provideSync = (group: { readonly current: CoreSyncGroup }): void => void setContext(SYNC, group);

export const chartCell = (): Cell<CoreChart> | undefined => getContext(CHART);
export const seriesCell = (): Cell<CoreSeries<SeriesType>> | undefined => getContext(SERIES);
export const dashboardCell = (): Cell<CoreDashboard> | undefined => getContext(DASHBOARD);
export const syncGroup = (): { readonly current: CoreSyncGroup } | undefined => getContext(SYNC);
