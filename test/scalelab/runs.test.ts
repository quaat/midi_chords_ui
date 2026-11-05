import { describe, expect, it } from "vitest";
import { scaleRunExercise, transposeRun } from "@/scalelab";
import type { ScaleRunExercise } from "@/scalelab";

function run(result: ReturnType<typeof scaleRunExercise>): ScaleRunExercise {
  if (!result.ok) throw new Error(result.reason);
  return result;
}

describe("scaleRunExercise", () => {
  const cMajor = run(scaleRunExercise("C", "major", "run-one-octave", 4, 1, "right", { tempoBpm: 80 }));

  it("C major one-octave run gives 15 steps: 8 up including the top, 7 down", () => {
    expect(cMajor.steps).toHaveLength(15);
    expect(cMajor.timeline.notes.map((n) => n.midi)).toEqual([60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60]);
    expect(cMajor.timeline.tempo.bpm).toBe(80);
    expect(cMajor.timeline.totalBeats).toBe(15);
  });

  it("every note is its own occurrence and step with an exact-voicing policy", () => {
    const ids = cMajor.timeline.occurrences.map((o) => o.occurrenceId);
    expect(new Set(ids).size).toBe(15);
    cMajor.steps.forEach((step, index) => {
      expect(step.targets).toHaveLength(1);
      expect(step.occurrenceId).toBe(ids[index]);
      expect(step.policy).toEqual({ kind: "exactVoicing" });
      expect(step.targets[0].part).toBe("learner");
    });
    // Repeated pitches (B on the way up and down) are distinct targets.
    const bs = cMajor.timeline.notes.filter((n) => n.midi === 71);
    expect(bs).toHaveLength(2);
    expect(bs[0].occurrenceId).not.toBe(bs[1].occurrenceId);
    expect(cMajor.steps[0].prompt).toContain("C4");
    expect(cMajor.steps[0].prompt).toContain("degree 1 (tonic)");
    expect(cMajor.steps[5].hints[0]).toBe("Degree 6 of C major");
  });

  it("shows reviewed fingering for C major right hand only", () => {
    expect(cMajor.fingering).toEqual([1, 2, 3, 1, 2, 3, 4, 5, 4, 3, 2, 1, 3, 2, 1]);
    expect(cMajor.timeline.notes[3].finger).toBe(1);
    expect(cMajor.steps[3].prompt).toContain("finger 1");
    const left = run(scaleRunExercise("C", "major", "run-one-octave", 3, 1, "left"));
    expect(left.fingering).toBeUndefined();
    expect(left.timeline.notes.every((n) => n.finger === undefined)).toBe(true);
  });

  it("omits fingering for D Dorian and spells it correctly", () => {
    const dorian = run(scaleRunExercise("D", "dorian", "run-one-octave", 4, 1, "right"));
    expect(dorian.fingering).toBeUndefined();
    expect(dorian.fingeringNote).toContain("omitted");
    expect(dorian.steps).toHaveLength(15);
    expect(dorian.timeline.notes.map((n) => n.degree).slice(0, 8)).toEqual(["1", "2", "b3", "4", "5", "6", "b7", "1"]);
    expect(dorian.timeline.notes[5].spelled).toEqual({ letter: "B", accidental: 0, octave: 4 });
  });

  it("supports the thirds pattern and multi-octave runs", () => {
    const thirds = run(scaleRunExercise("C", "major", "thirds-one-octave", 4, 1, "right"));
    expect(thirds.timeline.notes.slice(0, 4).map((n) => n.midi)).toEqual([60, 64, 62, 65]);
    expect(thirds.timeline.notes[1].durationBeats).toBe(0.5);
    const two = run(scaleRunExercise("C", "major", "run-one-octave", 4, 2, "right"));
    expect(two.steps).toHaveLength(29);
    expect(two.fingering).toBeUndefined();
    expect(scaleRunExercise("C", "major", "thirds-one-octave", 4, 2, "right").ok).toBe(false);
    expect(scaleRunExercise("C", "majorPentatonic", "thirds-one-octave", 4, 1, "right").ok).toBe(false);
    const penta = run(scaleRunExercise("C", "majorPentatonic", "run-one-octave", 4, 1, "right"));
    expect(penta.steps).toHaveLength(11);
    expect(scaleRunExercise("C", "major", "nope", 4, 1, "right").ok).toBe(false);
  });

  it("turns range failures into a useful message with suggested octaves", () => {
    const result = scaleRunExercise("C", "major", "run-one-octave", 6, 1, "right", { range: { low: 48, high: 84 } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rangeIssue).toBeDefined();
    expect(result.suggestedStartOctaves).toContain(4);
    expect(result.rangeIssue).toContain("octave");
    const tooNarrow = scaleRunExercise("C", "major", "run-one-octave", 4, 1, "right", { range: { low: 60, high: 65 } });
    expect(tooNarrow.ok).toBe(false);
    if (!tooNarrow.ok) expect(tooNarrow.reason).toContain("allows only");
  });
});

describe("transposeRun", () => {
  it("drops C major fingering when moving to D major", () => {
    const cMajor = run(scaleRunExercise("C", "major", "run-one-octave", 4, 1, "right"));
    const d = transposeRun(cMajor.config, "D");
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.fingering).toBeUndefined();
    expect(d.previousFingeringDropped).toBe(true);
    expect(d.fingeringNote).toContain("not reused");
    expect(d.timeline.notes.every((n) => n.finger === undefined)).toBe(true);
    expect(d.timeline.notes.slice(0, 8).map((n) => n.spelled ? `${n.spelled.letter}${n.spelled.accidental === 1 ? "#" : ""}` : "")).toEqual(["D", "E", "F#", "G", "A", "B", "C#", "D"]);
    expect(d.steps).toHaveLength(15);
    const back = transposeRun(d.config, "C");
    expect(back.ok && back.fingering !== undefined).toBe(true);
    expect(back.previousFingeringDropped).toBe(false);
  });
});
