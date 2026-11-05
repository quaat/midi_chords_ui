import { beforeEach, describe, expect, it } from "vitest";
import type { PerformanceTimeline, PerformedNote } from "@/model/contracts";
import { getExerciseSpec } from "@/content";
import { compileExercise } from "@/practice/compileExercise";
import type { PracticePayload, PracticeRequest } from "@/ui/runtime/practicePayload";
import { chordPracticePayload } from "@/ui/runtime/practicePayload";
import { chordFromSymbol } from "@/music/chords";
import {
  allowedModes,
  clearRequestExtras,
  consumeConceptRequest,
  consumeRequestExtras,
  defaultMode,
  exerciseForRegion,
  exerciseFromPayload,
  getRequestExtras,
  materialPracticePayload,
  openWithExtras,
  peekConceptRequest,
  requestConcept,
  setRequestExtras,
  stepsFromTimeline
} from "@/ui/practice/practiceRequests";
import type { PracticeNavigator } from "@/ui/practice/practiceRequests";
import { openArrangementInPractice, openExerciseInPractice, openMaterialInPractice, openWarmupInPractice } from "@/ui/practice/openExercise";

/** A navigator that behaves like the runtime: the request store notifies synchronously. */
function fakeNavigator(onNotify?: (request: PracticeRequest) => void): PracticeNavigator & { opened: PracticePayload[] } {
  let request: PracticeRequest | null = null;
  let counter = 0;
  const opened: PracticePayload[] = [];
  return {
    opened,
    navigate: {
      openInPractice: (payload: PracticePayload) => {
        counter += 1;
        request = { ...payload, requestId: counter, requestedAt: 0 };
        opened.push(payload);
        if (onNotify) onNotify(request);
      }
    },
    practiceRequestStore: { getState: () => ({ request }) }
  };
}

function note(id: string, occurrenceId: string, midi: number, onsetBeat: number, extra: Partial<PerformedNote> = {}): PerformedNote {
  return { id, eventId: occurrenceId.split("#")[0], occurrenceId, part: "learner", midi, onsetBeat, durationBeats: 4, velocity: 90, ...extra };
}

function progressionTimeline(): PerformanceTimeline {
  const c = chordFromSymbol("C");
  const g = chordFromSymbol("G");
  return {
    id: "material@1",
    sourceId: "material",
    sourceVersion: 1,
    tempo: { bpm: 90 },
    timeSignature: { numerator: 4, denominator: 4 },
    notes: [
      note("a1", "ev-1#0", 64, 0, { role: "third", degree: "3" }),
      note("a0", "ev-1#0", 60, 0, { role: "root", degree: "1" }),
      note("a2", "ev-1#0", 67, 0, { role: "fifth", degree: "5" }),
      { ...note("acc", "ev-1#0", 36, 0), part: "accompaniment" },
      note("b0", "ev-2#0", 55, 4, { role: "root", degree: "1" }),
      note("b1", "ev-2#0", 59, 4, { role: "third", degree: "3" }),
      note("b2", "ev-2#0", 62, 4, { role: "fifth", degree: "5" })
    ],
    occurrences: [
      { occurrenceId: "ev-2#0", eventId: "ev-2", passIndex: 0, startBeat: 4, durationBeats: 4, symbol: "G", chord: g },
      { occurrenceId: "ev-1#0", eventId: "ev-1", passIndex: 0, startBeat: 0, durationBeats: 4, symbol: "C", chord: c },
      { occurrenceId: "ev-3#0", eventId: "ev-3", passIndex: 0, startBeat: 8, durationBeats: 4, symbol: "NC" }
    ],
    totalBeats: 12
  };
}

