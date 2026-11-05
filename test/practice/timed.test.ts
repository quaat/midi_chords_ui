import { describe, it, expect } from "vitest";
import { TimedPracticeSession, compileExercise } from "@/practice";
import type { TimedSnapshot } from "@/practice";
import type { ExerciseDefinition, TransportState } from "@/model/contracts";
import { baseSpec, TIMED } from "./fixtures";

function runExercise(): ExerciseDefinition {
  const spec = baseSpec({
    timing: TIMED,
    tempoBpm: 120,
    material: {
      kind: "explicitNotes",
      steps: [
        { prompt: "C", notes: [{ midi: 60 }], durationBeats: 1 },
        { prompt: "D", notes: [{ midi: 62 }], durationBeats: 1 },
        { prompt: "E", notes: [{ midi: 64 }], durationBeats: 1 },
        { prompt: "F", notes: [{ midi: 65 }], durationBeats: 1 }
      ]
    }
  });
  const result = compileExercise(spec);
  if (!result.ok) throw new Error(result.reason);
  return result.exercise;
}

function snap(state: TransportState, positionBeats: number, generation: number, loop: { startBeat: number; endBeat: number } | null = null): TimedSnapshot {
  return { state, positionBeats, positionSeconds: positionBeats / 2, tempoBpm: 120, totalBeats: 4, loop, generation };
}

function setup(options: { loop?: { startBeat: number; endBeat: number }; latencyOffsetMs?: number } = {}) {
  const clock = { t: 0 };
  const session = new TimedPracticeSession();
  session.start(runExercise(), { tempoBpm: 120, latencyOffsetMs: options.latencyOffsetMs ?? 0, countInBeats: 4, loop: options.loop ?? null, clock: () => clock.t });
  // Count-in from t = 0, playing at beat 0 from t = 2000 (500 ms per beat).
  session.onTransportSnapshot(snap("countingIn", -4, 1, options.loop ?? null));
  return { session, clock };
}

function play(session: TimedPracticeSession, clock: { t: number }, loop: { startBeat: number; endBeat: number } | null = null): void {
  clock.t = 2000;
  session.onTransportSnapshot(snap("playing", 0, 1, loop));
}

