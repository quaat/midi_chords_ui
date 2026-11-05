import { describe, expect, it } from "vitest";
import type { AttemptResult, ExerciseDefinition, NextAction, PerformanceTimeline, PerformedNote } from "@/model/contracts";
import { getChart } from "@/content";
import { expandChart } from "@/charts/expand";
import { chordFromSymbol } from "@/music/chords";
import { assistanceView, pianoOverrideFor, reducedAssistance, targetLabelFor } from "@/ui/practice/assistance";
import { barIndexAt, chartBarsFromExpansion, chartBarsFromTimeline } from "@/ui/practice/chartModel";
import { reviewActionFor } from "@/ui/practice/reviewActions";
import type { ReviewActionContext } from "@/ui/practice/reviewActions";
import { difficultTransitionLabels, reviewStepRows, transitionLabel } from "@/ui/practice/reviewModel";
import { freeTraceNotes, replayNotes, splitTargetId, timedTraceNotes } from "@/ui/practice/traceModel";
import type { TraceAttack } from "@/ui/practice/traceModel";
import { materialPracticePayload, exerciseFromPayload } from "@/ui/practice/practiceRequests";

function learner(id: string, occurrenceId: string, midi: number, onsetBeat: number, extra: Partial<PerformedNote> = {}): PerformedNote {
  return { id, eventId: occurrenceId.split("#")[0], occurrenceId, part: "learner", midi, onsetBeat, durationBeats: 2, velocity: 90, ...extra };
}

function twoChordTimeline(): PerformanceTimeline {
  return {
    id: "t",
    sourceId: "t",
    sourceVersion: 1,
    tempo: { bpm: 60 },
    timeSignature: { numerator: 4, denominator: 4 },
    notes: [
      learner("n1", "ev-1#0", 62, 0, { role: "root", degree: "1", hand: "left" }),
      learner("n2", "ev-1#0", 65, 0, { role: "third", degree: "b3" }),
      learner("n3", "ev-2#0", 67, 2, { role: "root", degree: "1", spelled: { letter: "G", accidental: 0, octave: 4 } }),
      learner("n4", "ev-2#0", 71, 2, { role: "third", degree: "3", finger: 3 })
    ],
    occurrences: [
      { occurrenceId: "ev-1#0", eventId: "ev-1", passIndex: 0, startBeat: 0, durationBeats: 2, symbol: "Dm7", chord: chordFromSymbol("Dm7") },
      { occurrenceId: "ev-2#0", eventId: "ev-2", passIndex: 0, startBeat: 2, durationBeats: 6, symbol: "G7", chord: chordFromSymbol("G7") }
    ],
    totalBeats: 8
  };
}

function exercise(): ExerciseDefinition {
  return exerciseFromPayload(materialPracticePayload(twoChordTimeline()));
}

const CONTEXT: ReviewActionContext = { assistance: "full", currentTempoBpm: 100, routineActive: false, canTranspose: true };

describe("assistance mapping", () => {
  it("progressively hides labels, then targets", () => {
    expect(assistanceView("full")).toEqual({ showTargets: true, showLabels: true, showLearnerLane: true, showNoteNames: true });
    expect(assistanceView("reduced")).toMatchObject({ showTargets: true, showLabels: false });
    expect(assistanceView("none")).toMatchObject({ showTargets: false, showLabels: false, showLearnerLane: false });
    expect(reducedAssistance("full")).toBe("reduced");
    expect(reducedAssistance("reduced")).toBe("none");
    expect(reducedAssistance("none")).toBe("none");
  });

  it("builds the piano override: targets + labels / targets only / nothing (never null labels)", () => {
    const notes = twoChordTimeline().notes.filter((n) => n.occurrenceId === "ev-1#0");
    const full = pianoOverrideFor(notes, null, "full", "chordDegrees");
    expect(full.owner).toBe("practice");
    expect(full.targets).toEqual([
      { midi: 62, hand: "left", role: "root" },
      { midi: 65, role: "third" }
    ]);
    expect(Array.from(full.labels.entries())).toEqual([
      [62, "1"],
      [65, "♭3"]
    ]);
    const reduced = pianoOverrideFor(notes, null, "reduced", "chordDegrees");
    expect(reduced.targets).toHaveLength(2);
    expect(reduced.labels.size).toBe(0);
    const none = pianoOverrideFor(notes, null, "none", "noteNames");
    expect(none.targets).toEqual([]);
    expect(none.labels.size).toBe(0);
  });

  it("labels targets per label mode", () => {
    const notes = twoChordTimeline().notes;
    expect(targetLabelFor(notes[2], "noteNames")).toBe("G");
    expect(targetLabelFor(notes[3], "fingers")).toBe("3");
    expect(targetLabelFor(notes[0], "fingers")).toBeNull();
    expect(targetLabelFor(notes[0], "none")).toBeNull();
  });
});