describe("request side-store", () => {
  beforeEach(() => clearRequestExtras());

  it("sets, reads and consumes extras by request id", () => {
    setRequestExtras(7, { source: "payload", mode: "timed" });
    expect(getRequestExtras(7)?.mode).toBe("timed");
    expect(getRequestExtras(8)).toBeNull();
    expect(consumeRequestExtras(7)?.mode).toBe("timed");
    expect(getRequestExtras(7)).toBeNull();
  });

  it("binds extras to the new request id, also for listeners notified inside openInPractice", () => {
    let seenInside: string | undefined;
    const runtime = fakeNavigator((request) => {
      seenInside = getRequestExtras(request.requestId)?.source;
    });
    const payload = chordPracticePayload(chordFromSymbol("C"), [{ midi: 60 }, { midi: 64 }, { midi: 67 }]);
    const id = openWithExtras(runtime, payload, { source: "exercise", mode: "step", assistance: "reduced" });
    expect(id).toBe(1);
    expect(seenInside).toBe("exercise");
    expect(getRequestExtras(1)?.assistance).toBe("reduced");
    // Pending extras do not leak to a later request opened without extras.
    runtime.navigate.openInPractice(payload);
    expect(getRequestExtras(2)).toBeNull();
  });

  it("hands a concept id to Learn exactly once", () => {
    requestConcept("triads");
    expect(peekConceptRequest()).toBe("triads");
    expect(consumeConceptRequest()).toBe("triads");
    expect(consumeConceptRequest()).toBeNull();
  });
});

describe("material → steps", () => {
  it("groups learner notes per occurrence (in time order) with a roles policy", () => {
    const steps = stepsFromTimeline(progressionTimeline());
    expect(steps.map((step) => step.occurrenceId)).toEqual(["ev-1#0", "ev-2#0"]);
    expect(steps[0].targets.map((n) => n.midi)).toEqual([60, 64, 67]);
    expect(steps[0].targets.every((n) => n.part === "learner")).toBe(true);
    expect(steps[0].policy).toEqual({ kind: "roles", requiredRoles: ["root", "third", "fifth"], octaveFree: true });
    expect(steps[1].chord?.symbol).toBe("G");
    expect(steps[0].hints.length).toBeGreaterThanOrEqual(3);
  });

  it("falls back to pitch classes when notes carry no roles", () => {
    const timeline = progressionTimeline();
    const bare = { ...timeline, notes: timeline.notes.map((n) => ({ ...n, role: undefined })) };
    expect(stepsFromTimeline(bare)[0].policy.kind).toBe("pitchClass");
  });

  it("builds a material payload and an exercise definition from it", () => {
    const payload = materialPracticePayload(progressionTimeline(), "My song");
    expect(payload.title).toBe("Practise: My song");
    expect(payload.exerciseId).toBe("material:material");
    const exercise = exerciseFromPayload(payload);
    expect(exercise.steps).toHaveLength(2);
    expect(exercise.policy.kind).toBe("roles");
    expect(exercise.contract).toBe("satisfyConstraints");
    expect(exercise.timing.mode).toBe("step");
    expect(allowedModes(exercise)).toEqual(["listen", "step", "timed", "free"]);
  });
});

describe("modes and regions", () => {
  it("derives modes from the policy and honours an allowed requested mode", () => {
    const spec = getExerciseSpec("ex-dorian-vs-minor-listen");
    const free = getExerciseSpec("ex-dorian-free-improv");
    const run = getExerciseSpec("ex-c-major-run-timed");
    expect(spec && free && run).toBeTruthy();
    if (!spec || !free || !run) return;
    const listen = compileExercise(spec);
    const improv = compileExercise(free);
    const timed = compileExercise(run);
    if (!listen.ok || !improv.ok || !timed.ok) throw new Error("compile failed");
    expect(allowedModes(listen.exercise)).toEqual(["listen"]);
    expect(defaultMode(listen.exercise, "timed")).toBe("listen");
    expect(allowedModes(improv.exercise)).toEqual(["listen", "free"]);
    expect(defaultMode(improv.exercise)).toBe("free");
    expect(defaultMode(timed.exercise)).toBe("timed");
    expect(defaultMode(timed.exercise, "step")).toBe("step");
  });

  it("restricts steps to a loop region (by occurrence ids or by start beat)", () => {
    const exercise = exerciseFromPayload(materialPracticePayload(progressionTimeline()));
    expect(exerciseForRegion(exercise, { startBeat: 4, endBeat: 8 }).steps.map((s) => s.occurrenceId)).toEqual(["ev-2#0"]);
    expect(exerciseForRegion(exercise, { startBeat: 0, endBeat: 8, occurrenceIds: ["ev-1#0"] }).steps).toHaveLength(1);
    expect(exerciseForRegion(exercise, null)).toBe(exercise);
  });
});

