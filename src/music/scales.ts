/**
 * Spelled scale/mode catalogue, keys, diatonic chords and scale comparison (plan E27, E04).
 *
 * Spelling: diatonic scales use one letter per degree (derived from the degree labels),
 * so F major contains Bb, B major contains A#, and D dorian has no accidentals.
 * Pentatonic and blues scales are spelled from their labels relative to the tonic
 * (C blues = C Eb F Gb G Bb). The chromatic scale uses the conventional mixed labels
 * 1 b2 2 b3 3 4 #4 5 b6 6 b7 7.
 *
 * Error style: functions throw an Error with a clear message for unknown scale ids,
 * unsupported operations (e.g. diatonic sevenths of a pentatonic scale) and spellings
 * that would need more than a double accidental.
 */
import type { ChordDefinition, ChordQualityId, DegreeLabel, Interval, KeyContext, ScaleDefinition, ScaleDegree, ScaleId, SpelledNote, SpelledPitchClass } from "@/model/contracts";
import { chordFromDefinition } from "@/music/chords";
import { degreeNumber, intervalBetween, parseDegreeLabelOrThrow, semitonesOf, transposePitchClass, transposeSpelled } from "@/music/intervals";
import type { Direction } from "@/music/intervals";
import { formatPitchClass, midiOf, parsePitchClassOrThrow, spelledEquals, toPitchClass } from "@/music/pitch";

interface ScaleSpec {
  id: ScaleId;
  name: string;
  labels: DegreeLabel[];
  characteristicDegrees?: DegreeLabel[];
  relativeTo?: { scale: ScaleId; degree: number };
  description?: string;
}

function degreesFromLabels(labels: DegreeLabel[]): ScaleDegree[] {
  return labels.map((label) => {
    const interval = parseDegreeLabelOrThrow(label);
    return { label, interval, semitones: semitonesOf(interval) };
  });
}

const SCALE_SPECS: ReadonlyArray<ScaleSpec> = [
  { id: "major", name: "Major", labels: ["1", "2", "3", "4", "5", "6", "7"], description: "The major scale (same pitch collection as Ionian)." },
  {
    id: "naturalMinor",
    name: "Natural minor",
    labels: ["1", "2", "b3", "4", "5", "b6", "b7"],
    characteristicDegrees: ["b3", "b6", "b7"],
    relativeTo: { scale: "major", degree: 6 },
    description: "Natural minor: the major scale started from its 6th degree (same as Aeolian)."
  },
  {
    id: "harmonicMinor",
    name: "Harmonic minor",
    labels: ["1", "2", "b3", "4", "5", "b6", "7"],
    characteristicDegrees: ["7"],
    description: "Natural minor with a raised 7th, giving a leading tone and an augmented 2nd between b6 and 7."
  },
  {
    id: "melodicMinor",
    name: "Melodic minor",
    labels: ["1", "2", "b3", "4", "5", "6", "7"],
    characteristicDegrees: ["6", "7"],
    description: "Ascending melodic minor (jazz minor): natural minor with raised 6th and 7th. The classical descending form is natural minor."
  },
  { id: "ionian", name: "Ionian", labels: ["1", "2", "3", "4", "5", "6", "7"], relativeTo: { scale: "major", degree: 1 }, description: "Mode 1 of the major scale." },
  {
    id: "dorian",
    name: "Dorian",
    labels: ["1", "2", "b3", "4", "5", "6", "b7"],
    characteristicDegrees: ["6"],
    relativeTo: { scale: "major", degree: 2 },
    description: "Minor mode with a major 6th; compare with natural minor (b6)."
  },
  {
    id: "phrygian",
    name: "Phrygian",
    labels: ["1", "b2", "b3", "4", "5", "b6", "b7"],
    characteristicDegrees: ["b2"],
    relativeTo: { scale: "major", degree: 3 },
    description: "Minor mode with a minor 2nd; compare with natural minor (2)."
  },
  {
    id: "lydian",
    name: "Lydian",
    labels: ["1", "2", "3", "#4", "5", "6", "7"],
    characteristicDegrees: ["#4"],
    relativeTo: { scale: "major", degree: 4 },
    description: "Major mode with an augmented 4th; compare with major (4)."
  },
  {
    id: "mixolydian",
    name: "Mixolydian",
    labels: ["1", "2", "3", "4", "5", "6", "b7"],
    characteristicDegrees: ["b7"],
    relativeTo: { scale: "major", degree: 5 },
    description: "Major mode with a minor 7th; compare with major (7)."
  },
  {
    id: "aeolian",
    name: "Aeolian",
    labels: ["1", "2", "b3", "4", "5", "b6", "b7"],
    characteristicDegrees: ["b6"],
    relativeTo: { scale: "major", degree: 6 },
    description: "Mode 6 of the major scale (natural minor); compare with Dorian (6)."
  },
  {
    id: "locrian",
    name: "Locrian",
    labels: ["1", "b2", "b3", "4", "b5", "b6", "b7"],
    characteristicDegrees: ["b5"],
    relativeTo: { scale: "major", degree: 7 },
    description: "Mode 7 of the major scale, with a diminished 5th."
  },
  {
    id: "majorPentatonic",
    name: "Major pentatonic",
    labels: ["1", "2", "3", "5", "6"],
    description: "Five-note major scale without the 4th and 7th."
  },
  {
    id: "minorPentatonic",
    name: "Minor pentatonic",
    labels: ["1", "b3", "4", "5", "b7"],
    relativeTo: { scale: "majorPentatonic", degree: 5 },
    description: "Five-note minor scale without the 2nd and 6th."
  },
  {
    id: "blues",
    name: "Blues",
    labels: ["1", "b3", "4", "b5", "5", "b7"],
    characteristicDegrees: ["b5"],
    description: "Minor pentatonic plus the b5 'blue note' (spelled as a lowered 5th)."
  },
  {
    id: "chromatic",
    name: "Chromatic",
    labels: ["1", "b2", "2", "b3", "3", "4", "#4", "5", "b6", "6", "b7", "7"],
    description: "All twelve pitch classes, spelled with conventional mixed labels."
  }
];

