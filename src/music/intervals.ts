/**
 * Diatonic intervals and degree labels (plan E04/E05).
 *
 * An Interval is {number, quality}: number is 1-based and may be compound
 * (9 = ninth, 11, 13 ...). Semitones are derived, never the source of truth.
 *
 * Error style (consistent across this module):
 * - Text/semitone *lookups* (`parseInterval`, `parseDegreeLabel`, `intervalFromSemitones`,
 *   `intervalBetween`, `addIntervals`) return `null` when there is no valid answer.
 * - Operations on typed values (`semitonesOf`, `transposeSpelled`, `transposePitchClass`)
 *   throw an Error/RangeError with a clear message for structurally invalid intervals or
 *   results that would need more than a double accidental.
 */
import type { DegreeLabel, Interval, IntervalQuality, SpelledNote, SpelledPitchClass } from "@/model/contracts";
import { LETTER_PITCH_CLASS, diatonicStepsBetween, formatPitchClass, formatSpelledNote, isAccidental, letterIndex, midiOf, mod12, stepLetter } from "@/music/pitch";

export type Direction = "up" | "down";

/** Semitones of the major/perfect interval for simple numbers 1..7. */
const BASE_SEMITONES: readonly number[] = [0, 2, 4, 5, 7, 9, 11];

const PERFECT_OFFSETS: ReadonlyArray<[IntervalQuality, number]> = [
  ["dd", -2],
  ["d", -1],
  ["P", 0],
  ["A", 1],
  ["AA", 2]
];

const MAJOR_OFFSETS: ReadonlyArray<[IntervalQuality, number]> = [
  ["dd", -3],
  ["d", -2],
  ["m", -1],
  ["M", 0],
  ["A", 1],
  ["AA", 2]
];

/** 1..7 for any positive interval number (9 -> 2, 8 -> 1, 13 -> 6). */
export function simpleNumber(number: number): number {
  return ((number - 1) % 7) + 1;
}

/** True for unisons, fourths, fifths and their compounds (8, 11, 12, 15 ...). */
export function isPerfectClass(number: number): boolean {
  const simple = simpleNumber(number);
  return simple === 1 || simple === 4 || simple === 5;
}

function offsetsFor(number: number): ReadonlyArray<[IntervalQuality, number]> {
  return isPerfectClass(number) ? PERFECT_OFFSETS : MAJOR_OFFSETS;
}

export function isValidInterval(interval: Interval): boolean {
  if (!Number.isInteger(interval.number) || interval.number < 1) {
    return false;
  }
  return offsetsFor(interval.number).some(([quality]) => quality === interval.quality);
}

export function interval(quality: IntervalQuality, number: number): Interval {
  const result: Interval = { number, quality };
  if (!isValidInterval(result)) {
    throw new Error(`Invalid interval "${quality}${number}": ${isPerfectClass(number) ? "unisons, fourths and fifths take P/A/d/AA/dd" : "seconds, thirds, sixths and sevenths take M/m/A/d/AA/dd"}.`);
  }
  return result;
}

/** Semitone size of an interval (M3 = 4, m9 = 13, A11 = 18, M13 = 21). Throws for invalid intervals. */
export function semitonesOf(value: Interval): number {
  if (!isValidInterval(value)) {
    throw new Error(`Invalid interval "${value.quality}${value.number}".`);
  }
  const simple = simpleNumber(value.number);
  const octaves = Math.floor((value.number - 1) / 7);
  const entry = offsetsFor(value.number).find(([quality]) => quality === value.quality);
  const offset = entry ? entry[1] : 0;
  return BASE_SEMITONES[simple - 1] + 12 * octaves + offset;
}

/** Interval with the given number and semitone size, or null when no quality fits (e.g. 3rd of 7 semitones). */
export function intervalFromSemitones(number: number, semitones: number): Interval | null {
  if (!Number.isInteger(number) || number < 1) {
    return null;
  }
  const simple = simpleNumber(number);
  const octaves = Math.floor((number - 1) / 7);
  const offset = semitones - (BASE_SEMITONES[simple - 1] + 12 * octaves);
  const entry = offsetsFor(number).find(([, value]) => value === offset);
  return entry ? { number, quality: entry[0] } : null;
}

export function intervalEquals(a: Interval, b: Interval): boolean {
  return a.number === b.number && a.quality === b.quality;
}

export function isCompound(value: Interval): boolean {
  return value.number > 8;
}

/** Reduce a compound interval to within an octave (M9 -> M2, P11 -> P4). P8 stays P8. */
export function toSimpleInterval(value: Interval): Interval {
  if (value.number <= 8) {
    return { number: value.number, quality: value.quality };
  }
  return { number: simpleNumber(value.number), quality: value.quality };
}

/** Add an octave count to an interval (M2 + 1 octave = M9). */
export function compoundInterval(value: Interval, octaves: number): Interval {
  return { number: value.number + 7 * octaves, quality: value.quality };
}

