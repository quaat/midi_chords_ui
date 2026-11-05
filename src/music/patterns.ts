/**
 * Pattern recipes over scales (plan E27): ordered/rhythmic steps stored separately from
 * the scale's pitch collection, realised into explicit note occurrences.
 *
 * Realisation rules
 * - Every realised note is a distinct occurrence (own `stepIndex` and `id`), including
 *   repeated pitches and turnaround notes, so a matcher cannot reuse one attack for two.
 * - direction "up" plays the recipe steps in order, "down" reverses them, and "upDown"
 *   plays them up and back down without repeating the top (turnaround) note.
 * - `startOctave` is the octave of the pattern's degree-0 / octaveOffset-0 note for every
 *   direction (a descending C major run from octave 4 starts at C5).
 * - Range violations return { ok: false } with a reason and suggested start octaves;
 *   notes are never silently clamped or octave-shifted.
 * - Fingering comes only from `recipe.reviewedFingerings[fingeringKey(tonic, scaleId)]`
 *   (one finger per recipe step, mapped onto the realised order). Any other key/scale,
 *   a different hand, or a length mismatch yields no fingering. Transposition never
 *   reuses another key's fingering.
 */
import type { DegreeLabel, Hand, PatternRecipe, PatternStep, ScaleId, SpelledNote, SpelledPitchClass } from "@/model/contracts";
import { transposeSpelled } from "@/music/intervals";
import { accidentalToText, formatPitchClass, formatSpelledNote, midiOf, noteFromMidi, parsePitchClassOrThrow, toPitchClass } from "@/music/pitch";
import { getScale } from "@/music/scales";

export type PatternDirection = PatternRecipe["direction"];

export interface RealizedPatternNote {
  /** Stable occurrence id: `${recipeId}:${stepIndex}`. */
  id: string;
  /** 0-based position in the realised order (unique per occurrence). */
  stepIndex: number;
  /** Index into recipe.steps this occurrence came from. */
  recipeStepIndex: number;
  spelled: SpelledNote;
  midi: number;
  degreeLabel: DegreeLabel;
  degreeIndex: number;
  startBeat: number;
  durationBeats: number;
  /** Reviewed fingering only; undefined when not reviewed for this key/scale/hand. */
  finger?: number;
}

export type FingeringStatus = { status: "reviewed"; key: string } | { status: "unreviewed"; reason: string };

export interface PatternRealization {
  ok: true;
  recipeId: string;
  tonic: SpelledPitchClass;
  scaleId: ScaleId;
  direction: PatternDirection;
  hand: Hand;
  notes: RealizedPatternNote[];
  totalBeats: number;
  /** Actual lowest/highest MIDI notes of the realisation. */
  span: { low: number; high: number };
  fingering: FingeringStatus;
}

export type PatternRealizationResult = PatternRealization | { ok: false; reason: string; details: string[]; suggestedStartOctaves: number[] };

export interface RealizePatternOptions {
  /** Override the recipe's direction. */
  direction?: PatternDirection;
  /** Allowed MIDI range (inclusive). Defaults to the full MIDI range 0..127. */
  range?: { low: number; high: number };
  /** Hand being practised; fingering is only shown when it matches the recipe hand. */
  hand?: Hand;
}

/** Key used in PatternRecipe.reviewedFingerings: "C:major", "F#:dorian", "Bb:naturalMinor". */
export function fingeringKey(tonic: SpelledPitchClass, scaleId: ScaleId): string {
  return `${tonic.letter}${accidentalToText(tonic.accidental)}:${scaleId}`;
}

/** Reviewed fingering for exactly this tonic/scale/hand, else undefined. */
export function reviewedFingering(recipe: PatternRecipe, tonic: SpelledPitchClass, scaleId: ScaleId, hand?: Hand): number[] | undefined {
  return lookupFingering(recipe, tonic, scaleId, hand).fingers;
}

function lookupFingering(recipe: PatternRecipe, tonic: SpelledPitchClass, scaleId: ScaleId, hand?: Hand): { fingers?: number[]; status: FingeringStatus } {
  const key = fingeringKey(tonic, scaleId);
  const table = recipe.reviewedFingerings;
  const fingers = table ? table[key] : undefined;
  if (!fingers) {
    return { status: { status: "unreviewed", reason: `No reviewed fingering for ${key} in "${recipe.name}"; fingering is omitted.` } };
  }
  if (hand !== undefined && hand !== recipe.hand) {
    return { status: { status: "unreviewed", reason: `Reviewed fingering for ${key} is for the ${recipe.hand} hand, not ${hand}.` } };
  }
  if (fingers.length !== recipe.steps.length) {
    return { status: { status: "unreviewed", reason: `Reviewed fingering for ${key} has ${fingers.length} entries but the recipe has ${recipe.steps.length} steps.` } };
  }
  return { fingers: [...fingers], status: { status: "reviewed", key } };
}

