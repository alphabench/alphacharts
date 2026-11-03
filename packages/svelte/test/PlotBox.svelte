<script lang="ts">
  import { Plot } from "../src/plot/index.js";
  let { initial }: { initial: never } = $props();
  // $state.raw: a spec holds big data arrays and must not be proxied.
  // svelte-ignore state_referenced_locally
  let spec = $state.raw(initial);
  export function set(s: never): void {
    spec = s;
  }
</script>

<Plot {spec} class="p" />
