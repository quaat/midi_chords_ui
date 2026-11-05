/**
 * A tiny observable cache over `runtime.stores.progress` (React-free). Views read the cached
 * snapshot through `useProgress()` (useSyncExternalStore); every writer calls
 * `notifyProgressChanged()` (or uses the write helpers here) so the cache reloads once.
 */
import type { ProgressFile } from "@/model/contracts";
import type { ProgressStore } from "@/persistence";

export interface ProgressSnapshot {
  /** Bumped on every reload. */
  version: number;
  progress: ProgressFile | null;
  /** Learner-facing load error (damaged or newer progress data); null when loaded. */
  error: string | null;
  errorCode: string | null;
  warnings: string[];
}

type Listener = () => void;

const EMPTY: ProgressSnapshot = { version: 0, progress: null, error: null, errorCode: null, warnings: [] };

export class ProgressViewStore {
  private snapshot: ProgressSnapshot = EMPTY;
  private loaded = false;
  private readonly listeners = new Set<Listener>();
  private readonly source: () => ProgressStore;

  constructor(source: () => ProgressStore) {
    this.source = source;
  }

  readonly getSnapshot = (): ProgressSnapshot => {
    if (!this.loaded) {
      this.loaded = true;
      this.snapshot = this.read(this.snapshot.version + 1);
    }
    return this.snapshot;
  };

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Reload from storage and notify. */
  reload(): void {
    this.loaded = true;
    this.snapshot = this.read(this.snapshot.version + 1);
    this.listeners.forEach((listener) => listener());
  }

  private read(version: number): ProgressSnapshot {
    try {
      const result = this.source().load();
      if (result.ok) {
        return { version, progress: result.value, error: null, errorCode: null, warnings: result.warnings };
      }
      return { version, progress: null, error: result.error.message, errorCode: result.error.code, warnings: [] };
    } catch (error) {
      return { version, progress: null, error: error instanceof Error ? error.message : String(error), errorCode: "unavailable", warnings: [] };
    }
  }
}

// One cache per ProgressStore instance (the runtime swaps its memory stores for real ones on start()).
const caches = new WeakMap<ProgressStore, ProgressViewStore>();
const allCaches = new Set<ProgressViewStore>();

export function progressViewStoreFor(store: ProgressStore): ProgressViewStore {
  let cache = caches.get(store);
  if (!cache) {
    const created = new ProgressViewStore(() => store);
    caches.set(store, created);
    allCaches.add(created);
    cache = created;
  }
  return cache;
}

/** Call after any write to progress (attempts, routine state, goals, import, reset). */
export function notifyProgressChanged(): void {
  allCaches.forEach((cache) => cache.reload());
}
