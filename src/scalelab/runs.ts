/**
 * Scale runs and patterns as practice material (plan E27).
 *
 * - Every realised note is its own target occurrence and its own step (repeated pitches and
 *   the turnaround note included), so one attack can never satisfy two targets.
 * - Fingering appears only when `reviewedFingering` returns one for exactly this tonic, scale,
 *   pattern and hand; transposition never reuses another key's fingering.
 * - Impossible ranges return a useful message with suggested start octaves.
 */
import type { ExerciseStep, Hand, PatternRecipe, PerformanceOccurrence, PerformanceTimeline, PerformedNote, ScaleId, SpelledPitchClass } from "@/model/contracts";
import { formatPitchClass, formatSpelledNote, parsePitchClass, spelledEquals, toPitchClass } from "@/music/pitch";
import { ONE_OCTAVE_RUN, PATTERN_RECIPES, createRunRecipe, realizePattern, reviewedFingering } from "@/music/patterns";
import type { RealizedPatternNote } from "@/music/patterns";
import { getScale } from "@/music/scales";
import { scaleDisplayName } from "@/scalelab/compare";

/** Full 88-key piano range. */
export const PIANO_RANGE = { low: 21, high: 108 };

export interface ScaleRunConfig {
  tonic: SpelledPitchClass;
  scaleId: ScaleId;
  patternId: string;
  startOctave: number;
  octaves: number;
  hand: Hand;
  tempoBpm: number;
  range: { low: number; high: number };
}

export interface ScaleRunExercise {
  ok: true;
  config: ScaleRunConfig;
  recipe: PatternRecipe;
  notes: RealizedPatternNote[];
  timeline: PerformanceTimeline;
  steps: ExerciseStep[];
  /** One finger per realised note, only for a reviewed combination. */
  fingering: number[] | undefined;
  /** Why fingering is shown or omitted. */
  fingeringNote: string;
}

export type ScaleRunResult =
  | ScaleRunExercise
  | { ok: false; config: ScaleRunConfig; reason: string; rangeIssue?: string; suggestedStartOctaves: number[] };

export interface ScaleRunOptions {
  tempoBpm?: number;
  range?: { low: number; high: number };
}

function resolveRecipe(patternId: string, scaleId: ScaleId, octaves: number, hand: Hand): PatternRecipe | string {
  const degreeCount = getScale(scaleId).degrees.length;
  if (!Number.isInteger(octaves) || octaves < 1 || octaves > 4) {
    return `Choose 1 to 4 octaves (got ${octaves}).`;
  }
  if (patternId === ONE_OCTAVE_RUN.id) {
    if (octaves === 1 && degreeCount === ONE_OCTAVE_RUN.steps.length - 1) {
      return ONE_OCTAVE_RUN;
    }
    return createRunRecipe({ id: `run-${octaves}-octave-${degreeCount}`, name: `${octaves}-octave scale run`, degreeCount, octaves, beatsPerStep: 1, direction: "upDown", hand: hand === "left" ? "left" : "right" });
  }
  const recipe = PATTERN_RECIPES.find((candidate) => candidate.id === patternId);
  if (!recipe) {
    return `Unknown pattern "${patternId}" (available: ${PATTERN_RECIPES.map((candidate) => candidate.id).join(", ")}).`;
  }
  if (octaves !== recipe.octaves) {
    return `"${recipe.name}" is defined for ${recipe.octaves} octave${recipe.octaves === 1 ? "" : "s"} only.`;
  }
  const maxDegree = Math.max(...recipe.steps.map((step) => step.degreeIndex));
  if (maxDegree >= degreeCount) {
    return `"${recipe.name}" needs a seven-note scale; ${scaleDisplayName(scaleId)} has ${degreeCount} notes.`;
  }
  return recipe;
}

function ordinalDegree(label: string): string {
  return label === "1" ? "1 (tonic)" : label;
}

