import { createContext } from "react";
import type { Chart as CoreChart, Dashboard as CoreDashboard, Series as CoreSeries, SeriesType, SyncGroup as CoreSyncGroup } from "@alphacharts/core";

// Each holds the core object once its owner has mounted (null before), or
// undefined when there is no owner above: a hook outside its component.
export const ChartContext = createContext<CoreChart | null | undefined>(undefined);
export const SeriesContext = createContext<CoreSeries<SeriesType> | null | undefined>(undefined);
export const DashboardContext = createContext<CoreDashboard | null | undefined>(undefined);
export const SyncContext = createContext<CoreSyncGroup | undefined>(undefined);