describe("review next-action mapping", () => {
  const action = (kind: NextAction["kind"], payload?: Record<string, unknown>): NextAction => ({ kind, label: `do ${kind}`, payload });

  it("maps every next action to one UI action", () => {
    expect(reviewActionFor(action("retrySlower", { tempoBpm: 64 }), CONTEXT)).toEqual({ type: "retryTimed", label: "do retrySlower", tempoBpm: 64 });
    expect(reviewActionFor(action("retrySlower"), CONTEXT)).toMatchObject({ type: "retryTimed", tempoBpm: 80 });
    expect(reviewActionFor(action("loopTransition", { startBeat: 0, endBeat: 8, occurrenceIds: ["ev-1#0", "ev-2#0"] }), CONTEXT)).toEqual({
      type: "loop",
      label: "do loopTransition",
      startBeat: 0,
      endBeat: 8,
      occurrenceIds: ["ev-1#0", "ev-2#0"]
    });
    expect(reviewActionFor(action("reduceHints", { hintLevel: 0 }), CONTEXT)).toMatchObject({ type: "restartAssisted", assistance: "reduced" });
    expect(reviewActionFor(action("reduceHints"), { ...CONTEXT, assistance: "reduced" })).toMatchObject({ type: "restartAssisted", assistance: "none" });
    expect(reviewActionFor(action("transpose", { tonic: { letter: "F", accidental: 0 } }), CONTEXT)).toEqual({ type: "transpose", label: "do transpose", tonic: { letter: "F", accidental: 0 } });
    expect(reviewActionFor(action("reviewConcept", { conceptId: "triads" }), CONTEXT)).toEqual({ type: "reviewConcept", label: "do reviewConcept", conceptId: "triads" });
    expect(reviewActionFor(action("continue"), CONTEXT)).toMatchObject({ type: "again" });
    expect(reviewActionFor(action("continue"), { ...CONTEXT, routineActive: true })).toMatchObject({ type: "routineNext" });
    expect(reviewActionFor(undefined, CONTEXT)).toMatchObject({ type: "again" });
  });

  it("falls back safely on malformed payloads or untransposable material", () => {
    expect(reviewActionFor(action("loopTransition", { startBeat: 4, endBeat: 2 }), CONTEXT)).toMatchObject({ type: "again" });
    expect(reviewActionFor(action("transpose", { tonic: { letter: "H", accidental: 0 } }), CONTEXT)).toMatchObject({ type: "again" });
    expect(reviewActionFor(action("transpose", { tonic: { letter: "F", accidental: 0 } }), { ...CONTEXT, canTranspose: false, routineActive: true })).toMatchObject({ type: "routineNext" });
    expect(reviewActionFor(action("reviewConcept"), CONTEXT)).toMatchObject({ type: "reviewConcept", conceptId: null });
  });
});

describe("review model", () => {
  const result: AttemptResult = {
    id: "a",
    exerciseId: "material:t",
    exerciseVersion: 1,
    scoringVersion: "x",
    startedAt: "2026-11-04T10:00:00.000Z",
    mode: "timed",
    inputSource: "midi",
    assistance: "none",
    hintLevel: 1,
    policy: { kind: "roles", requiredRoles: ["root", "third"] },
    pitch: [
      { stepId: "step-1", occurrenceId: "ev-1#0@0", expectedMidi: [62, 65], playedMidi: [62, 65], missingMidi: [], extraMidi: [], missingRoles: [], correct: true, attempts: 1, hintLevelUsed: 0 },
      { stepId: "step-2", occurrenceId: "ev-2#0@1", expectedMidi: [67, 71], playedMidi: [67, 70], missingMidi: [71], extraMidi: [70], missingRoles: ["third"], correct: false, attempts: 1, hintLevelUsed: 2 }
    ],
    timing: [],
    summary: { stepsCompleted: 1, stepsTotal: 2, difficultOccurrenceIds: ["ev-2#0", "ev-1#0"] }
  };

  it("names missing/extra notes and the hint level per step", () => {
    const rows = reviewStepRows(result, exercise());
    expect(rows[0]).toMatchObject({ label: "Dm7 (pass 1)", correct: true, missing: [], extra: [] });
    expect(rows[1]).toMatchObject({ label: "G7 (pass 2)", correct: false, hintLevelUsed: 2, missing: ["B4"], missingRoles: ["third"] });
    expect(rows[1].extra).toHaveLength(1);
    expect(rows[1].extra[0]).toMatch(/^(A♯4|B♭4)$/);
  });

  it("describes difficult transitions as changes into the occurrence", () => {
    expect(transitionLabel(exercise(), "ev-2#0@3")).toBe("Dm7 → G7");
    expect(transitionLabel(exercise(), "ev-1#0")).toBe("Dm7");
    expect(difficultTransitionLabels(result, exercise())).toEqual(["Dm7 → G7", "Dm7"]);
  });
});