/** Build a scale-run/pattern exercise with explicit per-note targets and steps. */
export function scaleRunExercise(
  tonicInput: SpelledPitchClass | string,
  scaleId: ScaleId,
  patternId: string,
  startOctave: number,
  octaves: number,
  hand: Hand,
  options: ScaleRunOptions = {}
): ScaleRunResult {
  const parsedTonic = typeof tonicInput === "string" ? parsePitchClass(tonicInput) : toPitchClass(tonicInput);
  const config: ScaleRunConfig = {
    tonic: parsedTonic ?? { letter: "C", accidental: 0 },
    scaleId,
    patternId,
    startOctave,
    octaves,
    hand,
    tempoBpm: options.tempoBpm ?? 72,
    range: options.range ?? PIANO_RANGE
  };
  if (!parsedTonic) {
    return { ok: false, config, reason: `"${String(tonicInput)}" is not a note name.`, suggestedStartOctaves: [] };
  }
  const tonic = parsedTonic;
  const recipe = resolveRecipe(patternId, scaleId, octaves, hand);
  if (typeof recipe === "string") {
    return { ok: false, config, reason: recipe, suggestedStartOctaves: [] };
  }
  const realised = realizePattern(recipe, tonic, scaleId, startOctave, { range: config.range, hand });
  const scaleName = `${formatPitchClass(tonic)} ${scaleDisplayName(scaleId)}`;
  if (!realised.ok) {
    const suggestion =
      realised.suggestedStartOctaves.length > 0
        ? ` Suggested start octave${realised.suggestedStartOctaves.length > 1 ? "s" : ""}: ${realised.suggestedStartOctaves.join(", ")}.`
        : " No start octave fits this range; widen the range or choose fewer octaves.";
    const rangeIssue = realised.suggestedStartOctaves.length > 0 || realised.details.length > 0 ? `${realised.reason}${realised.reason.includes("Try starting octave") ? "" : suggestion}` : undefined;
    const failure: { ok: false; config: ScaleRunConfig; reason: string; rangeIssue?: string; suggestedStartOctaves: number[] } = {
      ok: false,
      config,
      reason: realised.reason,
      suggestedStartOctaves: realised.suggestedStartOctaves
    };
    if (rangeIssue !== undefined) failure.rangeIssue = rangeIssue;
    return failure;
  }
  const fingers = reviewedFingering(recipe, tonic, scaleId, hand);
  const fingering = fingers ? realised.notes.map((note) => (note.finger !== undefined ? note.finger : 0)) : undefined;
  const fingeringNote =
    realised.fingering.status === "reviewed"
      ? `Fingering shown for ${scaleName}, ${hand} hand (${recipe.reviewed ? "reviewed" : "authored; awaiting teacher review"}).`
      : `Fingering omitted: ${realised.fingering.reason}`;

  const id = `scalerun:${formatPitchClass(tonic)}-${scaleId}-${recipe.id}-o${startOctave}-${hand}`;
  const notes: PerformedNote[] = [];
  const occurrences: PerformanceOccurrence[] = [];
  const steps: ExerciseStep[] = [];
  realised.notes.forEach((note) => {
    const occurrenceId = `${id}:n${note.stepIndex}`;
    const name = formatSpelledNote(note.spelled);
    occurrences.push({ occurrenceId, eventId: occurrenceId, passIndex: 0, startBeat: note.startBeat, durationBeats: note.durationBeats, symbol: name });
    const performed: PerformedNote = {
      id: `${occurrenceId}:learner:0`,
      eventId: occurrenceId,
      occurrenceId,
      part: "learner",
      midi: note.midi,
      spelled: note.spelled,
      degree: note.degreeLabel,
      hand,
      onsetBeat: note.startBeat,
      durationBeats: note.durationBeats,
      velocity: 90
    };
    if (fingering && note.finger !== undefined) performed.finger = note.finger;
    notes.push(performed);
    steps.push({
      id: `${id}:step${note.stepIndex + 1}`,
      occurrenceId,
      prompt: `Play ${name} — degree ${ordinalDegree(note.degreeLabel)} of ${scaleName}${performed.finger !== undefined ? ` (finger ${performed.finger})` : ""}.`,
      targets: [performed],
      policy: { kind: "exactVoicing" },
      hints: [`Degree ${note.degreeLabel} of ${scaleName}`, `Note ${formatPitchClass(note.spelled)}`, `${name} (MIDI ${note.midi})`]
    });
  });
  const timeline: PerformanceTimeline = {
    id,
    sourceId: id,
    sourceVersion: 1,
    tempo: { bpm: config.tempoBpm },
    timeSignature: { numerator: 4, denominator: 4 },
    notes,
    occurrences,
    totalBeats: realised.totalBeats
  };
  return { ok: true, config, recipe, notes: realised.notes, timeline, steps, fingering, fingeringNote };
}

export interface TransposeRunOptions {
  startOctave?: number;
}

export type TransposedRunResult = ScaleRunResult & { previousFingeringDropped: boolean };

/**
 * The same run/pattern from another tonic. Fingering is recomputed from the reviewed table for
 * the new key only; a reviewed fingering from the old key is never carried over.
 */
export function transposeRun(config: ScaleRunConfig, newTonic: SpelledPitchClass | string, options: TransposeRunOptions = {}): TransposedRunResult {
  const result = scaleRunExercise(newTonic, config.scaleId, config.patternId, options.startOctave ?? config.startOctave, config.octaves, config.hand, {
    tempoBpm: config.tempoBpm,
    range: config.range
  });
  const oldRecipe = resolveRecipe(config.patternId, config.scaleId, config.octaves, config.hand);
  const hadFingering = typeof oldRecipe !== "string" && reviewedFingering(oldRecipe, config.tonic, config.scaleId, config.hand) !== undefined;
  const dropped = hadFingering && (!result.ok || result.fingering === undefined) && !(result.ok && spelledEquals(result.config.tonic, config.tonic));
  if (result.ok && dropped) {
    return {
      ...result,
      fingeringNote: `Fingering for ${formatPitchClass(config.tonic)} ${scaleDisplayName(config.scaleId)} is not reused in ${formatPitchClass(result.config.tonic)} ${scaleDisplayName(config.scaleId)}: it has not been reviewed for that key.`,
      previousFingeringDropped: true
    };
  }
  return { ...result, previousFingeringDropped: dropped };
}
