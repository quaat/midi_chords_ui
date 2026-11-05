import type { AttemptResult, MusicalSequence, PitchObservation, ProgressEvidence, SongChart, TimingObservation } from "@/model/contracts";
import { createMemoryAdapter, type StorageAdapter } from "@/persistence/storage";

/** Clock that advances one second per call, starting at `start`. */
export function steppingClock(start = "2026-11-01T10:00:00.000Z", stepMs = 1000): () => Date {
  let current = Date.parse(start);
  return () => {
    const value = new Date(current);
    current += stepMs;
    return value;
  };
}

export function fixedClock(iso: string): () => Date {
  return () => new Date(iso);
}

export function counterIds(): (prefix: string) => string {
  let n = 0;
  return (prefix: string) => {
    n += 1;
    return `${prefix}-${n}`;
  };
}

export function makeSequence(id = "seq-1"): MusicalSequence {
  return {
    id,
    version: 1,
    title: "ii-V-I",
    tempo: { bpm: 96 },
    timeSignature: { numerator: 4, denominator: 4 },
    events: [
      { id: "e1", index: 0, kind: "chord", symbol: "Dm9", startBeat: 0, durationBeats: 4 },
      { id: "e2", index: 1, kind: "chord", symbol: "G13", startBeat: 4, durationBeats: 4 },
      { id: "e3", index: 2, kind: "chord", symbol: "Cmaj9", startBeat: 8, durationBeats: 8 }
    ],
    totalBeats: 16
  };
}

export function pitchObs(occurrenceId: string, correct: boolean, missingRoles: PitchObservation["missingRoles"] = [], missingMidi: number[] = []): PitchObservation {
  return {
    stepId: `step-${occurrenceId}`,
    occurrenceId,
    expectedMidi: [62, 65, 69, 72],
    playedMidi: [],
    missingMidi,
    extraMidi: [],
    missingRoles,
    correct,
    attempts: 1,
    hintLevelUsed: 0
  };
}

export function timingObs(occurrenceId: string, verdict: TimingObservation["verdict"]): TimingObservation {
  return { targetNoteId: `n-${occurrenceId}`, occurrenceId, expectedOnsetMs: 0, verdict };
}

export function makeAttempt(id: string, overrides: Partial<AttemptResult> = {}): AttemptResult {
  return {
    id,
    exerciseId: "ex-251",
    exerciseVersion: 1,
    scoringVersion: "1.0.0",
    startedAt: "2026-11-01T10:00:00.000Z",
    completedAt: "2026-11-01T10:05:00.000Z",
    mode: "step",
    inputSource: "midi",
    assistance: "none",
    hintLevel: 0,
    policy: { kind: "roles", requiredRoles: ["third", "seventh"] },
    pitch: [],
    timing: [],
    summary: { stepsCompleted: 3, stepsTotal: 3, difficultOccurrenceIds: [] },
    ...overrides
  };
}

export function makeEvidence(kind: ProgressEvidence["kind"], at: string, overrides: Partial<ProgressEvidence> = {}): ProgressEvidence {
  return { kind, conceptId: "ii-V-I", exerciseId: "ex-251", at, ...overrides };
}

export function makeChart(overrides: Partial<SongChart> = {}): SongChart {
  return {
    id: "chart-1",
    version: 1,
    title: "Original Blues",
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: { bpm: 100 },
    sections: [
      {
        id: "A",
        label: "A",
        bars: [
          { id: "b1", spans: [{ id: "s1", symbol: "C7", startBeat: 0, durationBeats: 4 }] },
          {
            id: "b2",
            spans: [
              { id: "s2", symbol: "F7", startBeat: 0, durationBeats: 2 },
              { id: "s3", symbol: "C7", startBeat: 2, durationBeats: 2 }
            ]
          }
        ]
      },
      { id: "B", label: "B", bars: [{ id: "b3", spans: [{ id: "s4", symbol: "G7", startBeat: 0, durationBeats: 4 }] }] }
    ],
    performanceOrder: ["A", "A", "B", "A"],
    provenance: { origin: "original", author: "Test" },
    arrangementIds: [],
    meta: { version: 1, status: "draft" },
    ...overrides
  };
}

/** Adapter whose set() throws a browser-style QuotaExceededError once armed. */
export function quotaAdapter(): { adapter: StorageAdapter; arm: () => void; disarm: () => void } {
  const inner = createMemoryAdapter();
  let armed = false;
  const adapter: StorageAdapter = {
    get: (key) => inner.get(key),
    set: (key, value) => {
      if (armed) {
        const error = new Error("The quota has been exceeded.");
        error.name = "QuotaExceededError";
        throw error;
      }
      inner.set(key, value);
    },
    remove: (key) => inner.remove(key),
    keys: () => inner.keys()
  };
  return { adapter, arm: () => { armed = true; }, disarm: () => { armed = false; } };
}

/** Adapter where every operation throws (e.g. storage revoked mid-session). */
export function brokenAdapter(): StorageAdapter {
  const boom = (): never => {
    const error = new Error("The operation is insecure.");
    error.name = "SecurityError";
    throw error;
  };
  return { get: boom, set: boom, remove: boom, keys: boom };
}
