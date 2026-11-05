import { describe, expect, it } from "vitest";
import type { ChordDefinition } from "@/model/contracts";
import {
  analyzeChordSymbol,
  analyzeSlashBass,
  changeQuality,
  chordFromDefinition,
  chordFromSymbol,
  chordTones,
  describeDegree,
  formatChordSymbol,
  getDegree,
  inversion,
  transposeChord,
  tryChordFromSymbol
} from "@/music/chords";
import { formatPitchClass, formatSpelledNote } from "@/music/pitch";
import { parseChordSymbol } from "@/theory/chordParser";

function labels(chord: ChordDefinition): string[] {
  return chord.degrees.map((degree) => degree.label);
}

function noteNames(chord: ChordDefinition, octave: number = 4): string[] {
  return chordTones(chord, octave).map((tone) => formatSpelledNote(tone.spelled));
}

const README_SYMBOLS = [
  "C", "Cm", "Cdim", "Caug", "Csus2", "Csus4", "C6", "Cmaj6", "Cm6", "C7", "Cmaj7", "Cm7", "Cdim7", "Cm7b5", "Cø",
  "C9", "Cmaj9", "Cm9", "C11", "C13", "Cadd9", "C7b9", "C7#11", "C/E", "Db/F", "Dm9", "G13", "Cmaj9"
];

describe("legacy compatibility", () => {
  it("accepts every README chord symbol and keeps the legacy pitch content (except the documented 13-chord 11)", () => {
    README_SYMBOLS.forEach((symbol) => {
      const analysis = analyzeChordSymbol(symbol);
      const legacy = parseChordSymbol(symbol);
      const semitones = analysis.chord.degrees.map((degree) => degree.semitones);
      const expected = legacy.intervals.filter((value) => !(analysis.adjustments.length > 0 && value === 17));
      expect(semitones).toEqual(expected);
    });
  });

  it("rethrows legacy error messages unchanged", () => {
    expect(() => chordFromSymbol("H7")).toThrow('Invalid chord symbol "H7".');
    expect(() => chordFromSymbol("Cfoo")).toThrow('Unsupported quality token near "foo" in "Cfoo".');
    expect(() => chordFromSymbol("  ")).toThrow("Empty chord symbol.");
    const result = tryChordFromSymbol("Cxyz");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Unsupported quality token");
    }
  });

  it("maps legacy qualities to ChordQualityId", () => {
    const cases: Array<[string, string]> = [
      ["C", "maj"], ["Cm", "min"], ["Cdim", "dim"], ["Caug", "aug"], ["C+", "aug"], ["Csus2", "sus2"], ["Csus", "sus4"],
      ["C6", "maj6"], ["Cm6", "min6"], ["C7", "dom7"], ["Cmaj7", "maj7"], ["Cm7", "min7"], ["Cm(maj7)", "minMaj7"],
      ["Cdim7", "dim7"], ["Co7", "dim7"], ["Cm7b5", "halfDim7"], ["Cø", "halfDim7"], ["C9", "dom9"], ["Cmaj9", "maj9"],
      ["Cm11", "min11"], ["C13", "dom13"], ["Cmaj13", "maj13"], ["Cmin7", "min7"]
    ];
    cases.forEach(([symbol, quality]) => {
      expect(chordFromSymbol(symbol).quality).toBe(quality);
    });
  });
});

