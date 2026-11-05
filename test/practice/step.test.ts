import { describe, it, expect, vi } from "vitest";
import { StepPracticeSession, compileExercise } from "@/practice";
import type { ExerciseDefinition, TimingPolicy } from "@/model/contracts";
import type { ExerciseSpec } from "@/content/authoring";
import { HeldStateTracker } from "@/input";
import { baseSpec, rootlessSpec } from "./fixtures";

function compile(spec: ExerciseSpec): ExerciseDefinition {
  const result = compileExercise(spec);
  if (!result.ok) throw new Error(result.reason);
  return result.exercise;
}

function chord(session: StepPracticeSession, midis: number[], at: number, source: string = "midi"): void {
  midis.forEach((midi, index) => session.onAttack(midi, at + index * 10, source));
}

function release(session: StepPracticeSession, midis: number[], at: number): void {
  midis.forEach((midi) => session.onRelease(midi, at));
}

const DM9 = [53, 57, 60, 64];
const G13 = [53, 57, 59, 64];
const CMAJ9 = [52, 55, 59, 62];

describe("StepPracticeSession", () => {
  it("advances through the rootless ii–V–I and completes with a step AttemptResult", () => {
    const session = new StepPracticeSession();
    session.start(compile(rootlessSpec()), { clock: () => Date.UTC(2026, 10, 4) });
    expect(session.getState().phase).toBe("waiting");
    chord(session, DM9, 0);
    expect(session.getState().phase).toBe("correct");
    release(session, DM9, 500);
    expect(session.next(600)).toBe(true);
    chord(session, G13, 1000);
    release(session, G13, 1500);
    session.next(1600);
    chord(session, CMAJ9, 2000);
    session.next(2100);
    const state = session.getState();
    expect(state.phase).toBe("complete");
    expect(state.result?.mode).toBe("step");
    expect(state.result?.summary.pitchCorrectRatio).toBe(1);
    expect(state.result?.pitch).toHaveLength(3);
    expect(state.result?.timing).toEqual([]);
  });

  it("a wrong extra note under exactVoicing goes to retry and does not advance", () => {
    const session = new StepPracticeSession();
    session.start(compile(rootlessSpec()));
    chord(session, [53, 57, 59, 64], 0);
    const state = session.getState();
    expect(state.phase).toBe("retry");
    expect(state.explanation).toContain("The seventh (C4) is missing");
    expect(state.explanation).toContain("B is not in Dm9");
    expect(session.next()).toBe(false);
    expect(session.getState().stepIndex).toBe(0);
  });

  it("an extra fifth note within the window still fails exactVoicing", () => {
    const session = new StepPracticeSession();
    session.start(compile(rootlessSpec()));
    chord(session, [53, 57, 60, 59], 0);
    expect(session.getState().phase).toBe("retry");
  });

  it("a note held over from the previous step does not count until re-attacked", () => {
    // Steps C4 then C4+E4: holding C4 from step 1 and adding E4 must not complete step 2.
    const spec = baseSpec({
      material: {
        kind: "explicitNotes",
        steps: [
          { prompt: "C", notes: [{ midi: 60 }], durationBeats: 1 },
          { prompt: "C+E", notes: [{ midi: 60 }, { midi: 64 }], durationBeats: 1 }
        ]
      }
    });
    const session = new StepPracticeSession();
    session.start(compile(spec));
    session.onAttack(60, 0, "midi");
    expect(session.getState().phase).toBe("correct");
    session.next(100);
    expect(session.getState().heldOver).toEqual([60]);
    session.onAttack(64, 200, "midi");
    session.tick(400);
    expect(session.getState().phase).toBe("retry");
    // Re-strike C4: now both count.
    session.onRelease(60, 450);
    session.onAttack(60, 500, "midi");
    expect(session.getState().phase).toBe("correct");
  });

  it("a repeated identical chord in the next step needs a fresh attack", () => {
    const spec = baseSpec({
      material: {
        kind: "explicitNotes",
        steps: [
          { prompt: "C", notes: [{ midi: 60 }, { midi: 64 }, { midi: 67 }], durationBeats: 4 },
          { prompt: "C again", notes: [{ midi: 60 }, { midi: 64 }, { midi: 67 }], durationBeats: 4 }
        ]
      }
    });
    const session = new StepPracticeSession();
    session.start(compile(spec));
    chord(session, [60, 64, 67], 0);
    session.next(100);
    expect(session.getState().phase).toBe("waiting");
    session.tick(1000);
    expect(session.getState().phase).toBe("waiting");
    expect(session.getState().counted).toEqual([]);
    release(session, [60, 64, 67], 1100);
    chord(session, [60, 64, 67], 1200);
    expect(session.getState().phase).toBe("correct");
  });

  it("pedal residue does not count by default", () => {
    const spec = baseSpec({
      material: {
        kind: "explicitNotes",
        steps: [
          { prompt: "C", notes: [{ midi: 60 }], durationBeats: 1 },
          { prompt: "C+E", notes: [{ midi: 60 }, { midi: 64 }], durationBeats: 1 }
        ]
      }
    });
    const session = new StepPracticeSession();
    session.start(compile(spec));
    session.onAttack(60, 0, "midi");
    session.next(50);
    session.onPedal(true, 100);
    session.onAttack(60, 200, "midi");
    session.onRelease(60, 250);
    expect(session.getState().sustained).toEqual([60]);
    session.onAttack(64, 300, "midi");
    session.tick(1000);
    expect(session.getState().phase).toBe("retry");
    expect(session.getState().counted).toEqual([64]);
  });

  it("pedal-sustained notes count when timing.sustainCounts is true", () => {
    const timing: TimingPolicy = { mode: "step", assemblyWindowMs: 60, sustainCounts: true };
    const spec = baseSpec({
      timing,
      material: { kind: "explicitNotes", steps: [{ prompt: "C+E", notes: [{ midi: 60 }, { midi: 64 }], durationBeats: 1 }] }
    });
    const session = new StepPracticeSession();
    session.start(compile(spec));
    session.onPedal(true, 0);
    session.onAttack(60, 10, "midi");
    session.onRelease(60, 20);
    session.onAttack(64, 500, "midi");
    expect(session.getState().phase).toBe("correct");
  });

  it("accompaniment and demonstration sources are ignored", () => {
    const session = new StepPracticeSession();
    session.start(compile(rootlessSpec()));
    chord(session, DM9, 0, "accompaniment");
    chord(session, DM9, 100, "demonstration");
    chord(session, DM9, 200, "metronome");
    expect(session.getState().phase).toBe("waiting");
    expect(session.getState().pressed).toEqual([]);
    chord(session, DM9, 300, "replay");
    expect(session.getState().phase).toBe("correct");
  });

  it("evaluates a partial chord once the assembly window elapses (tick)", () => {
    vi.useFakeTimers();
    const session = new StepPracticeSession();
    session.start(compile(rootlessSpec()));
    session.onAttack(53, 0, "midi");
    session.onAttack(57, 30, "midi");
    session.tick(40);
    expect(session.getState().phase).toBe("waiting");
    session.tick(60);
    expect(session.getState().phase).toBe("retry");
    expect(session.getState().attempts).toBe(1);
    // Keep holding and add the missing notes: the held notes still count.
    session.onAttack(60, 500, "midi");
    session.onAttack(64, 520, "midi");
    expect(session.getState().phase).toBe("correct");
    vi.useRealTimers();
  });

  it("staggered attacks inside the window are judged as one chord", () => {
    const session = new StepPracticeSession();
    session.start(compile(rootlessSpec()));
    session.onAttack(53, 0, "midi");
    session.onAttack(57, 20, "midi");
    session.onAttack(60, 45, "midi");
    session.onAttack(64, 55, "midi");
    expect(session.getState().phase).toBe("correct");
    expect(session.getState().attempts).toBe(1);
  });

  it("the hint ladder advances and is recorded", () => {
    const session = new StepPracticeSession();
    const exercise = compile(rootlessSpec());
    session.start(exercise);
    expect(session.getState().nextHint).toBe("Look at the keyboard.");
    expect(session.requestHint()).toBe("Look at the keyboard.");
    expect(session.requestHint()).toBe("Find the group of two black keys.");
    expect(session.requestHint()).toBe("Play F3 A3 C4 E4");
    expect(session.requestHint()).toBe("Play F3 A3 C4 E4");
    expect(session.getState().hintLevel).toBe(3);
    chord(session, DM9, 0);
    expect(session.getState().observations[0].hintLevelUsed).toBe(3);
    session.next();
    expect(session.getState().hintLevel).toBe(0);
  });

  it("skip records a not-correct observation; restart clears", () => {
    const session = new StepPracticeSession();
    session.start(compile(rootlessSpec()));
    session.skip();
    expect(session.getState().stepIndex).toBe(1);
    expect(session.getState().observations[0].correct).toBe(false);
    session.restart();
    expect(session.getState().stepIndex).toBe(0);
    expect(session.getState().observations).toEqual([]);
  });

  it("listening phase ignores attacks until the demonstration ends", () => {
    const session = new StepPracticeSession();
    session.start(compile(rootlessSpec()), { demonstrate: true });
    expect(session.getState().phase).toBe("listening");
    chord(session, DM9, 0);
    expect(session.getState().phase).toBe("listening");
    session.onDemonstrationEnded(100);
    expect(session.getState().phase).toBe("waiting");
    expect(session.getState().heldOver).toEqual(DM9);
    release(session, DM9, 200);
    chord(session, DM9, 300);
    expect(session.getState().phase).toBe("correct");
  });

  it("attacks timestamped before the step began are not fresh", () => {
    const session = new StepPracticeSession();
    session.start(compile(rootlessSpec()), { nowMs: 1000 });
    chord(session, DM9, 500);
    expect(session.getState().phase).toBe("waiting");
  });

  it("works with HeldStateTracker changes", () => {
    const tracker = new HeldStateTracker();
    const session = new StepPracticeSession();
    session.start(compile(rootlessSpec()));
    tracker.onChange((change) => session.onInputChange(change));
    DM9.forEach((midi, index) => tracker.apply({ source: "computerKeyboard", type: "noteOn", midi, velocity: 90, timestampMs: index * 5 }));
    expect(session.getState().phase).toBe("correct");
    session.next();
    expect(session.getState().heldOver).toEqual(DM9);
  });

  it("notifies subscribers and caches state between changes", () => {
    const session = new StepPracticeSession();
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);
    session.start(compile(rootlessSpec()));
    expect(listener).toHaveBeenCalled();
    expect(session.getState()).toBe(session.getState());
    unsubscribe();
  });
});
