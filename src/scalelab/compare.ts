/**
 * Scale/mode laboratory: comparisons over the same tonic (plan E27, §3 "Modes", next slice
 * "Dorian in practice").
 *
 * The main meaning of a mode is its sound against a fixed tonal centre (D Dorian vs D natural
 * minor: the sixth is B instead of B♭ while D stays home). The relative view ("the notes of
 * C major started on D") is offered only as a secondary explanation.
 */
import type {
  ChordDefinition,
  DegreeLabel,
  MusicalSequence,
  PerformanceOccurrence,
  PerformanceTimeline,
  PerformedNote,
  ScaleId,
  SequenceEvent,
  SpelledNote,
  SpelledPitchClass
} from "@/model/contracts";
import { tryChordFromSymbol } from "@/music/chords";
import { degreeNumber, interval, transposePitchClass } from "@/music/intervals";
import { formatPitchClass, formatSpelledNote, midiOf, parsePitchClass, toPitchClass } from "@/music/pitch";
import { compareScales, getScale, scaleNotes } from "@/music/scales";
import type { ScaleTone } from "@/music/scales";
import { compileTimeline } from "@/timeline/compile";
import type { FallbackVoicing } from "@/timeline/compile";

const PROPER_NOUN_MODES: readonly ScaleId[] = ["ionian", "dorian", "phrygian", "lydian", "mixolydian", "aeolian", "locrian"];
const ORDINALS: readonly string[] = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh"];

export interface LabNote {
  spelled: SpelledNote;
  midi: number;
  label: DegreeLabel;
  /** "B4" */
  name: string;
  /** "B" (unicode accidentals) */
  pitchName: string;
}

export interface LabScale {
  id: ScaleId;
  name: string;
  /** "D Dorian", "D natural minor" */
  displayName: string;
  notes: LabNote[];
  degreeLabels: DegreeLabel[];
}

export interface ModeDifference {
  degreeNumber: number;
  a: ScaleTone[];
  b: ScaleTone[];
  text: string;
}

export interface ModeComparison {
  tonic: SpelledPitchClass;
  scales: [LabScale, LabScale];
  differences: ModeDifference[];
  summary: string;
  /** Secondary explanation of relative relationships (not the main meaning of a mode). */
  relativeExplanation: string[];
  /** MIDI notes (in the comparison octave) of the degrees that differ, for highlighting. */
  characteristicDegreeMidi: number[];
  timelines: { a: PerformanceTimeline; b: PerformanceTimeline; aThenB: PerformanceTimeline };
}

export function scaleDisplayName(scaleId: ScaleId): string {
  const name = getScale(scaleId).name;
  return PROPER_NOUN_MODES.includes(scaleId) ? name : name.toLowerCase();
}

function resolveTonic(tonic: SpelledPitchClass | string): SpelledPitchClass {
  if (typeof tonic !== "string") return toPitchClass(tonic);
  const parsed = parsePitchClass(tonic);
  if (!parsed) throw new Error(`"${tonic}" is not a note name.`);
  return parsed;
}

function unicodeName(pitch: SpelledPitchClass): string {
  return formatPitchClass(pitch, { unicode: true });
}

function labScale(tonic: SpelledPitchClass, scaleId: ScaleId, octave: number): LabScale {
  const scale = getScale(scaleId);
  const notes: LabNote[] = scaleNotes(tonic, scaleId, octave, 1).map((note) => ({
    spelled: note.spelled,
    midi: note.midi,
    label: note.degreeLabel,
    name: formatSpelledNote(note.spelled, { unicode: true }),
    pitchName: unicodeName(note.spelled)
  }));
  return {
    id: scaleId,
    name: scale.name,
    displayName: `${unicodeName(tonic)} ${scaleDisplayName(scaleId)}`,
    notes,
    degreeLabels: scale.degrees.map((degree) => degree.label)
  };
}

