import { describe, expect, it } from "vitest";
import { getExerciseSpec, getMelody } from "@/content";
import type { ExerciseSpec, ExplicitNotesStep } from "@/content/authoring";
import { ROOTLESS_II_V_I_C_BASS, ROOTLESS_TRANSFER_OFFSETS, TIMED_TIMING } from "@/content/exercises";

function explicitSteps(spec: ExerciseSpec | undefined): ExplicitNotesStep[] {
  if (!spec || spec.material.kind !== "explicitNotes") throw new Error("expected explicitNotes material");
  return spec.material.steps;
}

describe("rootless ii–V–I fixture (plan §7)", () => {
  const steps = explicitSteps(getExerciseSpec("ex-ii-v-i-rootless-c"));

  it("matches the plan table exactly", () => {
    // Dm9 F3 A3 C4 E4 | G13 F3 A3 B3 E4 | Cmaj9 E3 G3 B3 D4 with C4 = 60.
    expect(steps.map((s) => s.chordSymbol)).toEqual(["Dm9", "G13", "Cmaj9"]);
    expect(steps.map((s) => s.notes.map((n) => n.midi))).toEqual([
      [53, 57, 60, 64],
      [53, 57, 59, 64],
      [52, 55, 59, 62],
    ]);
    expect(steps.map((s) => s.notes.map((n) => n.degree))).toEqual([
      ["b3", "5", "b7", "9"],
      ["b7", "9", "3", "13"],
      ["3", "5", "7", "9"],
    ]);
    expect(steps.map((s) => s.notes.map((n) => n.role))).toEqual([
      ["third", "fifth", "seventh", "ninth"],
      ["seventh", "ninth", "third", "thirteenth"],
      ["third", "fifth", "seventh", "ninth"],
    ]);
  });

  it("keeps the accompaniment bass out of the learner answer and documents it", () => {
    expect(ROOTLESS_II_V_I_C_BASS).toEqual([38, 43, 36]); // D2, G2, C2
    for (const s of steps) expect(s.notes.some((n) => n.role === "root")).toBe(false);
    const spec = getExerciseSpec("ex-ii-v-i-rootless-c")!;
    expect(spec.policy.kind).toBe("exactVoicing");
    expect(spec.contract).toBe("reproduce");
    expect(spec.explanation!.join(" ")).toContain("D2");
    expect(spec.explanation!.join(" ")).toContain("G2");
    expect(spec.explanation!.join(" ")).toContain("C2");
  });

  // Register choice: F is transposed up a fourth (+5 → A3..A4, 57..69). B♭ is transposed DOWN
  // a whole step (−2 → D3..D4, 50..62) rather than up a minor seventh (+10 → E♭4..D5, 63..74),
  // which would leave the comping register of the C example (E3..E4, 52..64).
  it("transfer versions are exact transpositions in a comping register", () => {
    expect(ROOTLESS_TRANSFER_OFFSETS).toEqual({ F: 5, Bb: -2 });
    const cases: [string, number, string[]][] = [
      ["ex-ii-v-i-rootless-f", 5, ["Gm9", "C13", "Fmaj9"]],
      ["ex-ii-v-i-rootless-bb", -2, ["Cm9", "F13", "Bbmaj9"]],
    ];
    for (const [id, offset, symbols] of cases) {
      const transfer = explicitSteps(getExerciseSpec(id));
      expect(transfer.map((s) => s.chordSymbol)).toEqual(symbols);
      transfer.forEach((step, i) => {
        expect(step.notes.map((n) => n.midi)).toEqual(steps[i].notes.map((n) => n.midi + offset));
        expect(step.notes.map((n) => n.degree)).toEqual(steps[i].notes.map((n) => n.degree));
        expect(step.notes.map((n) => n.role)).toEqual(steps[i].notes.map((n) => n.role));
      });
      const all = transfer.flatMap((s) => s.notes.map((n) => n.midi));
      expect(Math.min(...all)).toBeGreaterThanOrEqual(50); // D3
      expect(Math.max(...all)).toBeLessThanOrEqual(69); // A4
    }
    expect(explicitSteps(getExerciseSpec("ex-ii-v-i-rootless-f")).map((s) => s.notes.map((n) => n.midi))).toEqual([
      [58, 62, 65, 69],
      [58, 62, 64, 69],
      [57, 60, 64, 67],
    ]);
    expect(explicitSteps(getExerciseSpec("ex-ii-v-i-rootless-bb")).map((s) => s.notes.map((n) => n.midi))).toEqual([
      [51, 55, 58, 62],
      [51, 55, 57, 62],
      [50, 53, 57, 60],
    ]);
  });
});

