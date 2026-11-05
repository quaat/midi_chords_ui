/**
 * Storage adapters. All persistence goes through `StorageAdapter`, so stores can run on
 * localStorage, an in-memory fallback (private mode / blocked storage / tests), or any
 * custom backend. Adapters may throw `PersistenceError`; the `readKey`/`writeKey` helpers
 * convert every thrown value into a typed `Result` so the app never crashes on storage.
 */

import { fail, ok, PersistenceError, toPersistenceError, type Result } from "./result";

/** Every key written by this app starts with this namespace. */
export const STORAGE_NAMESPACE = "pls:";

export interface StorageStatus {
  /** Whether durable (cross-reload) storage is in use. */
  available: boolean;
  /** Why durable storage is not in use, phrased for the learner. */
  reason?: string;
  /** Set once a write has failed because the storage quota was exceeded. */
  quotaExceeded?: boolean;
  backend: "localStorage" | "memory" | "custom";
}

export interface StorageAdapter {
  get(key: string): string | null;
  /** Throws `PersistenceError` ("quota" | "unavailable") when the value cannot be written. */
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
  /** Optional live status (localStorage and memory adapters provide it). */
  status?(): StorageStatus;
}

/** The subset of the Web Storage API we use. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

// ---------------------------------------------------------------------------
// Memory adapter
// ---------------------------------------------------------------------------

export interface MemoryAdapterOptions {
  /** Simulated quota (UTF-16 bytes of keys + values). Writes beyond it throw "quota". */
  quotaBytes?: number;
  /** Status reported by `status()`; defaults to a non-durable but working store. */
  status?: StorageStatus;
}

function entryBytes(key: string, value: string): number {
  return (key.length + value.length) * 2;
}

export function createMemoryAdapter(initial: Record<string, string> = {}, options: MemoryAdapterOptions = {}): StorageAdapter {
  const data = new Map<string, string>(Object.entries(initial));
  let quotaExceeded = false;
  const baseStatus: StorageStatus = options.status ?? { available: true, backend: "memory" };
  const usedBytes = (): number => {
    let total = 0;
    for (const [key, value] of data) total += entryBytes(key, value);
    return total;
  };
  return {
    get(key: string): string | null {
      const value = data.get(key);
      return value === undefined ? null : value;
    },
    set(key: string, value: string): void {
      if (options.quotaBytes !== undefined) {
        const previous = data.get(key);
        const next = usedBytes() - (previous === undefined ? 0 : entryBytes(key, previous)) + entryBytes(key, value);
        if (next > options.quotaBytes) {
          quotaExceeded = true;
          throw new PersistenceError("quota", `Storage is full (limit ${options.quotaBytes} bytes); the previous value was kept.`);
        }
      }
      data.set(key, String(value));
    },
    remove(key: string): void {
      data.delete(key);
    },
    keys(): string[] {
      return Array.from(data.keys());
    },
    status(): StorageStatus {
      return quotaExceeded ? { ...baseStatus, quotaExceeded: true } : { ...baseStatus };
    }
  };
}

// ---------------------------------------------------------------------------
// localStorage adapter
// ---------------------------------------------------------------------------

export const PROBE_KEY = "pls:__probe__";

export interface LocalStorageAdapterOptions {
  /** Storage to use, or a getter (accessing `window.localStorage` itself may throw). */
  storage?: StorageLike | null | (() => StorageLike | null | undefined);
}

interface ProbeOutcome {
  storage: StorageLike | null;
  reason?: string;
  quotaExceeded?: boolean;
}

const MEMORY_FALLBACK_NOTE = "Changes are kept in memory for this session only; export a backup to keep them.";