describe("TimedPracticeSession", () => {
  it("ignores count-in attacks", () => {
    const { session, clock } = setup();
    clock.t = 500;
    session.onAttack(60, 500, "midi");
    play(session, clock);
    clock.t = 5000;
    const result = session.finish();
    expect(result?.timing[0].verdict).toBe("missed");
    expect(session.getState().extraAttacks).toBe(0);
  });

  it("credits an attack just before beat 0 that anticipates the downbeat", () => {
    const { session, clock } = setup();
    clock.t = 1900;
    session.onAttack(60, 1900, "midi");
    play(session, clock);
    clock.t = 5000;
    const result = session.finish();
    expect(result?.timing[0].verdict).toBe("onTime");
    expect(result?.timing[0].deltaMs).toBe(-100);
  });

  it("classifies onTime / early / late / missed at the window boundaries", () => {
    const { session, clock } = setup();
    play(session, clock);
    session.onAttack(60, 2000 + 120, "midi"); // exactly +window → onTime
    session.onAttack(62, 2500 - 121, "midi"); // early
    session.onAttack(64, 3000 + 121, "midi"); // late
    clock.t = 3500 + 240 + 1;
    session.update();
    const live = session.getState();
    expect(live.observations.map((o) => o.verdict)).toEqual(["onTime", "early", "late", "missed"]);
    const result = session.finish();
    expect(result?.mode).toBe("timed");
    expect(result?.summary.onsetsWithinWindowRatio).toBe(0.25);
    expect(result?.summary.pitchCorrectRatio).toBe(0.75);
    expect(result?.timing[0].expectedOnsetMs).toBe(2000);
  });

  it("exactly −window is on time", () => {
    const { session, clock } = setup();
    play(session, clock);
    session.onAttack(62, 2500 - 120, "midi");
    clock.t = 6000;
    const result = session.finish();
    expect(result?.timing[1].verdict).toBe("onTime");
  });

  it("does not finalise missed before the window closes", () => {
    const { session, clock } = setup();
    play(session, clock);
    clock.t = 2100;
    session.update();
    expect(session.getState().observations).toEqual([]);
    expect(session.getState().pendingTargets).toBeGreaterThan(0);
    clock.t = 2241;
    session.update();
    expect(session.getState().observations.map((o) => o.verdict)).toEqual(["missed"]);
  });

  it("applies the latency offset to attack timestamps", () => {
    const { session, clock } = setup({ latencyOffsetMs: 150 });
    play(session, clock);
    session.onAttack(60, 2150, "midi");
    clock.t = 6000;
    const result = session.finish();
    expect(result?.timing[0].verdict).toBe("onTime");
    expect(result?.timing[0].deltaMs).toBe(0);
    expect(result?.latencyOffsetMs).toBe(150);
  });

  it("loop passes produce distinct observations per pass", () => {
    const loop = { startBeat: 0, endBeat: 2 };
    const { session, clock } = setup({ loop });
    play(session, clock, loop);
    [2000, 2500, 3000, 3500].forEach((t, i) => session.onAttack(i % 2 === 0 ? 60 : 62, t + 10, "midi"));
    clock.t = 3200;
    session.onTransportSnapshot(snap("playing", 0.4, 1, loop)); // wrapped, same generation
    clock.t = 4100;
    const result = session.finish();
    expect(result?.timing.map((o) => o.targetNoteId)).toEqual(["ev-1#0:learner:0@0", "ev-2#0:learner:0@0", "ev-1#0:learner:0@1", "ev-2#0:learner:0@1"]);
    expect(result?.timing.map((o) => o.occurrenceId)).toEqual(["ev-1#0@0", "ev-2#0@0", "ev-1#0@1", "ev-2#0@1"]);
    expect(result?.timing.every((o) => o.verdict === "onTime")).toBe(true);
    expect(result?.pitch).toHaveLength(4);
  });

  it("a missed note in the second loop pass is attributed to that pass", () => {
    const loop = { startBeat: 0, endBeat: 2 };
    const { session, clock } = setup({ loop });
    play(session, clock, loop);
    session.onAttack(60, 2000, "midi");
    session.onAttack(62, 2500, "midi");
    session.onAttack(60, 3000, "midi");
    clock.t = 4100;
    const result = session.finish();
    const missed = result?.timing.filter((o) => o.verdict === "missed") ?? [];
    expect(missed.map((o) => o.occurrenceId)).toEqual(["ev-2#0@1"]);
  });

  it("pause ignores attacks and does not penalise targets whose window was open", () => {
    const { session, clock } = setup();
    play(session, clock);
    session.onAttack(60, 2005, "midi");
    clock.t = 2550; // D4 (2500) window still open, not played
    session.onTransportSnapshot(snap("paused", 1.1, 2));
    expect(session.getState().phase).toBe("paused");
    session.onAttack(62, 2700, "midi");
    session.onAttack(64, 2800, "midi");
    // Resume at beat 1.1 at t = 10000: E4 (beat 2) expected at 10450.
    clock.t = 10000;
    session.onTransportSnapshot(snap("playing", 1.1, 3));
    session.onAttack(64, 10460, "midi");
    session.onAttack(65, 10950, "midi");
    clock.t = 12000;
    const result = session.finish();
    expect(result?.timing.map((o) => [o.targetNoteId, o.verdict])).toEqual([
      ["ev-1#0:learner:0@0", "onTime"],
      ["ev-3#0:learner:0@0", "onTime"],
      ["ev-4#0:learner:0@0", "onTime"]
    ]);
    expect(result?.timing[1].expectedOnsetMs).toBe(10450);
  });

  it("finish summary separates pitch and timing; unreached targets are not penalised", () => {
    const { session, clock } = setup();
    play(session, clock);
    session.onAttack(61, 2000, "midi"); // wrong pitch at C4's onset
    session.onAttack(62, 2500, "midi");
    clock.t = 2800; // stop before E4/F4
    const result = session.finish();
    expect(result?.timing.map((o) => o.verdict)).toEqual(["missed", "onTime"]);
    expect(result?.summary.onsetsWithinWindowRatio).toBe(0.5);
    expect(result?.summary.pitchCorrectRatio).toBe(0.5);
    expect(result?.pitch[0].playedMidi).toEqual([61]);
    expect(result?.summary.stepsTotal).toBe(2);
  });

  it("ignores non-learner sources and abort discards the attempt", () => {
    const { session, clock } = setup();
    play(session, clock);
    session.onAttack(60, 2000, "accompaniment");
    session.onAttack(60, 2000, "demonstration");
    clock.t = 3000;
    session.update();
    expect(session.getState().observations[0].verdict).toBe("missed");
    session.abort();
    expect(session.getState().phase).toBe("aborted");
    expect(session.finish()).toBeNull();
  });

  it("roles policy only times required roles and matches octave-free", () => {
    const spec = baseSpec({
      timing: TIMED,
      policy: { kind: "roles", requiredRoles: ["third", "seventh"], optionalRoles: ["fifth", "ninth"] },
      material: {
        kind: "explicitNotes",
        steps: [
          {
            prompt: "Dm9",
            chordSymbol: "Dm9",
            durationBeats: 4,
            notes: [
              { midi: 53, role: "third", degree: "b3" },
              { midi: 57, role: "fifth", degree: "5" },
              { midi: 60, role: "seventh", degree: "b7" },
              { midi: 64, role: "ninth", degree: "9" }
            ]
          }
        ]
      }
    });
    const compiled = compileExercise(spec);
    if (!compiled.ok) throw new Error(compiled.reason);
    const clock = { t: 0 };
    const session = new TimedPracticeSession();
    session.start(compiled.exercise, { clock: () => clock.t });
    clock.t = 2000;
    session.onTransportSnapshot(snap("playing", 0, 1));
    session.onAttack(65, 2010, "midi");
    session.onAttack(72, 2020, "midi");
    clock.t = 5000;
    const result = session.finish();
    expect(result?.timing).toHaveLength(2);
    expect(result?.timing.every((o) => o.verdict === "onTime")).toBe(true);
    expect(result?.pitch[0].correct).toBe(true);
  });

  it("free policy creates no timing targets", () => {
    const spec = baseSpec({ timing: TIMED, policy: { kind: "free" }, material: { kind: "chordSequence", symbols: ["Dm7", "G7"] } });
    const compiled = compileExercise(spec);
    if (!compiled.ok) throw new Error(compiled.reason);
    const clock = { t: 0 };
    const session = new TimedPracticeSession();
    session.start(compiled.exercise, { clock: () => clock.t });
    session.onTransportSnapshot(snap("playing", 0, 1));
    clock.t = 10000;
    const result = session.finish();
    expect(result?.timing).toEqual([]);
    expect(result?.summary.onsetsWithinWindowRatio).toBeUndefined();
    expect(result?.nextAction?.kind).toBe("continue");
  });
});