describe("exercise fixtures", () => {
  it("timed variants use the plan's timing defaults", () => {
    expect(TIMED_TIMING).toEqual({ mode: "timed", onsetWindowMs: 120, countInBeats: 4, assemblyWindowMs: 60 });
    expect(getExerciseSpec("ex-ii-v-i-shells-c-timed")!.timing).toEqual(TIMED_TIMING);
    expect(getExerciseSpec("ex-c-major-run-timed")!.timing).toEqual(TIMED_TIMING);
  });

  it("shells use the shell-137 recipe", () => {
    const shells = getExerciseSpec("ex-ii-v-i-shells-c")!;
    expect(shells.material).toEqual({ kind: "chordSequence", symbols: ["Dm7", "G7", "Cmaj7"], voicingRecipeId: "shell-137" });
  });

  it("scale runs declare tonic, scale and pattern", () => {
    const runs: [string, string, string, string][] = [
      ["ex-c-major-run", "C", "major", "run-one-octave"],
      ["ex-d-dorian-run", "D", "dorian", "run-one-octave"],
      ["ex-d-natural-minor-run", "D", "naturalMinor", "run-one-octave"],
      ["ex-c-thirds-sequence", "C", "major", "thirds-one-octave"],
    ];
    for (const [id, letter, scale, pattern] of runs) {
      const m = getExerciseSpec(id)!.material;
      if (m.kind !== "scaleRun") throw new Error(`${id} is not a scale run`);
      expect([m.tonic.letter, m.scale, m.patternId]).toEqual([letter, scale, pattern]);
    }
  });

  it("free improvisation is explore/reflect and listening is listen", () => {
    const free = getExerciseSpec("ex-dorian-free-improv")!;
    expect([free.policy.kind, free.contract]).toEqual(["free", "exploreReflect"]);
    expect(getExerciseSpec("ex-dorian-vs-minor-listen")!.policy.kind).toBe("listen");
  });

  it("every scored exercise has a three-rung hint ladder", () => {
    for (const id of ["ex-find-notes", "ex-c-triad-inversions", "ex-i-iv-v-i-c", "ex-ii-v-i-shells-c", "ex-ii-v-i-rootless-c", "ex-c-diatonic-triads"]) {
      expect(getExerciseSpec(id)!.hintLadder.length).toBe(3);
    }
  });

  it("the Dorian comparison differs only in the sixth", () => {
    const steps = explicitSteps(getExerciseSpec("ex-dorian-vs-minor-listen"));
    const minor = steps.slice(0, 8).map((s) => s.notes[0].midi);
    const dorian = steps.slice(8).map((s) => s.notes[0].midi);
    const diffs = minor.map((m, i) => dorian[i] - m);
    expect(diffs).toEqual([0, 0, 0, 0, 0, 1, 0, 0]);
  });

  it("the melody fixture is four bars with solutions that fit the palette", () => {
    const melody = getMelody("mel-four-bar-c")!;
    const end = Math.max(...melody.notes.map((n) => n.startBeat + n.durationBeats));
    expect(end).toBe(16);
    expect(melody.harmonicRhythmBeats).toBe(4);
    expect(melody.palette).toEqual(["C", "Dm", "Em", "F", "G", "Am", "G7", "C/E", "F/A"]);
    for (const s of melody.solutions) {
      expect(s.chords.length).toBe(4);
      expect(s.explanation.length).toBeGreaterThan(0);
    }
    expect(melody.assumptions.join(" ")).toContain("pop/folk");
  });
});
