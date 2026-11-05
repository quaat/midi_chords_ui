import { describe, it, expect } from "vitest";
import {
  CAVEAT_NOT_OBSERVED,
  CAVEAT_SELF_ASSESSMENT,
  SCORING_VERSION,
  buildAttemptResult,
  chooseNextAction,
  compileExercise,
  describeResult,
  evidenceFromAttempt
} from "@/practice";
import type { AnswerPolicy, ExerciseDefinition, PitchObservation, TimingObservation } from "@/model/contracts";
import { baseSpec, rootlessSpec } from "./fixtures";

function compile(transposeTo?: { letter: "F"; accidental: 0 }, policy?: AnswerPolicy): ExerciseDefinition {
  const spec = policy ? rootlessSpec({ policy }) : rootlessSpec();
  const result = compileExercise(spec, transposeTo ? { transposeTo } : {});
  if (!result.ok) throw new Error(result.reason);
  return result.exercise;
}

function pitchObs(exercise: ExerciseDefinition, correct: boolean[], attempts: number[] = [], hints: number[] = []): PitchObservation[] {
  return exercise.steps.map((step, index) => ({
    stepId: step.id,
    occurrenceId: step.occurrenceId,
    expectedMidi: step.targets.map((n) => n.midi),
    playedMidi: [],
    missingMidi: [],
    extraMidi: [],
    missingRoles: [],
    correct: correct[index] ?? true,
    attempts: attempts[index] ?? 1,
    hintLevelUsed: hints[index] ?? 0
  }));
}

function timingObs(verdicts: TimingObservation["verdict"][], occurrenceId: string = "ev-1#0@0"): TimingObservation[] {
  return verdicts.map((verdict, index) => ({ targetNoteId: `n${index}`, occurrenceId, expectedOnsetMs: index * 500, verdict }));
}

const STARTED = "2026-11-04T10:00:00.000Z";

describe("buildAttemptResult", () => {
  it("summarises pitch and timing separately with the scoring version", () => {
    const exercise = compile();
    const result = buildAttemptResult({
      exercise,
      mode: "timed",
      pitch: pitchObs(exercise, [true, false, true]),
      timing: timingObs(["onTime", "late", "onTime", "missed"]),
      inputSource: "midi",
      startedAt: STARTED
    });
    expect(result.scoringVersion).toBe(SCORING_VERSION);
    expect(result.scoringVersion).toBe("2026-11-04.1");
    expect(result.summary.pitchCorrectRatio).toBeCloseTo(2 / 3);
    expect(result.summary.onsetsWithinWindowRatio).toBe(0.5);
    expect(result.exerciseVersion).toBe(1);
  });

  it("ranks difficult occurrences by misses", () => {
    const exercise = compile();
    const result = buildAttemptResult({ exercise, mode: "step", pitch: pitchObs(exercise, [true, true, false], [1, 3, 1]), timing: [], inputSource: "midi", startedAt: STARTED });
    expect(result.summary.difficultOccurrenceIds).toEqual(["ev-2#0", "ev-3#0"]);
  });
});

describe("chooseNextAction", () => {
  it("timing ratio < 0.6 → retrySlower at 80% tempo", () => {
    const exercise = compile();
    const result = buildAttemptResult({ exercise, mode: "timed", pitch: pitchObs(exercise, [true, true, true]), timing: timingObs(["late", "late", "onTime"]), inputSource: "midi", startedAt: STARTED, tempoBpm: 100 });
    expect(result.nextAction).toEqual({ kind: "retrySlower", label: "Try again slower, at 80 BPM", payload: { tempoBpm: 80 } });
  });

  it("repeated misses on one change → loopTransition over the two occurrences", () => {
    const exercise = compile();
    const result = buildAttemptResult({ exercise, mode: "step", pitch: pitchObs(exercise, [true, true, true], [1, 3, 1]), timing: [], inputSource: "midi", startedAt: STARTED });
    expect(result.nextAction?.kind).toBe("loopTransition");
    expect(result.nextAction?.payload).toEqual({ startBeat: 0, endBeat: 8, occurrenceIds: ["ev-1#0", "ev-2#0"] });
  });

  it("all correct with hints → reduceHints", () => {
    const exercise = compile();
    const result = buildAttemptResult({ exercise, mode: "step", pitch: pitchObs(exercise, [true, true, true], [], [2, 0, 0]), timing: [], inputSource: "midi", startedAt: STARTED, hintLevel: 2 });
    expect(chooseNextAction(result, exercise).kind).toBe("reduceHints");
  });

  it("all correct without hints → transpose to the next transfer key", () => {
    const exercise = compile();
    const result = buildAttemptResult({ exercise, mode: "step", pitch: pitchObs(exercise, [true, true, true]), timing: [], inputSource: "midi", startedAt: STARTED });
    expect(result.nextAction?.kind).toBe("transpose");
    expect(result.nextAction?.payload).toEqual({ tonic: { letter: "F", accidental: 0 } });
    const inF = compile({ letter: "F", accidental: 0 });
    const resultF = buildAttemptResult({ exercise: inF, mode: "step", pitch: pitchObs(inF, [true, true, true]), timing: [], inputSource: "midi", startedAt: STARTED });
    expect(resultF.nextAction?.payload).toEqual({ tonic: { letter: "B", accidental: -1 } });
  });

  it("all correct, no transfer keys → continue", () => {
    const spec = baseSpec({});
    const compiled = compileExercise(spec);
    if (!compiled.ok) throw new Error(compiled.reason);
    const exercise = compiled.exercise;
    const result = buildAttemptResult({ exercise, mode: "step", pitch: pitchObs(exercise, [true]), timing: [], inputSource: "midi", startedAt: STARTED });
    expect(result.nextAction?.kind).toBe("continue");
  });

  it("otherwise → reviewConcept", () => {
    const exercise = compile();
    const result = buildAttemptResult({ exercise, mode: "step", pitch: pitchObs(exercise, [true, false, true]), timing: [], inputSource: "midi", startedAt: STARTED });
    expect(result.nextAction).toEqual({ kind: "reviewConcept", label: "Review the idea behind this exercise, then try again", payload: { conceptId: "concept-test" } });
  });
});

