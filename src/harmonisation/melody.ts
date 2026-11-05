/**
 * Harmonising a fixed melody (plan E29): bounded palette, declared harmonic rhythm, ranked
 * candidates with reasons (never a hidden "correct" answer), evaluation that keeps required
 * constraints, optional style observations and reflection prompts apart, comparison of two
 * solutions in words, and conversion to a playable sequence/timeline or a SongChart.
 *
 * Style assumptions are the melody's authored `assumptions`; the analysis below applies only
 * these simple rules:
 * - strong beats are beat 1 (and beat 3 in 4/4) plus the start of each harmonic slot;
 * - a non-chord tone on a weak beat approached and left by step in the same direction,
 *   between chord tones, is a passing tone; any other non-chord tone is "nonChordTone".
 * The melody's pitches and rhythm are never changed.
 */
import type {
  ChartBar,
  ChordDefinition,
  ChordSpan,
  HarmonicFunction,
  KeyContext,
  MusicalSequence,
  PerformanceTimeline,
  PerformedNote,
  SequenceEvent,
  SongChart,
  SpelledNote,
  VoicingInstance
} from "@/model/contracts";
import type { MelodyNote, MelodySpec } from "@/content/authoring";
import { chordPitchClasses, tryChordFromSymbol } from "@/music/chords";
import { formatPitchClass, formatSpelledNote, letterIndex, mod12, noteFromMidi, pitchClassOf, spellMidiWithLetter } from "@/music/pitch";
import { scalePitchClasses } from "@/music/scales";
import { compareNotes, compileTimeline } from "@/timeline/compile";
import type { FallbackVoicing } from "@/timeline/compile";
import { localVoicer } from "@/charts/voicer";
import type { ArrangementVoicer } from "@/charts/voicer";

const EPSILON = 1e-6;

export type MelodyRelation = "chordTone" | "passingTone" | "nonChordTone";
export type CadenceKind = "authentic" | "plagal" | "half" | "deceptive" | "none";

export interface HarmonySlot {
  index: number;
  label: string;
  startBeat: number;
  durationBeats: number;
  /** Melody notes whose onset lies in the slot (unchanged objects from the melody). */
  melodyNotes: MelodyNote[];
  melodyPitchClasses: number[];
  strongBeatPitchClasses: number[];
}

export interface HarmonyCandidate {
  symbol: string;
  romanNumeral: string;
  function?: HarmonicFunction;
  /** Ranking aid only; it is not a correctness judgement. */
  score: number;
  chordToneCount: number;
  melodyNoteCount: number;
  bassMotionFromPrevious: number | null;
  reasons: string[];
}

export interface SlotCandidates extends HarmonySlot {
  candidates: HarmonyCandidate[];
}

export interface HarmonisationActivity {
  melodyId: string;
  key: KeyContext;
  harmonicRhythmBeats: number;
  palette: string[];
  slots: SlotCandidates[];
  assumptions: string[];
  /** Palette symbols the chord model could not read (excluded from candidates). */
  unsupportedPalette: string[];
}

export interface HarmoniseOptions {
  /** The learner's current choices per slot (used for bass-motion reasons). */
  choices?: (string | null | undefined)[];
}

function barLength(melody: MelodySpec): number {
  return (melody.timeSignature.numerator * 4) / melody.timeSignature.denominator;
}

function melodyLength(melody: MelodySpec): number {
  let end = 0;
  melody.notes.forEach((note) => {
    end = Math.max(end, note.startBeat + note.durationBeats);
  });
  return end;
}