describe("degree labels and roles", () => {
  it("labels Dm9 as 1 b3 5 b7 9", () => {
    const chord = chordFromSymbol("Dm9");
    expect(labels(chord)).toEqual(["1", "b3", "5", "b7", "9"]);
    expect(noteNames(chord)).toEqual(["D4", "F4", "A4", "C5", "E5"]);
    expect(chord.extensions).toEqual(["9"]);
  });

  it("labels G13 as 1 3 5 b7 9 13 and reports the omitted legacy 11", () => {
    const analysis = analyzeChordSymbol("G13");
    expect(labels(analysis.chord)).toEqual(["1", "3", "5", "b7", "9", "13"]);
    expect(analysis.legacy.intervals).toContain(17);
    expect(analysis.adjustments[0]).toMatch(/Natural 11 omitted/);
    expect(getDegree(analysis.chord, "13")?.essential).toBe(true);
    expect(getDegree(analysis.chord, "9")?.essential).toBe(false);
    // Minor 13 keeps its 11.
    expect(labels(chordFromSymbol("Dm13"))).toEqual(["1", "b3", "5", "b7", "9", "11", "13"]);
  });

  it("labels half-diminished and diminished sevenths", () => {
    const halfDim = chordFromSymbol("Cm7b5");
    expect(labels(halfDim)).toEqual(["1", "b3", "b5", "b7"]);
    expect(noteNames(halfDim)).toEqual(["C4", "Eb4", "Gb4", "Bb4"]);
    expect(getDegree(halfDim, "b5")?.essential).toBe(true);
    expect(halfDim.alterations).toEqual([]);
    const dim7 = chordFromSymbol("Cdim7");
    expect(labels(dim7)).toEqual(["1", "b3", "b5", "bb7"]);
    expect(noteNames(dim7)).toEqual(["C4", "Eb4", "Gb4", "Bbb4"]);
    expect(getDegree(dim7, "bb7")?.role).toBe("seventh");
  });

  it("assigns roles and essential flags", () => {
    const c7 = chordFromSymbol("C7");
    expect(c7.degrees.map((d) => d.role)).toEqual(["root", "third", "fifth", "seventh"]);
    expect(c7.degrees.map((d) => d.essential)).toEqual([true, true, false, true]);
    const sus = chordFromSymbol("Csus4");
    expect(getDegree(sus, "4")?.role).toBe("suspension");
    expect(getDegree(sus, "4")?.essential).toBe(true);
    const sevenSus = chordFromSymbol("F7sus4");
    expect(labels(sevenSus)).toEqual(["1", "4", "5", "b7"]);
    expect(getDegree(sevenSus, "4")?.role).toBe("suspension");
    const aug = chordFromSymbol("Caug");
    expect(getDegree(aug, "#5")?.essential).toBe(true);
  });

  it("classifies alterations and added tones", () => {
    const b9 = chordFromSymbol("C7b9");
    expect(labels(b9)).toEqual(["1", "3", "5", "b7", "b9"]);
    expect(b9.alterations).toEqual(["b9"]);
    const sharp11 = chordFromSymbol("C7#11");
    expect(labels(sharp11)).toEqual(["1", "3", "5", "b7", "#11"]);
    expect(sharp11.alterations).toEqual(["#11"]);
    expect(noteNames(sharp11)).toContain("F#5");
    const add9 = chordFromSymbol("Cadd9");
    expect(labels(add9)).toEqual(["1", "3", "5", "9"]);
    expect(add9.added).toEqual(["9"]);
    expect(getDegree(add9, "9")?.role).toBe("added");
    const sharp5 = chordFromSymbol("C7+5");
    expect(labels(sharp5)).toEqual(["1", "3", "#5", "b7"]);
    expect(sharp5.alterations).toEqual(["#5"]);
  });
});

describe("spelling from written letters", () => {
  it("spells Db with D flat, not C sharp", () => {
    const chord = chordFromSymbol("Db/F");
    expect(chord.root).toEqual({ letter: "D", accidental: -1 });
    expect(chord.bass).toEqual({ letter: "F", accidental: 0 });
    expect(noteNames(chord)).toEqual(["Db4", "F4", "Ab4"]);
    const cSharp = chordFromSymbol("C#");
    expect(noteNames(cSharp)).toEqual(["C#4", "E#4", "G#4"]);
  });

  it("spells flat-key chords with letter-per-degree", () => {
    expect(noteNames(chordFromSymbol("Ebm7"))).toEqual(["Eb4", "Gb4", "Bb4", "Db5"]);
    expect(noteNames(chordFromSymbol("Bmaj7"))).toEqual(["B4", "D#5", "F#5", "A#5"]);
  });
});

