import { describe, expect, it } from "vitest";
import type { AttemptResult, ProgressEvidence, ProgressFile } from "@/model/contracts";
import { contentBundle, getExerciseSpec } from "@/content";
import { createMemoryAdapter, createStores } from "@/persistence";
import { compileExercise } from "@/practice/compileExercise";
import {
  EVIDENCE_COLUMNS,
  continueModel,
  continueTarget,
  evidenceRows,
  occurrenceDescriber,
  reviewCandidates,
  scoringVersionSummary,
  suggestionRows,
  transitionRows
} from "@/ui/myPractice/progressModel";
import { notifyProgressChanged, progressViewStoreFor } from "@/ui/myPractice/progressStore";

const C_MAJOR = { tonic: { letter: "C" as const, accidental: 0 as const }, mode: "major" as const };
const F_MAJOR = { tonic: { letter: "F" as const, accidental: 0 as const }, mode: "major" as const };

function evidence(kind: ProgressEvidence["kind"], conceptId: string, at: string, extra: Partial<ProgressEvidence> = {}): ProgressEvidence {
  return { kind, conceptId, at, ...extra };
}

function attempt(id: string, exerciseId: string, at: string, extra: Partial<AttemptResult> = {}): AttemptResult {
  return {
    id,
    exerciseId,
    exerciseVersion: 1,
    scoringVersion: "2026-11-04.1",
    startedAt: at,
    completedAt: at,
    mode: "step",
    inputSource: "midi",
    assistance: "none",
    hintLevel: 0,
    policy: { kind: "exactVoicing" },
    pitch: [],
    timing: [],
    summary: { stepsCompleted: 0, stepsTotal: 0, difficultOccurrenceIds: [] },
    ...extra
  };
}

function file(partial: Partial<ProgressFile>): ProgressFile {
  return { schemaVersion: 1, kind: "progress", attempts: [], evidence: [], routineState: {}, goals: [], updatedAt: "2026-11-04T00:00:00.000Z", ...partial };
}

describe("evidence rows", () => {
  it("keeps read / listened / assisted / independent / transfer as separate counts", () => {
    const progress = file({
      evidence: [
        evidence("read", "triads", "2026-11-01T10:00:00.000Z"),
        evidence("listened", "triads", "2026-11-01T10:01:00.000Z"),
        evidence("assisted", "triads", "2026-11-02T10:00:00.000Z", { key: C_MAJOR, tempoBpm: 72, assistance: "full" }),
        evidence("independent", "triads", "2026-11-03T10:00:00.000Z", { key: C_MAJOR, tempoBpm: 72, assistance: "none" }),
        evidence("independent", "triads", "2026-11-03T10:05:00.000Z", { key: F_MAJOR, tempoBpm: 72, assistance: "none" }),
        evidence("transfer", "triads", "2026-11-03T10:05:00.000Z", { key: F_MAJOR, tempoBpm: 72, assistance: "none" }),
        evidence("listened", "modes", "2026-10-01T10:00:00.000Z")
      ]
    });
    const rows = evidenceRows(progress, (id) => `Title ${id}`);
    expect(rows.map((row) => row.conceptId)).toEqual(["triads", "modes"]);
    expect(rows[0].title).toBe("Title triads");
    expect(rows[0].counts).toEqual({ read: 1, listened: 1, assisted: 1, independent: 2, transfer: 1 });
    expect(Object.keys(rows[0].counts).sort()).toEqual(EVIDENCE_COLUMNS.map((c) => c.kind).sort());
    expect(rows[0]).not.toHaveProperty("mastery");
    const fCombo = rows[0].combos.find((combo) => combo.label.startsWith("F"));
    expect(fCombo?.label).toBe("F major · 72 BPM · no hints");
    expect(fCombo?.counts).toEqual({ read: 0, listened: 0, assisted: 0, independent: 1, transfer: 1 });
    expect(rows[1].counts).toEqual({ read: 0, listened: 1, assisted: 0, independent: 0, transfer: 0 });
  });
});

describe("suggestions", () => {
  it("uses every published exercise spec with its first concept as a candidate", () => {
    const candidates = reviewCandidates(contentBundle.exerciseSpecs);
    expect(candidates.length).toBeGreaterThan(5);
    candidates.forEach((candidate) => {
      const spec = getExerciseSpec(candidate.exerciseId);
      expect(spec?.conceptIds[0]).toBe(candidate.conceptId);
    });
  });

  it("returns at most five rows, each with its transparent reason and titles", () => {
    const spec = contentBundle.exerciseSpecs[0];
    const progress = file({
      evidence: [evidence("independent", spec.conceptIds[0], "2026-10-01T10:00:00.000Z", { exerciseId: spec.id })],
      attempts: [attempt("a1", spec.id, "2026-10-01T10:00:00.000Z")]
    });
    const rows = suggestionRows(progress, "2026-11-04T10:00:00.000Z", contentBundle.exerciseSpecs, (id) => `Concept ${id}`, { limit: 5 });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(5);
    rows.forEach((row) => {
      expect(row.reason.length).toBeGreaterThan(10);
      expect(row.title).not.toBe("");
      expect(row.conceptTitle).toBe(`Concept ${row.conceptId}`);
    });
  });
});