/** Inversion of a simple interval within the octave (M3 <-> m6, P4 <-> P5, A4 <-> d5). */
export function invertInterval(value: Interval): Interval | null {
  const simple = toSimpleInterval(value);
  const number = 9 - simple.number;
  const semitones = 12 - semitonesOf(simple);
  return intervalFromSemitones(number, semitones);
}

/** Sum of two ascending intervals (M3 + m3 = P5; M9 + m3 = P11). Null when the result has no valid quality. */
export function addIntervals(a: Interval, b: Interval): Interval | null {
  return intervalFromSemitones(a.number + b.number - 1, semitonesOf(a) + semitonesOf(b));
}

const QUALITY_NAMES: Readonly<Record<IntervalQuality, string>> = {
  P: "perfect",
  M: "major",
  m: "minor",
  A: "augmented",
  d: "diminished",
  AA: "doubly augmented",
  dd: "doubly diminished"
};

const NUMBER_NAMES: Readonly<Record<number, string>> = {
  1: "unison",
  2: "second",
  3: "third",
  4: "fourth",
  5: "fifth",
  6: "sixth",
  7: "seventh",
  8: "octave",
  9: "ninth",
  10: "tenth",
  11: "eleventh",
  12: "twelfth",
  13: "thirteenth",
  14: "fourteenth",
  15: "double octave"
};

/** Short name: "M3", "P5", "m9", "A11". */
export function formatInterval(value: Interval): string {
  return `${value.quality}${value.number}`;
}

/** Long name: "major third", "augmented eleventh". */
export function intervalName(value: Interval): string {
  const numberName = NUMBER_NAMES[value.number] ?? `${value.number}th`;
  return `${QUALITY_NAMES[value.quality]} ${numberName}`;
}

/** Parse a short interval name ("M3", "P5", "m9", "A11", "dd7"). Returns null when invalid. */
export function parseInterval(text: string): Interval | null {
  const match = text.trim().match(/^(AA|dd|P|M|m|A|d)(\d{1,2})$/);
  if (!match) {
    return null;
  }
  const candidate: Interval = { quality: match[1] as IntervalQuality, number: Number.parseInt(match[2], 10) };
  return isValidInterval(candidate) ? candidate : null;
}

// ---------------------------------------------------------------------------
// Interval between spelled notes, transposition
// ---------------------------------------------------------------------------

/**
 * Interval from `a` up to `b`. When `b` is written below `a` the interval is measured
 * from `b` up to `a` (use `directedIntervalBetween` to keep the direction).
 * Returns null when the quality would exceed doubly augmented/diminished.
 */
export function intervalBetween(a: SpelledNote, b: SpelledNote): Interval | null {
  const directed = directedIntervalBetween(a, b);
  return directed ? directed.interval : null;
}

export interface DirectedInterval {
  interval: Interval;
  direction: Direction;
}

export function directedIntervalBetween(a: SpelledNote, b: SpelledNote): DirectedInterval | null {
  const steps = diatonicStepsBetween(a, b);
  const semitones = midiOf(b) - midiOf(a);
  if (steps < 0 || (steps === 0 && semitones < 0)) {
    const found = intervalFromSemitones(-steps + 1, -semitones);
    return found ? { interval: found, direction: "down" } : null;
  }
  const found = intervalFromSemitones(steps + 1, semitones);
  return found ? { interval: found, direction: "up" } : null;
}

/**
 * Simple ascending interval from pitch class `a` to pitch class `b` (within one octave).
 * C -> E = M3, E -> C = m6, C -> Fb = d4. Null when no valid quality exists.
 */
export function intervalBetweenPitchClasses(a: SpelledPitchClass, b: SpelledPitchClass): Interval | null {
  const steps = (((letterIndex(b.letter) - letterIndex(a.letter)) % 7) + 7) % 7;
  const natural = mod12(LETTER_PITCH_CLASS[b.letter] - LETTER_PITCH_CLASS[a.letter]);
  let semitones = natural + b.accidental - a.accidental;
  // Keep the size close to the letter distance (e.g. B# -> C is a d2 of 0 semitones, not 12).
  if (steps === 0 && semitones > 6) {
    semitones -= 12;
  }
  return intervalFromSemitones(steps + 1, semitones);
}

/**
 * Transpose a spelled note by an interval, preserving letter arithmetic
 * (D4 + M2 = E4, F#4 + m3 = A4, Bb3 + P4 = Eb4).
 * Throws a RangeError when the result would need more than a double accidental.
 */
