import { Dashboard as CoreDashboard, type DashboardOptions } from "@alphacharts/core";
import { defineComponent, h, onMounted, provide, ref, shallowRef, watch, type PropType, type ShallowRef } from "vue";
import { DASHBOARD_KEY } from "./keys.js";
import { snapshot } from "./options.js";

/**
 * Many charts on one WebGL context. Size and lay out the host with
 * `class`/`style` (CSS grid, flex, absolute); the slot takes `<AcDashboardCell>`s.
 * Exposes `dashboard`: the core Dashboard, null until mounted.
 */
export const AcDashboard = defineComponent({
  name: "AcDashboard",
  props: {
    /** The renderer is read when the dashboard is created. */
    options: Object as PropType<Partial<DashboardOptions>>,
  },
  setup(props, { slots, expose }) {
    const host = ref<HTMLElement | null>(null);
    const dashboard: ShallowRef<CoreDashboard | null> = shallowRef(null);
    const mounted = ref(false);
    provide(DASHBOARD_KEY, dashboard);
    onMounted(() => (mounted.value = true));
    watch(
      mounted,
      (isMounted, _o, onCleanup) => {
        if (!isMounted) return;
        const d = new CoreDashboard(host.value!, snapshot(props.options));
        dashboard.value = d;
        onCleanup(() => {
          d.remove();
          dashboard.value = null;
        });
      },
      { immediate: true, flush: "sync" },
    );
    expose({ dashboard });
    return () => h("div", { ref: host }, slots.default?.());
  },
});
