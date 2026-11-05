/**
 * Explainable voice leading across progressions (plan E07).
 *
 * explainTransition
 * - Equal voice counts: voices are matched by voiceId ("v1" lowest .. "vN" highest).
 * - Unequal counts: nearest-pitch assignment (minimum total movement, see matching.ts). Voices
 *   left over are not movements; the summary reports them as "enters" (new voice in the target)
 *   or "drops out" (source voice with no partner). Movement voiceIds are the source voiceIds.
 * - Kinds: common (0 semitones), step (1–2), leap (> 2). Only learner notes are compared; the
 *   accompaniment bass is not part of the transition.
 *
 * rankSequence — bounded beam search
 * - Per chord, candidates are the best voicing plus its alternatives from realizeVoicing (at most
 *   1 + MAX_ALTERNATIVES), with optional per-step melody/bass locks.
 * - A path's cost is the total voice movement; states are kept sorted by (cost, candidate
 *   indices lexicographically), so ties go to individually better-ranked candidates and the
 *   result is deterministic. Only `beam` states survive each step (default 4).
 * - Rests (null entries) carry the previous voicing forward for continuity: the next chord is
 *   ranked against the last sounding voicing. Output arrays stay aligned with the input, with
 *   `null` voicings at rests.
 * - Repeated chords (identical chord and identical locks to the previous sounding chord) reuse
 *   the same voicing: zero motion.
 * - A chord with no valid voicing (unsupported quality, impossible range or lock) fails the
 *   whole search explicitly with its step index and reason; nothing is silently skipped.
 */
import type { ChordDefinition, ChordRole, TransitionExplanation, VoiceMovement, VoicedNote, VoicingConstraints, VoicingInstance } from "@/model/contracts";
import { formatPitchClass } from "@/music/pitch";
import { realizeVoicing } from "@/voicing/engine";
import { matchVoices, motionCost } from "@/voicing/matching";

function sortedNotes(voicing: VoicingInstance): VoicedNote[] {
  return [...voicing.notes].sort((a, b) => a.midi - b.midi);
}

function kindOf(semitones: number): VoiceMovement["kind"] {
  const size = Math.abs(semitones);
  if (size === 0) {
    return "common";
  }
  return size <= 2 ? "step" : "leap";
}

function sizeText(semitones: number): string {
  const size = Math.abs(semitones);
  if (size === 1) {
    return "a half step";
  }
  if (size === 2) {
    return "a whole step";
  }
  return `${size} semitones`;
}

function roleWord(role: ChordRole): string {
  switch (role) {
    case "third":
      return "3";
    case "seventh":
      return "7";
    case "fifth":
      return "5";
    case "root":
      return "root";
    case "sixth":
      return "6";
    case "ninth":
      return "9";
    case "eleventh":
      return "11";
    case "thirteenth":
      return "13";
    default:
      return role;
  }
}

