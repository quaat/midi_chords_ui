import { describe, expect, it } from "vitest";
import { createStores } from "@/persistence";
import { PersistenceError } from "@/persistence/result";
import { createLocalStorageAdapter, createMemoryAdapter, readKey, writeKey, type StorageLike } from "@/persistence/storage";
import { brokenAdapter, makeSequence, quotaAdapter } from "./helpers";

function fakeStorage(options: { failWrites?: string } = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => (data.has(key) ? (data.get(key) as string) : null),
    setItem: (key, value) => {
      if (options.failWrites !== undefined) {
        const error = new Error("write failed");
        error.name = options.failWrites;
        throw error;
      }
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
    key: (index) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    }
  };
}

describe("storage adapters", () => {
  it("memory adapter round-trips values and lists keys", () => {
    const adapter = createMemoryAdapter();
    adapter.set("pls:a", "1");
    adapter.set("pls:b", "2");
    expect(adapter.get("pls:a")).toBe("1");
    adapter.remove("pls:a");
    expect(adapter.get("pls:a")).toBeNull();
    expect(adapter.keys()).toEqual(["pls:b"]);
  });

  it("memory adapter with a quota throws a typed quota error and keeps the old value", () => {
    const adapter = createMemoryAdapter({}, { quotaBytes: 40 });
    adapter.set("pls:k", "small");
    expect(() => adapter.set("pls:k", "x".repeat(100))).toThrow(PersistenceError);
    expect(adapter.get("pls:k")).toBe("small");
    expect(adapter.status?.().quotaExceeded).toBe(true);
  });

  it("localStorage adapter uses a working storage and reports it as available", () => {
    const storage = fakeStorage();
    const adapter = createLocalStorageAdapter({ storage });
    adapter.set("pls:x", "y");
    expect(storage.data.get("pls:x")).toBe("y");
    expect(storage.data.has("pls:__probe__")).toBe(false);
    expect(adapter.status?.()).toEqual({ available: true, backend: "localStorage" });
  });

  it("falls back to memory with a reason when accessing storage throws", () => {
    const adapter = createLocalStorageAdapter({
      storage: () => {
        const error = new Error("denied");
        error.name = "SecurityError";
        throw error;
      }
    });
    const status = adapter.status?.();
    expect(status?.available).toBe(false);
    expect(status?.backend).toBe("memory");
    expect(status?.reason).toMatch(/blocked/);
    adapter.set("pls:k", "v");
    expect(adapter.get("pls:k")).toBe("v");
  });

  it("falls back to memory when the probe write hits the quota (private mode)", () => {
    const adapter = createLocalStorageAdapter({ storage: fakeStorage({ failWrites: "QuotaExceededError" }) });
    const status = adapter.status?.();
    expect(status?.available).toBe(false);
    expect(status?.quotaExceeded).toBe(true);
    expect(typeof status?.reason).toBe("string");
  });

  it("falls back to memory when no storage exists", () => {
    const adapter = createLocalStorageAdapter({ storage: null });
    expect(adapter.status?.().available).toBe(false);
    expect(adapter.status?.().reason).toMatch(/not available/);
  });

  it("createStores on unavailable storage still works and exposes status.reason", () => {
    const stores = createStores(createLocalStorageAdapter({ storage: null }));
    expect(stores.status.available).toBe(false);
    expect(stores.status.reason).toBeTruthy();
    const created = stores.projects.createProject("Session only", makeSequence());
    expect(created.ok).toBe(true);
    const listed = stores.projects.list();
    expect(listed.ok && listed.value.length).toBe(1);
  });

  it("createStores without an adapter probes globalThis.localStorage (present or absent)", () => {
    const holder = globalThis as { localStorage?: unknown };
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    try {
      Object.defineProperty(globalThis, "localStorage", { value: fakeStorage(), configurable: true, writable: true });
      const present = createStores();
      expect(present.status.backend).toBe("localStorage");
      expect(present.status.available).toBe(true);

      Object.defineProperty(globalThis, "localStorage", { value: undefined, configurable: true, writable: true });
      const absent = createStores();
      expect(absent.status.available).toBe(false);
      expect(absent.status.reason).toBeTruthy();
    } finally {
      if (original !== undefined) Object.defineProperty(globalThis, "localStorage", original);
      else delete holder.localStorage;
    }
  });

  it("converts thrown QuotaExceededError into code 'quota'", () => {
    const { adapter, arm } = quotaAdapter();
    arm();
    const result = writeKey(adapter, "pls:k", "v");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(PersistenceError);
      expect(result.error.code).toBe("quota");
    }
  });

  it("converts other thrown errors into code 'unavailable' without throwing", () => {
    const adapter = brokenAdapter();
    const read = readKey(adapter, "pls:k");
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.error.code).toBe("unavailable");
    const stores = createStores(adapter);
    const listed = stores.projects.list();
    expect(listed.ok).toBe(false);
    if (!listed.ok) expect(listed.error.code).toBe("unavailable");
    expect(stores.status.backend).toBe("custom");
  });
});
