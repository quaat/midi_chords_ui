"use client";

/**
 * All My Practice data reads go through `useProgress()`: a useSyncExternalStore subscription to
 * the cached progress snapshot (progressStore.ts), reloaded after every write.
 */
import { useMemo, useSyncExternalStore } from "react";
import type { ProgressStore } from "@/persistence";
import { useStudioRuntime, useUiState } from "@/ui/runtime/useStudioRuntime";
import type { ProgressSnapshot } from "@/ui/myPractice/progressStore";
import { notifyProgressChanged, progressViewStoreFor } from "@/ui/myPractice/progressStore";

export interface ProgressApi extends ProgressSnapshot {
  store: ProgressStore;
  reload: () => void;
}

export function useProgress(): ProgressApi {
  const runtime = useStudioRuntime();
  // The runtime swaps its in-memory stores for real storage once started (storesReady).
  const storesReady = useUiState().storesReady;
  const store = runtime.stores.progress;
  const cache = useMemo(() => progressViewStoreFor(store), [store, storesReady]);
  const snapshot = useSyncExternalStore(cache.subscribe, cache.getSnapshot, cache.getSnapshot);
  return useMemo<ProgressApi>(() => ({ ...snapshot, store, reload: notifyProgressChanged }), [snapshot, store]);
}
