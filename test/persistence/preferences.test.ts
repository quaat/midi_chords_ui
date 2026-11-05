import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, PREFERENCES_KEY, PreferencesStore } from "@/persistence/preferences";
import { createMemoryAdapter } from "@/persistence/storage";
import { quotaAdapter } from "./helpers";

describe("PreferencesStore", () => {
  it("returns defaults when nothing is saved", () => {
    const store = new PreferencesStore(createMemoryAdapter());
    const prefs = store.get();
    expect(prefs.ok && prefs.value).toEqual({ ...DEFAULT_PREFERENCES });
    expect(prefs.ok && prefs.value.onboardingChoice).toBeUndefined();
  });

  it("applies partial updates and persists them with a schema version", () => {
    const adapter = createMemoryAdapter();
    const store = new PreferencesStore(adapter);
    store.update({ theme: "dark" });
    const updated = store.update({ latencyOffsetMs: 25, onboardingChoice: "betterVoicings" });
    expect(updated.ok && updated.value).toMatchObject({ theme: "dark", latencyOffsetMs: 25, onboardingChoice: "betterVoicings", labelMode: "noteNames" });
    expect(JSON.parse(adapter.get(PREFERENCES_KEY) as string)).toMatchObject({ schemaVersion: 1, kind: "preferences", theme: "dark" });
    const reopened = new PreferencesStore(adapter).get();
    expect(reopened.ok && reopened.value.latencyOffsetMs).toBe(25);
    const cleared = store.update({ onboardingChoice: undefined });
    expect(cleared.ok && cleared.value.onboardingChoice).toBeUndefined();
  });

  it("rejects invalid updates without writing", () => {
    const adapter = createMemoryAdapter();
    const store = new PreferencesStore(adapter);
    const bad = store.update({ pianoRange: { low: 90, high: 40 } });
    expect(!bad.ok && bad.error.code).toBe("invalid");
    expect(adapter.get(PREFERENCES_KEY)).toBeNull();
  });

  it("falls back to defaults field-by-field for damaged saved values", () => {
    const adapter = createMemoryAdapter({ [PREFERENCES_KEY]: JSON.stringify({ schemaVersion: 1, kind: "preferences", theme: "neon", labelMode: "degrees" }) });
    const prefs = new PreferencesStore(adapter).get();
    expect(prefs.ok && prefs.value.theme).toBe("system");
    expect(prefs.ok && prefs.value.labelMode).toBe("degrees");
    expect(prefs.ok && prefs.warnings.length).toBe(1);
    const corrupt = new PreferencesStore(createMemoryAdapter({ [PREFERENCES_KEY]: "{" })).get();
    expect(corrupt.ok && corrupt.value).toEqual({ ...DEFAULT_PREFERENCES });
  });

  it("does not overwrite preferences saved by a newer app version", () => {
    const future = JSON.stringify({ schemaVersion: 5, kind: "preferences", theme: "light" });
    const adapter = createMemoryAdapter({ [PREFERENCES_KEY]: future });
    const store = new PreferencesStore(adapter);
    expect(store.get().ok).toBe(true);
    const update = store.update({ theme: "dark" });
    expect(!update.ok && update.error.code).toBe("unsupportedVersion");
    expect(adapter.get(PREFERENCES_KEY)).toBe(future);
  });

  it("surfaces quota errors", () => {
    const { adapter, arm } = quotaAdapter();
    const store = new PreferencesStore(adapter);
    arm();
    const result = store.update({ theme: "dark" });
    expect(!result.ok && result.error.code).toBe("quota");
  });
});