export const SCALES: Readonly<Record<ScaleId, ScaleDefinition>> = buildCatalogue();

function buildCatalogue(): Record<ScaleId, ScaleDefinition> {
  const result = {} as Record<ScaleId, ScaleDefinition>;
  SCALE_SPECS.forEach((spec) => {
    const definition: ScaleDefinition = { id: spec.id, name: spec.name, degrees: degreesFromLabels(spec.labels) };
    if (spec.characteristicDegrees) {
      definition.characteristicDegrees = [...spec.characteristicDegrees];
    }
    if (spec.relativeTo) {
      definition.relativeTo = { scale: spec.relativeTo.scale, degree: spec.relativeTo.degree };
    }
    if (spec.description) {
      definition.description = spec.description;
    }
    result[spec.id] = definition;
  });
  return result;
}

export const SCALE_IDS: readonly ScaleId[] = SCALE_SPECS.map((spec) => spec.id);

export function getScale(scaleId: ScaleId): ScaleDefinition {
  const scale = SCALES[scaleId];
  if (!scale) {
    throw new Error(`Unknown scale "${String(scaleId)}".`);
  }
  return scale;
}

function resolveTonic(tonic: SpelledPitchClass | string): SpelledPitchClass {
  return typeof tonic === "string" ? parsePitchClassOrThrow(tonic) : toPitchClass(tonic);
}

/** Spelled pitch classes of a scale (one per degree, ascending from the tonic). */
export function scalePitchClasses(tonic: SpelledPitchClass | string, scaleId: ScaleId): SpelledPitchClass[] {
  const root = resolveTonic(tonic);
  return getScale(scaleId).degrees.map((degree) => transposePitchClass(root, degree.interval));
}

export interface ScaleNote {
  spelled: SpelledNote;
  midi: number;
  degreeLabel: DegreeLabel;
  /** 0-based index into the scale's degrees. */
  degreeIndex: number;
  /** Octave offset from the starting tonic. */
  octaveIndex: number;
}

export interface ScaleNotesOptions {
  /** Include the closing tonic an octave above the last octave (default true). */
  includeTop?: boolean;
}

/**
 * Ascending spelled notes of a scale starting at `tonic` in `startOctave`, spanning
 * `octaves` octaves. The tonic note's octave follows the letter (Cb4 = MIDI 59).
 * By default the closing tonic is included (C major, 1 octave = 8 notes).
 */
