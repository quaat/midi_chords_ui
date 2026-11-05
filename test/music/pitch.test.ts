import { describe, expect, it } from "vitest";
import {
  defaultSpelling,
  enharmonicEquals,
  enharmonicNoteEquals,
  enharmonicSpellings,
  formatPitchClass,
  formatSpelledNote,
  midiOf,
  noteFromMidi,
  parsePitchClass,
  parsePitchClassOrThrow,
  parseSpelledNote,
  pitchClassOf,
  simplifySpelling,
  spellMidiWithLetter,
  spelledEquals,
  stepLetter
} from "@/music/pitch";

describe("spelled pitch parsing and formatting", () => {
  it("parses naturals, single and double accidentals", () => {
    expect(parsePitchClass("C")).toEqual({ letter: "C", accidental: 0 });
    expect(parsePitchClass("F#")).toEqual({ letter: "F", accidental: 1 });
    expect(parsePitchClass("Bb")).toEqual({ letter: "B", accidental: -1 });
    expect(parsePitchClass("Cbb")).toEqual({ letter: "C", accidental: -2 });
    expect(parsePitchClass("Fx")).toEqual({ letter: "F", accidental: 2 });
    expect(parsePitchClass("F##")).toEqual({ letter: "F", accidental: 2 });
    expect(parsePitchClass("E♭")).toEqual({ letter: "E", accidental: -1 });
    expect(parsePitchClass("bb")).toEqual({ letter: "B", accidental: -1 });
  });

  it("rejects invalid note names explicitly", () => {
    expect(parsePitchClass("H")).toBeNull();
    expect(parsePitchClass("C###")).toBeNull();
    expect(parsePitchClass("")).toBeNull();
    expect(() => parsePitchClassOrThrow("Q#")).toThrow(/Invalid note name/);
  });

  it("round-trips spelled notes with octaves", () => {
    const names = ["C4", "Eb4", "F#3", "Cbb2", "B#3", "Fx5", "Ab-1"];
    names.forEach((name) => {
      const note = parseSpelledNote(name);
      expect(note).not.toBeNull();
      if (note) {
        expect(formatSpelledNote(note)).toBe(name.replace("x", "##"));
      }
    });
    expect(parseSpelledNote("Eb")).toBeNull();
    expect(formatPitchClass({ letter: "B", accidental: -1 }, { unicode: true })).toBe("B♭");
  });
});

describe("pitch class and MIDI", () => {
  it("uses C4 = 60 with the octave belonging to the letter", () => {
    expect(midiOf({ letter: "C", accidental: 0, octave: 4 })).toBe(60);
    expect(midiOf({ letter: "C", accidental: -1, octave: 4 })).toBe(59);
    expect(midiOf({ letter: "B", accidental: 1, octave: 3 })).toBe(60);
    expect(midiOf({ letter: "A", accidental: 0, octave: 4 })).toBe(69);
    expect(pitchClassOf({ letter: "C", accidental: -1 })).toBe(11);
    expect(pitchClassOf({ letter: "F", accidental: 2 })).toBe(7);
  });

  it("distinguishes enharmonic from spelled equality", () => {
    const cSharp = { letter: "C" as const, accidental: 1 as const };
    const dFlat = { letter: "D" as const, accidental: -1 as const };
    expect(enharmonicEquals(cSharp, dFlat)).toBe(true);
    expect(spelledEquals(cSharp, dFlat)).toBe(false);
    expect(enharmonicNoteEquals({ letter: "B", accidental: 1, octave: 3 }, { letter: "C", accidental: 0, octave: 4 })).toBe(true);
  });

  it("spells MIDI numbers on a chosen letter and with default preferences", () => {
    expect(spellMidiWithLetter(59, "C")).toEqual({ letter: "C", accidental: -1, octave: 4 });
    expect(spellMidiWithLetter(60, "B")).toEqual({ letter: "B", accidental: 1, octave: 3 });
    expect(spellMidiWithLetter(66, "C")).toBeNull();
    expect(noteFromMidi(61)).toEqual({ letter: "D", accidental: -1, octave: 4 });
    expect(noteFromMidi(61, "sharp")).toEqual({ letter: "C", accidental: 1, octave: 4 });
    expect(defaultSpelling(6)).toEqual({ letter: "F", accidental: 1 });
  });

  it("provides nearest-spelling helpers and letter stepping", () => {
    expect(simplifySpelling({ letter: "F", accidental: 2 })).toEqual({ letter: "G", accidental: 0 });
    expect(simplifySpelling({ letter: "C", accidental: -2 })).toEqual({ letter: "B", accidental: -1 });
    expect(simplifySpelling({ letter: "E", accidental: 1 }, false)).toEqual({ letter: "F", accidental: 0 });
    expect(enharmonicSpellings(8).map((p) => formatPitchClass(p))).toEqual(["G#", "Ab"]);
    expect(enharmonicSpellings(7).map((p) => formatPitchClass(p))).toEqual(["G", "F##", "Abb"]);
    expect(stepLetter("B", 1)).toBe("C");
    expect(stepLetter("C", -1)).toBe("B");
    expect(stepLetter("D", 8)).toBe("E");
  });
});
