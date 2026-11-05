/**
 * Attempt results, next actions, learner-facing summaries, and progress evidence (plan E15/E19).
 *
 * - Pitch and timing are summarised separately (`pitchCorrectRatio`, `onsetsWithinWindowRatio`);
 *   there is no combined score.
 * - Unobserved dimensions (fingering, technique, posture, tone) are never reported as measured;
 *   `describeResult` always states this, and self-assessment stays separate free text.
 * - Evidence kinds are derived only from what was observed: "listened", "assisted",
 *   "independent", "transfer". Practice never produces "read".
 */
import type {
  AnswerPolicy,
  AssistanceLevel,
  AttemptMode,
  AttemptResult,
  ExerciseDefinition,
  InputSource,
  KeyContext,
  NextAction,
  PerformanceOccurrence,
  PitchObservation,
  ProgressEvidence,
  SpelledPitchClass,
  TimingObservation
} from "@/model/contracts";
import { formatPitchClass, spelledEquals } from "@/music";
import { compiledExerciseInfo } from "@/practice/compileExercise";

export const SCORING_VERSION = "2026-11-04.1";

/** Ratio below which a timed attempt suggests a slower retry. */
export const SLOW_DOWN_BELOW = 0.6;
export const SLOWER_TEMPO_FACTOR = 0.8;

export interface BuildAttemptInput {
  exercise: ExerciseDefinition;
  mode: AttemptMode;
  pitch: PitchObservation[];
  timing: TimingObservation[];
  inputSource: InputSource;
  assistance?: AssistanceLevel;
  /** Highest hint level used across the attempt (0 = none). */
  hintLevel?: number;
  startedAt: string;
  completedAt?: string;
  tempoBpm?: number;
  latencyOffsetMs?: number;
  chartId?: string;
  arrangementId?: string;
  selfAssessment?: string;
  id?: string;
  /** Override for steps completed (default: number of correct pitch observations). */
  stepsCompleted?: number;
  /** Override for steps total (default: exercise steps for step mode, pitch observations otherwise). */
  stepsTotal?: number;
  /** Skip computing `nextAction`. */
  omitNextAction?: boolean;
}

/** Strip a timed-mode loop-pass suffix: "ev-2#0@3" → "ev-2#0". */
export function baseOccurrenceId(occurrenceId: string): string {
  const at = occurrenceId.lastIndexOf("@");
  return at >= 0 ? occurrenceId.slice(0, at) : occurrenceId;
}

function isGraded(policy: AnswerPolicy): boolean {
  return policy.kind !== "listen" && policy.kind !== "free";
}

/**
 * Miss counts per (base) occurrence.
 * - Step observations (no "@pass" suffix): failed tries (attempts − 1 when finally correct,
 *   attempts when never correct).
 * - Timed observations: the number of distinct occurrence passes with a wrong chord or any
 *   onset that was not on time (one bad pass counts once, however many notes it had).
 */
export function missCounts(pitch: PitchObservation[], timing: TimingObservation[]): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (id: string, amount: number): void => {
    if (amount <= 0) return;
    const base = baseOccurrenceId(id);
    counts.set(base, (counts.get(base) ?? 0) + amount);
  };
  const failedPasses = new Set<string>();
  pitch.forEach((obs) => {
    if (obs.occurrenceId.includes("@")) {
      if (!obs.correct) failedPasses.add(obs.occurrenceId);
      return;
    }
    add(obs.occurrenceId, obs.correct ? Math.max(0, obs.attempts - 1) : Math.max(1, obs.attempts));
  });
  timing.forEach((obs) => {
    if (obs.verdict !== "onTime") failedPasses.add(obs.occurrenceId);
  });
  failedPasses.forEach((id) => add(id, 1));
  return counts;
}

function occurrenceOrder(exercise: ExerciseDefinition): Map<string, number> {
  const order = new Map<string, number>();
  exercise.timeline.occurrences.forEach((occ, index) => order.set(occ.occurrenceId, index));
  return order;
}

