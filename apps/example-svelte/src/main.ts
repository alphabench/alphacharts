import { mount, unmount } from "svelte";
import "../../example-shared/style.css";
import "../../example-shared/track.js";
import App from "./App.svelte";

const target = document.getElementById("app")!;
let app: ReturnType<typeof mount> | null = null;
window.__mount = () => {
  app = mount(App, { target });
};
window.__unmount = () => {
  if (app) void unmount(app);
  app = null;
};
window.__mount();