export function scaleNotes(tonic: SpelledPitchClass | string, scaleId: ScaleId, startOctave: number = 4, octaves: number = 1, options: ScaleNotesOptions = {}): ScaleNote[] {
  if (!Number.isInteger(octaves) || octaves < 1) {
    throw new Error(`Octaves must be a positive integer (got ${octaves}).`);
  }
  const root = resolveTonic(tonic);
  const scale = getScale(scaleId);
  const tonicNote: SpelledNote = { letter: root.letter, accidental: root.accidental, octave: startOctave };
  const oneOctave: SpelledNote[] = scale.degrees.map((degree) => transposeSpelled(tonicNote, degree.interval));
  const result: ScaleNote[] = [];
  for (let octaveIndex = 0; octaveIndex < octaves; octaveIndex += 1) {
    oneOctave.forEach((note, degreeIndex) => {
      const spelled: SpelledNote = { letter: note.letter, accidental: note.accidental, octave: note.octave + octaveIndex };
      result.push({ spelled, midi: midiOf(spelled), degreeLabel: scale.degrees[degreeIndex].label, degreeIndex, octaveIndex });
    });
  }
  if (options.includeTop !== false) {
    const spelled: SpelledNote = { letter: tonicNote.letter, accidental: tonicNote.accidental, octave: tonicNote.octave + octaves };
    result.push({ spelled, midi: midiOf(spelled), degreeLabel: scale.degrees[0].label, degreeIndex: 0, octaveIndex: octaves });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export function keyFromTonicAndMode(tonic: SpelledPitchClass | string, mode: ScaleId = "major"): KeyContext {
  getScale(mode);
  return { tonic: resolveTonic(tonic), mode };
}

/** Transpose a key, preserving letter-based spelling (D dorian up M2 = E dorian). */
export function transposeKey(key: KeyContext, value: Interval, direction: Direction = "up"): KeyContext {
  return { tonic: transposePitchClass(key.tonic, value, direction), mode: key.mode };
}

/** "D dorian", "F major", "A natural minor". */
export function formatKey(key: KeyContext): string {
  return `${formatPitchClass(key.tonic)} ${getScale(key.mode).name.toLowerCase()}`;
}

export function keyEquals(a: KeyContext, b: KeyContext): boolean {
  return a.mode === b.mode && spelledEquals(a.tonic, b.tonic);
}

// ---------------------------------------------------------------------------
// Diatonic chords
// ---------------------------------------------------------------------------

export interface DiatonicChord {
  /** 1-based scale degree. */
  degree: number;
  /** Scale degree label of the chord root ("b3" in dorian ...). */
  scaleDegreeLabel: DegreeLabel;
  romanNumeral: string;
  chord: ChordDefinition;
}

export interface DiatonicChordOptions {
  /**
   * "diatonic" (default): numerals follow the mode's own degrees (C minor: i ii° III iv v VI VII).
   * "relativeToMajor": prefix accidentals relative to the major scale (C minor: i ii° bIII iv v bVI bVII).
   */
  numeralStyle?: "diatonic" | "relativeToMajor";
}

const NUMERALS: readonly string[] = ["I", "II", "III", "IV", "V", "VI", "VII"];

interface StackedQuality {
  quality: ChordQualityId;
  alterations?: DegreeLabel[];
  lower: boolean;
  numeralSuffix: string;
}

const TRIAD_QUALITIES: Readonly<Record<string, StackedQuality>> = {
  "4,7": { quality: "maj", lower: false, numeralSuffix: "" },
  "3,7": { quality: "min", lower: true, numeralSuffix: "" },
  "3,6": { quality: "dim", lower: true, numeralSuffix: "°" },
  "4,8": { quality: "aug", lower: false, numeralSuffix: "+" }
};

const SEVENTH_QUALITIES: Readonly<Record<string, StackedQuality>> = {
  "4,7,11": { quality: "maj7", lower: false, numeralSuffix: "maj7" },
  "4,7,10": { quality: "dom7", lower: false, numeralSuffix: "7" },
  "3,7,10": { quality: "min7", lower: true, numeralSuffix: "7" },
  "3,6,10": { quality: "halfDim7", lower: true, numeralSuffix: "ø7" },
  "3,6,9": { quality: "dim7", lower: true, numeralSuffix: "°7" },
  "3,7,11": { quality: "minMaj7", lower: true, numeralSuffix: "(maj7)" },
  "4,8,11": { quality: "maj7", alterations: ["#5"], lower: false, numeralSuffix: "+maj7" }
};

function diatonicChords(key: KeyContext, size: 3 | 4, options: DiatonicChordOptions): DiatonicChord[] {
  const scale = getScale(key.mode);
  if (scale.degrees.length !== 7) {
    throw new Error(`Diatonic ${size === 3 ? "triads" : "seventh chords"} need a seven-note scale; ${scale.name} has ${scale.degrees.length} notes.`);
  }
  const notes = scaleNotes(key.tonic, key.mode, 4, 2, { includeTop: false });
  const table = size === 3 ? TRIAD_QUALITIES : SEVENTH_QUALITIES;
  const result: DiatonicChord[] = [];
  for (let index = 0; index < 7; index += 1) {
    const root = notes[index].spelled;
    const semitones: number[] = [];
    for (let member = 1; member < size; member += 1) {
      const upper = notes[index + member * 2].spelled;
      const found = intervalBetween(root, upper);
      semitones.push(found ? semitonesOf(found) : midiOf(upper) - midiOf(root));
    }
    const stacked = table[semitones.join(",")];
    if (!stacked) {
      throw new Error(`Unsupported stacked chord on degree ${index + 1} of ${formatKey(key)} (semitones ${semitones.join(", ")}).`);
    }
    const scaleDegreeLabel = scale.degrees[index].label;
    let prefix = "";
    if (options.numeralStyle === "relativeToMajor") {
      const match = scaleDegreeLabel.match(/^(bb|b|##|#)/);
      prefix = match ? match[1] : "";
    }
    const base = NUMERALS[index];
    const numeral = `${prefix}${stacked.lower ? base.toLowerCase() : base}${stacked.numeralSuffix}`;
    const chord = chordFromDefinition(toPitchClass(root), stacked.quality, stacked.alterations ? { alterations: stacked.alterations } : {});
    result.push({ degree: index + 1, scaleDegreeLabel, romanNumeral: numeral, chord });
  }
  return result;
}

/** Diatonic triads with Roman numerals (C major: I ii iii IV V vi vii°). */
export function diatonicTriads(key: KeyContext, options: DiatonicChordOptions = {}): DiatonicChord[] {
  return diatonicChords(key, 3, options);
}

/** Diatonic seventh chords (C major: Imaj7 ii7 iii7 IVmaj7 V7 vi7 viiø7). */
export function diatonicSevenths(key: KeyContext, options: DiatonicChordOptions = {}): DiatonicChord[] {
  return diatonicChords(key, 4, options);
}

// ---------------------------------------------------------------------------
// Scale comparison
// ---------------------------------------------------------------------------

export interface ScaleTone {
  label: DegreeLabel;
  spelled: SpelledPitchClass;
}

export interface ScaleDifference {
  /** Degree number 1..7 the tones belong to. */
  degreeNumber: number;
  a: ScaleTone[];
  b: ScaleTone[];
}

export interface ScaleComparison {
  tonic: SpelledPitchClass;
  a: ScaleId;
  b: ScaleId;
  /** Tones present with the same label in both scales. */
  shared: ScaleTone[];
  differences: ScaleDifference[];
  summary: string;
}

function ordinal(n: number): string {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}

function tonesByNumber(tonic: SpelledPitchClass, scaleId: ScaleId): Map<number, ScaleTone[]> {
  const map = new Map<number, ScaleTone[]>();
  const scale = getScale(scaleId);
  scale.degrees.forEach((degree) => {
    const number = degreeNumber(degree.label) ?? 0;
    const list = map.get(number) ?? [];
    list.push({ label: degree.label, spelled: transposePitchClass(tonic, degree.interval) });
    map.set(number, list);
  });
  return map;
}

/**
 * Compare two scales over the same tonic, degree number by degree number
 * (D dorian vs D natural minor: only the 6th differs, B vs Bb).
 */
export function compareScales(tonic: SpelledPitchClass | string, a: ScaleId, b: ScaleId): ScaleComparison {
  const root = resolveTonic(tonic);
  const tonesA = tonesByNumber(root, a);
  const tonesB = tonesByNumber(root, b);
  const shared: ScaleTone[] = [];
  const differences: ScaleDifference[] = [];
  for (let number = 1; number <= 7; number += 1) {
    const listA = tonesA.get(number) ?? [];
    const listB = tonesB.get(number) ?? [];
    const labelsA = listA.map((tone) => tone.label).join(",");
    const labelsB = listB.map((tone) => tone.label).join(",");
    listA.forEach((tone) => {
      if (listB.some((other) => other.label === tone.label)) {
        shared.push(tone);
      }
    });
    if (labelsA !== labelsB) {
      differences.push({ degreeNumber: number, a: listA, b: listB });
    }
  }
  const nameA = `${formatPitchClass(root)} ${getScale(a).name.toLowerCase()}`;
  const nameB = `${formatPitchClass(root)} ${getScale(b).name.toLowerCase()}`;
  const describe = (tones: ScaleTone[]): string => (tones.length === 0 ? "none" : tones.map((tone) => `${formatPitchClass(tone.spelled)} (${tone.label})`).join(" + "));
  const summary =
    differences.length === 0
      ? `${nameA} and ${nameB} contain the same degrees.`
      : `${nameA} vs ${nameB}: ${differences.map((difference) => `${ordinal(difference.degreeNumber)}: ${describe(difference.a)} vs ${describe(difference.b)}`).join("; ")}.`;
  return { tonic: root, a, b, shared, differences, summary };
}
