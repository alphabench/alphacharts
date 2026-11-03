import { SyncGroup as CoreSyncGroup } from "@alphacharts/core";
import { computed, defineComponent, provide } from "vue";
import { SYNC_KEY } from "./keys.js";

/**
 * Every `<AcChart>` and `<AcDashboardCell>` below joins one core `SyncGroup`
 * (time window and crosshair). Renders only its slot. `time` and `crosshair`
 * (both default true) are read when the group is made; changing one makes a
 * new group and the charts re-join it.
 */
export const AcSyncGroup = defineComponent({
  name: "AcSyncGroup",
  props: {
    // `default: undefined`: Vue would otherwise turn an absent Boolean into false.
    time: { type: Boolean, default: undefined },
    crosshair: { type: Boolean, default: undefined },
  },
  setup(props, { slots }) {
    provide(
      SYNC_KEY,
      computed(() => new CoreSyncGroup({ ...(props.time !== undefined && { time: props.time }), ...(props.crosshair !== undefined && { crosshair: props.crosshair }) })),
    );
    return () => slots.default?.();
  },
});
