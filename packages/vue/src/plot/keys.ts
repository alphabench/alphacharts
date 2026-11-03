import type { PlotSyncGroup } from "@alphacharts/plot";
import type { ComputedRef, InjectionKey } from "vue";

export const PLOT_SYNC_KEY: InjectionKey<ComputedRef<PlotSyncGroup>> = Symbol("alphacharts.plotSync");
