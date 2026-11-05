/**
 * Spelled pitch classes and notes (plan E04).
 *
 * A spelled note keeps its letter and accidental, so E♭ and D♯ remain different
 * notes even though they share a pitch class / MIDI number.
 *
 * Conventions
 * - MIDI: C4 = 60. The octave number belongs to the *letter*, so Cb4 = 59 and B#3 = 60.
 * - Accidentals: -2..2 (double flat .. double sharp). Spellings that would need a
 *   triple accidental are not representable.
 * - Error style: `parse*` functions return `null` for unparseable text; the
 *   `*OrThrow` variants throw an Error with a descriptive message. Functions that take
 *   already-typed values never return null unless documented.
 */
import type { Accidental, Letter, SpelledNote, SpelledPitchClass } from "@/model/contracts";

export const LETTERS: readonly Letter[] = ["C", "D", "E", "F", "G", "A", "B"];

/** Pitch class of each natural letter. */
export const LETTER_PITCH_CLASS: Readonly<Record<Letter, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11
};

export type SpellingPreference = "sharp" | "flat" | "smart";

export interface FormatOptions {
  /** Use ♯ ♭ 𝄪 𝄫 instead of ASCII "#", "b", "##", "bb". */
  unicode?: boolean;
}

const ACCIDENTAL_ASCII: Readonly<Record<string, string>> = {
  "-2": "bb",
  "-1": "b",
  "0": "",
  "1": "#",
  "2": "##"
};

const ACCIDENTAL_UNICODE: Readonly<Record<string, string>> = {
  "-2": "\u{1D12B}",
  "-1": "♭",
  "0": "",
  "1": "♯",
  "2": "\u{1D12A}"
};

/** Accepted accidental spellings (case-sensitive; "x" = double sharp). */
const ACCIDENTAL_TEXT: ReadonlyArray<[string, Accidental]> = [
  ["##", 2],
  ["x", 2],
  ["♯♯", 2],
  ["\u{1D12A}", 2],
  ["#", 1],
  ["♯", 1],
  ["bb", -2],
  ["♭♭", -2],
  ["\u{1D12B}", -2],
  ["b", -1],
  ["♭", -1],
  ["", 0],
  ["♮", 0]
];

export function mod12(value: number): number {
  return ((value % 12) + 12) % 12;
}

export function isLetter(value: string): value is Letter {
  return value === "C" || value === "D" || value === "E" || value === "F" || value === "G" || value === "A" || value === "B";
}

export function isAccidental(value: number): value is Accidental {
  return value === -2 || value === -1 || value === 0 || value === 1 || value === 2;
}

export function letterIndex(letter: Letter): number {
  return LETTERS.indexOf(letter);
}

/** Step a letter by a number of diatonic steps (negative = down). */
export function stepLetter(letter: Letter, steps: number): Letter {
  const index = (((letterIndex(letter) + steps) % 7) + 7) % 7;
  return LETTERS[index];
}

export function accidentalToText(accidental: Accidental, options: FormatOptions = {}): string {
  const table = options.unicode ? ACCIDENTAL_UNICODE : ACCIDENTAL_ASCII;
  return table[String(accidental)];
}

function parseAccidentalText(text: string): Accidental | null {
  for (const [candidate, value] of ACCIDENTAL_TEXT) {
    if (candidate === text) {
      return value;
    }
  }
  return null;
}

/**
 * Parse a pitch class such as "C", "f#", "Bb", "Cbb", "Fx", "F##", "E♭".
 * The letter is case-insensitive; accidentals are case-sensitive ("b" flat, "x" double sharp).
 * Returns null for anything else (including octave digits).
 */
export function parsePitchClass(text: string): SpelledPitchClass | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const letterText = trimmed.charAt(0).toUpperCase();
  if (!isLetter(letterText)) {
    return null;
  }
  const accidental = parseAccidentalText(trimmed.slice(1));
  if (accidental === null) {
    return null;
  }
  return { letter: letterText, accidental };
}

export function parsePitchClassOrThrow(text: string): SpelledPitchClass {
  const parsed = parsePitchClass(text);
  if (!parsed) {
    throw new Error(`Invalid note name "${text}". Expected a letter A-G with an optional accidental (#, b, ##, bb, x).`);
  }
  return parsed;
}

