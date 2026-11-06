/**
 * Local persistence (plan §4 "Persistence and compatibility", E11, E19).
 *
 * Browser-only, no backend: projects, song charts, recordings, progress and preferences live in
 * localStorage (or an in-memory fallback) with versioned schemas and explicit JSON
 * export/import. Every operation returns a `Result`; nothing throws into the UI.
 */

import { ChartStore } from "./charts";
import { PreferencesStore } from "./preferences";
import { ProgressStore, type ProgressStoreOptions } from "./progress";
import { ProjectStore } from "./projects";
import { RecordingStore } from "./recordings";
import { adapterStatus, createLocalStorageAdapter, type StorageAdapter, type StorageStatus } from "./storage";

export * from "./result";
export * from "./storage";
export * from "./migrations";
export * from "./json";
export * from "./guards";
export * from "./util";
export * from "./projects";
export * from "./progress";
export * from "./progressQueries";
export * from "./preferences";
export * from "./charts";
export * from "./recordings";
export * from "./backup";

export interface PersistenceStores {
  adapter: StorageAdapter;
  projects: ProjectStore;
  progress: ProgressStore;
  preferences: PreferencesStore;
  charts: ChartStore;
  /** Performance recordings (MIDI recorder takes). */
  recordings: RecordingStore;
  /** Snapshot at creation; call `currentStatus()` for live quota information. */
  status: StorageStatus;
  currentStatus: () => StorageStatus;
}

export type CreateStoresOptions = ProgressStoreOptions;

/**
 * Build all stores on one adapter. Without an adapter, localStorage is probed; when it is
 * unavailable the stores run on memory and `status.available` is false with a `reason`.
 */
export function createStores(adapter?: StorageAdapter, options: CreateStoresOptions = {}): PersistenceStores {
  const resolved = adapter ?? createLocalStorageAdapter();
  return {
    adapter: resolved,
    projects: new ProjectStore(resolved, options),
    progress: new ProgressStore(resolved, options),
    preferences: new PreferencesStore(resolved, options),
    charts: new ChartStore(resolved, options),
    recordings: new RecordingStore(resolved, options),
    status: adapterStatus(resolved),
    currentStatus: () => adapterStatus(resolved)
  };
}