function describeTones(tones: ScaleTone[], other: ScaleTone[]): string {
  if (tones.length === 0) return "absent";
  const otherHasAccidental = other.some((tone) => tone.spelled.accidental !== 0);
  return tones.map((tone) => `${unicodeName(tone.spelled)}${tone.spelled.accidental === 0 && otherHasAccidental ? " natural" : ""}`).join(" and ");
}

export interface RunTimelineOptions {
  octave?: number;
  beatsPerNote?: number;
  startBeat?: number;
  /** Sustain the tonic underneath (part "accompaniment") to keep the tonal centre. Default true. */
  drone?: boolean;
  tempoBpm?: number;
  idPrefix?: string;
}

/**
 * A scale run as a demonstration timeline: one PerformedNote per degree (ascending, closing
 * tonic included), each with its own occurrence and degree label.
 */
export function scaleRunTimeline(tonicInput: SpelledPitchClass | string, scaleId: ScaleId, options: RunTimelineOptions = {}): PerformanceTimeline {
  const tonic = resolveTonic(tonicInput);
  const octave = options.octave ?? 4;
  const step = options.beatsPerNote ?? 0.5;
  const start = options.startBeat ?? 0;
  const prefix = options.idPrefix ?? `run:${formatPitchClass(tonic)}-${scaleId}`;
  const notes: PerformedNote[] = [];
  const occurrences: PerformanceOccurrence[] = [];
  const run = scaleNotes(tonic, scaleId, octave, 1);
  run.forEach((note, index) => {
    const occurrenceId = `${prefix}:n${index}`;
    occurrences.push({ occurrenceId, eventId: occurrenceId, passIndex: 0, startBeat: start + index * step, durationBeats: step, symbol: formatSpelledNote(note.spelled) });
    notes.push({
      id: `${occurrenceId}:demonstration:0`,
      eventId: occurrenceId,
      occurrenceId,
      part: "demonstration",
      midi: note.midi,
      spelled: note.spelled,
      degree: note.degreeLabel,
      onsetBeat: start + index * step,
      durationBeats: step,
      velocity: 90
    });
  });
  const length = run.length * step;
  if (options.drone !== false) {
    const droneNote: SpelledNote = { letter: tonic.letter, accidental: tonic.accidental, octave: octave - 1 };
    const occurrenceId = `${prefix}:drone`;
    occurrences.push({ occurrenceId, eventId: occurrenceId, passIndex: 0, startBeat: start, durationBeats: length, symbol: `${formatPitchClass(tonic)} drone` });
    notes.push({
      id: `${occurrenceId}:accompaniment:0`,
      eventId: occurrenceId,
      occurrenceId,
      part: "accompaniment",
      midi: midiOf(droneNote),
      spelled: droneNote,
      degree: "1",
      role: "root",
      onsetBeat: start,
      durationBeats: length,
      velocity: 60
    });
  }
  notes.sort((x, y) => x.onsetBeat - y.onsetBeat || x.midi - y.midi);
  return {
    id: prefix,
    sourceId: prefix,
    sourceVersion: 1,
    tempo: { bpm: options.tempoBpm ?? 90 },
    timeSignature: { numerator: 4, denominator: 4 },
    notes,
    occurrences,
    totalBeats: start + length
  };
}

function relativeLines(tonic: SpelledPitchClass, scaleId: ScaleId): string[] {
  const scale = getScale(scaleId);
  const relative = scale.relativeTo;
  if (!relative) return [];
  const parent = getScale(relative.scale);
  const degree = parent.degrees[relative.degree - 1];
  if (!degree) return [];
  let parentTonic: SpelledPitchClass;
  try {
    parentTonic = transposePitchClass(tonic, degree.interval, "down");
  } catch {
    return [];
  }
  if (relative.degree === 1) return [];
  return [
    `${unicodeName(tonic)} ${scaleDisplayName(scaleId)} uses the same notes as ${unicodeName(parentTonic)} ${scaleDisplayName(relative.scale)}, started on its ${ORDINALS[relative.degree] ?? `${relative.degree}th`} degree (${unicodeName(tonic)}).`
  ];
}