/** Parse a spelled note with octave, e.g. "Eb4", "C#-1", "Fx3", "B♭2". Returns null when invalid. */
export function parseSpelledNote(text: string): SpelledNote | null {
  const match = text.trim().match(/^(.+?)(-?\d+)$/u);
  if (!match) {
    return null;
  }
  const pitchClass = parsePitchClass(match[1]);
  if (!pitchClass) {
    return null;
  }
  const octave = Number.parseInt(match[2], 10);
  if (!Number.isFinite(octave)) {
    return null;
  }
  return { letter: pitchClass.letter, accidental: pitchClass.accidental, octave };
}

export function parseSpelledNoteOrThrow(text: string): SpelledNote {
  const parsed = parseSpelledNote(text);
  if (!parsed) {
    throw new Error(`Invalid note "${text}". Expected a note name followed by an octave, e.g. "Eb4".`);
  }
  return parsed;
}

export function formatPitchClass(pitchClass: SpelledPitchClass, options: FormatOptions = {}): string {
  return `${pitchClass.letter}${accidentalToText(pitchClass.accidental, options)}`;
}

export function formatSpelledNote(note: SpelledNote, options: FormatOptions = {}): string {
  return `${formatPitchClass(note, options)}${note.octave}`;
}

/** Pitch class 0..11 of a spelled pitch class. */
export function pitchClassOf(pitchClass: SpelledPitchClass): number {
  return mod12(LETTER_PITCH_CLASS[pitchClass.letter] + pitchClass.accidental);
}

/** MIDI number of a spelled note (C4 = 60; Cb4 = 59; B#3 = 60). */
export function midiOf(note: SpelledNote): number {
  return 12 * (note.octave + 1) + LETTER_PITCH_CLASS[note.letter] + note.accidental;
}

export function pitchClass(letter: Letter, accidental: Accidental = 0): SpelledPitchClass {
  return { letter, accidental };
}

export function spelledNote(pitch: SpelledPitchClass, octave: number): SpelledNote {
  return { letter: pitch.letter, accidental: pitch.accidental, octave };
}

export function toPitchClass(note: SpelledPitchClass): SpelledPitchClass {
  return { letter: note.letter, accidental: note.accidental };
}

/** Same letter and accidental (C# vs Db are NOT spelled-equal). */
export function spelledEquals(a: SpelledPitchClass, b: SpelledPitchClass): boolean {
  return a.letter === b.letter && a.accidental === b.accidental;
}

/** Same sounding pitch class (C# vs Db ARE enharmonically equal). */
export function enharmonicEquals(a: SpelledPitchClass, b: SpelledPitchClass): boolean {
  return pitchClassOf(a) === pitchClassOf(b);
}

/** Same letter, accidental, and octave. */
export function spelledNoteEquals(a: SpelledNote, b: SpelledNote): boolean {
  return spelledEquals(a, b) && a.octave === b.octave;
}

/** Same MIDI number regardless of spelling (B#3 and C4 are enharmonic notes). */
export function enharmonicNoteEquals(a: SpelledNote, b: SpelledNote): boolean {
  return midiOf(a) === midiOf(b);
}

/**
 * Spell pitch class `pc` using `letter`. Returns null when the spelling would need more
 * than a double accidental (e.g. pc 6 on letter C).
 */
export function spellPitchClassWithLetter(pc: number, letter: Letter): SpelledPitchClass | null {
  let diff = mod12(pc) - LETTER_PITCH_CLASS[letter];
  if (diff > 6) {
    diff -= 12;
  } else if (diff < -6) {
    diff += 12;
  }
  if (!isAccidental(diff)) {
    return null;
  }
  return { letter, accidental: diff };
}

/** Spell a MIDI number on a given letter, choosing the octave that belongs to that letter. */
export function spellMidiWithLetter(midi: number, letter: Letter): SpelledNote | null {
  const pitch = spellPitchClassWithLetter(mod12(midi), letter);
  if (!pitch) {
    return null;
  }
  // midi = 12 * (octave + 1) + letterPc + accidental  =>  solve for octave.
  const octave = (midi - LETTER_PITCH_CLASS[letter] - pitch.accidental) / 12 - 1;
  return { letter: pitch.letter, accidental: pitch.accidental, octave };
}

const SHARP_SPELLINGS: ReadonlyArray<SpelledPitchClass> = [
  { letter: "C", accidental: 0 },
  { letter: "C", accidental: 1 },
  { letter: "D", accidental: 0 },
  { letter: "D", accidental: 1 },
  { letter: "E", accidental: 0 },
  { letter: "F", accidental: 0 },
  { letter: "F", accidental: 1 },
  { letter: "G", accidental: 0 },
  { letter: "G", accidental: 1 },
  { letter: "A", accidental: 0 },
  { letter: "A", accidental: 1 },
  { letter: "B", accidental: 0 }
];

