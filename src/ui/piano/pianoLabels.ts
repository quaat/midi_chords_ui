/**
 * Label builders for the interactive piano and the falling-note stage.
 * Note names are computed locally (no dependency on the music model) so the piano can
 * render before integration; spelled notes from the contracts are honoured when given.
 */
import type { Accidental, PerformedNote, SpelledPitchClass } from "@/model/contracts";

export type LabelMode = "none" | "noteNames" | "chordDegrees" | "scaleDegrees" | "fingers";
export type SpellingPreference = "sharp" | "flat";

export const LABEL_MODES: { value: LabelMode; label: string }[] = [
  { value: "none", label: "No labels" },
  { value: "noteNames", label: "Note names" },
  { value: "chordDegrees", label: "Chord degrees" },
  { value: "scaleDegrees", label: "Scale degrees" },
  { value: "fingers", label: "Fingers" }
];

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

/** Degree labels relative to a tonic, by semitone (major-scale reference). */
const SCALE_DEGREE_BY_SEMITONE = ["1", "b2", "2", "b3", "3", "4", "#4", "5", "b6", "6", "b7", "7"];

function pc(midi: number): number {
  return ((Math.round(midi) % 12) + 12) % 12;
}

/** Replace ASCII accidentals with ♯/♭ for display. */
export function prettyAccidentals(name: string): string {
  // No regex lookbehind: older Safari versions fail to parse it.
  return name.replace(/##/g, "𝄪").replace(/#/g, "♯").replace(/([A-G])bb/g, "$1𝄫").replace(/([A-G])b/g, "$1♭");
}

export interface NoteNameOptions {
  preference?: SpellingPreference;
  withOctave?: boolean;
  /** Use ♯/♭ glyphs (default true). */
  unicode?: boolean;
}

export function midiToNoteName(midi: number, options: NoteNameOptions = {}): string {
  const names = options.preference === "flat" ? FLAT_NAMES : SHARP_NAMES;
  let name = names[pc(midi)];
  if (options.withOctave) {
    name += String(Math.floor(Math.round(midi) / 12) - 1);
  }
  return options.unicode === false ? name : prettyAccidentals(name);
}

function accidentalText(accidental: Accidental): string {
  switch (accidental) {
    case -2:
      return "bb";
    case -1:
      return "b";
    case 1:
      return "#";
    case 2:
      return "##";
    default:
      return "";
  }
}

/** "E♭" for { letter: "E", accidental: -1 }. Optional octave for spelled notes. */
export function spelledToName(spelled: SpelledPitchClass & { octave?: number }, options: { withOctave?: boolean; unicode?: boolean } = {}): string {
  let name = `${spelled.letter}${accidentalText(spelled.accidental)}`;
  if (options.withOctave && typeof spelled.octave === "number") {
    name += String(spelled.octave);
  }
  return options.unicode === false ? name : prettyAccidentals(name);
}

export function noteNameLabels(midis: readonly number[], options: NoteNameOptions = {}): Map<number, string> {
  const map = new Map<number, string>();
  for (const midi of midis) {
    map.set(midi, midiToNoteName(midi, options));
  }
  return map;
}

/** Note-name labels for every key in a range (useful for "show all names"). */
export function rangeNoteNameLabels(low: number, high: number, options: NoteNameOptions = {}): Map<number, string> {
  const midis: number[] = [];
  for (let m = low; m <= high; m += 1) {
    midis.push(m);
  }
  return noteNameLabels(midis, options);
}

/** Degree of each MIDI note relative to a tonic pitch class (0 = C). */
export function scaleDegreeLabels(midis: readonly number[], tonicPc: number, unicode: boolean = true): Map<number, string> {
  const map = new Map<number, string>();
  for (const midi of midis) {
    const label = SCALE_DEGREE_BY_SEMITONE[pc(midi - tonicPc)];
    map.set(midi, unicode ? prettyDegree(label) : label);
  }
  return map;
}

/** Format a degree label ("b7", "#11") for display ("♭7", "♯11"). */
export function prettyDegree(label: string): string {
  return label.replace(/^bb/, "𝄫").replace(/^b/, "♭").replace(/^##/, "𝄪").replace(/^#/, "♯");
}

/** Minimal note shape the label builder needs (satisfied by PerformedNote and VoicedNote). */
export interface LabelSourceNote {
  midi: number;
  spelled?: PerformedNote["spelled"];
  degree?: string;
  finger?: number;
}

export interface BuildLabelsOptions {
  preference?: SpellingPreference;
  /** Tonic pitch class for scale degrees (0 = C). */
  tonicPc?: number;
  withOctave?: boolean;
}

/**
 * Labels for a set of notes in the chosen mode. Missing information yields no label
 * (e.g. fingers are authored advice; nothing is inferred when absent).
 */
export function buildLabels(mode: LabelMode, notes: readonly LabelSourceNote[], options: BuildLabelsOptions = {}): Map<number, string> {
  const map = new Map<number, string>();
  if (mode === "none") {
    return map;
  }
  for (const note of notes) {
    let label: string | undefined;
    if (mode === "noteNames") {
      label = note.spelled
        ? spelledToName(note.spelled, { withOctave: options.withOctave })
        : midiToNoteName(note.midi, { preference: options.preference, withOctave: options.withOctave });
    } else if (mode === "chordDegrees") {
      label = note.degree ? prettyDegree(note.degree) : undefined;
    } else if (mode === "scaleDegrees") {
      if (typeof options.tonicPc === "number") {
        label = scaleDegreeLabels([note.midi], options.tonicPc).get(note.midi);
      }
    } else if (mode === "fingers") {
      label = typeof note.finger === "number" ? String(note.finger) : undefined;
    }
    if (label !== undefined && !map.has(note.midi)) {
      map.set(note.midi, label);
    }
  }
  return map;
}