export function transposeSpelled(note: SpelledNote, value: Interval, direction: Direction = "up"): SpelledNote {
  const sign = direction === "up" ? 1 : -1;
  const steps = (value.number - 1) * sign;
  const targetLetterAbsolute = letterIndex(note.letter) + steps;
  const octave = note.octave + Math.floor(targetLetterAbsolute / 7);
  const letter = stepLetter(note.letter, steps);
  const targetMidi = midiOf(note) + sign * semitonesOf(value);
  const naturalMidi = 12 * (octave + 1) + LETTER_PITCH_CLASS[letter];
  const accidental = targetMidi - naturalMidi;
  if (!isAccidental(accidental)) {
    throw new RangeError(`Transposing ${formatSpelledNote(note)} ${direction} by ${formatInterval(value)} would need ${Math.abs(accidental)} accidentals on ${letter}; only up to double sharps/flats are supported.`);
  }
  return { letter, accidental, octave };
}

/** Pitch-class transposition (octave-free). Throws like `transposeSpelled`. */
export function transposePitchClass(pitch: SpelledPitchClass, value: Interval, direction: Direction = "up"): SpelledPitchClass {
  try {
    const moved = transposeSpelled({ letter: pitch.letter, accidental: pitch.accidental, octave: 4 }, value, direction);
    return { letter: moved.letter, accidental: moved.accidental };
  } catch (error) {
    if (error instanceof RangeError) {
      throw new RangeError(`Transposing ${formatPitchClass(pitch)} ${direction} by ${formatInterval(value)} needs more than a double accidental.`);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Degree labels
// ---------------------------------------------------------------------------

/** Labels accepted as aliases of numeric degree labels. */
const DEGREE_ALIASES: Readonly<Record<string, DegreeLabel>> = {
  sus4: "4",
  sus2: "2",
  R: "1",
  root: "1"
};

/** Highest degree number accepted in labels (two octaves). */
export const MAX_DEGREE_NUMBER = 15;

/**
 * Parse a degree label into an interval above the root/tonic.
 *
 * Rules: an optional prefix of "b"/"bb"/"#"/"##" (or ♭/♯) followed by a number 1..15.
 * - Perfect-class numbers (1, 4, 5, 8, 11, 12, 15): natural = P, b = d, bb = dd, # = A, ## = AA.
 * - Others (2, 3, 6, 7, 9, 10, 13, 14): natural = M, b = m, bb = d, # = A, ## = AA.
 * So "b3" = m3, "#11" = A11, "b9" = m9, "13" = M13, "b5" = d5, "bb7" = d7.
 * Aliases: "sus4" = "4", "sus2" = "2", "R"/"root" = "1".
 * The unison "1" takes no accidental. Returns null for anything else.
 */
export function parseDegreeLabel(label: DegreeLabel): Interval | null {
  const trimmed = label.trim();
  const normalized = DEGREE_ALIASES[trimmed] ?? trimmed;
  const match = normalized.replace(/♭/g, "b").replace(/♯/g, "#").match(/^(bb|b|##|#)?(\d{1,2})$/);
  if (!match) {
    return null;
  }
  const prefix = match[1] ?? "";
  const number = Number.parseInt(match[2], 10);
  if (number < 1 || number > MAX_DEGREE_NUMBER) {
    return null;
  }
  if (number === 1 && prefix !== "") {
    return null;
  }
  let quality: IntervalQuality;
  if (isPerfectClass(number)) {
    quality = prefix === "" ? "P" : prefix === "b" ? "d" : prefix === "bb" ? "dd" : prefix === "#" ? "A" : "AA";
  } else {
    quality = prefix === "" ? "M" : prefix === "b" ? "m" : prefix === "bb" ? "d" : prefix === "#" ? "A" : "AA";
  }
  return { number, quality };
}

export function parseDegreeLabelOrThrow(label: DegreeLabel): Interval {
  const parsed = parseDegreeLabel(label);
  if (!parsed) {
    throw new Error(`Invalid degree label "${label}". Expected e.g. "1", "b3", "5", "#5", "b7", "9", "#11", "b13", "sus4".`);
  }
  return parsed;
}

/** Inverse of `parseDegreeLabel` ("M3" -> "3", "m7" -> "b7", "d7" -> "bb7", "A11" -> "#11"). */
export function degreeLabelFromInterval(value: Interval): DegreeLabel {
  let prefix: string;
  if (isPerfectClass(value.number)) {
    prefix = value.quality === "P" ? "" : value.quality === "d" ? "b" : value.quality === "dd" ? "bb" : value.quality === "A" ? "#" : value.quality === "AA" ? "##" : "?";
  } else {
    prefix = value.quality === "M" ? "" : value.quality === "m" ? "b" : value.quality === "d" ? "bb" : value.quality === "dd" ? "bbb" : value.quality === "A" ? "#" : value.quality === "AA" ? "##" : "?";
  }
  if (prefix === "?") {
    throw new Error(`Invalid interval "${value.quality}${value.number}".`);
  }
  return `${prefix}${value.number}`;
}

/** Numeric part of a degree label ("b13" -> 13, "sus4" -> 4). Null for invalid labels. */
export function degreeNumber(label: DegreeLabel): number | null {
  const parsed = parseDegreeLabel(label);
  return parsed ? parsed.number : null;
}
