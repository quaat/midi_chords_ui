import { describe, expect, it } from "vitest";
import type { MelodySpec } from "@/content/authoring";
import { getMelody } from "@/content";
import { compareSolutions, evaluateSolution, harmoniseMelody, melodySlots, solutionToChart, solutionToSequence } from "@/harmonisation";
import { expandChart } from "@/charts/expand";
import { localVoicer } from "@/charts/voicer";

function melody(): MelodySpec {
  const found = getMelody("mel-four-bar-c");
  if (!found) throw new Error("missing melody");
  return found;
}

function solution(id: string): string[] {
  const found = melody().solutions.find((s) => s.id === id);
  if (!found) throw new Error(`missing solution ${id}`);
  return found.chords;
}

describe("harmoniseMelody", () => {
  const activity = harmoniseMelody(melody());

  it("creates one slot per harmonic-rhythm unit with the melody notes in it", () => {
    expect(activity.slots).toHaveLength(4);
    expect(activity.slots.map((s) => [s.startBeat, s.durationBeats])).toEqual([
      [0, 4],
      [4, 4],
      [8, 4],
      [12, 4]
    ]);
    expect(activity.slots[0].melodyNotes.map((n) => n.midi)).toEqual([64, 62, 60, 64]);
    expect(activity.slots[0].melodyPitchClasses).toEqual([0, 2, 4]);
    expect(activity.slots[0].strongBeatPitchClasses).toEqual([0, 4]);
    expect(activity.slots[0].label).toBe("Bar 1");
    expect(activity.unsupportedPalette).toEqual([]);
  });

  it("ranks every palette chord with reasons and never marks one correct", () => {
    activity.slots.forEach((slot) => {
      expect(slot.candidates).toHaveLength(melody().palette.length);
      slot.candidates.forEach((candidate) => {
        expect(candidate.reasons.length).toBeGreaterThan(0);
        expect(Object.keys(candidate)).not.toContain("correct");
      });
      for (let i = 1; i < slot.candidates.length; i += 1) {
        expect(slot.candidates[i - 1].score).toBeGreaterThanOrEqual(slot.candidates[i].score);
      }
    });
    const bar1 = activity.slots[0].candidates.map((c) => c.symbol);
    expect(bar1.indexOf("C")).toBeLessThan(bar1.indexOf("G"));
    const top = activity.slots[0].candidates[0];
    expect(top.reasons[0]).toContain("chord tone");
    const last = activity.slots[3].candidates.find((c) => c.symbol === "C");
    expect(last?.reasons.join(" ")).toContain("closes the phrase");
  });

  it("explains bass motion from the learner's previous choice", () => {
    const withChoices = harmoniseMelody(melody(), { choices: ["C", "F", undefined, undefined] });
    const f = withChoices.slots[1].candidates.find((c) => c.symbol === "F");
    expect(f?.bassMotionFromPrevious).toBe(5);
    expect(f?.reasons.join(" ")).toContain("fourth");
    expect(withChoices.slots[2].candidates.find((c) => c.symbol === "G")?.bassMotionFromPrevious).toBe(2);
    expect(activity.slots[1].candidates[0].bassMotionFromPrevious).toBeNull();
  });
});

describe("evaluateSolution", () => {
  const plain = evaluateSolution(melody(), solution("sol-plain"));
  const rising = evaluateSolution(melody(), solution("sol-rising-bass"));

  it("both reviewed solutions satisfy the required constraints", () => {
    [plain, rising].forEach((evaluation) => {
      expect(evaluation.constraints).toMatchObject({ melodyUnchanged: true, chordsFromPalette: true, harmonicRhythmKept: true, allSatisfied: true });
      expect(evaluation.constraints.problems).toEqual([]);
      evaluation.slots.forEach((slot) => expect(slot.constraintsSatisfied).toEqual({ melodyUnchanged: true, chordsFromPalette: true, harmonicRhythmKept: true }));
    });
  });

  it("they differ in bass motion", () => {
    expect(plain.slots.map((s) => s.bassMotion)).toEqual([null, 5, 2, 5]);
    expect(rising.slots.map((s) => s.bassMotion)).toEqual([null, 1, 2, 5]);
    expect(plain.bassLine).toEqual(["C", "F", "G", "C"]);
    expect(rising.bassLine).toEqual(["E", "F", "G", "C"]);
  });

  it("classifies melody notes and cadences", () => {
    expect(plain.slots[0].melodyRelation).toEqual(["chordTone", "passingTone", "chordTone", "chordTone"]);
    // F over G7 is the chord seventh, a chord tone.
    expect(plain.slots[2].melodyRelation[1]).toBe("chordTone");
    expect(rising.slots[2].melodyRelation[1]).not.toBe("chordTone");
    expect(plain.cadence).toBe("authentic");
    expect(plain.slots[3].cadence).toBe("authentic");
    expect(plain.slots[0].cadence).toBe("none");
    expect(plain.slots[2].romanNumeral).toBe("V7");
    expect(rising.slots[0].romanNumeral).toBe("I6");
  });

  it("keeps constraints, style notes and reflection separate", () => {
    expect(plain.styleNotes.join(" ")).toContain("authentic cadence");
    expect(plain.reflection.length).toBeGreaterThan(0);
    expect(plain.assumptions).toEqual(melody().assumptions);
    expect(rising.slots[0].styleNotes.join(" ")).toContain("E in the bass");
  });

  it("reports violated constraints without inventing a score", () => {
    const outside = evaluateSolution(melody(), ["C", "Bb", "G", "C"]);
    expect(outside.constraints.chordsFromPalette).toBe(false);
    expect(outside.constraints.allSatisfied).toBe(false);
    expect(outside.slots[1].constraintsSatisfied.chordsFromPalette).toBe(false);
    const short = evaluateSolution(melody(), ["C", "F", "C"]);
    expect(short.constraints.harmonicRhythmKept).toBe(false);
    expect(short.constraints.problems[0]).toContain("4 slots");
    const deceptive = evaluateSolution(melody(), ["C", "F", "G", "Am"]);
    expect(deceptive.cadence).toBe("deceptive");
    const half = evaluateSolution(melody(), ["C", "F", "C", "G"]);
    expect(half.cadence).toBe("half");
    const plagal = evaluateSolution(melody(), ["C", "G", "F", "C"]);
    expect(plagal.cadence).toBe("plagal");
  });
});

