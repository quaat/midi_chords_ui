import { describe, expect, it } from "vitest";
import {
  addIntervals,
  degreeLabelFromInterval,
  directedIntervalBetween,
  formatInterval,
  intervalBetween,
  intervalBetweenPitchClasses,
  intervalFromSemitones,
  intervalName,
  invertInterval,
  parseDegreeLabel,
  parseDegreeLabelOrThrow,
  parseInterval,
  semitonesOf,
  transposePitchClass,
  transposeSpelled
} from "@/music/intervals";
import { formatSpelledNote, parseSpelledNoteOrThrow } from "@/music/pitch";

const n = parseSpelledNoteOrThrow;

describe("interval sizes", () => {
  it("computes semitones for simple, compound, augmented and diminished intervals", () => {
    expect(semitonesOf({ number: 3, quality: "M" })).toBe(4);
    expect(semitonesOf({ number: 3, quality: "m" })).toBe(3);
    expect(semitonesOf({ number: 5, quality: "d" })).toBe(6);
    expect(semitonesOf({ number: 4, quality: "A" })).toBe(6);
    expect(semitonesOf({ number: 7, quality: "d" })).toBe(9);
    expect(semitonesOf({ number: 9, quality: "m" })).toBe(13);
    expect(semitonesOf({ number: 11, quality: "A" })).toBe(18);
    expect(semitonesOf({ number: 13, quality: "M" })).toBe(21);
    expect(semitonesOf({ number: 13, quality: "m" })).toBe(20);
    expect(() => semitonesOf({ number: 5, quality: "M" })).toThrow(/Invalid interval/);
  });

  it("builds intervals from number + semitones and rejects impossible combinations", () => {
    expect(intervalFromSemitones(3, 4)).toEqual({ number: 3, quality: "M" });
    expect(intervalFromSemitones(9, 15)).toEqual({ number: 9, quality: "A" });
    expect(intervalFromSemitones(3, 7)).toBeNull();
    expect(parseInterval("A11")).toEqual({ number: 11, quality: "A" });
    expect(parseInterval("P3")).toBeNull();
    expect(formatInterval({ number: 9, quality: "m" })).toBe("m9");
    expect(intervalName({ number: 11, quality: "A" })).toBe("augmented eleventh");
  });

  it("adds and inverts intervals", () => {
    expect(addIntervals({ number: 3, quality: "M" }, { number: 3, quality: "m" })).toEqual({ number: 5, quality: "P" });
    expect(addIntervals({ number: 9, quality: "M" }, { number: 3, quality: "m" })).toEqual({ number: 11, quality: "P" });
    expect(invertInterval({ number: 3, quality: "M" })).toEqual({ number: 6, quality: "m" });
    expect(invertInterval({ number: 4, quality: "A" })).toEqual({ number: 5, quality: "d" });
  });
});

describe("intervals between spelled notes", () => {
  it("measures letter distance, not just semitones", () => {
    expect(intervalBetween(n("C4"), n("E4"))).toEqual({ number: 3, quality: "M" });
    expect(intervalBetween(n("C4"), n("Fb4"))).toEqual({ number: 4, quality: "d" });
    expect(intervalBetween(n("C4"), n("D#4"))).toEqual({ number: 2, quality: "A" });
    expect(intervalBetween(n("C4"), n("Eb4"))).toEqual({ number: 3, quality: "m" });
    expect(intervalBetween(n("C4"), n("D5"))).toEqual({ number: 9, quality: "M" });
    expect(intervalBetween(n("B3"), n("C4"))).toEqual({ number: 2, quality: "m" });
    expect(intervalBetweenPitchClasses({ letter: "E", accidental: 0 }, { letter: "C", accidental: 0 })).toEqual({ number: 6, quality: "m" });
  });

  it("keeps direction when asked", () => {
    expect(directedIntervalBetween(n("E4"), n("C4"))).toEqual({ interval: { number: 3, quality: "M" }, direction: "down" });
  });
});

describe("spelled transposition", () => {
  it("preserves letter arithmetic up and down", () => {
    expect(formatSpelledNote(transposeSpelled(n("D4"), { number: 2, quality: "M" }))).toBe("E4");
    expect(formatSpelledNote(transposeSpelled(n("F#4"), { number: 3, quality: "m" }))).toBe("A4");
    expect(formatSpelledNote(transposeSpelled(n("Bb3"), { number: 4, quality: "P" }))).toBe("Eb4");
    expect(formatSpelledNote(transposeSpelled(n("C4"), { number: 13, quality: "M" }))).toBe("A5");
    expect(formatSpelledNote(transposeSpelled(n("C4"), { number: 7, quality: "d" }))).toBe("Bbb4");
    expect(formatSpelledNote(transposeSpelled(n("C4"), { number: 3, quality: "M" }, "down"))).toBe("Ab3");
    expect(formatSpelledNote(transposeSpelled(n("E4"), { number: 4, quality: "A" }))).toBe("A#4");
  });

  it("fails explicitly when more than a double accidental would be needed", () => {
    expect(() => transposeSpelled(n("Fx4"), { number: 1, quality: "A" })).toThrow(/double sharps\/flats/);
    expect(() => transposePitchClass({ letter: "C", accidental: -2 }, { number: 2, quality: "m" })).toThrow(RangeError);
  });
});

describe("degree labels", () => {
  it("maps teaching labels to intervals", () => {
    const cases: Array<[string, string]> = [
      ["1", "P1"],
      ["b3", "m3"],
      ["3", "M3"],
      ["#11", "A11"],
      ["b9", "m9"],
      ["13", "M13"],
      ["b13", "m13"],
      ["#5", "A5"],
      ["b5", "d5"],
      ["6", "M6"],
      ["sus4", "P4"],
      ["4", "P4"],
      ["2", "M2"],
      ["7", "M7"],
      ["b7", "m7"],
      ["bb7", "d7"],
      ["#9", "A9"]
    ];
    cases.forEach(([label, expected]) => {
      const parsed = parseDegreeLabel(label);
      expect(parsed ? formatInterval(parsed) : null).toBe(expected);
    });
  });

  it("round-trips intervals to labels", () => {
    ["1", "b3", "3", "b5", "5", "#5", "6", "bb7", "b7", "7", "b9", "9", "#9", "11", "#11", "b13", "13"].forEach((label) => {
      expect(degreeLabelFromInterval(parseDegreeLabelOrThrow(label))).toBe(label);
    });
  });

  it("rejects invalid labels explicitly", () => {
    expect(parseDegreeLabel("b1")).toBeNull();
    expect(parseDegreeLabel("x9")).toBeNull();
    expect(parseDegreeLabel("add9")).toBeNull();
    expect(parseDegreeLabel("16")).toBeNull();
    expect(() => parseDegreeLabelOrThrow("maj")).toThrow(/Invalid degree label "maj"/);
  });
});
