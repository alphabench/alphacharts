import type { PlotSyncGroup as CorePlotSyncGroup } from "@alphacharts/plot";
import { getContext, setContext } from "svelte";

const SYNC = Symbol("alphacharts.plotSync");

export const providePlotSync = (group: { readonly current: CorePlotSyncGroup }): void => void setContext(SYNC, group);
export const plotSync = (): { readonly current: CorePlotSyncGroup } | undefined => getContext(SYNC);
