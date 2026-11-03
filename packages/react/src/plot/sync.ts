import { PlotSyncGroup, type SyncOptions } from "@alphacharts/plot";
import { createContext, createElement, useMemo, type ReactNode } from "react";

export const PlotSyncContext = createContext<PlotSyncGroup | null>(null);

export interface PlotSyncProps {
  /** Share the zoomed x range as well as the crosshair. Default true. Read when the group is made. */
  view?: SyncOptions["view"] | undefined;
  children?: ReactNode;
}

/** Every `<Plot>` below shares a crosshair (and zoom) through one PlotSyncGroup. Renders nothing itself. */
export function PlotSync({ view, children }: PlotSyncProps) {
  const group = useMemo(() => new PlotSyncGroup({ ...(view !== undefined && { view }) }), [view]);
  return createElement(PlotSyncContext.Provider, { value: group }, children);
}