describe("difficult transitions", () => {
  it("describes occurrences with chord symbols from the compiled exercise", () => {
    const spec = getExerciseSpec("ex-ii-v-i-shells-c");
    if (!spec) throw new Error("missing spec");
    const compiled = compileExercise(spec);
    if (!compiled.ok) throw new Error(compiled.reason);
    const second = compiled.exercise.steps[1];
    const progress = file({
      attempts: [
        attempt("a1", spec.id, "2026-11-01T10:00:00.000Z", {
          pitch: [{ stepId: second.id, occurrenceId: second.occurrenceId, expectedMidi: [1], playedMidi: [2], missingMidi: [1], extraMidi: [2], missingRoles: ["third"], correct: false, attempts: 2, hintLevelUsed: 0 }],
          summary: { stepsCompleted: 0, stepsTotal: 3, difficultOccurrenceIds: [second.occurrenceId] }
        })
      ]
    });
    const describe = occurrenceDescriber((id) => (id === spec.id ? compiled.exercise : null));
    const rows = transitionRows(progress, () => "Shells", describe);
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("Dm7 → G7");
    expect(rows[0].exerciseTitle).toBe("Shells");
    expect(rows[0].missingRoles).toContain("third");
    expect(describe("unknown", "x")).toBeUndefined();
  });
});

describe("continue", () => {
  it("turns the last attempt's next action into something to open", () => {
    expect(continueTarget(attempt("a", "ex-x", "t", { mode: "timed", nextAction: { kind: "retrySlower", label: "slower", payload: { tempoBpm: 64 } } }))).toEqual({
      kind: "exercise",
      exerciseId: "ex-x",
      mode: "timed",
      tempoBpm: 64
    });
    expect(continueTarget(attempt("a", "ex-x", "t", { nextAction: { kind: "transpose", label: "F", payload: { tonic: { letter: "F", accidental: 0 } } } }))).toMatchObject({ transposeTo: { letter: "F", accidental: 0 } });
    expect(continueTarget(attempt("a", "ex-x", "t", { assistance: "full", nextAction: { kind: "reduceHints", label: "fewer" } }))).toMatchObject({ assistance: "reduced" });
    expect(continueTarget(attempt("a", "ex-x", "t", { nextAction: { kind: "reviewConcept", label: "read", payload: { conceptId: "triads" } } }))).toEqual({ kind: "concept", conceptId: "triads" });
    expect(continueTarget(attempt("a", "ex-x", "t", { nextAction: { kind: "loopTransition", label: "loop", payload: { startBeat: 4, endBeat: 12, occurrenceIds: ["a", "b"] } } }))).toMatchObject({
      mode: "step",
      loopRegion: { startBeat: 4, endBeat: 12, occurrenceIds: ["a", "b"] }
    });
    expect(continueTarget(attempt("a", "chart:evening-loop:evening-loop-simple", "t"))).toEqual({ kind: "chart", chartId: "evening-loop", arrangementId: "evening-loop-simple" });
    expect(continueTarget(attempt("a", "explore:C", "t"))).toBeNull();
  });

  it("picks the most recent attempt", () => {
    const progress = file({ attempts: [attempt("old", "ex-a", "2026-11-01T10:00:00.000Z"), attempt("new", "ex-b", "2026-11-03T10:00:00.000Z")] });
    const model = continueModel(progress, (id) => id.toUpperCase());
    expect(model?.attempt.id).toBe("new");
    expect(model?.title).toBe("EX-B");
    expect(continueModel(file({}), (id) => id)).toBeNull();
  });
});

describe("scoring version note", () => {
  it("mentions attempts scored with another version without rewriting them", () => {
    const progress = file({ attempts: [attempt("a", "ex-a", "t", { scoringVersion: "old-1" }), attempt("b", "ex-a", "t", { scoringVersion: "cur" })] });
    const note = scoringVersionSummary(progress, "cur");
    expect(note).toContain("1 attempt was scored");
    expect(note).toContain("old-1");
    expect(scoringVersionSummary(progress, "old-1")).toContain("cur");
    expect(scoringVersionSummary(file({ attempts: [attempt("b", "ex-a", "t", { scoringVersion: "cur" })] }), "cur")).toBeNull();
  });
});

describe("progress view store", () => {
  it("caches one snapshot per store and reloads after writes", () => {
    const stores = createStores(createMemoryAdapter());
    const cache = progressViewStoreFor(stores.progress);
    expect(progressViewStoreFor(stores.progress)).toBe(cache);
    const first = cache.getSnapshot();
    expect(first.progress?.goals).toEqual([]);
    expect(cache.getSnapshot()).toBe(first);
    let notified = 0;
    const off = cache.subscribe(() => {
      notified += 1;
    });
    stores.progress.setGoals(["Play shells in three keys"]);
    notifyProgressChanged();
    expect(notified).toBe(1);
    const second = cache.getSnapshot();
    expect(second).not.toBe(first);
    expect(second.version).toBeGreaterThan(first.version);
    expect(second.progress?.goals).toEqual(["Play shells in three keys"]);
    off();
  });

  it("reports unreadable progress as an error instead of throwing", () => {
    const adapter = createMemoryAdapter({ "pls:progress": "{not json" });
    const stores = createStores(adapter);
    const snapshot = progressViewStoreFor(stores.progress).getSnapshot();
    expect(snapshot.progress).toBeNull();
    expect(snapshot.error).toBeTruthy();
  });
});
