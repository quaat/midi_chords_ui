import { describe, it, expect } from "vitest";
import { compileExercise, groupAttacks, matchSequenceAttacks, matchStep, pitchClassKey, verdictForDelta } from "@/practice";
import type { AnswerPolicy, ExerciseDefinition, ExerciseStep, PerformedNote } from "@/model/contracts";
import { rootlessSpec } from "./fixtures";

function rootless(): ExerciseDefinition {
  const result = compileExercise(rootlessSpec());
  if (!result.ok) throw new Error(result.reason);
  return result.exercise;
}

const dm9 = (): ExerciseStep => rootless().steps[0];

describe("matchStep — exactVoicing", () => {
  const policy: AnswerPolicy = { kind: "exactVoicing" };
  it("accepts the exact set in any order", () => {
    expect(matchStep(dm9(), [64, 53, 60, 57], policy).correct).toBe(true);
  });
  it("fails with an extra note and names it", () => {
    const match = matchStep(dm9(), [53, 57, 60, 64, 59], policy);
    expect(match.correct).toBe(false);
    expect(match.extraMidi).toEqual([59]);
    expect(match.notes).toContain("B is not in Dm9");
  });
  it("allowExtraNotes permits extras", () => {
    expect(matchStep(dm9(), [53, 57, 60, 64, 59], { kind: "exactVoicing", allowExtraNotes: true }).correct).toBe(true);
  });
  it("a wrong octave is missing + extra with a helpful line", () => {
    const match = matchStep(dm9(), [53, 57, 72, 64], policy);
    expect(match.correct).toBe(false);
    expect(match.missingMidi).toEqual([60]);
    expect(match.missingRoles).toEqual(["seventh"]);
    expect(match.notes).toContain("C5 is in the wrong octave (expected C4)");
  });
  it("nothing played is not correct", () => {
    expect(matchStep(dm9(), [], policy).correct).toBe(false);
  });
});

describe("matchStep — roles", () => {
  const policy: AnswerPolicy = { kind: "roles", requiredRoles: ["third", "seventh"], optionalRoles: ["fifth", "ninth"] };
  it("accepts the required roles in a different octave and ignores the optional fifth", () => {
    const match = matchStep(dm9(), [65, 72], policy);
    expect(match.correct).toBe(true);
    expect(match.satisfiedRoles).toEqual(["third", "seventh"]);
  });
  it("explains a missing seventh by naming the note", () => {
    const match = matchStep(dm9(), [53, 57, 64], policy);
    expect(match.correct).toBe(false);
    expect(match.missingRoles).toEqual(["seventh"]);
    expect(match.notes).toContain("The seventh (C) is missing");
  });
  it("a played pitch class outside the chord is extra", () => {
    const match = matchStep(dm9(), [53, 60, 59], policy);
    expect(match.correct).toBe(false);
    expect(match.extraMidi).toEqual([59]);
    expect(match.notes).toContain("B is not in Dm9");
  });
  it("chord tones outside the voicing (the root) are not extras", () => {
    expect(matchStep(dm9(), [50, 53, 60], policy).correct).toBe(true);
  });
  it("octaveFree false needs the target pitch", () => {
    const strict: AnswerPolicy = { kind: "roles", requiredRoles: ["third", "seventh"], octaveFree: false };
    expect(matchStep(dm9(), [65, 72], strict).correct).toBe(false);
    expect(matchStep(dm9(), [53, 60], strict).correct).toBe(true);
  });
  it("does not invent exact-note requirements from the chord symbol", () => {
    // Required roles only — no fifth/ninth/root demanded even though Dm9 contains them.
    const match = matchStep(dm9(), [53, 60], { kind: "roles", requiredRoles: ["third", "seventh"] });
    expect(match.correct).toBe(true);
    expect(match.missingMidi).toEqual([]);
  });
});

describe("matchStep — pitchClass / listen / free", () => {
  it("pitchClass compares pitch-class sets", () => {
    const policy: AnswerPolicy = { kind: "pitchClass" };
    expect(matchStep(dm9(), [41, 45, 48, 52], policy).correct).toBe(true);
    expect(matchStep(dm9(), [41, 45, 48], policy).correct).toBe(false);
    expect(matchStep(dm9(), [41, 45, 48, 52, 47], policy).correct).toBe(false);
  });
  it("listen and free are never graded", () => {
    const listen = matchStep(dm9(), [], { kind: "listen" });
    expect(listen.correct).toBe(true);
    expect(listen.notes[0]).toContain("nothing");
    expect(matchStep(dm9(), [1, 2, 3], { kind: "free" }).correct).toBe(true);
  });
});

