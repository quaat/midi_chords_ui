/**
 * Harmonising a scale (plan E29, §3 "Harmonisation"): build the diatonic chords of a key and
 * explain WHY their qualities differ from the sizes of the stacked intervals between scale
 * degrees. This is distinct from choosing harmony for a melody (see melody.ts).
 */
import type {
  ChordDefinition,
  ChordQualityId,
  HarmonicFunction,
  KeyContext,
  MusicalSequence,
  SequenceEvent,
  SpelledNote,
  SpelledPitchClass,
  VoicedNote,
  VoicingInstance
} from "@/model/contracts";
import { chordTones, coreDegrees } from "@/music/chords";
import { interval, transposePitchClass } from "@/music/intervals";
import { formatPitchClass, formatSpelledNote, midiOf } from "@/music/pitch";
import { diatonicSevenths, diatonicTriads, formatKey, scaleNotes } from "@/music/scales";

export interface DiatonicNote {
  spelled: SpelledNote;
  midi: number;
  /** Chord degree label ("1", "b3", "5", "b7"). */
  label: string;
  name: string;
}

export interface StackedInterval {
  from: string;
  to: string;
  semitones: number;
  name: string;
}

export interface DiatonicDegreeInfo {
  degree: number;
  scaleDegreeLabel: string;
  romanNumeral: string;
  chord: ChordDefinition;
  symbol: string;
  quality: string;
  /** Why the chord has this quality, from the interval sizes between scale degrees. */
  qualityExplanation: string;
  notes: DiatonicNote[];
  /** Intervals above the root: third, fifth (and seventh). */
  intervals: StackedInterval[];
  function?: HarmonicFunction;
}

export interface DiatonicActivity {
  key: KeyContext;
  sevenths: boolean;
  degrees: DiatonicDegreeInfo[];
  sequence: MusicalSequence;
  explanation: string[];
  /** Whole/half-step pattern of the scale, e.g. ["W","W","H","W","W","W","H"]. */
  stepPattern: string[];
}

export interface DiatonicActivityOptions {
  sevenths?: boolean;
  /** Beats per chord in the demonstration sequence (default 2). */
  beatsPerChord?: number;
  tempoBpm?: number;
}

const QUALITY_NAMES: Partial<Record<ChordQualityId, string>> = {
  maj: "major",
  min: "minor",
  dim: "diminished",
  aug: "augmented",
  maj7: "major seventh",
  dom7: "dominant seventh",
  min7: "minor seventh",
  halfDim7: "half-diminished seventh",
  dim7: "diminished seventh",
  minMaj7: "minor-major seventh"
};

const MAJOR_FUNCTIONS: readonly HarmonicFunction[] = ["tonic", "predominant", "tonic", "predominant", "dominant", "tonic", "dominant"];
const MINOR_FUNCTIONS: readonly HarmonicFunction[] = ["tonic", "predominant", "tonic", "predominant", "dominant", "predominant", "dominant"];

function harmonicFunction(key: KeyContext, degree: number): HarmonicFunction | undefined {
  if (key.mode === "major" || key.mode === "ionian") return MAJOR_FUNCTIONS[degree - 1];
  if (key.mode === "naturalMinor" || key.mode === "aeolian" || key.mode === "harmonicMinor") return MINOR_FUNCTIONS[degree - 1];
  return undefined;
}

function stepName(semitones: number): string {
  if (semitones === 1) return "half step";
  if (semitones === 2) return "whole step";
  if (semitones === 3) return "augmented second";
  return `${semitones} semitones`;
}

function stepSymbol(semitones: number): string {
  if (semitones === 1) return "H";
  if (semitones === 2) return "W";
  if (semitones === 3) return "A2";
  return String(semitones);
}

function comparison(actual: SpelledPitchClass, reference: SpelledPitchClass, actualSemitones: number, referenceSemitones: number): string {
  const diff = actualSemitones - referenceSemitones;
  const amount = Math.abs(diff) === 1 ? "a half step" : Math.abs(diff) === 2 ? "a whole step" : `${Math.abs(diff)} semitones`;
  return `${formatPitchClass(actual)} is ${amount} ${diff < 0 ? "lower" : "higher"} than ${formatPitchClass(reference)}`;
}

function thirdName(semitones: number): string {
  if (semitones === 4) return "a major third";
  if (semitones === 3) return "a minor third";
  return `a third of ${semitones} semitones`;
}