describe("describeResult", () => {
  it("states pitch and timing lines and always the unobserved caveats", () => {
    const exercise = compile();
    const result = buildAttemptResult({ exercise, mode: "step", pitch: pitchObs(exercise, [true, true, false]), timing: [], inputSource: "midi", startedAt: STARTED });
    const description = describeResult(result, exercise);
    expect(description.pitchLine).toBe("Pitch: 2 of 3 steps correct.");
    expect(description.timingLine).toContain("not measured");
    expect(description.caveats).toContain(CAVEAT_NOT_OBSERVED);
    expect(description.caveats).toContain(CAVEAT_SELF_ASSESSMENT);
    expect(description.nextLine).toBe(result.nextAction?.label);
  });

  it("describes timing verdict counts", () => {
    const exercise = compile();
    const result = buildAttemptResult({ exercise, mode: "timed", pitch: [], timing: timingObs(["onTime", "late", "missed", "early"]), inputSource: "computerKeyboard", startedAt: STARTED });
    const description = describeResult(result, exercise);
    expect(description.timingLine).toBe("Timing: 1 of 4 onsets within ±120 ms (1 early, 1 late, 1 missed).");
    expect(description.caveats.some((c) => c.includes("approximate"))).toBe(true);
  });
});

describe("evidenceFromAttempt", () => {
  it("assisted when hints were used", () => {
    const exercise = compile();
    const result = buildAttemptResult({ exercise, mode: "step", pitch: pitchObs(exercise, [true, true, true]), timing: [], inputSource: "midi", startedAt: STARTED, hintLevel: 1 });
    expect(evidenceFromAttempt(result, exercise).map((e) => e.kind)).toEqual(["assisted"]);
  });

  it("assisted when assistance is full", () => {
    const exercise = compile();
    const result = buildAttemptResult({ exercise, mode: "step", pitch: pitchObs(exercise, [true, true, true]), timing: [], inputSource: "midi", startedAt: STARTED, assistance: "full" });
    expect(evidenceFromAttempt(result, exercise).map((e) => e.kind)).toEqual(["assisted"]);
  });

  it("independent when correct without hints", () => {
    const exercise = compile();
    const result = buildAttemptResult({ exercise, mode: "step", pitch: pitchObs(exercise, [true, true, true]), timing: [], inputSource: "midi", startedAt: STARTED, assistance: "reduced" });
    const evidence = evidenceFromAttempt(result, exercise);
    expect(evidence.map((e) => e.kind)).toEqual(["independent"]);
    expect(evidence[0].conceptId).toBe("concept-test");
    expect(evidence[0].attemptId).toBe(result.id);
  });

  it("no independent evidence when a step was wrong", () => {
    const exercise = compile();
    const result = buildAttemptResult({ exercise, mode: "step", pitch: pitchObs(exercise, [true, false, true]), timing: [], inputSource: "midi", startedAt: STARTED });
    expect(evidenceFromAttempt(result, exercise)).toEqual([]);
  });

  it("transfer when compiled into another key and independent", () => {
    const exercise = compile({ letter: "F", accidental: 0 });
    const result = buildAttemptResult({ exercise, mode: "step", pitch: pitchObs(exercise, [true, true, true]), timing: [], inputSource: "midi", startedAt: STARTED });
    expect(evidenceFromAttempt(result, exercise).map((e) => e.kind)).toEqual(["independent", "transfer"]);
  });

  it("listened for listen policy, and never read", () => {
    const exercise = compile(undefined, { kind: "listen" });
    const result = buildAttemptResult({ exercise, mode: "listen", pitch: [], timing: [], inputSource: "midi", startedAt: STARTED });
    const kinds = evidenceFromAttempt(result, exercise).map((e) => e.kind);
    expect(kinds).toEqual(["listened"]);
    expect(kinds).not.toContain("read");
  });
});
