import { defineComponent, watch } from "vue";
import { useChart } from "@alphacharts/vue";
import { track } from "../../example-shared/track.js";

/** Records the enclosing chart for the browser tests. */
export default defineComponent({
  setup() {
    const chart = useChart();
    watch(chart, (c) => track(c), { immediate: true });
    return () => null;
  },
});