function fifthName(semitones: number): string {
  if (semitones === 7) return "a perfect fifth";
  if (semitones === 6) return "a diminished fifth";
  if (semitones === 8) return "an augmented fifth";
  return `a fifth of ${semitones} semitones`;
}

function seventhName(semitones: number): string {
  if (semitones === 11) return "a major seventh";
  if (semitones === 10) return "a minor seventh";
  if (semitones === 9) return "a diminished seventh";
  return `a seventh of ${semitones} semitones`;
}

function closeVoicing(chord: ChordDefinition, recipeId: string): VoicingInstance {
  const core = coreDegrees(chord);
  const tones = chordTones(chord, 4).filter((tone) => core.includes(tone.degree));
  const notes: VoicedNote[] = tones.map((tone, index) => ({
    midi: tone.midi,
    spelled: tone.spelled,
    degree: tone.degree.label,
    role: tone.degree.role,
    hand: "right",
    voiceId: `v${index + 1}`
  }));
  return {
    id: `${recipeId}:${chord.symbol}:root`,
    chord,
    recipeId,
    notes,
    omitted: [],
    explanation: [`${chord.symbol} in root position, stacked in thirds from the scale.`]
  };
}

/** Build the diatonic chords of a key with explanations and a playable sequence. */
export function buildDiatonicActivity(key: KeyContext, options: DiatonicActivityOptions = {}): DiatonicActivity {
  const sevenths = options.sevenths === true;
  const chords = sevenths ? diatonicSevenths(key) : diatonicTriads(key);
  const scale = scaleNotes(key.tonic, key.mode, 4, 2, { includeTop: true });
  const keyName = formatKey(key);
  const stepPattern: string[] = [];
  for (let index = 0; index < 7; index += 1) {
    stepPattern.push(stepSymbol(scale[index + 1].midi - scale[index].midi));
  }

  const degrees: DiatonicDegreeInfo[] = chords.map((diatonic) => {
    const index = diatonic.degree - 1;
    const chord = diatonic.chord;
    const root = scale[index];
    const members = [scale[index + 2], scale[index + 4]];
    if (sevenths) members.push(scale[index + 6]);
    const core = coreDegrees(chord);
    const notes: DiatonicNote[] = chordTones(chord, 4)
      .filter((tone) => core.includes(tone.degree))
      .map((tone) => ({ spelled: tone.spelled, midi: tone.midi, label: tone.degree.label, name: formatSpelledNote(tone.spelled) }));
    const rootName = formatPitchClass(root.spelled);
    const intervals: StackedInterval[] = [];
    const sentences: string[] = [];
    sentences.push(`Built on degree ${diatonic.degree} of ${keyName}: ${[root, ...members].map((note) => formatPitchClass(note.spelled)).join(" ")}.`);

    // Third: the two scale steps it spans.
    const third = members[0];
    const thirdSemitones = third.midi - root.midi;
    const stepA = scale[index + 1].midi - root.midi;
    const stepB = third.midi - scale[index + 1].midi;
    const majorThird = transposePitchClass(root.spelled, interval("M", 3));
    let thirdText = `${rootName}–${formatPitchClass(third.spelled)} spans ${rootName}–${formatPitchClass(scale[index + 1].spelled)} (${stepName(stepA)}) + ${formatPitchClass(scale[index + 1].spelled)}–${formatPitchClass(third.spelled)} (${stepName(stepB)}) = ${thirdSemitones} semitones: ${thirdName(thirdSemitones)}`;
    if (thirdSemitones !== 4) {
      thirdText += `, because ${comparison(third.spelled, majorThird, thirdSemitones, 4)}, the major third above ${rootName}`;
    }
    sentences.push(`${thirdText}.`);
    intervals.push({ from: rootName, to: formatPitchClass(third.spelled), semitones: thirdSemitones, name: thirdName(thirdSemitones) });

    const fifth = members[1];
    const fifthSemitones = fifth.midi - root.midi;
    const perfectFifth = transposePitchClass(root.spelled, interval("P", 5));
    let fifthText = `${rootName}–${formatPitchClass(fifth.spelled)} = ${fifthSemitones} semitones: ${fifthName(fifthSemitones)}`;
    if (fifthSemitones !== 7) {
      fifthText += `, because ${comparison(fifth.spelled, perfectFifth, fifthSemitones, 7)}, the perfect fifth above ${rootName}`;
    }
    sentences.push(`${fifthText}.`);
    intervals.push({ from: rootName, to: formatPitchClass(fifth.spelled), semitones: fifthSemitones, name: fifthName(fifthSemitones) });

    if (sevenths) {
      const seventh = members[2];
      const seventhSemitones = seventh.midi - root.midi;
      const majorSeventh = transposePitchClass(root.spelled, interval("M", 7));
      let seventhText = `${rootName}–${formatPitchClass(seventh.spelled)} = ${seventhSemitones} semitones: ${seventhName(seventhSemitones)}`;
      if (seventhSemitones !== 11) {
        seventhText += `, because ${comparison(seventh.spelled, majorSeventh, seventhSemitones, 11)}, the major seventh above ${rootName}`;
      }
      sentences.push(`${seventhText}.`);
      intervals.push({ from: rootName, to: formatPitchClass(seventh.spelled), semitones: seventhSemitones, name: seventhName(seventhSemitones) });
    }
    const quality = QUALITY_NAMES[chord.quality] ?? chord.qualityLabel.toLowerCase();
    const upperThird = fifthSemitones - thirdSemitones;
    sentences.push(`${thirdName(thirdSemitones).replace(/^a /, "A ")} with ${thirdName(upperThird)} on top makes a ${quality} ${sevenths ? "chord" : "triad"} (${diatonic.romanNumeral}).`);

    const info: DiatonicDegreeInfo = {
      degree: diatonic.degree,
      scaleDegreeLabel: diatonic.scaleDegreeLabel,
      romanNumeral: diatonic.romanNumeral,
      chord,
      symbol: chord.symbol,
      quality,
      qualityExplanation: sentences.join(" "),
      notes,
      intervals
    };
    const fn = harmonicFunction(key, diatonic.degree);
    if (fn) info.function = fn;
    return info;
  });

  const beats = options.beatsPerChord ?? 2;
  const recipeId = sevenths ? "close-sevenths-rh" : "close-triads-rh";
  const events: SequenceEvent[] = degrees.map((info, index) => {
    const event: SequenceEvent = {
      id: `deg-${info.degree}`,
      index,
      kind: "chord",
      symbol: info.symbol,
      chord: info.chord,
      startBeat: index * beats,
      durationBeats: beats,
      voicingRecipeId: recipeId,
      voicing: closeVoicing(info.chord, recipeId),
      context: { key, romanNumeral: info.romanNumeral }
    };
    if (info.function && event.context) event.context.function = info.function;
    return event;
  });
  const sequence: MusicalSequence = {
    id: `diatonic:${formatPitchClass(key.tonic)}-${key.mode}${sevenths ? "-7" : ""}`,
    version: 1,
    title: `Diatonic ${sevenths ? "seventh chords" : "triads"} of ${keyName}`,
    tempo: { bpm: options.tempoBpm ?? 80 },
    timeSignature: { numerator: 4, denominator: 4 },
    key,
    events,
    totalBeats: events.length * beats,
    defaultVoicingRecipeId: recipeId
  };

  const tonicMidi = midiOf({ letter: key.tonic.letter, accidental: key.tonic.accidental, octave: 4 });
  const halfSteps = stepPattern
    .map((step, index) => (step === "H" ? `${formatPitchClass(scale[index].spelled)}–${formatPitchClass(scale[index + 1].spelled)}` : ""))
    .filter((text) => text !== "");
  const explanation: string[] = [
    `Each chord stacks alternate notes of ${keyName}: a root, the note two scale steps higher (the third) and the note four steps higher (the fifth)${sevenths ? ", plus the note six steps higher (the seventh)" : ""}.`,
    `${keyName} has the step pattern ${stepPattern.join(" ")} (W = whole step, H = half step); its half steps are ${halfSteps.join(" and ")}.`,
    "Where the half steps fall decides whether each stacked third has 4 semitones (major) or 3 (minor), so the same recipe gives different chord qualities on different degrees.",
    sevenths
      ? "Seventh chords add one more third: a major seventh (11 semitones) or minor seventh (10) above the root, and a diminished seventh (9) only where two half steps are close together."
      : "Major triad = major third + minor third; minor triad = minor third + major third; diminished triad = two minor thirds (its fifth has only 6 semitones).",
    `The first chord is built on the tonic ${formatPitchClass(key.tonic)} (MIDI ${tonicMidi} in octave 4); the Roman numerals use upper case for major and lower case for minor/diminished chords.`
  ];
  return { key, sevenths, degrees, sequence, explanation, stepPattern };
}