function probeStorage(source: LocalStorageAdapterOptions["storage"]): ProbeOutcome {
  let storage: StorageLike | null | undefined;
  try {
    if (typeof source === "function") storage = source();
    else if (source !== undefined) storage = source;
    else storage = (globalThis as { localStorage?: StorageLike }).localStorage;
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    return { storage: null, reason: `Browser storage is blocked (${name}). ${MEMORY_FALLBACK_NOTE}` };
  }
  if (storage === null || storage === undefined) {
    return { storage: null, reason: `Browser storage is not available here. ${MEMORY_FALLBACK_NOTE}` };
  }
  try {
    storage.setItem(PROBE_KEY, "1");
    storage.removeItem(PROBE_KEY);
  } catch (error) {
    const converted = toPersistenceError(error, "checking browser storage");
    if (converted.code === "quota") {
      return {
        storage: null,
        quotaExceeded: true,
        reason: `Browser storage is full or disabled (private browsing can do this). ${MEMORY_FALLBACK_NOTE}`
      };
    }
    return { storage: null, reason: `Browser storage cannot be written. ${MEMORY_FALLBACK_NOTE}` };
  }
  return { storage };
}

/**
 * Wrap localStorage after probing that it can be read and written. When it cannot (no
 * window, SecurityError, private mode with zero quota), an in-memory adapter is returned
 * whose `status()` reports `available: false` with a learner-facing `reason`.
 */
export function createLocalStorageAdapter(options: LocalStorageAdapterOptions = {}): StorageAdapter {
  const probe = probeStorage(options.storage);
  if (probe.storage === null) {
    const status: StorageStatus = { available: false, backend: "memory", reason: probe.reason };
    if (probe.quotaExceeded === true) status.quotaExceeded = true;
    return createMemoryAdapter({}, { status });
  }
  const storage = probe.storage;
  let quotaExceeded = false;
  return {
    get(key: string): string | null {
      try {
        return storage.getItem(key);
      } catch (error) {
        throw toPersistenceError(error, `reading "${key}"`);
      }
    },
    set(key: string, value: string): void {
      try {
        storage.setItem(key, value);
      } catch (error) {
        const converted = toPersistenceError(error, `saving "${key}"`);
        if (converted.code === "quota") quotaExceeded = true;
        throw converted;
      }
    },
    remove(key: string): void {
      try {
        storage.removeItem(key);
      } catch (error) {
        throw toPersistenceError(error, `removing "${key}"`);
      }
    },
    keys(): string[] {
      try {
        const out: string[] = [];
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          if (key !== null) out.push(key);
        }
        return out;
      } catch (error) {
        throw toPersistenceError(error, "listing saved items");
      }
    },
    status(): StorageStatus {
      const status: StorageStatus = { available: true, backend: "localStorage" };
      if (quotaExceeded) status.quotaExceeded = true;
      return status;
    }
  };
}

export function adapterStatus(adapter: StorageAdapter): StorageStatus {
  if (typeof adapter.status === "function") {
    try {
      return adapter.status();
    } catch {
      return { available: false, backend: "custom", reason: "Storage status could not be read." };
    }
  }
  return { available: true, backend: "custom" };
}

// ---------------------------------------------------------------------------
// Result-returning helpers used by every store
// ---------------------------------------------------------------------------

export function readKey(adapter: StorageAdapter, key: string): Result<string | null> {
  try {
    return ok(adapter.get(key));
  } catch (error) {
    return { ok: false, error: toPersistenceError(error, `reading "${key}"`) };
  }
}

export function writeKey(adapter: StorageAdapter, key: string, value: string): Result<undefined> {
  try {
    adapter.set(key, value);
    return ok(undefined);
  } catch (error) {
    return { ok: false, error: toPersistenceError(error, `saving "${key}"`) };
  }
}

export function removeKey(adapter: StorageAdapter, key: string): Result<undefined> {
  try {
    adapter.remove(key);
    return ok(undefined);
  } catch (error) {
    return { ok: false, error: toPersistenceError(error, `removing "${key}"`) };
  }
}

export function listKeys(adapter: StorageAdapter, prefix: string): Result<string[]> {
  try {
    return ok(adapter.keys().filter((key) => key.startsWith(prefix)).sort());
  } catch (error) {
    return { ok: false, error: toPersistenceError(error, "listing saved items") };
  }
}

/** Guard a key segment (ids are user/import supplied). */
export function checkIdSegment(id: unknown, label: string): Result<string> {
  if (typeof id !== "string" || id.trim() === "" || id.length > 200) {
    return fail("invalid", `The ${label} id must be a non-empty string of at most 200 characters.`);
  }
  return ok(id);
}