describe("open* entry points", () => {
  beforeEach(() => clearRequestExtras());

  it("openExerciseInPractice compiles, transposes and registers the definition", () => {
    const runtime = fakeNavigator();
    const result = openExerciseInPractice(runtime, "ex-ii-v-i-shells-c", { transposeTo: { letter: "F", accidental: 0 }, mode: "step", assistance: "reduced" });
    expect(result.ok).toBe(true);
    expect(runtime.opened).toHaveLength(1);
    expect(runtime.opened[0].title).toContain("in F");
    const extras = getRequestExtras(result.requestId ?? -1);
    expect(extras?.source).toBe("exercise");
    expect(extras?.specId).toBe("ex-ii-v-i-shells-c");
    expect(extras?.exercise?.key?.tonic.letter).toBe("F");
    expect(extras?.mode).toBe("step");
    expect(extras?.assistance).toBe("reduced");
    expect(extras?.sequence).toBeTruthy();
  });

  it("returns a message instead of throwing for unknown ids", () => {
    const runtime = fakeNavigator();
    expect(openExerciseInPractice(runtime, "nope").ok).toBe(false);
    expect(openArrangementInPractice(runtime, "nope", "nope").ok).toBe(false);
    expect(runtime.opened).toHaveLength(0);
  });

  it("delegates warm-up ids and keeps chart/arrangement ids and the section loop", () => {
    const runtime = fakeNavigator();
    const warm = openExerciseInPractice(runtime, "wu-five-finger-c", { tempoBpm: 50 });
    expect(warm.ok).toBe(true);
    expect(getRequestExtras(warm.requestId ?? -1)?.source).toBe("warmup");
    const direct = openWarmupInPractice(runtime, "wu-five-finger-c", { repeats: 2 });
    expect(direct.ok).toBe(true);

    const chart = openArrangementInPractice(runtime, "evening-loop", "evening-loop-simple", { sectionId: "B" });
    expect(chart.ok).toBe(true);
    const extras = getRequestExtras(chart.requestId ?? -1);
    expect(extras?.chartId).toBe("evening-loop");
    expect(extras?.arrangementId).toBe("evening-loop-simple");
    expect(extras?.chartExpansion?.bars.length).toBeGreaterThan(0);
    expect(extras?.loopRegion?.endBeat).toBeGreaterThan(extras?.loopRegion?.startBeat ?? 0);
    expect(extras?.exercise?.id).toBe("chart:evening-loop:evening-loop-simple");

    const chartOnly = openArrangementInPractice(runtime, "evening-loop", "evening-loop-chart-only");
    expect(chartOnly.ok).toBe(true);
    const onlyExercise = getRequestExtras(chartOnly.requestId ?? -1)?.exercise;
    expect(onlyExercise && allowedModes(onlyExercise)).toEqual(["listen", "free"]);
  });

  it("openMaterialInPractice opens one step per chord", () => {
    const runtime = fakeNavigator();
    const result = openMaterialInPractice(runtime, progressionTimeline(), "Sketch");
    expect(result.ok).toBe(true);
    expect(runtime.opened[0].steps).toHaveLength(2);
    expect(getRequestExtras(result.requestId ?? -1)?.mode).toBe("step");
  });
});
