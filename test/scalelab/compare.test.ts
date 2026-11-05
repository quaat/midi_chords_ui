import { describe, expect, it } from "vitest";
import { modeComparison, scaleRunTimeline, vampTimeline } from "@/scalelab";

describe("modeComparison", () => {
  const cmp = modeComparison("D", "dorian", "naturalMinor", 4);

  it("lists both scales over the same tonic with spelled notes and labels", () => {
    expect(cmp.scales[0].displayName).toBe("D Dorian");
    expect(cmp.scales[1].displayName).toBe("D natural minor");
    expect(cmp.scales[0].notes.map((n) => n.pitchName)).toEqual(["D", "E", "F", "G", "A", "B", "C", "D"]);
    expect(cmp.scales[1].notes.map((n) => n.pitchName)).toEqual(["D", "E", "F", "G", "A", "B♭", "C", "D"]);
    expect(cmp.scales[0].notes[0].midi).toBe(62);
    expect(cmp.scales[1].degreeLabels).toEqual(["1", "2", "b3", "4", "5", "b6", "b7"]);
  });

  it("finds the single difference on the sixth degree, B vs B♭", () => {
    expect(cmp.differences).toHaveLength(1);
    expect(cmp.differences[0].degreeNumber).toBe(6);
    expect(cmp.differences[0].text).toBe("The sixth degree: B natural in D Dorian, B♭ in D natural minor; the tonic D stays the same.");
    expect(cmp.characteristicDegreeMidi).toEqual([70, 71]);
    expect(cmp.summary).toContain("share the tonic D");
  });

  it("offers the relative view only as a secondary explanation", () => {
    const text = cmp.relativeExplanation.join(" ");
    expect(text).toContain("D Dorian uses the same notes as C major");
    expect(text).toContain("D natural minor uses the same notes as F major");
    expect(text).toContain("secondary");
  });

  it("produces runs for hearing A then B over the same tonic", () => {
    const a = cmp.timelines.a;
    const melodic = a.notes.filter((n) => n.part === "demonstration");
    expect(melodic).toHaveLength(8);
    expect(melodic.map((n) => n.onsetBeat)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
    expect(melodic.map((n) => n.degree)).toEqual(["1", "2", "b3", "4", "5", "6", "b7", "1"]);
    expect(new Set(melodic.map((n) => n.occurrenceId)).size).toBe(8);
    const drone = a.notes.filter((n) => n.part === "accompaniment");
    expect(drone).toHaveLength(1);
    expect(drone[0].midi).toBe(50);
    const both = cmp.timelines.aThenB;
    expect(both.totalBeats).toBe(9);
    expect(both.notes.filter((n) => n.part === "demonstration").find((n) => n.onsetBeat === 5 + 2.5)?.midi).toBe(70);
    expect(new Set(both.notes.map((n) => n.id)).size).toBe(both.notes.length);
    expect(scaleRunTimeline("D", "dorian", { drone: false }).notes.every((n) => n.part === "demonstration")).toBe(true);
  });

  it("handles other comparisons (major vs mixolydian)", () => {
    const other = modeComparison("G", "major", "mixolydian");
    expect(other.differences.map((d) => d.degreeNumber)).toEqual([7]);
    expect(other.differences[0].text).toContain("F♯ in G major, F natural in G Mixolydian");
  });
});

describe("vampTimeline", () => {
  it("Dorian vamp: Dm7–G7 sustained with D in the bass, no learner notes", () => {
    const vamp = vampTimeline("D", "dorian");
    expect(vamp.ok).toBe(true);
    if (!vamp.ok) return;
    expect(vamp.symbols).toEqual(["Dm7", "G7"]);
    expect(vamp.romanNumerals).toEqual(["i7", "IV7"]);
    const timeline = vamp.timeline;
    expect(timeline.notes.filter((n) => n.part === "learner")).toEqual([]);
    expect(timeline.totalBeats).toBe(16);
    const first = timeline.notes.filter((n) => n.onsetBeat === 0);
    expect(Math.min(...first.map((n) => n.midi)) % 12).toBe(2);
    expect(new Set(timeline.occurrences.map((o) => o.occurrenceId)).size).toBe(4);
  });

  it("natural minor, major and mixolydian vamps", () => {
    const minor = vampTimeline("D", "naturalMinor");
    const major = vampTimeline("F", "major");
    const mixo = vampTimeline("G", "mixolydian");
    expect(minor.ok && minor.symbols).toEqual(["Dm7", "Gm7"]);
    expect(major.ok && major.symbols).toEqual(["Fmaj7", "Bbmaj7"]);
    expect(mixo.ok && mixo.symbols).toEqual(["G7", "F"]);
    const none = vampTimeline("C", "blues");
    expect(none.ok).toBe(false);
  });
});
