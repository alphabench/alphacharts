import type { Chart as CoreChart, Dashboard as CoreDashboard, Series as CoreSeries, SeriesType, SyncGroup as CoreSyncGroup } from "@alphacharts/core";
import type { ComputedRef, InjectionKey, ShallowRef } from "vue";

// Refs, not values: the core objects exist only after the owner mounts, and a
// child must see them appear (and go away) without being re-rendered.
export const CHART_KEY: InjectionKey<ShallowRef<CoreChart | null>> = Symbol("alphacharts.chart");
export const SERIES_KEY: InjectionKey<ShallowRef<CoreSeries<SeriesType> | null>> = Symbol("alphacharts.series");
export const DASHBOARD_KEY: InjectionKey<ShallowRef<CoreDashboard | null>> = Symbol("alphacharts.dashboard");
export const SYNC_KEY: InjectionKey<ComputedRef<CoreSyncGroup>> = Symbol("alphacharts.sync");
