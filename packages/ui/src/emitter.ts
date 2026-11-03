// A small typed emitter and a subscribable store: the shell's only reactive primitives.

export class Emitter<E extends { [K in keyof E]: unknown }> {
  private readonly map = new Map<keyof E, Set<(e: never) => void>>();
  on<K extends keyof E>(type: K, fn: (e: E[K]) => void): () => void {
    let set = this.map.get(type);
    if (!set) this.map.set(type, (set = new Set()));
    set.add(fn as (e: never) => void);
    return () => void this.map.get(type)?.delete(fn as (e: never) => void);
  }
  emit<K extends keyof E>(type: K, e: E[K]): void {
    for (const fn of [...(this.map.get(type) ?? [])]) (fn as (e: E[K]) => void)(e);
  }
  clear(): void {
    this.map.clear();
  }
}