/** Realised order of recipe step indices for a direction. */
export function patternOrder(stepCount: number, direction: PatternDirection): number[] {
  const up: number[] = [];
  for (let index = 0; index < stepCount; index += 1) {
    up.push(index);
  }
  if (direction === "up") {
    return up;
  }
  const down = [...up].reverse();
  if (direction === "down") {
    return down;
  }
  // upDown: the top (turnaround) note is played once.
  return [...up, ...down.slice(1)];
}

function realizeAt(recipe: PatternRecipe, tonic: SpelledPitchClass, scaleId: ScaleId, startOctave: number, order: number[]): { notes: RealizedPatternNote[]; error?: string } {
  const scale = getScale(scaleId);
  const tonicNote: SpelledNote = { letter: tonic.letter, accidental: tonic.accidental, octave: startOctave };
  const notes: RealizedPatternNote[] = [];
  let beat = 0;
  for (let stepIndex = 0; stepIndex < order.length; stepIndex += 1) {
    const recipeStepIndex = order[stepIndex];
    const step: PatternStep = recipe.steps[recipeStepIndex];
    const degree = scale.degrees[step.degreeIndex];
    if (!degree) {
      return { notes: [], error: `Step ${recipeStepIndex + 1} of "${recipe.name}" uses degree index ${step.degreeIndex}, but ${scale.name} has ${scale.degrees.length} degrees.` };
    }
    let spelled: SpelledNote;
    try {
      const base = transposeSpelled(tonicNote, degree.interval);
      spelled = { letter: base.letter, accidental: base.accidental, octave: base.octave + step.octaveOffset };
    } catch (error) {
      return { notes: [], error: error instanceof Error ? error.message : String(error) };
    }
    const durationBeats = step.durationBeats ?? recipe.beatsPerStep;
    notes.push({
      id: `${recipe.id}:${stepIndex}`,
      stepIndex,
      recipeStepIndex,
      spelled,
      midi: midiOf(spelled),
      degreeLabel: degree.label,
      degreeIndex: step.degreeIndex,
      startBeat: beat,
      durationBeats
    });
    beat += durationBeats;
  }
  return { notes };
}

function fits(notes: RealizedPatternNote[], low: number, high: number): boolean {
  return notes.every((note) => note.midi >= low && note.midi <= high);
}

function midiLabel(midi: number): string {
  return `${formatSpelledNote(noteFromMidi(midi))} (${midi})`;
}

/**
 * Realise a pattern recipe over a scale. Returns explicit occurrences or an explicit
 * failure (unknown degree, impossible spelling, out-of-range notes).
 */
