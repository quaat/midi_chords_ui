import { describe, it, expect } from "vitest";
import { compileExercise, compiledExerciseInfo, closeVoicer } from "@/practice";
import type { ExerciseVoicer } from "@/practice";
import { contentBundle } from "@/content";
import type { ExerciseSpec } from "@/content/authoring";
import { baseSpec, rootlessSpec, TIMED } from "./fixtures";
import type { ExerciseDefinition } from "@/model/contracts";

function compileOk(spec: ExerciseSpec, options = {}): ExerciseDefinition {
  const result = compileExercise(spec, options);
  if (!result.ok) {
    throw new Error(result.reason);
  }
  return result.exercise;
}

describe("compileExercise — explicit notes", () => {
  it("compiles the rootless ii–V–I fixture into three steps with the authored targets and degrees", () => {
    const exercise = compileOk(rootlessSpec());
    expect(exercise.steps).toHaveLength(3);
    expect(exercise.steps.map((step) => step.targets.map((n) => n.midi))).toEqual([
      [53, 57, 60, 64],
      [53, 57, 59, 64],
      [52, 55, 59, 62]
    ]);
    expect(exercise.steps[0].targets.map((n) => n.degree)).toEqual(["b3", "5", "b7", "9"]);
    expect(exercise.steps[1].targets.map((n) => n.role)).toEqual(["seventh", "ninth", "third", "thirteenth"]);
    expect(exercise.steps[2].targets.map((n) => n.degree)).toEqual(["3", "5", "7", "9"]);
    expect(exercise.steps[0].chord?.symbol).toBe("Dm9");
    expect(exercise.steps[0].prompt).toBe("Dm9: F3 A3 C4 E4 (♭3 5 ♭7 9)");
    expect(exercise.steps.every((step) => step.targets.every((n) => n.part === "learner"))).toBe(true);
  });

  it("uses event ids ev-N and one occurrence per step", () => {
    const exercise = compileOk(rootlessSpec());
    expect(exercise.steps.map((step) => step.occurrenceId)).toEqual(["ev-1#0", "ev-2#0", "ev-3#0"]);
    expect(exercise.timeline.occurrences.map((occ) => occ.startBeat)).toEqual([0, 4, 8]);
  });

  it("appends a concrete final hint naming the notes", () => {
    const exercise = compileOk(rootlessSpec());
    const hints = exercise.steps[0].hints;
    expect(hints[0]).toBe("Look at the keyboard.");
    expect(hints[hints.length - 1]).toBe("Play F3 A3 C4 E4");
  });

  it("transposeTo F shifts explicit notes by +5 and respells from the transposed chord", () => {
    const result = compileExercise(rootlessSpec(), { transposeTo: { letter: "F", accidental: 0 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const exercise = result.exercise;
    expect(exercise.steps[0].targets.map((n) => n.midi)).toEqual([58, 62, 65, 69]);
    expect(exercise.steps[0].chord?.symbol).toBe("Gm9");
    expect(exercise.steps[0].prompt).toBe("Gm9: B♭3 D4 F4 A4");
    expect(exercise.key?.tonic).toEqual({ letter: "F", accidental: 0 });
    expect(result.info.isTransfer).toBe(true);
    expect(result.info.semitones).toBe(5);
    expect(compiledExerciseInfo(exercise)?.isTransfer).toBe(true);
  });

  it("transposeTo B♭ goes down a whole step to stay in register", () => {
    const exercise = compileOk(rootlessSpec(), { transposeTo: { letter: "B", accidental: -1 } });
    expect(exercise.steps[2].targets.map((n) => n.midi)).toEqual([50, 53, 57, 60]);
    expect(exercise.steps[2].chord?.symbol).toBe("Bbmaj9");
  });

  it("transposeTo the authored key is not a transfer", () => {
    const result = compileExercise(rootlessSpec(), { transposeTo: { letter: "C", accidental: 0 } });
    expect(result.ok && result.info.isTransfer).toBe(false);
  });

  it("explicit rests produce no step", () => {
    const exercise = compileOk(
      baseSpec({
        material: {
          kind: "explicitNotes",
          steps: [
            { prompt: "C", notes: [{ midi: 60 }], durationBeats: 2 },
            { prompt: "rest", notes: [], durationBeats: 2 },
            { prompt: "D", notes: [{ midi: 62 }], durationBeats: 2 }
          ]
        }
      })
    );
    expect(exercise.steps).toHaveLength(2);
    expect(exercise.steps[1].targets[0].onsetBeat).toBe(4);
  });
});

describe("compileExercise — chord sequences", () => {
  it("realises each symbol with the voicer and stores the voicing; default one bar each", () => {
    const calls: string[] = [];
    const voicer: ExerciseVoicer = (chord, recipeId) => {
      calls.push(`${chord.symbol}:${recipeId}`);
      return closeVoicer(chord, recipeId);
    };
    const result = compileExercise(
      baseSpec({ policy: { kind: "roles", requiredRoles: ["root", "third"] }, material: { kind: "chordSequence", symbols: ["C", "F", "G7"] } }),
      { voicer }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(calls).toEqual(["C:close-triads-rh", "F:close-triads-rh", "G7:close-sevenths-rh"]);
    expect(result.info.sequence.events.map((e) => e.id)).toEqual(["ev-1", "ev-2", "ev-3"]);
    expect(result.info.sequence.events.every((e) => e.voicing !== undefined)).toBe(true);
    expect(result.exercise.steps.map((s) => s.targets[0].onsetBeat)).toEqual([0, 4, 8]);
    expect(result.exercise.steps[0].targets.map((n) => n.midi)).toEqual([60, 64, 67]);
    expect(result.exercise.steps[0].prompt).toBe("Play C");
  });

  it("names the voicing family in the prompt and keeps an accompaniment bass separate", () => {
    const voicer: ExerciseVoicer = (chord, recipeId) => {
      const voicing = closeVoicer(chord, recipeId);
      if (!voicing) return null;
      return { ...voicing, accompanimentBass: { ...voicing.notes[0], midi: 38, role: "root", degree: "1", voiceId: "bass", hand: "left" } };
    };
    const exercise = compileOk(
      baseSpec({ policy: { kind: "roles", requiredRoles: ["third", "seventh"] }, material: { kind: "chordSequence", symbols: ["Dm9"], voicingRecipeId: "rootless-a" } }),
      { voicer }
    );
    expect(exercise.steps[0].prompt).toBe("Play Dm9 as a rootless voicing");
    expect(exercise.steps[0].targets.some((n) => n.role === "root")).toBe(false);
    const bass = exercise.timeline.notes.filter((n) => n.part === "accompaniment");
    expect(bass.map((n) => n.midi)).toEqual([38]);
    expect(exercise.steps[0].targets.some((n) => n.midi === 38)).toBe(false);
  });

  it("falls back to close position when the voicer returns null", () => {
    const result = compileExercise(baseSpec({ material: { kind: "chordSequence", symbols: ["Am"], voicingRecipeId: "rootless-a" } }), { voicer: () => null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.exercise.steps[0].targets.map((n) => n.midi)).toEqual([69, 72, 76]);
    expect(result.info.warnings.length).toBe(1);
  });

  it("transposes chord symbols with transposeChord", () => {
    const exercise = compileOk(baseSpec({ material: { kind: "chordSequence", symbols: ["Dm7", "G7", "Cmaj7"] } }), { transposeTo: { letter: "F", accidental: 0 } });
    expect(exercise.steps.map((s) => s.chord?.symbol)).toEqual(["Gm7", "C7", "Fmaj7"]);
  });

  it("rejects unreadable symbols with a reason", () => {
    const result = compileExercise(baseSpec({ material: { kind: "chordSequence", symbols: ["C", "Qx9"] } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Qx9");
  });

  it("NC is a rest and produces no step; count-in comes from timing", () => {
    const exercise = compileOk(baseSpec({ timing: TIMED, material: { kind: "chordSequence", symbols: ["C", "NC", "G"] } }));
    expect(exercise.steps).toHaveLength(2);
    expect(exercise.timeline.countInBeats).toBe(4);
  });
});

describe("compileExercise — scale runs and single notes", () => {
  it("realises a scale run into one step per note, keeping repeated pitches distinct", () => {
    const exercise = compileOk(
      baseSpec({ material: { kind: "scaleRun", tonic: { letter: "C", accidental: 0 }, scale: "major", patternId: "run-one-octave", startOctave: 4, octaves: 1, hand: "right" } })
    );
    expect(exercise.steps).toHaveLength(15);
    expect(exercise.steps[0].targets[0].midi).toBe(60);
    expect(exercise.steps[7].targets[0].midi).toBe(72);
    expect(exercise.steps[14].targets[0].midi).toBe(60);
    expect(exercise.steps[2].targets[0].degree).toBe("3");
    expect(exercise.steps[0].prompt).toBe("Play C4 (degree 1)");
    expect(new Set(exercise.steps.map((s) => s.occurrenceId)).size).toBe(15);
  });

  it("returns the realisation reason when the range fails", () => {
    const result = compileExercise(
      baseSpec({ material: { kind: "scaleRun", tonic: { letter: "C", accidental: 0 }, scale: "major", patternId: "run-one-octave", startOctave: 10, octaves: 1, hand: "right" } })
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown pattern id", () => {
    const result = compileExercise(
      baseSpec({ material: { kind: "scaleRun", tonic: { letter: "C", accidental: 0 }, scale: "major", patternId: "nope", startOctave: 4, octaves: 1, hand: "right" } })
    );
    expect(result.ok).toBe(false);
  });

  it("transposing a scale run changes the tonic", () => {
    const exercise = compileOk(
      baseSpec({
        key: { tonic: { letter: "D", accidental: 0 }, mode: "dorian" },
        material: { kind: "scaleRun", tonic: { letter: "D", accidental: 0 }, scale: "dorian", patternId: "run-one-octave", startOctave: 4, octaves: 1, hand: "right" }
      }),
      { transposeTo: { letter: "G", accidental: 0 } }
    );
    expect(exercise.steps[0].targets[0].midi).toBe(67);
    expect(exercise.steps[0].prompt).toBe("Play G4 (degree 1)");
  });

  it("single notes produce one step each with the authored label", () => {
    const exercise = compileOk(baseSpec({ material: { kind: "singleNotes", prompts: [{ label: "Middle C", midi: 60 }, { label: "F3", midi: 53 }] } }));
    expect(exercise.steps.map((s) => s.prompt)).toEqual(["Middle C", "F3"]);
    expect(exercise.steps.map((s) => s.targets.map((n) => n.midi))).toEqual([[60], [53]]);
    expect(exercise.steps[1].hints[exercise.steps[1].hints.length - 1]).toBe("Play F3");
  });
});

describe("compileExercise — repository content", () => {
  it("compiles every exercise spec in the content bundle", () => {
    const failures: string[] = [];
    contentBundle.exerciseSpecs.forEach((spec: ExerciseSpec) => {
      const result = compileExercise(spec);
      if (!result.ok) {
        failures.push(`${spec.id}: ${result.reason}`);
      } else if (result.exercise.steps.length === 0) {
        failures.push(`${spec.id}: no steps`);
      }
    });
    expect(failures).toEqual([]);
  });

  it("compiles every declared transfer key", () => {
    const failures: string[] = [];
    contentBundle.exerciseSpecs.forEach((spec: ExerciseSpec) => {
      (spec.transferKeys ?? []).forEach((tonic) => {
        const result = compileExercise(spec, { transposeTo: tonic });
        if (!result.ok) failures.push(`${spec.id} → ${tonic.letter}${tonic.accidental}: ${result.reason}`);
      });
    });
    expect(failures).toEqual([]);
  });
});

describe("compileExercise — default voicing engine", () => {
  it("realises rootless-a with the engine: plan §7 voicing plus a separate accompaniment bass", () => {
    const exercise = compileOk(
      baseSpec({
        policy: { kind: "roles", requiredRoles: ["third", "seventh"] },
        material: { kind: "chordSequence", symbols: ["Dm9", "G13", "Cmaj9"], voicingRecipeId: "rootless-a" }
      })
    );
    expect(exercise.steps.map((s) => s.targets.map((n) => n.midi))).toEqual([
      [53, 57, 60, 64],
      [53, 57, 59, 64],
      [52, 55, 59, 62]
    ]);
    expect(exercise.steps[0].prompt).toBe("Play Dm9 as a rootless voicing");
    const bass = exercise.timeline.notes.filter((n) => n.part === "accompaniment").map((n) => n.midi);
    expect(bass).toEqual([38, 43, 36]);
    expect(exercise.steps.every((s) => s.targets.every((n) => n.part === "learner"))).toBe(true);
  });

  it("defaults to close-sevenths-rh for seventh chords and close-triads-rh for triads", () => {
    const exercise = compileOk(baseSpec({ material: { kind: "chordSequence", symbols: ["C", "G7"] } }));
    expect(exercise.steps[0].targets.map((n) => n.midi)).toEqual([60, 64, 67]);
    expect(exercise.steps[1].targets).toHaveLength(4);
  });
});
