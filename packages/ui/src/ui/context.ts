import { createContext } from "preact";
import { useContext, useEffect, useReducer } from "preact/hooks";
import type { ChartApp, Key } from "../engine/app.js";
import type { MessageValues } from "@alphacharts/i18n";

export const AppContext = createContext<ChartApp | null>(null);
export const RootContext = createContext<ShadowRoot | null>(null);

/** The controller; re-renders the component whenever the app announces a change. */
export function useApp(): ChartApp {
  const app = useContext(AppContext);
  if (!app) throw new Error("useApp outside the shell");
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => app.events.on("change", () => bump(0)), [app]);
  return app;
}

export function useT(): (key: Key, values?: MessageValues) => string {
  return useApp().t.bind(useApp());
}

export function useRoot(): ShadowRoot {
  const r = useContext(RootContext);
  if (!r) throw new Error("useRoot outside the shell");
  return r;
}
