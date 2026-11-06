import { describe, expect, it } from "vitest";
import { MAX_RECORDING_EVENTS } from "@/recording";
import type { PerformanceRecording, RecordedEvent } from "@/recording";
import { RECORDING_INDEX_KEY, RecordingStore, recordingKey, validateRecordingShape } from "@/persistence/recordings";
import { createMemoryAdapter } from "@/persistence/storage";
import { counterIds, quotaAdapter, steppingClock } from "./helpers";

function events(): RecordedEvent[] {
  return [
    { type: "sustain", atMs: 0, value: 127, source: "midi", portId: "p1", channel: 1 },
    { type: "noteOn", atMs: 100, midi: 60, velocity: 90, source: "midi", portId: "p1", channel: 1 },
    { type: "noteOff", atMs: 600, midi: 60, velocity: 0, source: "midi", portId: "p1", channel: 1 },
    { type: "noteOn", atMs: 700, midi: 64, velocity: 80, source: "touch", channel: 1 },
    { type: "noteOff", atMs: 900, midi: 64, velocity: 0, source: "touch", channel: 1 },
    { type: "sustain", atMs: 1200, value: 0, source: "midi", portId: "p1", channel: 1 }
  ];
}

function makeRecording(id = "rec-1", title = "Take 1"): PerformanceRecording {
  return {
    schemaVersion: 1,
    kind: "recording",
    id,
    title,
    createdAt: "2026-11-06T20:00:00.000Z",
    updatedAt: "2026-11-06T20:00:00.000Z",
    tempo: { bpm: 110 },
    timeSignature: { numerator: 4, denominator: 4 },
    countInBeats: 4,
    durationMs: 2000,
    events: events(),
    sources: [{ source: "midi", portId: "p1", portName: "Fake Piano" }, { source: "touch" }]
  };
}

function setup() {
  const adapter = createMemoryAdapter();
  const store = new RecordingStore(adapter, { now: steppingClock(), newId: counterIds() });
  return { adapter, store };
}

describe("RecordingStore", () => {
  it("save/list/get/remove round trip restores the same musical content", () => {
    const { adapter, store } = setup();
    const saved = store.save(makeRecording());
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.events).toEqual(events());
    const again = new RecordingStore(adapter); // "after a refresh"
    const got = again.get("rec-1");
    expect(got.ok && got.value).toEqual(saved.value);
    const listed = again.list();
    expect(listed.ok && listed.value).toEqual([
      { id: "rec-1", title: "Take 1", createdAt: saved.value.createdAt, updatedAt: saved.value.updatedAt, durationMs: 2000, tempoBpm: 110, noteCount: 2, schemaVersion: 1 }
    ]);
    const removed = store.remove("rec-1");
    expect(removed.ok && removed.value).toBe(true);
    const missing = store.get("rec-1");
    expect(missing.ok && missing.value).toBeNull();
    const gone = store.remove("rec-1");
    expect(gone.ok && gone.value).toBe(false);
  });

  it("lists most recently updated first and renames in place", () => {
    const { store } = setup();
    store.save(makeRecording("a", "First"));
    store.save(makeRecording("b", "Second"));
    const renamed = store.rename("a", "  First renamed ");
    expect(renamed.ok && renamed.value.title).toBe("First renamed");
    const listed = store.list();
    expect(listed.ok && listed.value.map((entry) => entry.title)).toEqual(["First renamed", "Second"]);
    const empty = store.rename("a", "   ");
    expect(empty.ok).toBe(false);
    const nope = store.rename("zzz", "x");
    expect(nope.ok).toBe(false);
  });

  it("rejects invalid documents and reports the problems", () => {
    const { store } = setup();
    const bad = { ...makeRecording(), events: [{ type: "noteOn", atMs: -1, midi: 200, velocity: 300, source: "nope" }] } as unknown as PerformanceRecording;
    const result = store.save(bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid");
    expect(result.error.details.length).toBeGreaterThanOrEqual(4);
    expect(validateRecordingShape(null)).toEqual(["recording must be an object"]);
    expect(validateRecordingShape({ ...makeRecording(), kind: "project" })).toContain('recording.kind must be "recording"');
  });

  it("enforces the event count limit", () => {
    const { store } = setup();
    const tooMany = makeRecording();
    tooMany.events = Array.from({ length: MAX_RECORDING_EVENTS + 1 }, (_, index) => ({ type: "sustain" as const, atMs: index, value: 0, source: "midi" as const }));
    const result = store.save(tooMany);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.details[0]).toMatch(/at most/);
  });

  it("enforces the serialised size limit", () => {
    const { store } = setup();
    const huge = makeRecording();
    huge.events = Array.from({ length: 8000 }, (_, index) => ({ type: "sustain" as const, atMs: index, value: 0, source: "midi" as const, portId: "x".repeat(200) }));
    const result = store.save(huge);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid");
      expect(result.error.message).toMatch(/too large/);
    }
  });

  it("a quota failure keeps the previous record and leaves the caller's copy untouched", () => {
    const { adapter, arm } = quotaAdapter();
    const store = new RecordingStore(adapter, { now: steppingClock(), newId: counterIds() });
    const first = store.save(makeRecording());
    expect(first.ok).toBe(true);
    arm();
    const updated = makeRecording("rec-1", "Changed");
    const result = store.save(updated);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("quota");
    expect(updated.title).toBe("Changed");
    const stored = store.get("rec-1");
    expect(stored.ok && stored.value?.title).toBe("Take 1");
  });

  it("never opens or overwrites a record from a newer schema", () => {
    const { adapter, store } = setup();
    adapter.set(recordingKey("future"), JSON.stringify({ ...makeRecording("future"), schemaVersion: 99 }));
    const got = store.get("future");
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.error.code).toBe("unsupportedVersion");
    const overwrite = store.save(makeRecording("future"));
    expect(overwrite.ok).toBe(false);
    const listed = store.list();
    expect(listed.ok && listed.value[0]).toMatchObject({ id: "future", problem: "unsupportedVersion" });
  });

  it("rebuilds a missing or damaged index from the records", () => {
    const { adapter, store } = setup();
    store.save(makeRecording("a"));
    store.save(makeRecording("b"));
    adapter.set(RECORDING_INDEX_KEY, "{not json");
    const listed = store.list();
    expect(listed.ok && listed.value.map((entry) => entry.id).sort()).toEqual(["a", "b"]);
    expect(listed.ok && listed.warnings[0]).toMatch(/rebuilt/);
    adapter.remove(RECORDING_INDEX_KEY);
    adapter.set(recordingKey("broken"), "oops");
    const again = store.list();
    expect(again.ok && again.value.find((entry) => entry.id === "broken")?.problem).toBe("corrupt");
  });
});