describe("compareSolutions", () => {
  it("describes the differences in words", () => {
    const comparison = compareSolutions(melody(), solution("sol-plain"), solution("sol-rising-bass"));
    expect(comparison.sameSlots).toEqual([1, 3]);
    const text = comparison.differences.join("\n");
    expect(text).toContain("Bar 1: C (I) vs C/E (I6)");
    expect(text).toContain("only the bass changes (C vs E)");
    expect(text).toContain("Bar 3: G7 (V7) vs G (V)");
    expect(text).toContain("Bass line: C–F–G–C vs E–F–G–C");
    expect(comparison.summary).toContain("neither is marked as the correct answer");
    const minor = compareSolutions(melody(), solution("sol-plain"), solution("sol-minor-colour"));
    expect(minor.differences.join(" ")).toContain("Am (vi)");
    expect(compareSolutions(melody(), solution("sol-plain"), solution("sol-plain")).differences).toEqual([]);
  });
});

describe("solutionToSequence / solutionToChart", () => {
  it("keeps the melody's pitches and rhythm unchanged", () => {
    const result = solutionToSequence(melody(), solution("sol-plain"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const melodyNotes = result.timeline.notes.filter((n) => n.part === "demonstration");
    expect(melodyNotes.map((n) => [n.midi, n.onsetBeat, n.durationBeats])).toEqual(melody().notes.map((n) => [n.midi, n.startBeat, n.durationBeats]));
    expect(result.sequence.events.map((e) => e.symbol)).toEqual(["C", "F", "G7", "C"]);
    const chords = result.timeline.notes.filter((n) => n.part === "learner");
    expect(chords.length).toBeGreaterThanOrEqual(12);
    chords.forEach((n) => expect(n.midi).toBeLessThan(60));
    melodyNotes.forEach((n) => expect(result.timeline.occurrences.some((o) => o.occurrenceId === n.occurrenceId)).toBe(true));
    expect(melodyNotes[0].spelled).toEqual({ letter: "E", accidental: 0, octave: 4 });
  });

  it("lets the learner play the melody over chord accompaniment", () => {
    const result = solutionToSequence(melody(), solution("sol-rising-bass"), { learnerPlaysMelody: true, voicer: localVoicer });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const learner = result.timeline.notes.filter((n) => n.part === "learner");
    expect(learner.map((n) => [n.midi, n.onsetBeat, n.durationBeats])).toEqual(melody().notes.map((n) => [n.midi, n.startBeat, n.durationBeats]));
    expect(result.timeline.notes.filter((n) => n.part === "accompaniment").length).toBeGreaterThan(0);
    expect(new Set(result.timeline.notes.map((n) => n.id)).size).toBe(result.timeline.notes.length);
    expect(solutionToSequence(melody(), ["C", "F"]).ok).toBe(false);
  });

  it("saves a solution as a one-section chart with the same chords and provenance", () => {
    const result = solutionToChart(melody(), solution("sol-minor-colour"), "Stepping Home (minor colour)");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const chart = result.chart;
    expect(chart.sections).toHaveLength(1);
    expect(chart.sections[0].bars.map((b) => b.spans.map((s) => s.symbol))).toEqual([["Am"], ["Dm"], ["G7"], ["C"]]);
    expect(chart.provenance.origin).toBe("original");
    expect(chart.provenance.note).toContain("mel-four-bar-c");
    expect(chart.meta.status).toBe("draft");
    expect(chart.key).toEqual(melody().key);
    const expansion = expandChart(chart);
    expect(expansion.ok).toBe(true);
    if (expansion.ok) expect(expansion.totalBeats).toBe(16);
    const halfBars: MelodySpec = { ...melody(), harmonicRhythmBeats: 2 };
    expect(melodySlots(halfBars)).toHaveLength(8);
    const split = solutionToChart(halfBars, ["C", "C", "F", "F", "G", "G7", "C", "C"], "Half-bar");
    expect(split.ok).toBe(true);
    if (split.ok) expect(split.chart.sections[0].bars[2].spans.map((s) => s.symbol)).toEqual(["G", "G7"]);
  });
});