describe("chart model", () => {
  it("groups timeline occurrences into bars with held-over cells", () => {
    const bars = chartBarsFromTimeline(twoChordTimeline());
    expect(bars).toHaveLength(2);
    expect(bars[0].cells.map((cell) => [cell.symbol, cell.beatInBar, cell.beats, cell.continuation])).toEqual([
      ["Dm7", 0, 2, false],
      ["G7", 2, 2, false]
    ]);
    expect(bars[1].cells.map((cell) => [cell.symbol, cell.continuation])).toEqual([["G7", true]]);
    expect(barIndexAt(bars, -1)).toBe(-1);
    expect(barIndexAt(bars, 0)).toBe(0);
    expect(barIndexAt(bars, 5.5)).toBe(1);
    expect(barIndexAt(bars, 8)).toBe(-1);
  });

  it("uses the chart expansion for section labels", () => {
    const chart = getChart("evening-loop");
    if (!chart) throw new Error("missing chart");
    const expansion = expandChart(chart);
    if (!expansion.ok) throw new Error(expansion.reason);
    const bars = chartBarsFromExpansion(expansion);
    expect(bars).toHaveLength(16);
    expect(bars.filter((bar) => bar.sectionLabel !== null).map((bar) => bar.sectionLabel)).toEqual(["A", "A", "B", "A"]);
    expect(bars[3].cells.map((cell) => cell.symbol)).toEqual(["F", "G"]);
  });
});

describe("learner trace", () => {
  const attack = (midi: number, atMs: number, onsetBeat: number, pass: number = 0): TraceAttack => ({ midi, velocity: 80, atMs, onsetBeat, durationBeats: 0.5, pass, released: true });
  const notesById = new Map(twoChordTimeline().notes.map((n) => [n.id, n]));

  it("splits target ids", () => {
    expect(splitTargetId("ev-1#0:learner:0@2")).toEqual({ noteId: "ev-1#0:learner:0", pass: 2 });
    expect(splitTargetId("plain")).toEqual({ noteId: "plain", pass: 0 });
  });

  it("gives credited attacks their verdict, uncredited old attacks 'extra' and misses their own position", () => {
    const attacks = [attack(62, 1000, 0), attack(65, 1010, 0), attack(80, 1020, 0.1)];
    const trace = timedTraceNotes(
      attacks,
      [
        { targetNoteId: "n1@0", occurrenceId: "ev-1#0@0", expectedOnsetMs: 990, actualOnsetMs: 1000, deltaMs: 10, verdict: "onTime" },
        { targetNoteId: "n2@0", occurrenceId: "ev-1#0@0", expectedOnsetMs: 900, actualOnsetMs: 1010, deltaMs: 110, verdict: "late" },
        { targetNoteId: "n3@0", occurrenceId: "ev-2#0@0", expectedOnsetMs: 3000, verdict: "missed" }
      ],
      notesById,
      { nowMs: 5000, searchWindowMs: 240, pass: 0, pitchClassOnly: false, finished: false }
    );
    expect(trace.find((n) => n.midi === 62)?.verdict).toBe("onTime");
    expect(trace.find((n) => n.midi === 65)?.verdict).toBe("late");
    expect(trace.find((n) => n.midi === 80)?.verdict).toBe("extra");
    expect(trace.find((n) => n.midi === 67)).toMatchObject({ verdict: "missed", onsetBeat: 2 });
  });

  it("leaves recent unmatched attacks undecided and hides other loop passes", () => {
    const trace = timedTraceNotes([attack(80, 4900, 0), attack(62, 100, 0, 1)], [], notesById, { nowMs: 5000, searchWindowMs: 240, pass: 0, pitchClassOnly: false, finished: false });
    expect(trace).toHaveLength(1);
    expect(trace[0].verdict).toBeUndefined();
  });

  it("free traces carry no verdicts and replay keeps clock spacing", () => {
    const attacks = [attack(60, 2000, 3), attack(64, 2500, 3.5)];
    expect(freeTraceNotes(attacks).every((n) => n.verdict === undefined)).toBe(true);
    const replay = replayNotes(attacks, 120);
    expect(replay.map((n) => [n.midi, n.onsetBeat])).toEqual([
      [60, 0],
      [64, 1]
    ]);
  });
});
