import { describe, expect, it } from "vitest";
import { buildDiatonicActivity } from "@/harmonisation";
import { compileTimeline } from "@/timeline/compile";

const C_MAJOR = { tonic: { letter: "C" as const, accidental: 0 as const }, mode: "major" as const };

describe("buildDiatonicActivity", () => {
  const activity = buildDiatonicActivity(C_MAJOR);

  it("builds the seven triads of C major with qualities M m m M M m dim", () => {
    expect(activity.degrees.map((d) => d.chord.quality)).toEqual(["maj", "min", "min", "maj", "maj", "min", "dim"]);
    expect(activity.degrees.map((d) => d.romanNumeral)).toEqual(["I", "ii", "iii", "IV", "V", "vi", "vii°"]);
    expect(activity.degrees.map((d) => d.quality)).toEqual(["major", "minor", "minor", "major", "major", "minor", "diminished"]);
    expect(activity.stepPattern).toEqual(["W", "W", "H", "W", "W", "W", "H"]);
  });

  it("gives notes in octave 4 and explains qualities from interval sizes", () => {
    const ii = activity.degrees[1];
    expect(ii.notes.map((n) => n.name)).toEqual(["D4", "F4", "A4"]);
    expect(ii.notes.map((n) => n.midi)).toEqual([62, 65, 69]);
    expect(ii.qualityExplanation).toContain("Built on degree 2 of C major: D F A");
    expect(ii.qualityExplanation).toContain("a minor third, because F is a half step lower than F#");
    expect(ii.intervals.map((i) => i.semitones)).toEqual([3, 7]);
    const vii = activity.degrees[6];
    expect(vii.qualityExplanation).toContain("diminished fifth");
    expect(vii.qualityExplanation).toContain("F is a half step lower than F#, the perfect fifth above B");
    expect(activity.degrees[0].qualityExplanation).toContain("major third");
    expect(activity.degrees[4].function).toBe("dominant");
    expect(activity.explanation.length).toBeGreaterThanOrEqual(3);
    expect(activity.explanation.join(" ")).toContain("E–F and B–C");
  });

  it("produces a playable 2-beat-per-chord sequence", () => {
    expect(activity.sequence.events).toHaveLength(7);
    expect(activity.sequence.events.map((e) => e.startBeat)).toEqual([0, 2, 4, 6, 8, 10, 12]);
    expect(activity.sequence.totalBeats).toBe(14);
    const timeline = compileTimeline(activity.sequence);
    const learner = timeline.notes.filter((n) => n.part === "learner");
    expect(learner).toHaveLength(21);
    expect(learner.filter((n) => n.onsetBeat === 2).map((n) => n.midi)).toEqual([62, 65, 69]);
  });

  it("supports seventh chords and other keys", () => {
    const sevenths = buildDiatonicActivity(C_MAJOR, { sevenths: true });
    expect(sevenths.degrees.map((d) => d.chord.quality)).toEqual(["maj7", "min7", "min7", "maj7", "dom7", "min7", "halfDim7"]);
    expect(sevenths.degrees[4].qualityExplanation).toContain("minor seventh");
    const aMinor = buildDiatonicActivity({ tonic: { letter: "A", accidental: 0 }, mode: "naturalMinor" });
    expect(aMinor.degrees.map((d) => d.chord.quality)).toEqual(["min", "dim", "maj", "min", "min", "maj", "maj"]);
    const fMajor = buildDiatonicActivity({ tonic: { letter: "F", accidental: 0 }, mode: "major" });
    expect(fMajor.degrees[3].symbol).toBe("Bb");
  });
});
