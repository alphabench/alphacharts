export class Emitter<E extends { [K in keyof E]: unknown }> {
  private readonly map = new Map<keyof E, Set<(e: never) => void>>();

  on<K extends keyof E>(type: K, fn: (e: E[K]) => void): () => void {
    let set = this.map.get(type);
    if (!set) this.map.set(type, (set = new Set()));
    set.add(fn as (e: never) => void);
    return () => this.off(type, fn);
  }

  off<K extends keyof E>(type: K, fn: (e: E[K]) => void): void {
    this.map.get(type)?.delete(fn as (e: never) => void);
  }

  has(type: keyof E): boolean {
    return (this.map.get(type)?.size ?? 0) > 0;
  }

  emit<K extends keyof E>(type: K, e: E[K]): void {
    const set = this.map.get(type);
    if (!set) return;
    for (const fn of set) (fn as (e: E[K]) => void)(e);
  }

  clear(): void {
    this.map.clear();
  }
}