function isStrong(melody: MelodySpec, beat: number, slotStart: number): boolean {
  if (Math.abs(beat - slotStart) < EPSILON) return true;
  const bar = barLength(melody);
  const position = beat - Math.floor((beat + EPSILON) / bar) * bar;
  if (Math.abs(position) < EPSILON) return true;
  return Math.abs(bar - 4) < EPSILON && Math.abs(position - 2) < EPSILON;
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

/** Harmonic slots of a melody (one per harmonic-rhythm unit). */
export function melodySlots(melody: MelodySpec): HarmonySlot[] {
  const unit = melody.harmonicRhythmBeats > 0 ? melody.harmonicRhythmBeats : barLength(melody);
  const count = Math.max(1, Math.ceil(melodyLength(melody) / unit - EPSILON));
  const sameAsBar = Math.abs(unit - barLength(melody)) < EPSILON;
  const slots: HarmonySlot[] = [];
  for (let index = 0; index < count; index += 1) {
    const startBeat = index * unit;
    const notes = melody.notes.filter((note) => note.startBeat >= startBeat - EPSILON && note.startBeat < startBeat + unit - EPSILON);
    slots.push({
      index,
      label: sameAsBar ? `Bar ${index + 1}` : `Chord ${index + 1}`,
      startBeat,
      durationBeats: unit,
      melodyNotes: notes,
      melodyPitchClasses: uniqueSorted(notes.map((note) => mod12(note.midi))),
      strongBeatPitchClasses: uniqueSorted(notes.filter((note) => isStrong(melody, note.startBeat, startBeat)).map((note) => mod12(note.midi)))
    });
  }
  return slots;
}

/** Spell a melody pitch in the melody's key (scale letters first). */
export function spellInKey(midi: number, key: KeyContext): SpelledNote {
  const pcs = scalePitchClasses(key.tonic, key.mode);
  for (const pc of pcs) {
    if (pitchClassOf(pc) === mod12(midi)) {
      const spelled = spellMidiWithLetter(midi, pc.letter);
      if (spelled) return spelled;
    }
  }
  return noteFromMidi(midi);
}

function noteLabel(midi: number, key: KeyContext): string {
  return formatPitchClass(spellInKey(midi, key));
}

// ---------------------------------------------------------------------------
// Chord analysis in the key
// ---------------------------------------------------------------------------

interface ChordAnalysis {
  degree: number;
  romanNumeral: string;
  function?: HarmonicFunction;
  bassPc: number;
  bassName: string;
  pcs: number[];
}

const NUMERALS: readonly string[] = ["I", "II", "III", "IV", "V", "VI", "VII"];
const MAJOR_FUNCTIONS: readonly HarmonicFunction[] = ["tonic", "predominant", "tonic", "predominant", "dominant", "tonic", "dominant"];
const MINOR_FUNCTIONS: readonly HarmonicFunction[] = ["tonic", "predominant", "tonic", "predominant", "dominant", "predominant", "dominant"];

function analyse(chord: ChordDefinition, key: KeyContext): ChordAnalysis {
  const degree = ((letterIndex(chord.root.letter) - letterIndex(key.tonic.letter) + 7) % 7) + 1;
  const minorLike = chord.quality === "min" || chord.quality === "min7" || chord.quality === "dim" || chord.quality === "halfDim7" || chord.quality === "dim7" || chord.quality === "min6" || chord.quality === "min9" || chord.quality === "min11" || chord.quality === "min13" || chord.quality === "minMaj7";
  let numeral = NUMERALS[degree - 1];
  if (minorLike) numeral = numeral.toLowerCase();
  const scalePcs = scalePitchClasses(key.tonic, key.mode);
  const diatonicRoot = scalePcs[degree - 1];
  if (diatonicRoot) {
    const offset = mod12(pitchClassOf(chord.root) - pitchClassOf(diatonicRoot));
    if (offset === 11) numeral = `b${numeral}`;
    else if (offset === 10) numeral = `bb${numeral}`;
    else if (offset === 1) numeral = `#${numeral}`;
    else if (offset === 2) numeral = `##${numeral}`;
  }
  if (chord.quality === "dim" || chord.quality === "dim7") numeral += "°";
  if (chord.quality === "halfDim7") numeral += "ø";
  if (chord.quality === "dom7" || chord.quality === "min7" || chord.quality === "halfDim7" || chord.quality === "dim7") numeral += "7";
  if (chord.quality === "maj7") numeral += "maj7";
  const bass = chord.bass ?? chord.root;
  if (chord.bass) {
    const third = chord.degrees.find((d) => d.role === "third");
    const fifth = chord.degrees.find((d) => d.role === "fifth");
    const bassPcValue = pitchClassOf(chord.bass);
    const rootPc = pitchClassOf(chord.root);
    if (third && mod12(rootPc + third.semitones) === bassPcValue) numeral += "6";
    else if (fifth && mod12(rootPc + fifth.semitones) === bassPcValue) numeral += "64";
    else numeral += `/${formatPitchClass(chord.bass)}`;
  }
  const result: ChordAnalysis = { degree, romanNumeral: numeral, bassPc: pitchClassOf(bass), bassName: formatPitchClass(bass), pcs: chordPitchClasses(chord) };
  const table = key.mode === "major" || key.mode === "ionian" ? MAJOR_FUNCTIONS : key.mode === "naturalMinor" || key.mode === "aeolian" || key.mode === "harmonicMinor" ? MINOR_FUNCTIONS : null;
  if (table) result.function = table[degree - 1];
  return result;
}

/** Smallest signed bass movement in semitones (-5..+6). */
export function bassMotion(fromPc: number, toPc: number): number {
  const up = mod12(toPc - fromPc);
  return up > 6 ? up - 12 : up;
}

function describeBassMotion(semitones: number, from: string, to: string): string {
  const size = Math.abs(semitones);
  const direction = semitones > 0 ? "up" : "down";
  if (size === 0) return `The bass stays on ${to}.`;
  if (size <= 2) return `The bass moves by step ${direction} (${from}–${to}, ${size} semitone${size === 1 ? "" : "s"}).`;
  if (size <= 4) return `The bass moves by a third ${direction} (${from}–${to}).`;
  if (size === 5) return `The bass moves a fourth ${direction} (${from}–${to}), the strong root motion of a fifth/fourth.`;
  return `The bass leaps a tritone (${from}–${to}).`;
}

function parseChord(symbol: string): ChordDefinition | null {
  const parsed = tryChordFromSymbol(symbol);
  return parsed.ok ? parsed.chord : null;
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

/** Slots with ranked palette candidates and reasons. No candidate is marked correct. */
export function harmoniseMelody(melody: MelodySpec, options: HarmoniseOptions = {}): HarmonisationActivity {
  const key: KeyContext = { tonic: melody.key.tonic, mode: melody.key.mode };
  const slots = melodySlots(melody);
  const unsupported: string[] = [];
  const palette: { symbol: string; chord: ChordDefinition; analysis: ChordAnalysis; order: number }[] = [];
  melody.palette.forEach((symbol, order) => {
    const chord = parseChord(symbol);
    if (chord) palette.push({ symbol, chord, analysis: analyse(chord, key), order });
    else unsupported.push(symbol);
  });
  const choices = options.choices ?? [];
  const tonicPc = pitchClassOf(key.tonic);

  const withCandidates: SlotCandidates[] = slots.map((slot) => {
    const previousSymbol = slot.index > 0 ? choices[slot.index - 1] : undefined;
    const previousChord = previousSymbol ? parseChord(previousSymbol) : null;
    const previousBassPc = previousChord ? pitchClassOf(previousChord.bass ?? previousChord.root) : null;
    const previousBassName = previousChord ? formatPitchClass(previousChord.bass ?? previousChord.root) : "";
    const isFirst = slot.index === 0;
    const isLast = slot.index === slots.length - 1;
    const isPenultimate = slot.index === slots.length - 2;

    const ranked = palette.map((entry) => {
      const reasons: string[] = [];
      let total = 0;
      let covered = 0;
      let chordTones = 0;
      const strongMisses: string[] = [];
      const weakMisses: string[] = [];
      const hits: string[] = [];
      slot.melodyNotes.forEach((note) => {
        const strong = isStrong(melody, note.startBeat, slot.startBeat);
        const weight = note.durationBeats * (strong ? 2 : 1);
        total += weight;
        const name = noteLabel(note.midi, key);
        if (entry.analysis.pcs.includes(mod12(note.midi))) {
          covered += weight;
          chordTones += 1;
          if (!hits.includes(name)) hits.push(name);
        } else if (strong) {
          strongMisses.push(name);
        } else {
          weakMisses.push(name);
        }
      });
      let score = total > 0 ? (covered / total) * 10 : 5;
      if (slot.melodyNotes.length > 0) {
        reasons.push(
          hits.length > 0
            ? `Melody ${hits.join(", ")} ${hits.length === 1 ? "is a chord tone" : "are chord tones"} of ${entry.symbol} (${chordTones} of ${slot.melodyNotes.length} notes).`
            : `None of the melody notes are in ${entry.symbol}.`
        );
      }
      if (strongMisses.length > 0) {
        score -= 2 * strongMisses.length;
        reasons.push(`On a strong beat, ${strongMisses.join(", ")} ${strongMisses.length === 1 ? "is" : "are"} not in ${entry.symbol}.`);
      }
      if (weakMisses.length > 0) {
        reasons.push(`${weakMisses.join(", ")} on a weak beat would be a non-chord tone (fine if it passes by step).`);
      }
      let motion: number | null = null;
      if (previousBassPc !== null) {
        motion = bassMotion(previousBassPc, entry.analysis.bassPc);
        const size = Math.abs(motion);
        if (size === 1 || size === 2) score += 1;
        else if (size === 5) score += 1;
        else if (size === 3 || size === 4) score += 0.5;
        else if (size === 6) score -= 0.5;
        reasons.push(describeBassMotion(motion, previousBassName, entry.analysis.bassName));
      }
      const fn = entry.analysis.function;
      if (isFirst && fn === "tonic" && entry.analysis.degree === 1) {
        score += 0.5;
        reasons.push("Starting on the tonic chord establishes the key.");
      }
      if (isLast && entry.analysis.degree === 1 && entry.analysis.bassPc === tonicPc) {
        score += 1;
        reasons.push("Ending on the tonic with the tonic in the bass closes the phrase.");
      } else if (isLast && entry.analysis.degree === 1) {
        reasons.push("Ending on the tonic chord, but with another bass note, sounds less final.");
      }
      if (isPenultimate && fn === "dominant") {
        score += 0.5;
        reasons.push(`A dominant (${entry.analysis.romanNumeral}) before the last chord prepares a cadence.`);
      }
      if (fn !== undefined) {
        reasons.push(`Role in ${formatPitchClass(key.tonic)} ${key.mode === "major" ? "major" : key.mode}: ${entry.analysis.romanNumeral}, ${fn} function.`);
      }
      const candidate: HarmonyCandidate = {
        symbol: entry.symbol,
        romanNumeral: entry.analysis.romanNumeral,
        score: Math.round(score * 100) / 100,
        chordToneCount: chordTones,
        melodyNoteCount: slot.melodyNotes.length,
        bassMotionFromPrevious: motion,
        reasons
      };
      if (fn !== undefined) candidate.function = fn;
      return { candidate, order: entry.order };
    });
    ranked.sort((a, b) => (Math.abs(b.candidate.score - a.candidate.score) > 1e-9 ? b.candidate.score - a.candidate.score : a.order - b.order));
    return { ...slot, candidates: ranked.map((entry) => entry.candidate) };
  });

  return {
    melodyId: melody.id,
    key,
    harmonicRhythmBeats: slots.length > 0 ? slots[0].durationBeats : melody.harmonicRhythmBeats,
    palette: [...melody.palette],
    slots: withCandidates,
    assumptions: [...melody.assumptions],
    unsupportedPalette: unsupported
  };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export interface EvaluatedNote {
  midi: number;
  name: string;
  startBeat: number;
  durationBeats: number;
  strong: boolean;
  relation: MelodyRelation;
}

export interface SlotConstraints {
  /** The fixed-melody activity never changes the melody. */
  melodyUnchanged: true;
  chordsFromPalette: boolean;
  harmonicRhythmKept: boolean;
}

export interface SlotEvaluation {
  index: number;
  label: string;
  startBeat: number;
  durationBeats: number;
  chord: string;
  romanNumeral: string | null;
  bass: string | null;
  melodyRelation: MelodyRelation[];
  notes: EvaluatedNote[];
  /** Semitones from the previous slot's bass (null for the first slot). */
  bassMotion: number | null;
  /** Cadence formed by this slot with the previous one (only at the final slot). */
  cadence: CadenceKind;
  constraintsSatisfied: SlotConstraints;
  styleNotes: string[];
}

export interface SolutionEvaluation {
  melodyId: string;
  chords: string[];
  slots: SlotEvaluation[];
  /** Required constraints (pass/fail). */
  constraints: SlotConstraints & { allSatisfied: boolean; problems: string[] };
  cadence: CadenceKind;
  bassLine: string[];
  /** Optional style observations; never a reason to mark a valid solution wrong. */
  styleNotes: string[];
  /** Open questions for the learner; not scored. */
  reflection: string[];
  assumptions: string[];
}

function cadenceOf(previous: ChordAnalysis | null, final: ChordAnalysis | null, finalChord: ChordDefinition | null): CadenceKind {
  if (!final || !finalChord) return "none";
  if (final.degree === 5) return "half";
  if (!previous) return "none";
  if (final.degree === 1 && (previous.degree === 5 || previous.degree === 7)) return "authentic";
  if (final.degree === 1 && previous.degree === 4) return "plagal";
  if (final.degree === 6 && previous.degree === 5) return "deceptive";
  return "none";
}

const CADENCE_TEXT: Record<CadenceKind, string> = {
  authentic: "an authentic cadence (V → I)",
  plagal: "a plagal cadence (IV → I)",
  half: "a half cadence (ending on V)",
  deceptive: "a deceptive cadence (V → vi)",
  none: "no standard cadence"
};

/** Evaluate a chosen harmonisation (one chord per slot). */
export function evaluateSolution(melody: MelodySpec, chords: string[]): SolutionEvaluation {
  const key: KeyContext = { tonic: melody.key.tonic, mode: melody.key.mode };
  const slots = melodySlots(melody);
  const rhythmKept = chords.length === slots.length;
  const problems: string[] = [];
  if (!rhythmKept) {
    problems.push(`The harmonic rhythm has ${slots.length} slots of ${slots[0] ? slots[0].durationBeats : melody.harmonicRhythmBeats} beats, but ${chords.length} chord${chords.length === 1 ? " was" : "s were"} given.`);
  }
  const parsed = slots.map((_, index) => (index < chords.length ? parseChord(chords[index]) : null));
  const analyses = parsed.map((chord) => (chord ? analyse(chord, key) : null));
  const slotOfNote = (note: MelodyNote): number => slots.findIndex((slot) => slot.melodyNotes.includes(note));
  const sortedNotes = [...melody.notes].sort((a, b) => a.startBeat - b.startBeat);
  const isChordTone = (note: MelodyNote): boolean => {
    const index = slotOfNote(note);
    const analysis = index >= 0 ? analyses[index] : null;
    return analysis !== null && analysis.pcs.includes(mod12(note.midi));
  };
  const relationOf = (note: MelodyNote, slotStart: number): MelodyRelation => {
    if (isChordTone(note)) return "chordTone";
    const position = sortedNotes.indexOf(note);
    const previous = position > 0 ? sortedNotes[position - 1] : undefined;
    const next = position >= 0 && position < sortedNotes.length - 1 ? sortedNotes[position + 1] : undefined;
    if (!previous || !next || isStrong(melody, note.startBeat, slotStart)) return "nonChordTone";
    const into = note.midi - previous.midi;
    const out = next.midi - note.midi;
    const step = (value: number): boolean => Math.abs(value) >= 1 && Math.abs(value) <= 2;
    if (step(into) && step(out) && Math.sign(into) === Math.sign(out) && isChordTone(previous) && isChordTone(next)) return "passingTone";
    return "nonChordTone";
  };

  const evaluations: SlotEvaluation[] = slots.map((slot, index) => {
    const symbol = index < chords.length ? chords[index] : "";
    const chord = parsed[index];
    const analysis = analyses[index];
    const inPalette = symbol !== "" && melody.palette.includes(symbol);
    if (symbol === "") problems.push(`${slot.label} has no chord.`);
    else if (!chord) problems.push(`${slot.label}: "${symbol}" is not a supported chord symbol.`);
    else if (!inPalette) problems.push(`${slot.label}: ${symbol} is not in the palette (${melody.palette.join(", ")}).`);
    const notes: EvaluatedNote[] = slot.melodyNotes.map((note) => ({
      midi: note.midi,
      name: formatSpelledNote(spellInKey(note.midi, key)),
      startBeat: note.startBeat,
      durationBeats: note.durationBeats,
      strong: isStrong(melody, note.startBeat, slot.startBeat),
      relation: relationOf(note, slot.startBeat)
    }));
    const previousAnalysis = index > 0 ? analyses[index - 1] : null;
    const motion = analysis && previousAnalysis ? bassMotion(previousAnalysis.bassPc, analysis.bassPc) : null;
    const styleNotes: string[] = [];
    if (analysis && previousAnalysis && motion !== null) {
      styleNotes.push(describeBassMotion(motion, previousAnalysis.bassName, analysis.bassName));
    }
    notes.forEach((note) => {
      if (note.relation === "passingTone") styleNotes.push(`${note.name} passes by step between chord tones (a passing tone over ${symbol}).`);
      if (note.relation === "nonChordTone") styleNotes.push(`${note.name} is not in ${symbol || "the chord"}${note.strong ? " and falls on a strong beat, which sounds tense in this style" : ""}.`);
    });
    if (chord && chord.bass && analysis) styleNotes.push(`${symbol} puts ${analysis.bassName} in the bass; the harmony is still ${formatPitchClass(chord.root)} ${chord.qualityLabel.toLowerCase()}.`);
    const isFinal = index === slots.length - 1;
    const cadence = isFinal ? cadenceOf(previousAnalysis, analysis, chord) : "none";
    return {
      index,
      label: slot.label,
      startBeat: slot.startBeat,
      durationBeats: slot.durationBeats,
      chord: symbol,
      romanNumeral: analysis ? analysis.romanNumeral : null,
      bass: analysis ? analysis.bassName : null,
      melodyRelation: notes.map((note) => note.relation),
      notes,
      bassMotion: motion,
      cadence,
      constraintsSatisfied: { melodyUnchanged: true, chordsFromPalette: inPalette && chord !== null, harmonicRhythmKept: rhythmKept },
      styleNotes
    };
  });
  const chordsFromPalette = evaluations.every((slot) => slot.constraintsSatisfied.chordsFromPalette);
  const finalSlot = evaluations[evaluations.length - 1];
  const cadence: CadenceKind = finalSlot ? finalSlot.cadence : "none";
  const bassLine = evaluations.map((slot) => slot.bass ?? "?");
  const styleNotes: string[] = [`The phrase ends with ${CADENCE_TEXT[cadence]}.`, `Bass line: ${bassLine.join("–")}.`];
  const strongMisses = evaluations.flatMap((slot) => slot.notes.filter((note) => note.strong && note.relation !== "chordTone").map((note) => `${note.name} (${slot.label})`));
  if (strongMisses.length > 0) styleNotes.push(`Strong-beat melody notes that are not chord tones: ${strongMisses.join(", ")}.`);
  else styleNotes.push("Every strong-beat melody note is a chord tone.");
  const reflection: string[] = [
    "Which bar sounds most different from the other version you tried, and why?",
    "Does the ending feel finished, or does it ask to continue?",
    "How does the bass line shape the phrase: does it walk, leap, or stay still?"
  ];
  return {
    melodyId: melody.id,
    chords: [...chords],
    slots: evaluations,
    constraints: { melodyUnchanged: true, chordsFromPalette, harmonicRhythmKept: rhythmKept, allSatisfied: chordsFromPalette && rhythmKept, problems },
    cadence,
    bassLine,
    styleNotes,
    reflection,
    assumptions: [...melody.assumptions]
  };
}

export interface SolutionComparison {
  differences: string[];
  sameSlots: number[];
  summary: string;
}

/** Describe in words how two harmonisations of the same melody differ. */
export function compareSolutions(melody: MelodySpec, a: string[], b: string[]): SolutionComparison {
  const evalA = evaluateSolution(melody, a);
  const evalB = evaluateSolution(melody, b);
  const differences: string[] = [];
  const sameSlots: number[] = [];
  const count = Math.max(evalA.slots.length, evalB.slots.length);
  for (let index = 0; index < count; index += 1) {
    const slotA = evalA.slots[index];
    const slotB = evalB.slots[index];
    if (!slotA || !slotB) continue;
    if (slotA.chord === slotB.chord) {
      sameSlots.push(index);
      continue;
    }
    const chordA = parseChord(slotA.chord);
    const chordB = parseChord(slotB.chord);
    let text = `${slotA.label}: ${slotA.chord} (${slotA.romanNumeral ?? "?"}) vs ${slotB.chord} (${slotB.romanNumeral ?? "?"})`;
    if (chordA && chordB && chordA.quality === chordB.quality && pitchClassOf(chordA.root) === pitchClassOf(chordB.root)) {
      text += ` — the same harmony; only the bass changes (${slotA.bass ?? "?"} vs ${slotB.bass ?? "?"})`;
    }
    const relationChanges: string[] = [];
    slotA.notes.forEach((note, noteIndex) => {
      const other = slotB.notes[noteIndex];
      if (other && other.relation !== note.relation) {
        relationChanges.push(`${note.name} is a ${relationWord(note.relation)} over ${slotA.chord} but a ${relationWord(other.relation)} over ${slotB.chord}`);
      }
    });
    if (relationChanges.length > 0) text += `; ${relationChanges.join("; ")}`;
    differences.push(`${text}.`);
  }
  if (evalA.bassLine.join("–") !== evalB.bassLine.join("–")) {
    differences.push(`Bass line: ${evalA.bassLine.join("–")} vs ${evalB.bassLine.join("–")}.`);
    const motions = (evaluation: SolutionEvaluation): string =>
      evaluation.slots
        .slice(1)
        .map((slot) => (slot.bassMotion === null ? "?" : `${slot.bassMotion > 0 ? "+" : ""}${slot.bassMotion}`))
        .join(", ");
    differences.push(`Bass movement in semitones: ${motions(evalA)} vs ${motions(evalB)}.`);
  }
  if (evalA.cadence !== evalB.cadence) {
    differences.push(`Ending: ${CADENCE_TEXT[evalA.cadence]} vs ${CADENCE_TEXT[evalB.cadence]}.`);
  }
  const summary =
    differences.length === 0
      ? "The two solutions use the same chords."
      : `They differ in ${count - sameSlots.length} of ${count} slots${evalA.cadence === evalB.cadence ? ` and both end with ${CADENCE_TEXT[evalA.cadence]}` : ""}. Both keep the melody unchanged; neither is marked as the correct answer.`;
  return { differences, sameSlots, summary };
}

function relationWord(relation: MelodyRelation): string {
  if (relation === "chordTone") return "chord tone";
  if (relation === "passingTone") return "passing tone";
  return "non-chord tone";
}

// ---------------------------------------------------------------------------
// Playback and chart conversion
// ---------------------------------------------------------------------------

export interface SolutionToSequenceOptions {
  /**
   * Default: the local close-position voicer (left hand, below the melody). The src/voicing
   * close recipes are right-hand recipes registered from C4/G3 upward and would collide with
   * the melody; inject `engineVoicer` with a matching `recipeId`/`chordRegister` to use them.
   */
  voicer?: ArrangementVoicer;
  recipeId?: string;
  /** The learner plays the melody; chords become accompaniment. Default false. */
  learnerPlaysMelody?: boolean;
  tempoBpm?: number;
  /** Register for the chord voicings (default 47..59, below the melody). */
  chordRegister?: { low: number; high: number };
}

export type SolutionSequenceResult = { ok: true; sequence: MusicalSequence; timeline: PerformanceTimeline } | { ok: false; reason: string };

/**
 * Turn a harmonisation into a playable sequence and timeline. The melody notes are emitted at
 * their authored onsets/durations/pitches (part "demonstration", or "learner" when the learner
 * plays the melody); the chords are the learner part, or the accompaniment part when the
 * learner plays the melody.
 */
export function solutionToSequence(melody: MelodySpec, chords: string[], options: SolutionToSequenceOptions = {}): SolutionSequenceResult {
  const key: KeyContext = { tonic: melody.key.tonic, mode: melody.key.mode };
  const slots = melodySlots(melody);
  if (chords.length !== slots.length) {
    return { ok: false, reason: `The melody has ${slots.length} harmonic slots but ${chords.length} chords were given.` };
  }
  const register = options.chordRegister ?? { low: 47, high: 59 };
  const recipeId = options.recipeId ?? "close-triads-rh";
  const events: SequenceEvent[] = [];
  let previous: VoicingInstance | undefined;
  for (const slot of slots) {
    const symbol = chords[slot.index];
    const chord = parseChord(symbol);
    if (!chord) {
      return { ok: false, reason: `${slot.label}: "${symbol}" is not a supported chord symbol.` };
    }
    const constraints: { minMidi: number; maxMidi: number; hand: "left"; previous?: VoicingInstance } = { minMidi: register.low, maxMidi: register.high, hand: "left" };
    if (previous) constraints.previous = previous;
    const voicer: ArrangementVoicer = options.voicer ?? localVoicer;
    const voicing = voicer(chord, recipeId, constraints);
    if (!voicing) {
      return { ok: false, reason: `${slot.label}: cannot voice ${symbol} with "${recipeId}" in ${register.low}–${register.high}.` };
    }
    previous = voicing;
    const analysis = analyse(chord, key);
    events.push({
      id: `${melody.id}:slot${slot.index + 1}`,
      index: slot.index,
      kind: "chord",
      symbol,
      chord,
      startBeat: slot.startBeat,
      durationBeats: slot.durationBeats,
      voicingRecipeId: voicing.recipeId,
      voicing,
      context: { key, romanNumeral: analysis.romanNumeral }
    });
  }
  const totalBeats = slots.length * (slots[0] ? slots[0].durationBeats : 0);
  const sequence: MusicalSequence = {
    id: `${melody.id}:${chords.join("-")}`,
    version: melody.version,
    title: melody.title,
    tempo: { bpm: options.tempoBpm ?? 80 },
    timeSignature: { numerator: melody.timeSignature.numerator, denominator: melody.timeSignature.denominator },
    key,
    events,
    totalBeats,
    defaultVoicingRecipeId: recipeId
  };
  const noVoicer = (): FallbackVoicing | null => null;
  const compiled = compileTimeline(sequence, { accompaniment: "none", fallbackVoicer: noVoicer, timelineId: `${sequence.id}@${sequence.version}` });
  const learnerPlaysMelody = options.learnerPlaysMelody === true;
  const notes: PerformedNote[] = compiled.notes.map((note) => {
    if (learnerPlaysMelody && note.part === "learner") {
      return { ...note, part: "accompaniment", id: note.id.replace(":learner:", ":accompaniment:") };
    }
    return note;
  });
  const melodyPart = learnerPlaysMelody ? "learner" : "demonstration";
  melody.notes.forEach((authored, index) => {
    const slotIndex = slots.findIndex((slot) => slot.melodyNotes.includes(authored));
    const occurrence = compiled.occurrences[slotIndex >= 0 ? slotIndex : 0];
    const note: PerformedNote = {
      id: `${occurrence.occurrenceId}:melody:${index}`,
      eventId: occurrence.eventId,
      occurrenceId: occurrence.occurrenceId,
      part: melodyPart,
      midi: authored.midi,
      spelled: spellInKey(authored.midi, key),
      onsetBeat: authored.startBeat,
      durationBeats: authored.durationBeats,
      velocity: 100,
      hand: "right"
    };
    if (authored.degree !== undefined) note.degree = authored.degree;
    notes.push(note);
  });
  notes.sort(compareNotes);
  return { ok: true, sequence, timeline: { ...compiled, notes } };
}

export type SolutionChartResult = { ok: true; chart: SongChart } | { ok: false; reason: string };

/** Save a harmonisation as a one-section SongChart (bars by harmonic rhythm). */
export function solutionToChart(melody: MelodySpec, chords: string[], title: string): SolutionChartResult {
  const key: KeyContext = { tonic: melody.key.tonic, mode: melody.key.mode };
  const slots = melodySlots(melody);
  if (chords.length !== slots.length) {
    return { ok: false, reason: `The melody has ${slots.length} harmonic slots but ${chords.length} chords were given.` };
  }
  for (let index = 0; index < chords.length; index += 1) {
    if (!parseChord(chords[index])) {
      return { ok: false, reason: `${slots[index].label}: "${chords[index]}" is not a supported chord symbol.` };
    }
  }
  const bar = barLength(melody);
  const unit = slots[0] ? slots[0].durationBeats : bar;
  const perBar = bar / unit;
  const barsPerSlot = unit / bar;
  const bars: ChartBar[] = [];
  const numeral = (symbol: string): string | undefined => {
    const chord = parseChord(symbol);
    return chord ? analyse(chord, key).romanNumeral : undefined;
  };
  if (unit <= bar + EPSILON && Math.abs(perBar - Math.round(perBar)) < EPSILON) {
    const count = Math.round(perBar);
    for (let barIndex = 0; barIndex * count < chords.length; barIndex += 1) {
      const id = `h-bar${barIndex + 1}`;
      const spans = chords.slice(barIndex * count, barIndex * count + count).map((symbol, spanIndex) => {
        const span: ChordSpan = { id: `${id}-s${spanIndex + 1}`, symbol, startBeat: spanIndex * unit, durationBeats: unit };
        const rn = numeral(symbol);
        if (rn) span.romanNumeral = rn;
        return span;
      });
      const filled = spans.length * unit;
      const chartBar: ChartBar = { id, spans };
      if (filled < bar - EPSILON) {
        return { ok: false, reason: `The last bar would hold only ${filled} of ${bar} beats; the melody does not fill whole bars.` };
      }
      bars.push(chartBar);
    }
  } else if (Math.abs(barsPerSlot - Math.round(barsPerSlot)) < EPSILON) {
    chords.forEach((symbol) => {
      for (let repeat = 0; repeat < Math.round(barsPerSlot); repeat += 1) {
        const id = `h-bar${bars.length + 1}`;
        const span: ChordSpan = { id: `${id}-s1`, symbol, startBeat: 0, durationBeats: bar };
        const rn = numeral(symbol);
        if (rn) span.romanNumeral = rn;
        bars.push({ id, spans: [span] });
      }
    });
  } else {
    return { ok: false, reason: `A harmonic rhythm of ${unit} beats does not divide into ${bar}-beat bars.` };
  }
  const chart: SongChart = {
    id: `${melody.id}-harmonisation-${chords.map((symbol) => symbol.replace(/[^A-Za-z0-9#]+/g, "_")).join("-")}`,
    version: 1,
    title,
    key,
    timeSignature: { numerator: melody.timeSignature.numerator, denominator: melody.timeSignature.denominator },
    tempo: { bpm: 80 },
    sections: [{ id: "A", label: "A", bars }],
    performanceOrder: ["A"],
    provenance: {
      origin: "original",
      note: `Harmonisation of the melody "${melody.title}" (${melody.id} v${melody.version}): ${chords.join(" ")}.`
    },
    arrangementIds: [],
    meta: { version: 1, status: "draft" }
  };
  if (melody.author !== undefined) {
    chart.provenance.author = melody.author;
    chart.composer = melody.author;
  }
  return { ok: true, chart };
}