describe("groupAttacks", () => {
  it("groups staggered attacks (0, 30, 55 ms) into one chord", () => {
    const groups = groupAttacks(
      [
        { midi: 53, timestampMs: 1000 },
        { midi: 57, timestampMs: 1030 },
        { midi: 60, timestampMs: 1055 }
      ],
      80
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].midi).toEqual([53, 57, 60]);
  });
  it("splits at 200 ms", () => {
    const groups = groupAttacks(
      [
        { midi: 53, timestampMs: 0 },
        { midi: 57, timestampMs: 30 },
        { midi: 60, timestampMs: 200 }
      ],
      80
    );
    expect(groups.map((g) => g.midi)).toEqual([[53, 57], [60]]);
  });
  it("measures the window from the first attack of the group", () => {
    const groups = groupAttacks(
      [
        { midi: 1, timestampMs: 0 },
        { midi: 2, timestampMs: 70 },
        { midi: 3, timestampMs: 140 }
      ],
      80
    );
    expect(groups.map((g) => g.midi)).toEqual([[1, 2], [3]]);
  });
});

function note(id: string, midi: number, onsetBeat: number): PerformedNote {
  return { id, eventId: id, occurrenceId: `${id}#0`, part: "learner", midi, onsetBeat, durationBeats: 1, velocity: 90 };
}

describe("matchSequenceAttacks", () => {
  const expected = (n: PerformedNote): number => n.onsetBeat * 500;

  it("never reuses one attack for two targets of the same pitch", () => {
    const targets = [note("a", 60, 0), note("b", 60, 1)];
    const result = matchSequenceAttacks(targets, [{ midi: 60, timestampMs: 10 }], expected, 120);
    expect(result.observations.map((o) => o.verdict)).toEqual(["onTime", "missed"]);
    expect(result.extraAttacks).toEqual([]);
  });

  it("marks missed and returns unmatched extras", () => {
    const targets = [note("a", 60, 0), note("b", 62, 1)];
    const result = matchSequenceAttacks(targets, [{ midi: 60, timestampMs: 0 }, { midi: 61, timestampMs: 500 }], expected, 120);
    expect(result.observations.map((o) => o.verdict)).toEqual(["onTime", "missed"]);
    expect(result.extraAttacks).toEqual([{ midi: 61, timestampMs: 500 }]);
  });

  it("classifies early / late and treats exactly ±window as on time", () => {
    const targets = [note("a", 60, 0), note("b", 62, 1), note("c", 64, 2), note("d", 65, 3)];
    const attacks = [
      { midi: 60, timestampMs: -120 },
      { midi: 62, timestampMs: 500 + 120 },
      { midi: 64, timestampMs: 1000 - 121 },
      { midi: 65, timestampMs: 1500 + 121 }
    ];
    const result = matchSequenceAttacks(targets, attacks, expected, 120);
    expect(result.observations.map((o) => o.verdict)).toEqual(["onTime", "onTime", "early", "late"]);
    expect(result.observations[3].deltaMs).toBe(121);
  });

  it("does not steal an attack that is on time for the next repeated note", () => {
    const targets = [note("a", 60, 0), note("b", 60, 0.5)];
    // 250 ms apart; the single attack at 240 is late for a (+240) but on time for b (−10).
    const result = matchSequenceAttacks(targets, [{ midi: 60, timestampMs: 240 }], expected, 120);
    expect(result.observations.map((o) => o.verdict)).toEqual(["missed", "onTime"]);
  });

  it("prefers the nearest attack", () => {
    const targets = [note("a", 60, 0)];
    const result = matchSequenceAttacks(targets, [{ midi: 60, timestampMs: -90 }, { midi: 60, timestampMs: 20 }], expected, 120);
    expect(result.observations[0].actualOnsetMs).toBe(20);
    expect(result.extraAttacks).toHaveLength(1);
  });

  it("supports octave-free matching", () => {
    const result = matchSequenceAttacks([note("a", 60, 0)], [{ midi: 72, timestampMs: 0 }], expected, 120, { matchKey: pitchClassKey });
    expect(result.observations[0].verdict).toBe("onTime");
  });

  it("verdictForDelta boundaries", () => {
    expect(verdictForDelta(120, 120)).toBe("onTime");
    expect(verdictForDelta(-120, 120)).toBe("onTime");
    expect(verdictForDelta(120.5, 120)).toBe("late");
    expect(verdictForDelta(-121, 120)).toBe("early");
  });
});