/** Compare two scales/modes over the same tonic. */
export function modeComparison(tonicInput: SpelledPitchClass | string, a: ScaleId, b: ScaleId, octave: number = 4): ModeComparison {
  const tonic = resolveTonic(tonicInput);
  const scaleA = labScale(tonic, a, octave);
  const scaleB = labScale(tonic, b, octave);
  const comparison = compareScales(tonic, a, b);
  const tonicName = unicodeName(tonic);
  const differences: ModeDifference[] = comparison.differences.map((difference) => ({
    degreeNumber: difference.degreeNumber,
    a: difference.a,
    b: difference.b,
    text: `The ${ORDINALS[difference.degreeNumber] ?? `${difference.degreeNumber}th`} degree: ${describeTones(difference.a, difference.b)} in ${scaleA.displayName}, ${describeTones(difference.b, difference.a)} in ${scaleB.displayName}; the tonic ${tonicName} stays the same.`
  }));
  const characteristic: number[] = [];
  const differing = new Set<number>(comparison.differences.map((difference) => difference.degreeNumber));
  [scaleA, scaleB].forEach((scale) => {
    scale.notes.slice(0, scale.notes.length - 1).forEach((note) => {
      const number = degreeNumber(note.label);
      if (number !== null && differing.has(number) && !characteristic.includes(note.midi)) characteristic.push(note.midi);
    });
  });
  characteristic.sort((x, y) => x - y);
  const summary =
    differences.length === 0
      ? `${scaleA.displayName} and ${scaleB.displayName} contain the same notes.`
      : `${scaleA.displayName} and ${scaleB.displayName} share the tonic ${tonicName} and differ in ${differences.length} degree${differences.length === 1 ? "" : "s"}: ${differences.map((difference) => difference.text.replace(/; the tonic .*$/, "")).join(" ")}`;
  const relativeExplanation = [
    ...relativeLines(tonic, a),
    ...relativeLines(tonic, b),
    `This relative view is a secondary aid: the sound of each mode comes from hearing its degrees against the ${tonicName} tonic, which is why the demonstrations keep ${tonicName} in the bass.`
  ];
  const timelineA = scaleRunTimeline(tonic, a, { octave, idPrefix: `cmp-a:${a}` });
  const timelineB = scaleRunTimeline(tonic, b, { octave, idPrefix: `cmp-b:${b}` });
  const gap = 1;
  const shiftedB = scaleRunTimeline(tonic, b, { octave, idPrefix: `cmp-b:${b}`, startBeat: timelineA.totalBeats + gap });
  const aThenB: PerformanceTimeline = {
    ...timelineA,
    id: `cmp:${formatPitchClass(tonic)}-${a}-then-${b}`,
    sourceId: `cmp:${formatPitchClass(tonic)}-${a}-${b}`,
    notes: [...timelineA.notes, ...shiftedB.notes],
    occurrences: [...timelineA.occurrences, ...shiftedB.occurrences],
    totalBeats: shiftedB.totalBeats
  };
  return {
    tonic,
    scales: [scaleA, scaleB],
    differences,
    summary,
    relativeExplanation,
    characteristicDegreeMidi: characteristic,
    timelines: { a: timelineA, b: timelineB, aThenB }
  };
}

// ---------------------------------------------------------------------------
// Modal vamps
// ---------------------------------------------------------------------------

interface VampSpec {
  chords: { interval: { quality: "P" | "M" | "m"; number: number }; suffix: string; numeral: string }[];
}

