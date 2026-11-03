import { Dashboard as CoreDashboard, type DashboardOptions } from "@alphacharts/core";
import { createElement, forwardRef, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { DashboardContext } from "./context.js";

export interface DashboardProps {
  /** The renderer is read when the dashboard is created. */
  options?: Partial<DashboardOptions> | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  /** `<DashboardCell>`s, laid out by your CSS (grid, flex, absolute). */
  children?: ReactNode;
}

/** Many charts on one WebGL context. The ref is the core `Dashboard` (null until mounted). */
export const Dashboard = forwardRef<CoreDashboard | null, DashboardProps>(function Dashboard({ options, className, style, children }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(options);
  latest.current = options;
  const [dashboard, setDashboard] = useState<CoreDashboard | null>(null);

  useEffect(() => {
    const d = new CoreDashboard(host.current!, latest.current);
    setDashboard(d);
    return () => {
      d.remove();
      setDashboard(null);
    };
  }, []);

  useImperativeHandle(ref, () => dashboard as CoreDashboard, [dashboard]);
  return createElement("div", { ref: host, className, style }, createElement(DashboardContext.Provider, { value: dashboard }, children));
});