const FLAT_SPELLINGS: ReadonlyArray<SpelledPitchClass> = [
  { letter: "C", accidental: 0 },
  { letter: "D", accidental: -1 },
  { letter: "D", accidental: 0 },
  { letter: "E", accidental: -1 },
  { letter: "E", accidental: 0 },
  { letter: "F", accidental: 0 },
  { letter: "G", accidental: -1 },
  { letter: "G", accidental: 0 },
  { letter: "A", accidental: -1 },
  { letter: "A", accidental: 0 },
  { letter: "B", accidental: -1 },
  { letter: "B", accidental: 0 }
];

/** Matches the legacy "smart" table in src/theory/notes.ts (F# but Db, Eb, Ab, Bb). */
const SMART_SPELLINGS: ReadonlyArray<SpelledPitchClass> = [
  { letter: "C", accidental: 0 },
  { letter: "D", accidental: -1 },
  { letter: "D", accidental: 0 },
  { letter: "E", accidental: -1 },
  { letter: "E", accidental: 0 },
  { letter: "F", accidental: 0 },
  { letter: "F", accidental: 1 },
  { letter: "G", accidental: 0 },
  { letter: "A", accidental: -1 },
  { letter: "A", accidental: 0 },
  { letter: "B", accidental: -1 },
  { letter: "B", accidental: 0 }
];

/** Default (context-free) spelling of a pitch class: naturals, else one sharp/flat. */
export function defaultSpelling(pc: number, preference: SpellingPreference = "smart"): SpelledPitchClass {
  const table = preference === "sharp" ? SHARP_SPELLINGS : preference === "flat" ? FLAT_SPELLINGS : SMART_SPELLINGS;
  const entry = table[mod12(pc)];
  return { letter: entry.letter, accidental: entry.accidental };
}

/** Context-free spelling of a MIDI number. Use only when no harmonic context is known. */
export function noteFromMidi(midi: number, preference: SpellingPreference = "smart"): SpelledNote {
  const pitch = defaultSpelling(mod12(midi), preference);
  const note = spellMidiWithLetter(midi, pitch.letter);
  if (!note) {
    // Unreachable: default spellings use at most one accidental.
    throw new Error(`Cannot spell MIDI ${midi}.`);
  }
  return note;
}

/** All spellings (at most double accidentals) of a pitch class, ordered by accidental size. */
export function enharmonicSpellings(pc: number): SpelledPitchClass[] {
  const result: SpelledPitchClass[] = [];
  for (const letter of LETTERS) {
    const spelled = spellPitchClassWithLetter(pc, letter);
    if (spelled) {
      result.push(spelled);
    }
  }
  return result.sort((a, b) => Math.abs(a.accidental) - Math.abs(b.accidental) || letterIndex(a.letter) - letterIndex(b.letter));
}

/**
 * Nearest simpler spelling: keeps naturals and single accidentals unchanged, otherwise
 * returns the enharmonic with the fewest accidentals (Fx -> G, Cbb -> Bb, E# -> E# kept).
 * Pass `allowWhiteKeyAccidentals: false` to also simplify E#, B#, Fb, Cb.
 */
export function simplifySpelling(pitch: SpelledPitchClass, allowWhiteKeyAccidentals: boolean = true): SpelledPitchClass {
  if (Math.abs(pitch.accidental) <= 1) {
    if (allowWhiteKeyAccidentals || pitch.accidental === 0) {
      return toPitchClass(pitch);
    }
    const natural = spellPitchClassWithLetter(pitchClassOf(pitch), stepLetter(pitch.letter, pitch.accidental));
    if (natural && natural.accidental === 0) {
      return natural;
    }
    return toPitchClass(pitch);
  }
  const options = enharmonicSpellings(pitchClassOf(pitch));
  const sameDirection = options.find((candidate) => Math.abs(candidate.accidental) <= 1 && (candidate.accidental === 0 || Math.sign(candidate.accidental) === Math.sign(pitch.accidental)));
  return sameDirection ? sameDirection : options[0];
}

/** Diatonic letter distance from a to b counting octaves (C4 -> E4 = 2, C4 -> C5 = 7). */
export function diatonicStepsBetween(a: SpelledNote, b: SpelledNote): number {
  return letterIndex(b.letter) + 7 * b.octave - (letterIndex(a.letter) + 7 * a.octave);
}