export function realizePattern(recipe: PatternRecipe, tonic: SpelledPitchClass | string, scaleId: ScaleId, startOctave: number = 4, options: RealizePatternOptions = {}): PatternRealizationResult {
  const root = typeof tonic === "string" ? parsePitchClassOrThrow(tonic) : toPitchClass(tonic);
  const direction = options.direction ?? recipe.direction;
  const low = Math.max(0, options.range ? options.range.low : 0);
  const high = Math.min(127, options.range ? options.range.high : 127);
  if (recipe.steps.length === 0) {
    return { ok: false, reason: `"${recipe.name}" has no steps.`, details: [], suggestedStartOctaves: [] };
  }
  if (low > high) {
    return { ok: false, reason: `Invalid range: low ${low} is above high ${high}.`, details: [], suggestedStartOctaves: [] };
  }
  const order = patternOrder(recipe.steps.length, direction);
  const realized = realizeAt(recipe, root, scaleId, startOctave, order);
  if (realized.error) {
    return { ok: false, reason: realized.error, details: [], suggestedStartOctaves: [] };
  }
  const notes = realized.notes;
  const midis = notes.map((note) => note.midi);
  const spanLow = Math.min(...midis);
  const spanHigh = Math.max(...midis);
  const label = `${formatPitchClass(root)} ${getScale(scaleId).name.toLowerCase()} "${recipe.name}" from octave ${startOctave}`;

  if (!fits(notes, low, high)) {
    const outside = notes.filter((note) => note.midi < low || note.midi > high);
    const details = outside.map((note) => `Step ${note.stepIndex + 1}: ${formatSpelledNote(note.spelled)} (${note.midi}) is ${note.midi < low ? "below" : "above"} the range.`);
    const suggestedStartOctaves: number[] = [];
    for (let octave = -1; octave <= 9; octave += 1) {
      if (octave === startOctave) {
        continue;
      }
      const candidate = realizeAt(recipe, root, scaleId, octave, order);
      if (!candidate.error && fits(candidate.notes, low, high)) {
        suggestedStartOctaves.push(octave);
      }
    }
    const needed = spanHigh - spanLow;
    const available = high - low;
    let reason = `${label} spans ${midiLabel(spanLow)}–${midiLabel(spanHigh)}, outside the range ${midiLabel(low)}–${midiLabel(high)}.`;
    if (needed > available) {
      reason += ` The pattern needs ${needed} semitones but the range allows only ${available}.`;
    } else if (suggestedStartOctaves.length > 0) {
      reason += ` Try starting octave ${suggestedStartOctaves.join(" or ")}.`;
    }
    return { ok: false, reason, details, suggestedStartOctaves };
  }

  const lookup = lookupFingering(recipe, root, scaleId, options.hand);
  if (lookup.fingers) {
    const fingers = lookup.fingers;
    notes.forEach((note) => {
      note.finger = fingers[note.recipeStepIndex];
    });
  }
  const last = notes[notes.length - 1];
  return {
    ok: true,
    recipeId: recipe.id,
    tonic: root,
    scaleId,
    direction,
    hand: options.hand ?? recipe.hand,
    notes,
    totalBeats: last.startBeat + last.durationBeats,
    span: { low: spanLow, high: spanHigh },
    fingering: lookup.status
  };
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

export interface RunRecipeOptions {
  id?: string;
  name?: string;
  /** Number of degrees in the target scale (7 for diatonic, 5 for pentatonic ...). */
  degreeCount?: number;
  octaves?: number;
  beatsPerStep?: number;
  direction?: PatternDirection;
  hand?: Hand;
}

/** Steps of a scale run: every degree for `octaves` octaves plus the closing tonic. */
export function runSteps(degreeCount: number, octaves: number): PatternStep[] {
  const steps: PatternStep[] = [];
  for (let octave = 0; octave < octaves; octave += 1) {
    for (let degreeIndex = 0; degreeIndex < degreeCount; degreeIndex += 1) {
      steps.push({ degreeIndex, octaveOffset: octave });
    }
  }
  steps.push({ degreeIndex: 0, octaveOffset: octaves });
  return steps;
}

/**
 * Steps of a "thirds" sequence over one octave: 1-3, 2-4, 3-5 ... 7-9, then 8.
 * Played upDown this yields the descending mirror 9-7, 8-6 ... 3-1.
 */
export function thirdsSteps(degreeCount: number): PatternStep[] {
  const steps: PatternStep[] = [];
  for (let index = 0; index < degreeCount; index += 1) {
    const upper = index + 2;
    steps.push({ degreeIndex: index, octaveOffset: 0 });
    steps.push({ degreeIndex: upper % degreeCount, octaveOffset: Math.floor(upper / degreeCount) });
  }
  steps.push({ degreeIndex: 0, octaveOffset: 1 });
  return steps;
}

/** Build an (unreviewed) scale-run recipe for any scale size. */
export function createRunRecipe(options: RunRecipeOptions = {}): PatternRecipe {
  const degreeCount = options.degreeCount ?? 7;
  const octaves = options.octaves ?? 1;
  return {
    id: options.id ?? `run-${degreeCount}-degrees-${octaves}-octave`,
    name: options.name ?? `${octaves}-octave scale run`,
    description: "Every scale degree in order, then back down; the top note is played once.",
    steps: runSteps(degreeCount, octaves),
    beatsPerStep: options.beatsPerStep ?? 1,
    direction: options.direction ?? "upDown",
    octaves,
    hand: options.hand ?? "right",
    reviewed: false
  };
}

/**
 * One-octave ascending/descending run for seven-note scales.
 * Fingering: only C major (right hand) is provided — standard RH fingering 1 2 3 1 2 3 4 5
 * (mapped back down as 4 3 2 1 3 2 1). It still awaits teacher review (reviewed: false).
 */
export const ONE_OCTAVE_RUN: PatternRecipe = {
  ...createRunRecipe({ id: "run-one-octave", name: "One-octave scale run", degreeCount: 7, octaves: 1, beatsPerStep: 1, direction: "upDown", hand: "right" }),
  reviewedFingerings: { "C:major": [1, 2, 3, 1, 2, 3, 4, 5] }
};

/** Thirds sequence (1-3, 2-4, 3-5 ...) for seven-note scales, eighth notes, no fingering. */
export const THIRDS_PATTERN: PatternRecipe = {
  id: "thirds-one-octave",
  name: "Scale in thirds",
  description: "Broken thirds up the scale (1-3, 2-4, 3-5 ... 7-9, 8) and the mirror back down.",
  steps: thirdsSteps(7),
  beatsPerStep: 0.5,
  direction: "upDown",
  octaves: 1,
  hand: "right",
  reviewed: false
};

export const PATTERN_RECIPES: readonly PatternRecipe[] = [ONE_OCTAVE_RUN, THIRDS_PATTERN];
