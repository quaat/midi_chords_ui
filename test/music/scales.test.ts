import { describe, expect, it } from "vitest";
import type { ScaleId } from "@/model/contracts";
import { compareScales, diatonicSevenths, diatonicTriads, formatKey, getScale, keyFromTonicAndMode, scaleNotes, scalePitchClasses, SCALE_IDS, transposeKey } from "@/music/scales";
import { formatPitchClass, formatSpelledNote } from "@/music/pitch";

function names(tonic: string, scaleId: ScaleId): string[] {
  return scalePitchClasses(tonic, scaleId).map((p) => formatPitchClass(p));
}

describe("scale catalogue", () => {
  it("defines every ScaleId with degrees starting at 1", () => {
    const expected: ScaleId[] = ["major", "naturalMinor", "harmonicMinor", "melodicMinor", "ionian", "dorian", "phrygian", "lydian", "mixolydian", "aeolian", "locrian", "majorPentatonic", "minorPentatonic", "blues", "chromatic"];
    expect([...SCALE_IDS].sort()).toEqual([...expected].sort());
    expected.forEach((id) => {
      const scale = getScale(id);
      expect(scale.degrees[0].label).toBe("1");
      expect(scale.degrees[0].semitones).toBe(0);
    });
    expect(getScale("chromatic").degrees).toHaveLength(12);
  });

  it("describes dorian relative to major with its characteristic 6", () => {
    const dorian = getScale("dorian");
    expect(dorian.degrees.map((d) => d.label)).toEqual(["1", "2", "b3", "4", "5", "6", "b7"]);
    expect(dorian.characteristicDegrees).toEqual(["6"]);
    expect(dorian.relativeTo).toEqual({ scale: "major", degree: 2 });
  });
});

describe("scale spelling", () => {
  it("uses one letter per degree for diatonic scales", () => {
    expect(names("F", "major")).toEqual(["F", "G", "A", "Bb", "C", "D", "E"]);
    expect(names("D", "dorian")).toEqual(["D", "E", "F", "G", "A", "B", "C"]);
    expect(names("B", "major")).toEqual(["B", "C#", "D#", "E", "F#", "G#", "A#"]);
    expect(names("Gb", "major")).toEqual(["Gb", "Ab", "Bb", "Cb", "Db", "Eb", "F"]);
    expect(names("A", "harmonicMinor")).toEqual(["A", "B", "C", "D", "E", "F", "G#"]);
    expect(names("G#", "harmonicMinor")).toEqual(["G#", "A#", "B", "C#", "D#", "E", "F##"]);
    expect(names("F", "lydian")).toEqual(["F", "G", "A", "B", "C", "D", "E"]);
  });

  it("derives pentatonic and blues spellings from labels", () => {
    expect(names("C", "majorPentatonic")).toEqual(["C", "D", "E", "G", "A"]);
    expect(names("A", "minorPentatonic")).toEqual(["A", "C", "D", "E", "G"]);
    expect(names("C", "blues")).toEqual(["C", "Eb", "F", "Gb", "G", "Bb"]);
  });

  it("returns spelled notes with MIDI across octaves", () => {
    const notes = scaleNotes("C", "major", 4, 1);
    expect(notes).toHaveLength(8);
    expect(notes.map((n) => n.midi)).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
    expect(notes[7].degreeLabel).toBe("1");
    const cb = scaleNotes("Cb", "major", 4, 1, { includeTop: false });
    expect(cb[0].midi).toBe(59);
    expect(formatSpelledNote(cb[6].spelled)).toBe("Bb4");
    const two = scaleNotes("D", "dorian", 3, 2);
    expect(two).toHaveLength(15);
    expect(formatSpelledNote(two[14].spelled)).toBe("D5");
  });
});

describe("keys and diatonic chords", () => {
  it("builds C major triads with Roman numerals", () => {
    const triads = diatonicTriads(keyFromTonicAndMode("C", "major"));
    expect(triads.map((t) => t.romanNumeral)).toEqual(["I", "ii", "iii", "IV", "V", "vi", "vii°"]);
    expect(triads.map((t) => t.chord.symbol)).toEqual(["C", "Dm", "Em", "F", "G", "Am", "Bdim"]);
    expect(triads[6].chord.quality).toBe("dim");
  });

  it("builds seventh chords, including harmonic minor colours", () => {
    const sevenths = diatonicSevenths(keyFromTonicAndMode("C", "major"));
    expect(sevenths.map((t) => t.romanNumeral)).toEqual(["Imaj7", "ii7", "iii7", "IVmaj7", "V7", "vi7", "viiø7"]);
    const harmonic = diatonicSevenths(keyFromTonicAndMode("A", "harmonicMinor"));
    expect(harmonic.map((t) => t.chord.symbol)).toEqual(["Am(maj7)", "Bm7b5", "Cmaj7#5", "Dm7", "E7", "Fmaj7", "G#dim7"]);
  });

  it("supports both numeral styles in minor/modal keys", () => {
    const key = keyFromTonicAndMode("C", "naturalMinor");
    expect(diatonicTriads(key).map((t) => t.romanNumeral)).toEqual(["i", "ii°", "III", "iv", "v", "VI", "VII"]);
    expect(diatonicTriads(key, { numeralStyle: "relativeToMajor" }).map((t) => t.romanNumeral)).toEqual(["i", "ii°", "bIII", "iv", "v", "bVI", "bVII"]);
    expect(diatonicTriads(keyFromTonicAndMode("F", "major"))[3].chord.symbol).toBe("Bb");
    expect(() => diatonicTriads(keyFromTonicAndMode("C", "majorPentatonic"))).toThrow(/seven-note scale/);
  });

  it("transposes keys with spelling", () => {
    const key = transposeKey(keyFromTonicAndMode("D", "dorian"), { number: 3, quality: "m" });
    expect(formatKey(key)).toBe("F dorian");
    expect(formatKey(transposeKey(keyFromTonicAndMode("C", "major"), { number: 2, quality: "m" }))).toBe("Db major");
    expect(() => keyFromTonicAndMode("H", "major")).toThrow(/Invalid note name/);
  });
});

describe("scale comparison", () => {
  it("finds that D dorian and D natural minor differ only on the 6th", () => {
    const comparison = compareScales("D", "dorian", "naturalMinor");
    expect(comparison.differences).toHaveLength(1);
    const difference = comparison.differences[0];
    expect(difference.degreeNumber).toBe(6);
    expect(formatPitchClass(difference.a[0].spelled)).toBe("B");
    expect(formatPitchClass(difference.b[0].spelled)).toBe("Bb");
    expect(comparison.summary).toContain("6th: B (6) vs Bb (b6)");
    expect(comparison.shared).toHaveLength(6);
  });

  it("compares scales of different sizes", () => {
    const comparison = compareScales("C", "minorPentatonic", "blues");
    expect(comparison.differences.map((d) => d.degreeNumber)).toEqual([5]);
    expect(comparison.differences[0].b.map((t) => t.label)).toEqual(["b5", "5"]);
    expect(compareScales("C", "major", "ionian").differences).toEqual([]);
  });
});
