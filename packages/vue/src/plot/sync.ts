import { PlotSyncGroup } from "@alphacharts/plot";
import { computed, defineComponent, provide } from "vue";
import { PLOT_SYNC_KEY } from "./keys.js";

/**
 * Every `<AcPlot>` below shares a crosshair (and zoom) through one
 * PlotSyncGroup. Renders only its slot. `view` (default true) is read when the
 * group is made; changing it makes a new group and the plots re-join it.
 */
export const AcPlotSync = defineComponent({
  name: "AcPlotSync",
  props: {
    // `default: undefined`: Vue would otherwise turn an absent Boolean into false.
    view: { type: Boolean, default: undefined },
  },
  setup(props, { slots }) {
    provide(PLOT_SYNC_KEY, computed(() => new PlotSyncGroup({ ...(props.view !== undefined && { view: props.view }) })));
    return () => slots.default?.();
  },
});
