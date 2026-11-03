// One requestAnimationFrame loop for every chart on the page. Charts mark
// layers dirty; the loop renders each dirty chart once per frame, so 100 Hz
// ticks or a dashboard of synced charts never render more than once per
// display refresh.

export const LAYER_BG = 1;
export const LAYER_GL = 2;
export const LAYER_OVERLAY = 4;
export const LAYER_ALL = LAYER_BG | LAYER_GL | LAYER_OVERLAY;

export interface Renderable {
  render(layers: number, now: number): void;
}

const dirty = new Map<Renderable, number>();
let raf = 0;

export function requestRender(r: Renderable, layers: number): void {
  dirty.set(r, (dirty.get(r) ?? 0) | layers);
  if (raf === 0) raf = requestAnimationFrame(frame);
}

export function cancelRender(r: Renderable): void {
  dirty.delete(r);
}

function frame(now: number): void {
  raf = 0;
  // Snapshot: a render may request the next frame (kinetic scroll).
  const batch = [...dirty];
  dirty.clear();
  // One chart's failure must not freeze the others: render every chart,
  // then surface the first error.
  let failure: { error: unknown } | null = null;
  for (const [r, layers] of batch) {
    try {
      r.render(layers, now);
    } catch (error) {
      failure ??= { error };
    }
  }
  if (failure) throw failure.error;
}