describe("construction, transposition and formatting", () => {
  it("builds chords programmatically", () => {
    const g7 = chordFromDefinition({ letter: "G", accidental: 0 }, "dom7");
    expect(g7.symbol).toBe("G7");
    expect(labels(g7)).toEqual(["1", "3", "5", "b7"]);
    const alt = chordFromDefinition({ letter: "G", accidental: 0 }, "dom7", { alterations: ["b9", "#11"] });
    expect(alt.symbol).toBe("G7b9#11");
    expect(labels(alt)).toEqual(["1", "3", "5", "b7", "b9", "#11"]);
    const sus = chordFromDefinition({ letter: "D", accidental: 0 }, "dom7", { suspension: "4" });
    expect(labels(sus)).toEqual(["1", "4", "5", "b7"]);
    expect(() => chordFromDefinition({ letter: "C", accidental: 0 }, "maj", { alterations: ["9"] })).toThrow(/not a supported alteration/);
    expect(labels(changeQuality(chordFromSymbol("C7"), "min7"))).toEqual(["1", "b3", "5", "b7"]);
  });

  it("transposes while preserving spelling and suffix", () => {
    const em9 = transposeChord(chordFromSymbol("Dm9"), { number: 2, quality: "M" });
    expect(em9.symbol).toBe("Em9");
    expect(noteNames(em9)).toEqual(["E4", "G4", "B4", "D5", "F#5"]);
    const gb = transposeChord(chordFromSymbol("Db/F"), { number: 4, quality: "P" });
    expect(gb.symbol).toBe("Gb/Bb");
    expect(formatPitchClass(gb.root)).toBe("Gb");
    const down = transposeChord(chordFromSymbol("Cmin7"), { number: 2, quality: "m" }, "down");
    expect(down.symbol).toBe("Bmin7");
  });

  it("formats chord symbols", () => {
    expect(formatChordSymbol(chordFromSymbol("Bbmaj7/D"))).toBe("Bbmaj7/D");
    expect(formatChordSymbol(chordFromSymbol("Bbmaj7/D"), { unicode: true })).toBe("B♭maj7/D");
    expect(formatChordSymbol(chordFromSymbol("Cbb9"))).toBe("Cbb9");
  });
});

describe("inversions and slash bass", () => {
  it("defines inversions by the lowest chord degree", () => {
    const c = chordFromSymbol("C");
    const first = inversion(c, 1, 4);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.bassDegree.role).toBe("third");
      expect(first.notes.map((t) => formatSpelledNote(t.spelled))).toEqual(["E4", "G4", "C5"]);
      expect(first.name).toBe("first inversion");
    }
    const second = inversion(c, 2, 4);
    expect(second.ok && second.notes.map((t) => formatSpelledNote(t.spelled))).toEqual(["G4", "C5", "E5"]);
    const third = inversion(c, 3);
    expect(third.ok).toBe(false);
    if (!third.ok) {
      expect(third.reason).toMatch(/no third inversion/);
    }
  });

  it("handles third inversion of seventh chords and keeps extensions on top", () => {
    const g7 = inversion(chordFromSymbol("G7"), 3, 3);
    expect(g7.ok && g7.notes.map((t) => formatSpelledNote(t.spelled))).toEqual(["F3", "G3", "B3", "D4"]);
    const dm9 = inversion(chordFromSymbol("Dm9"), 1, 3);
    expect(dm9.ok && dm9.ordering.map((d) => d.label)).toEqual(["b3", "5", "b7", "1", "9"]);
  });

  it("relates slash basses to chord degrees", () => {
    const slash = analyzeSlashBass(chordFromSymbol("C/E"));
    expect(slash.kind).toBe("chordTone");
    if (slash.kind === "chordTone") {
      expect(slash.degree.label).toBe("3");
      expect(slash.inversion).toBe(1);
      expect(slash.enharmonicOnly).toBe(false);
    }
    const db = analyzeSlashBass(chordFromSymbol("Db/F"));
    expect(db.kind === "chordTone" && db.inversion).toBe(1);
    const nonChord = analyzeSlashBass(chordFromSymbol("C/D"));
    expect(nonChord).toEqual({ kind: "nonChordTone", relativeLabel: "2" });
  });

  it("describes played pitches for inspectors, including ambiguity", () => {
    const c = chordFromSymbol("C/E");
    const e = describeDegree(c, 52);
    expect(e.status).toBe("chordTone");
    expect(e.isBass).toBe(true);
    expect(e.matches[0].degree.label).toBe("3");
    expect(formatSpelledNote(e.matches[0].spelled)).toBe("E3");
    const db = describeDegree(chordFromSymbol("Db"), 61);
    expect(formatSpelledNote(db.matches[0].spelled)).toBe("Db4");
    const outside = describeDegree(chordFromSymbol("C"), 61);
    expect(outside.status).toBe("nonChordTone");
    expect(outside.relativeLabel).toBe("b2");
    const ambiguous = describeDegree(chordFromSymbol("C7#5b13"), 68);
    expect(ambiguous.ambiguous).toBe(true);
    expect(ambiguous.matches.map((m) => m.degree.label)).toEqual(["#5", "b13"]);
    const slashOnly = describeDegree(chordFromSymbol("C/D"), 50);
    expect(slashOnly.status).toBe("slashBass");
  });
});