const VAMPS: Partial<Record<ScaleId, VampSpec>> = {
  dorian: { chords: [{ interval: { quality: "P", number: 1 }, suffix: "m7", numeral: "i7" }, { interval: { quality: "P", number: 4 }, suffix: "7", numeral: "IV7" }] },
  naturalMinor: { chords: [{ interval: { quality: "P", number: 1 }, suffix: "m7", numeral: "i7" }, { interval: { quality: "P", number: 4 }, suffix: "m7", numeral: "iv7" }] },
  aeolian: { chords: [{ interval: { quality: "P", number: 1 }, suffix: "m7", numeral: "i7" }, { interval: { quality: "P", number: 4 }, suffix: "m7", numeral: "iv7" }] },
  major: { chords: [{ interval: { quality: "P", number: 1 }, suffix: "maj7", numeral: "Imaj7" }, { interval: { quality: "P", number: 4 }, suffix: "maj7", numeral: "IVmaj7" }] },
  ionian: { chords: [{ interval: { quality: "P", number: 1 }, suffix: "maj7", numeral: "Imaj7" }, { interval: { quality: "P", number: 4 }, suffix: "maj7", numeral: "IVmaj7" }] },
  mixolydian: { chords: [{ interval: { quality: "P", number: 1 }, suffix: "7", numeral: "I7" }, { interval: { quality: "m", number: 7 }, suffix: "", numeral: "bVII" }] }
};

export interface VampOptions {
  tempoBpm?: number;
  /** Times the 2-bar vamp is played (default 2). */
  repeats?: number;
  metronome?: boolean;
}

export type VampResult =
  | { ok: true; symbols: string[]; romanNumerals: string[]; sequence: MusicalSequence; timeline: PerformanceTimeline }
  | { ok: false; reason: string };

/**
 * A 2-bar modal vamp (one chord per bar) as sustained accompaniment with the tonic in the
 * bass, for playing a scale/phrase over. No learner notes: the learner improvises or plays the
 * selected exercise on top.
 */
export function vampTimeline(tonicInput: SpelledPitchClass | string, scaleId: ScaleId, options: VampOptions = {}): VampResult {
  let tonic: SpelledPitchClass;
  try {
    tonic = resolveTonic(tonicInput);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  const spec = VAMPS[scaleId];
  if (!spec) {
    return { ok: false, reason: `No vamp is authored for ${scaleDisplayName(scaleId)} yet (available: Dorian, natural minor, major, Mixolydian).` };
  }
  const symbols: string[] = [];
  const chords: ChordDefinition[] = [];
  for (const entry of spec.chords) {
    let root: SpelledPitchClass;
    try {
      root = transposePitchClass(tonic, interval(entry.interval.quality, entry.interval.number));
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
    const symbol = `${formatPitchClass(root)}${entry.suffix}`;
    const parsed = tryChordFromSymbol(symbol);
    if (!parsed.ok) {
      return { ok: false, reason: `The vamp chord ${symbol} cannot be read: ${parsed.error}` };
    }
    symbols.push(symbol);
    chords.push(parsed.chord);
  }
  const key = { tonic, mode: scaleId };
  const events: SequenceEvent[] = chords.map((chord, index): SequenceEvent => ({
    id: `vamp-${index + 1}`,
    index,
    kind: "chord",
    symbol: symbols[index],
    chord,
    startBeat: index * 4,
    durationBeats: 4,
    voicing: { id: `vamp:${symbols[index]}`, chord, recipeId: "accompanimentOnly", notes: [], omitted: [], explanation: ["Accompaniment only; the learner plays on top."] },
    context: { key, romanNumeral: spec.chords[index].numeral }
  }));
  const sequence: MusicalSequence = {
    id: `vamp:${formatPitchClass(tonic)}-${scaleId}`,
    version: 1,
    title: `${unicodeName(tonic)} ${scaleDisplayName(scaleId)} vamp`,
    tempo: { bpm: options.tempoBpm ?? 90 },
    timeSignature: { numerator: 4, denominator: 4 },
    key,
    events,
    totalBeats: events.length * 4
  };
  const noVoicer = (): FallbackVoicing | null => null;
  const timeline = compileTimeline(sequence, {
    accompaniment: "sustained",
    repeats: Math.max(1, Math.floor(options.repeats ?? 2)),
    metronome: options.metronome === true,
    fallbackVoicer: noVoicer
  });
  return { ok: true, symbols, romanNumerals: spec.chords.map((entry) => entry.numeral), sequence, timeline };
}
