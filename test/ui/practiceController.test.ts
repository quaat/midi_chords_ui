import { afterEach, describe, expect, it, vi } from "vitest";
import { StudioRuntimeCore } from "@/ui/runtime/runtimeCore";
import { getPracticeController } from "@/ui/practice/practiceController";
import { openExerciseInPractice } from "@/ui/practice/openExercise";
import { clearRequestExtras } from "@/ui/practice/practiceRequests";

let cleanups: Array<() => void> = [];

afterEach(() => {
  cleanups.forEach((cleanup) => cleanup());
  cleanups = [];
  clearRequestExtras();
  vi.useRealTimers();
});

function setup(): { runtime: StudioRuntimeCore; controller: ReturnType<typeof getPracticeController> } {
  const runtime = new StudioRuntimeCore();
  const controller = getPracticeController(runtime);
  cleanups.push(controller.attach());
  return { runtime, controller };
}

let clock = 0;
/** Input timestamps share the performance clock with the session (like real input). */
function tick(): number {
  clock = Math.max(clock + 5, performance.now());
  return clock;
}
function press(runtime: StudioRuntimeCore, midis: number[]): void {
  midis.forEach((midi) => {
    runtime.input.held.apply({ source: "touch", type: "noteOn", midi, velocity: 80, timestampMs: tick() });
  });
}
function release(runtime: StudioRuntimeCore, midis: number[]): void {
  midis.forEach((midi) => {
    runtime.input.held.apply({ source: "touch", type: "noteOff", midi, timestampMs: tick() });
  });
}

