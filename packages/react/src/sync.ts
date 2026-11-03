import { SyncGroup as CoreSyncGroup, type SyncOptions } from "@alphacharts/core";
import { createElement, useMemo, type ReactNode } from "react";
import { SyncContext } from "./context.js";

export interface SyncGroupProps {
  time?: SyncOptions["time"] | undefined;
  crosshair?: SyncOptions["crosshair"] | undefined;
  children?: ReactNode;
}

/**
 * Every `<Chart>` and `<DashboardCell>` below joins one core `SyncGroup`
 * (time window and crosshair). Renders nothing itself. `time` and `crosshair`
 * (both default true) are read when the group is made; changing one makes a
 * new group and the charts re-join it.
 */
export function SyncGroup({ time, crosshair, children }: SyncGroupProps) {
  const group = useMemo(() => new CoreSyncGroup({ ...(time !== undefined && { time }), ...(crosshair !== undefined && { crosshair }) }), [time, crosshair]);
  return createElement(SyncContext.Provider, { value: group }, children);
}
