import { createApp, type App as VueApp } from "vue";
import "../../example-shared/style.css";
import "../../example-shared/track.js";
import App from "./App.vue";

const el = document.getElementById("app")!;
let app: VueApp | null = null;
window.__mount = () => {
  app = createApp(App);
  app.mount(el);
};
window.__unmount = () => {
  app?.unmount();
  app = null;
};
window.__mount();