describe("practice controller (headless runtime)", () => {
  it("runs a step exercise from a request to a recorded attempt", () => {
    const { runtime, controller } = setup();
    const opened = openExerciseInPractice(runtime, "ex-c-triad-inversions", { mode: "step" });
    expect(opened.ok).toBe(true);
    let state = controller.getState();
    expect(state.requestId).toBe(opened.requestId);
    expect(state.mode).toBe("step");
    expect(state.status).toBe("running");
    expect(state.step?.stepIndex).toBe(0);

    const override = runtime.targetsOverrideStore.getState().override;
    const targets = state.step?.step?.targets.map((note) => note.midi) ?? [];
    expect(override?.owner).toBe("practice");
    expect(override?.targets.map((target) => target.midi)).toEqual(targets);
    expect(override?.labels?.size).toBeGreaterThan(0);

    controller.setAutoAdvance(false);
    const stepCount = state.step?.stepCount ?? 0;
    expect(stepCount).toBe(3);
    for (let index = 0; index < stepCount; index += 1) {
      const step = controller.getState().step?.step;
      const midis = step ? step.targets.map((note) => note.midi) : [];
      press(runtime, midis);
      expect(controller.getState().step?.phase).toBe("correct");
      expect(controller.getState().confirmation).toContain("Correct");
      release(runtime, midis);
      controller.nextStep();
    }
    state = controller.getState();
    expect(state.status).toBe("review");
    expect(state.review?.recorded).toBe(true);
    expect(state.review?.description.pitchLine).toContain("3 of 3");
    const progress = runtime.stores.progress.load();
    if (!progress.ok) throw new Error("progress");
    expect(progress.value.attempts).toHaveLength(1);
    expect(progress.value.attempts[0].mode).toBe("step");
    // Full visual help → assisted evidence, never "independent".
    expect(progress.value.evidence.map((e) => e.kind)).toContain("assisted");
    expect(progress.value.evidence.map((e) => e.kind)).not.toContain("independent");
    expect(runtime.targetsOverrideStore.getState().override).toBeNull();
  });

  it("explains a wrong answer, keeps the step, and advances automatically after a correct one", () => {
    vi.useFakeTimers();
    const { runtime, controller } = setup();
    openExerciseInPractice(runtime, "ex-c-triad-inversions", { mode: "step" });
    const step = controller.getState().step?.step;
    const midis = step ? step.targets.map((note) => note.midi) : [];
    press(runtime, [midis[0], midis[1], midis[2] + 1]);
    expect(controller.getState().step?.phase).toBe("retry");
    expect(controller.getState().step?.explanation.length).toBeGreaterThan(0);
    release(runtime, [midis[0], midis[1], midis[2] + 1]);
    press(runtime, midis);
    expect(controller.getState().step?.phase).toBe("correct");
    vi.advanceTimersByTime(650);
    expect(controller.getState().step?.stepIndex).toBe(1);
  });

  it("maps assistance levels onto the piano target layer", () => {
    const { runtime, controller } = setup();
    openExerciseInPractice(runtime, "ex-c-triad-inversions", { mode: "step", assistance: "reduced" });
    let override = runtime.targetsOverrideStore.getState().override;
    expect(override?.targets.length).toBeGreaterThan(0);
    expect(override?.labels?.size).toBe(0);
    controller.setAssistance("none");
    override = runtime.targetsOverrideStore.getState().override;
    expect(override?.targets).toEqual([]);
    expect(controller.getState().status).toBe("running");
  });

  it("records listened evidence for a listening exercise and free takes with self-assessment only", () => {
    const { runtime, controller } = setup();
    openExerciseInPractice(runtime, "ex-dorian-vs-minor-listen");
    expect(controller.getState().mode).toBe("listen");
    controller.markListened();
    expect(controller.getState().review?.unscored).toBe(true);

    openExerciseInPractice(runtime, "ex-dorian-free-improv");
    expect(controller.getState().mode).toBe("free");
    controller.startFreeTake();
    expect(controller.getState().status).toBe("running");
    controller.stopFreeTake();
    expect(controller.getState().status).toBe("reflect");
    controller.saveFreeTake("  Tried the B natural on beat 3.  ");
    const review = controller.getState().review;
    expect(review?.unscored).toBe(true);
    expect(review?.result.selfAssessment).toBe("Tried the B natural on beat 3.");
    expect(review?.result.mode).toBe("free");

    const progress = runtime.stores.progress.load();
    if (!progress.ok) throw new Error("progress");
    expect(progress.value.attempts.map((a) => a.mode)).toEqual(["listen", "free"]);
    expect(progress.value.evidence.every((e) => e.kind === "listened")).toBe(true);
    expect(progress.value.evidence.length).toBeGreaterThan(0);
  });

  it("mutes the learner part for a timed take and restores it after review", () => {
    const { runtime, controller } = setup();
    openExerciseInPractice(runtime, "ex-c-major-run-timed");
    expect(controller.getState().mode).toBe("timed");
    expect(controller.getState().status).toBe("ready");
    controller.setTempo(66);
    controller.startTimed();
    expect(runtime.transport.isPartMuted("learner")).toBe(true);
    expect(controller.getState().status).toBe("running");
    controller.stopTimed();
    expect(runtime.transport.isPartMuted("learner")).toBe(false);
    const state = controller.getState();
    expect(state.status).toBe("review");
    expect(state.review?.result.mode).toBe("timed");
    expect(state.review?.result.tempoBpm).toBe(66);
  });

  it("applies a loop action to step practice and reopens transposed material", () => {
    const { runtime, controller } = setup();
    openExerciseInPractice(runtime, "ex-ii-v-i-shells-c", { mode: "step" });
    const exercise = controller.getState().exercise;
    if (!exercise) throw new Error("no exercise");
    const [first, second] = exercise.steps;
    const start = exercise.timeline.occurrences.find((o) => o.occurrenceId === first.occurrenceId)?.startBeat ?? 0;
    const end = (exercise.timeline.occurrences.find((o) => o.occurrenceId === second.occurrenceId)?.startBeat ?? 0) + 4;
    controller.applyReviewAction({ type: "loop", label: "Loop", startBeat: start, endBeat: end, occurrenceIds: [first.occurrenceId, second.occurrenceId] });
    expect(controller.getState().loopEnabled).toBe(true);
    expect(controller.getState().step?.stepCount).toBe(2);

    const before = controller.getState().requestId ?? 0;
    controller.applyReviewAction({ type: "transpose", label: "F", tonic: { letter: "F", accidental: 0 } });
    const after = controller.getState();
    expect(after.requestId).toBeGreaterThan(before);
    expect(after.exercise?.key?.tonic.letter).toBe("F");
    expect(after.mode).toBe("step");
  });
});