function capitalise(text: string): string {
  return text.length > 0 ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** Explain how the learner voices move from one voicing to the next. */
export function explainTransition(from: VoicingInstance, to: VoicingInstance): TransitionExplanation {
  const fromNotes = sortedNotes(from);
  const toNotes = sortedNotes(to);
  const match = matchVoices(
    fromNotes.map((note) => note.midi),
    toNotes.map((note) => note.midi)
  );
  const pairs: Array<{ from: VoicedNote; to: VoicedNote }> = match.pairs.map(([i, j]) => ({ from: fromNotes[i], to: toNotes[j] }));
  const movements: VoiceMovement[] = pairs.map((pair) => {
    const semitones = pair.to.midi - pair.from.midi;
    return {
      voiceId: pair.from.voiceId,
      fromMidi: pair.from.midi,
      toMidi: pair.to.midi,
      semitones,
      kind: kindOf(semitones),
      fromDegree: pair.from.degree,
      toDegree: pair.to.degree
    };
  });
  const commonTones = movements.filter((movement) => movement.kind === "common").length;
  const totalMotionSemitones = movements.reduce((sum, movement) => sum + Math.abs(movement.semitones), 0);

  // Describe common tones first, then steps, then leaps (each group lowest voice first).
  const kindRank: Record<VoiceMovement["kind"], number> = { common: 0, step: 1, leap: 2 };
  const order: number[] = pairs.map((_, index) => index).sort((a, b) => {
    const rank = kindRank[movements[a].kind] - kindRank[movements[b].kind];
    return rank !== 0 ? rank : movements[a].fromMidi - movements[b].fromMidi;
  });
  const parts: string[] = order.map((index) => {
    const pair = pairs[index];
    const movement = movements[index];
    const fromName = formatPitchClass(pair.from.spelled);
    const toName = formatPitchClass(pair.to.spelled);
    const roles = pair.from.degree !== pair.to.degree ? ` (${pair.from.degree} → ${pair.to.degree})` : "";
    if (movement.kind === "common") {
      return `${fromName} stays${roles}`;
    }
    const direction = movement.semitones > 0 ? "up" : "down";
    const verb = movement.kind === "step" ? "moves" : "leaps";
    return `${fromName}→${toName} ${verb} ${direction} ${sizeText(movement.semitones)}${roles}`;
  });
  match.unmatchedFrom.forEach((index) => {
    const note = fromNotes[index];
    parts.push(`${formatPitchClass(note.spelled)} (${note.degree}) drops out`);
  });
  match.unmatchedTo.forEach((index) => {
    const note = toNotes[index];
    parts.push(`${formatPitchClass(note.spelled)} (${note.degree}) enters`);
  });

  let prefix = "";
  for (let a = 0; a < order.length && prefix === ""; a += 1) {
    for (let b = a + 1; b < order.length; b += 1) {
      const ra = pairs[order[a]];
      const rb = pairs[order[b]];
      if (ra.from.role !== ra.to.role && ra.from.role === rb.to.role && rb.from.role === ra.to.role) {
        prefix = `${roleWord(ra.from.role)} and ${roleWord(rb.from.role)} swap roles: `;
        break;
      }
    }
  }
  let summary: string;
  if (parts.length === 0) {
    summary = "No voices to compare.";
  } else if (totalMotionSemitones === 0 && match.unmatchedFrom.length === 0 && match.unmatchedTo.length === 0) {
    summary = `${capitalise(prefix)}All ${movements.length} voices stay: ${parts.join(", ")}.`;
  } else {
    summary = `${capitalise(prefix)}${prefix ? parts.join(", ") : capitalise(parts.join(", "))} (total ${totalMotionSemitones} semitone${totalMotionSemitones === 1 ? "" : "s"}).`;
  }
  return { movements, commonTones, totalMotionSemitones, summary };
}

export interface RankSequenceOptions {
  /** Number of partial paths kept per step (default 4, minimum 1). */
  beam?: number;
  /** Per-step locks aligned with `chords`; undefined/null entries mean "no lock". */
  locks?: {
    melody?: ReadonlyArray<number | null | undefined>;
    bass?: ReadonlyArray<number | null | undefined>;
  };
}

export type RankSequenceResult =
  | {
      ok: true;
      /** Aligned with the input; null at rests. */
      voicings: Array<VoicingInstance | null>;
      /**
       * Aligned with the input: transitions[i] explains the move INTO step i from the last
       * sounding voicing (or constraints.previous for the first chord); null at rests and when
       * there is nothing before.
       */
      transitions: Array<TransitionExplanation | null>;
      /** Aligned with the input: the other candidates considered at each step ([] at rests). */
      alternativesPerStep: VoicingInstance[][];
      totalMotionSemitones: number;
    }
  | { ok: false; stepIndex: number; reason: string };

function chordKey(chord: ChordDefinition): string {
  const bass = chord.bass ? `${chord.bass.letter}${chord.bass.accidental}` : "";
  const degrees = chord.degrees.map((degree) => degree.label).join(",");
  return `${chord.root.letter}${chord.root.accidental}|${chord.quality}|${degrees}|${bass}`;
}

function lockAt(list: ReadonlyArray<number | null | undefined> | undefined, index: number): number | undefined {
  if (!list) {
    return undefined;
  }
  const value = list[index];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

interface StepPlan {
  kind: "rest" | "chord" | "repeat";
  candidates: VoicingInstance[];
  /** For repeats: the step whose choice is reused. */
  repeatOf: number;
}

interface BeamState {
  choices: number[];
  cost: number;
  last: number[] | null;
}

function compareStates(a: BeamState, b: BeamState): number {
  if (a.cost !== b.cost) {
    return a.cost - b.cost;
  }
  const length = Math.min(a.choices.length, b.choices.length);
  for (let i = 0; i < length; i += 1) {
    if (a.choices[i] !== b.choices[i]) {
      return a.choices[i] - b.choices[i];
    }
  }
  return 0;
}

function midisOf(voicing: VoicingInstance): number[] {
  return voicing.notes.map((note) => note.midi).sort((a, b) => a - b);
}

/**
 * Choose one voicing per chord minimising total voice movement (bounded beam search).
 * `constraints` apply to every step (except `previous`, which seeds continuity for the first
 * chord); `options.locks` add per-step melody/bass locks.
 */
export function rankSequence(
  chords: ReadonlyArray<ChordDefinition | null>,
  recipeId: string,
  constraints: VoicingConstraints = {},
  options: RankSequenceOptions = {}
): RankSequenceResult {
  const beam = Math.max(1, Math.floor(options.beam ?? 4));
  const steps: StepPlan[] = [];
  let lastSoundingIndex = -1;
  let lastKey = "";
  for (let index = 0; index < chords.length; index += 1) {
    const chord = chords[index];
    if (chord === null) {
      steps.push({ kind: "rest", candidates: [], repeatOf: -1 });
      continue;
    }
    const melody = lockAt(options.locks ? options.locks.melody : undefined, index);
    const bass = lockAt(options.locks ? options.locks.bass : undefined, index);
    const key = `${chordKey(chord)}|${melody ?? ""}|${bass ?? ""}`;
    if (lastSoundingIndex >= 0 && key === lastKey) {
      steps.push({ kind: "repeat", candidates: steps[lastSoundingIndex].candidates, repeatOf: lastSoundingIndex });
      lastSoundingIndex = index;
      continue;
    }
    const stepConstraints: VoicingConstraints = { ...constraints };
    delete stepConstraints.previous;
    if (melody !== undefined) {
      stepConstraints.melodyMidi = melody;
    }
    if (bass !== undefined) {
      stepConstraints.bassMidi = bass;
    }
    const result = realizeVoicing(chord, recipeId, stepConstraints);
    if (!result.ok) {
      return { ok: false, stepIndex: index, reason: `Step ${index + 1} (${chord.symbol}): ${result.reason}` };
    }
    steps.push({ kind: "chord", candidates: [result.voicing, ...result.alternatives], repeatOf: -1 });
    lastSoundingIndex = index;
    lastKey = key;
  }

  const seed = constraints.previous ? midisOf(constraints.previous) : null;
  let states: BeamState[] = [{ choices: [], cost: 0, last: seed }];
  steps.forEach((step) => {
    if (step.kind === "rest") {
      states = states.map((state) => ({ choices: [...state.choices, -1], cost: state.cost, last: state.last }));
      return;
    }
    if (step.kind === "repeat") {
      states = states.map((state) => ({ choices: [...state.choices, state.choices[step.repeatOf]], cost: state.cost, last: state.last }));
      return;
    }
    const expanded: BeamState[] = [];
    states.forEach((state) => {
      step.candidates.forEach((candidate, candidateIndex) => {
        const midis = midisOf(candidate);
        const added = state.last ? motionCost(state.last, midis) : 0;
        expanded.push({ choices: [...state.choices, candidateIndex], cost: state.cost + added, last: midis });
      });
    });
    expanded.sort(compareStates);
    states = expanded.slice(0, beam);
  });

  const best = states[0];
  const voicings: Array<VoicingInstance | null> = steps.map((step, index) => {
    const choice = best.choices[index];
    return step.kind === "rest" || choice < 0 ? null : step.candidates[choice];
  });
  const transitions: Array<TransitionExplanation | null> = [];
  let previous: VoicingInstance | null = constraints.previous ?? null;
  voicings.forEach((voicing) => {
    if (voicing === null) {
      transitions.push(null);
      return;
    }
    transitions.push(previous ? explainTransition(previous, voicing) : null);
    previous = voicing;
  });
  const alternativesPerStep: VoicingInstance[][] = steps.map((step, index) => {
    const chosen = voicings[index];
    return step.candidates.filter((candidate) => candidate !== chosen);
  });
  const totalMotionSemitones = transitions.reduce((sum, transition) => sum + (transition ? transition.totalMotionSemitones : 0), 0);
  return { ok: true, voicings, transitions, alternativesPerStep, totalMotionSemitones };
}
