import { describe, expect, it } from "vitest";
import { PROGRESS_KEY, ProgressStore } from "@/persistence/progress";
import { createMemoryAdapter } from "@/persistence/storage";
import { makeAttempt, makeEvidence, quotaAdapter, steppingClock } from "./helpers";

function setup(maxAttempts?: number) {
  const adapter = createMemoryAdapter();
  const store = new ProgressStore(adapter, { now: steppingClock(), maxAttempts });
  return { adapter, store };
}

describe("ProgressStore", () => {
  it("load() returns an empty v1 file when nothing is saved, without writing", () => {
    const { adapter, store } = setup();
    const loaded = store.load();
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value).toMatchObject({ schemaVersion: 1, kind: "progress", attempts: [], evidence: [], goals: [], routineState: {} });
    }
    expect(adapter.get(PROGRESS_KEY)).toBeNull();
  });

  it("records attempts and dedupes by id (later record replaces)", () => {
    const { store } = setup();
    store.recordAttempt(makeAttempt("a1", { completedAt: undefined }));
    store.recordAttempt(makeAttempt("a2", { startedAt: "2026-11-01T11:00:00.000Z" }));
    const result = store.recordAttempt(makeAttempt("a1"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.attempts.map((attempt) => attempt.id)).toEqual(["a1", "a2"]);
    expect(result.value.attempts[0].completedAt).toBe("2026-11-01T10:05:00.000Z");
  });

  it("caps attempts, trimming the oldest first", () => {
    const { store } = setup(3);
    for (let i = 0; i < 5; i += 1) {
      store.recordAttempt(makeAttempt(`a${i}`, { startedAt: `2026-11-0${i + 1}T10:00:00.000Z` }));
    }
    const loaded = store.load();
    expect(loaded.ok && loaded.value.attempts.map((attempt) => attempt.id)).toEqual(["a2", "a3", "a4"]);
  });

  it("rejects malformed attempts without writing", () => {
    const { adapter, store } = setup();
    const bad = { ...makeAttempt("x"), summary: undefined } as unknown as ReturnType<typeof makeAttempt>;
    const result = store.recordAttempt(bad);
    expect(!result.ok && result.error.code).toBe("invalid");
    expect(adapter.get(PROGRESS_KEY)).toBeNull();
  });

  it("records evidence (deduped by identity) and attempt+evidence together", () => {
    const { store } = setup();
    const evidence = makeEvidence("independent", "2026-11-01T10:05:00.000Z", { attemptId: "a1" });
    store.recordAttempt(makeAttempt("a1"), [evidence]);
    const again = store.recordEvidence(evidence);
    expect(again.ok && again.value.evidence).toHaveLength(1);
    const more = store.recordEvidence([makeEvidence("read", "2026-10-30T10:00:00.000Z"), makeEvidence("listened", "2026-10-31T10:00:00.000Z")]);
    expect(more.ok && more.value.evidence.map((entry) => entry.kind)).toEqual(["read", "listened", "independent"]);
  });

  it("routine state and goals", () => {
    const { store } = setup();
    expect(store.getRoutineState("r1")).toBeUndefined();
    store.setRoutineState("r1", { itemIndex: 2, completedItemIds: ["warmup", "scale"] });
    const state = store.getRoutineState("r1");
    expect(state).toMatchObject({ itemIndex: 2, completedItemIds: ["warmup", "scale"] });
    expect(typeof state?.updatedAt).toBe("string");
    const bad = store.setRoutineState("r1", { itemIndex: -1, completedItemIds: [] });
    expect(bad.ok).toBe(false);
    const goals = store.setGoals([" Learn shell voicings ", "", "Learn shell voicings", "Comp a blues"]);
    expect(goals.ok && goals.value.goals).toEqual(["Learn shell voicings", "Comp a blues"]);
    store.clearRoutineState("r1");
    expect(store.getRoutineState("r1")).toBeUndefined();
  });

  it("export/import replace round trip", () => {
    const { store } = setup();
    store.recordAttempt(makeAttempt("a1"), [makeEvidence("assisted", "2026-11-01T10:05:00.000Z")]);
    store.setGoals(["Voicings"]);
    const exported = store.exportJson();
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    const other = setup().store;
    const imported = other.importJson(exported.value, "replace");
    expect(imported.ok).toBe(true);
    const loaded = other.load();
    if (loaded.ok) {
      expect(loaded.value.attempts.map((attempt) => attempt.id)).toEqual(["a1"]);
      expect(loaded.value.goals).toEqual(["Voicings"]);
      expect(loaded.value.evidence).toHaveLength(1);
    }
  });

  it("import merge unions attempts and evidence without duplicates", () => {
    const { store } = setup();
    store.recordAttempt(makeAttempt("a1"), [makeEvidence("assisted", "2026-11-01T10:05:00.000Z")]);
    const exported = store.exportJson();
    if (!exported.ok) throw exported.error;
    store.recordAttempt(makeAttempt("a2", { startedAt: "2026-11-02T10:00:00.000Z" }));
    const merged = store.importJson(exported.value, "merge");
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.value.attempts.map((attempt) => attempt.id)).toEqual(["a1", "a2"]);
    expect(merged.value.evidence).toHaveLength(1);
    const twice = store.importJson(exported.value, "merge");
    expect(twice.ok && twice.value.attempts).toHaveLength(2);
  });

  it("drops damaged entries on import with warnings instead of failing", () => {
    const { store } = setup();
    const doc = {
      schemaVersion: 1,
      kind: "progress",
      attempts: [makeAttempt("good"), { id: "broken" }],
      evidence: [makeEvidence("read", "2026-11-01T00:00:00.000Z"), { kind: "mastered" }],
      routineState: {},
      goals: [],
      updatedAt: "2026-11-01T00:00:00.000Z"
    };
    const result = store.importJson(JSON.stringify(doc), "replace");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.attempts.map((attempt) => attempt.id)).toEqual(["good"]);
    expect(result.value.evidence).toHaveLength(1);
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it("damaged or newer stored progress is never overwritten implicitly", () => {
    const { adapter, store } = setup();
    adapter.set(PROGRESS_KEY, "{broken");
    const loaded = store.load();
    expect(!loaded.ok && loaded.error.code).toBe("corrupt");
    const write = store.recordAttempt(makeAttempt("a1"));
    expect(!write.ok && write.error.code).toBe("corrupt");
    expect(store.readRaw()).toBe("{broken");

    const future = JSON.stringify({ schemaVersion: 2, kind: "progress", attempts: [], evidence: [], routineState: {}, goals: [], updatedAt: "2026-11-01T00:00:00.000Z" });
    adapter.set(PROGRESS_KEY, future);
    const blocked = store.setGoals(["x"]);
    expect(!blocked.ok && blocked.error.code).toBe("unsupportedVersion");
    expect(adapter.get(PROGRESS_KEY)).toBe(future);
    const importFuture = store.importJson(future, "replace");
    expect(!importFuture.ok && importFuture.error.code).toBe("unsupportedVersion");
  });

  it("reset() clears progress and is the recovery path", () => {
    const { adapter, store } = setup();
    adapter.set(PROGRESS_KEY, "{broken");
    const reset = store.reset();
    expect(reset.ok && reset.value.attempts).toEqual([]);
    expect(store.recordAttempt(makeAttempt("a1")).ok).toBe(true);
  });

  it("quota failure keeps the previously saved progress", () => {
    const { adapter, arm } = quotaAdapter();
    const store = new ProgressStore(adapter, { now: steppingClock() });
    store.recordAttempt(makeAttempt("a1"));
    const before = adapter.get(PROGRESS_KEY);
    arm();
    const result = store.recordAttempt(makeAttempt("a2", { startedAt: "2026-11-02T10:00:00.000Z" }));
    expect(!result.ok && result.error.code).toBe("quota");
    expect(adapter.get(PROGRESS_KEY)).toBe(before);
  });
});