/** Occurrences with misses, most misses first (ties in timeline order). */
export function difficultOccurrences(exercise: ExerciseDefinition, pitch: PitchObservation[], timing: TimingObservation[]): { occurrenceId: string; misses: number }[] {
  const order = occurrenceOrder(exercise);
  const entries: { occurrenceId: string; misses: number }[] = [];
  missCounts(pitch, timing).forEach((misses, occurrenceId) => entries.push({ occurrenceId, misses }));
  entries.sort((a, b) => (b.misses !== a.misses ? b.misses - a.misses : (order.get(a.occurrenceId) ?? 1e9) - (order.get(b.occurrenceId) ?? 1e9)));
  return entries;
}

export function buildAttemptResult(input: BuildAttemptInput): AttemptResult {
  const exercise = input.exercise;
  const graded = isGraded(exercise.policy);
  const pitchCorrect = input.pitch.filter((obs) => obs.correct).length;
  const onTime = input.timing.filter((obs) => obs.verdict === "onTime").length;
  const stepsTotal = input.stepsTotal ?? (input.mode === "step" ? exercise.steps.length : input.pitch.length);
  const summary: AttemptResult["summary"] = {
    stepsCompleted: input.stepsCompleted ?? pitchCorrect,
    stepsTotal,
    difficultOccurrenceIds: difficultOccurrences(exercise, input.pitch, input.timing).map((entry) => entry.occurrenceId)
  };
  if (graded && input.pitch.length > 0) {
    summary.pitchCorrectRatio = pitchCorrect / input.pitch.length;
  }
  if (input.timing.length > 0) {
    summary.onsetsWithinWindowRatio = onTime / input.timing.length;
  }
  const startedMs = Date.parse(input.startedAt);
  const result: AttemptResult = {
    id: input.id ?? `attempt-${exercise.id}-${Number.isFinite(startedMs) ? startedMs : 0}`,
    exerciseId: exercise.id,
    exerciseVersion: exercise.version,
    scoringVersion: SCORING_VERSION,
    startedAt: input.startedAt,
    mode: input.mode,
    inputSource: input.inputSource,
    assistance: input.assistance ?? (input.hintLevel && input.hintLevel > 0 ? "reduced" : "none"),
    hintLevel: input.hintLevel ?? 0,
    policy: exercise.policy,
    pitch: input.pitch,
    timing: input.timing,
    summary
  };
  if (input.completedAt !== undefined) result.completedAt = input.completedAt;
  if (input.chartId !== undefined) result.chartId = input.chartId;
  if (input.arrangementId !== undefined) result.arrangementId = input.arrangementId;
  else if (exercise.timeline.arrangementId !== undefined) result.arrangementId = exercise.timeline.arrangementId;
  if (exercise.key) result.key = exercise.key;
  if (input.tempoBpm !== undefined) result.tempoBpm = input.tempoBpm;
  if (input.latencyOffsetMs !== undefined) result.latencyOffsetMs = input.latencyOffsetMs;
  if (input.selfAssessment !== undefined) result.selfAssessment = input.selfAssessment;
  if (!input.omitNextAction) {
    result.nextAction = chooseNextAction(result, exercise);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Next action
// ---------------------------------------------------------------------------

function occurrenceById(exercise: ExerciseDefinition, id: string): PerformanceOccurrence | undefined {
  return exercise.timeline.occurrences.find((occ) => occ.occurrenceId === id);
}

/** Occurrences that have learner steps, in timeline order. */
function stepOccurrences(exercise: ExerciseDefinition): PerformanceOccurrence[] {
  const ids = exercise.steps.map((step) => step.occurrenceId);
  return exercise.timeline.occurrences.filter((occ) => ids.includes(occ.occurrenceId));
}

function nextTransferKey(exercise: ExerciseDefinition): SpelledPitchClass | undefined {
  const keys = exercise.transferKeys ?? [];
  if (keys.length === 0) {
    return undefined;
  }
  const current = exercise.key ? exercise.key.tonic : undefined;
  if (!current) {
    return keys[0];
  }
  const index = keys.findIndex((pc) => spelledEquals(pc, current));
  for (let offset = 1; offset <= keys.length; offset += 1) {
    const candidate = keys[(index + offset + keys.length) % keys.length];
    if (!spelledEquals(candidate, current)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * One actionable suggestion, in this order:
 * 1. onset ratio < 0.6 → retrySlower at tempo × 0.8;
 * 2. a change with repeated misses (≥ 2) → loopTransition over that occurrence and its neighbour;
 * 3. everything correct with hints used → reduceHints;
 * 4. everything correct without hints → transpose (next transfer key) or continue;
 * 5. otherwise reviewConcept.
 * Ungraded (listen/free) attempts → continue.
 */
export function chooseNextAction(result: AttemptResult, exercise: ExerciseDefinition): NextAction {
  if (!isGraded(result.policy)) {
    return { kind: "continue", label: "Continue to the next item" };
  }
  const timingRatio = result.summary.onsetsWithinWindowRatio;
  const baseTempo = result.tempoBpm ?? exercise.timeline.tempo.bpm;
  if (timingRatio !== undefined && timingRatio < SLOW_DOWN_BELOW) {
    const tempoBpm = Math.max(20, Math.round(baseTempo * SLOWER_TEMPO_FACTOR));
    return { kind: "retrySlower", label: `Try again slower, at ${tempoBpm} BPM`, payload: { tempoBpm } };
  }

  const difficult = difficultOccurrences(exercise, result.pitch, result.timing);
  const worst = difficult.length > 0 ? difficult[0] : undefined;
  const occurrences = stepOccurrences(exercise);
  if (worst && worst.misses >= 2 && occurrences.length >= 2) {
    const index = occurrences.findIndex((occ) => occ.occurrenceId === worst.occurrenceId);
    const target = occurrenceById(exercise, worst.occurrenceId);
    if (index >= 0 && target) {
      const from = index > 0 ? occurrences[index - 1] : target;
      const to = index > 0 ? target : occurrences[index + 1];
      const startBeat = from.startBeat;
      const endBeat = to.startBeat + to.durationBeats;
      return {
        kind: "loopTransition",
        label: `Loop the change ${from.symbol} → ${to.symbol}`,
        payload: { startBeat, endBeat, occurrenceIds: [from.occurrenceId, to.occurrenceId] }
      };
    }
  }

  const pitchRatio = result.summary.pitchCorrectRatio;
  const allPitch = pitchRatio === undefined ? result.pitch.length === 0 : pitchRatio === 1;
  const allTiming = timingRatio === undefined || timingRatio === 1;
  const allCorrect = allPitch && allTiming && (result.pitch.length > 0 || result.timing.length > 0);
  if (allCorrect && result.hintLevel > 0) {
    return { kind: "reduceHints", label: "Try it again with fewer hints", payload: { hintLevel: Math.max(0, result.hintLevel - 1) } };
  }
  if (allCorrect) {
    const key = nextTransferKey(exercise);
    if (key) {
      return { kind: "transpose", label: `Try it in ${formatPitchClass(key, { unicode: true })}`, payload: { tonic: { letter: key.letter, accidental: key.accidental } } };
    }
    return { kind: "continue", label: "Continue to the next item" };
  }
  const conceptId = exercise.conceptIds.length > 0 ? exercise.conceptIds[0] : undefined;
  const action: NextAction = { kind: "reviewConcept", label: "Review the idea behind this exercise, then try again" };
  if (conceptId) action.payload = { conceptId };
  return action;
}

// ---------------------------------------------------------------------------
// Description
// ---------------------------------------------------------------------------

export interface ResultDescription {
  pitchLine: string;
  timingLine: string;
  nextLine: string;
  caveats: string[];
}

export const CAVEAT_NOT_OBSERVED = "Fingering, hand use and technique were not observed; MIDI only reports which keys were pressed and when.";
export const CAVEAT_SELF_ASSESSMENT = "Self-assessment is your own note and is not measured or scored.";

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function describeResult(result: AttemptResult, exercise: ExerciseDefinition): ResultDescription {
  let pitchLine: string;
  if (result.policy.kind === "listen") {
    pitchLine = "Pitch was not graded: this was a listening exercise.";
  } else if (result.policy.kind === "free") {
    pitchLine = "Pitch was not graded: this was free playing.";
  } else if (result.pitch.length === 0) {
    pitchLine = "No pitch observations were recorded.";
  } else {
    const correct = result.pitch.filter((obs) => obs.correct).length;
    pitchLine = `Pitch: ${correct} of ${plural(result.pitch.length, result.mode === "timed" ? "chord" : "step")} correct.`;
    const retried = result.pitch.filter((obs) => obs.attempts > 1).length;
    if (result.mode === "step" && retried > 0) {
      pitchLine += ` ${plural(retried, "step")} needed more than one try.`;
    }
  }

  let timingLine: string;
  if (result.timing.length === 0) {
    timingLine = result.mode === "step" ? "Timing was not measured: step practice waits for you." : "Timing was not measured.";
  } else {
    const count = (verdict: TimingObservation["verdict"]): number => result.timing.filter((obs) => obs.verdict === verdict).length;
    const window = exercise.timing.onsetWindowMs ?? 120;
    const parts: string[] = [];
    if (count("early") > 0) parts.push(`${count("early")} early`);
    if (count("late") > 0) parts.push(`${count("late")} late`);
    if (count("missed") > 0) parts.push(`${count("missed")} missed`);
    timingLine = `Timing: ${count("onTime")} of ${plural(result.timing.length, "onset")} within ±${window} ms${parts.length > 0 ? ` (${parts.join(", ")})` : ""}.`;
  }

  const nextLine = result.nextAction ? result.nextAction.label : chooseNextAction(result, exercise).label;
  const caveats: string[] = [CAVEAT_NOT_OBSERVED, CAVEAT_SELF_ASSESSMENT];
  if (result.timing.length > 0) {
    if (result.inputSource === "computerKeyboard" || result.inputSource === "touch") {
      caveats.push("Computer-key and touch input add their own delay, so timing is approximate.");
    }
    caveats.push(
      result.latencyOffsetMs !== undefined && result.latencyOffsetMs !== 0
        ? `Timing includes a latency adjustment of ${result.latencyOffsetMs} ms; event arrival is not the same as key motion.`
        : "No latency calibration was applied; event arrival is not the same as key motion."
    );
  }
  return { pitchLine, timingLine, nextLine, caveats };
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export interface EvidenceContext {
  /** The key the exercise was authored in (default: from the compile registry). */
  originalKey?: KeyContext;
  /** Force transfer detection (default: compile registry `isTransfer`). */
  isTransfer?: boolean;
}

export function evidenceFromAttempt(result: AttemptResult, exercise: ExerciseDefinition, context: EvidenceContext = {}): ProgressEvidence[] {
  const at = result.completedAt ?? result.startedAt;
  const base = (kind: ProgressEvidence["kind"], conceptId?: string): ProgressEvidence => {
    const evidence: ProgressEvidence = { kind, exerciseId: exercise.id, attemptId: result.id, policy: result.policy.kind, assistance: result.assistance, at };
    if (conceptId !== undefined) evidence.conceptId = conceptId;
    if (result.chartId !== undefined) evidence.chartId = result.chartId;
    if (result.key) evidence.key = result.key;
    if (result.tempoBpm !== undefined) evidence.tempoBpm = result.tempoBpm;
    return evidence;
  };
  const concepts: (string | undefined)[] = exercise.conceptIds.length > 0 ? exercise.conceptIds : [undefined];
  const kinds: ProgressEvidence["kind"][] = [];
  if (result.policy.kind === "listen") {
    kinds.push("listened");
  } else if (result.policy.kind !== "free") {
    if (result.hintLevel > 0 || result.assistance === "full") {
      kinds.push("assisted");
    } else {
      const allPitch = result.pitch.length > 0 && result.pitch.every((obs) => obs.correct);
      if (allPitch) {
        kinds.push("independent");
        const info = compiledExerciseInfo(exercise);
        let transfer = context.isTransfer ?? (info ? info.isTransfer : false);
        if (context.isTransfer === undefined && context.originalKey && exercise.key) {
          transfer = !spelledEquals(context.originalKey.tonic, exercise.key.tonic);
        }
        if (transfer) {
          kinds.push("transfer");
        }
      }
    }
  }
  const out: ProgressEvidence[] = [];
  kinds.forEach((kind) => concepts.forEach((conceptId) => out.push(base(kind, conceptId))));
  return out;
}
