import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import "../../example-shared/style.css";
import { App } from "./App.js";
import "../../example-shared/track.js";

// StrictMode on: every mount below is a double mount, and must still end with one live set of charts.
const el = document.getElementById("app")!;
let root: Root | null = null;
window.__mount = () => {
  root = createRoot(el);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
};
window.__unmount = () => {
  root?.unmount();
  root = null;
};
window.__mount();
