/**
 * Review panel view model (plan E15): per-step rows with missing/extra note NAMES and the hint
 * level used, and difficult transitions as "A → B". Pure.
 */
import type { AttemptResult, ExerciseDefinition, PerformanceOccurrence } from "@/model/contracts";
import { baseOccurrenceId } from "@/practice/feedback";
import { noteLabel, roleName } from "@/practice/text";

export interface ReviewStepRow {
  key: string;
  label: string;
  correct: boolean;
  attempts: number;
  hintLevelUsed: number;
  missing: string[];
  extra: string[];
  missingRoles: string[];
}

function occurrenceMap(exercise: ExerciseDefinition): Map<string, PerformanceOccurrence> {
  return new Map(exercise.timeline.occurrences.map((occurrence) => [occurrence.occurrenceId, occurrence]));
}

function passSuffix(occurrenceId: string, base: string): string {
  if (occurrenceId === base) {
    return "";
  }
  const pass = Number(occurrenceId.slice(base.length + 1));
  return Number.isFinite(pass) ? ` (pass ${pass + 1})` : "";
}

export function reviewStepRows(result: AttemptResult, exercise: ExerciseDefinition): ReviewStepRow[] {
  const occurrences = occurrenceMap(exercise);
  return result.pitch.map((observation, index) => {
    const base = baseOccurrenceId(observation.occurrenceId);
    const occurrence = occurrences.get(base);
    const chord = occurrence ? occurrence.chord : undefined;
    return {
      key: `${observation.stepId}|${observation.occurrenceId}|${index}`,
      label: `${occurrence ? occurrence.symbol : observation.stepId}${passSuffix(observation.occurrenceId, base)}`,
      correct: observation.correct,
      attempts: observation.attempts,
      hintLevelUsed: observation.hintLevelUsed,
      missing: observation.missingMidi.map((midi) => noteLabel(midi, chord)),
      extra: observation.extraMidi.map((midi) => noteLabel(midi, chord)),
      missingRoles: observation.missingRoles.map((role) => roleName(role))
    };
  });
}

/** "Dm7 → G7" for a difficult occurrence (the change INTO it), or its symbol alone when first. */
export function transitionLabel(exercise: ExerciseDefinition, occurrenceId: string): string {
  const base = baseOccurrenceId(occurrenceId);
  const ordered = [...exercise.timeline.occurrences].sort((a, b) => a.startBeat - b.startBeat);
  const withSteps = new Set(exercise.steps.map((step) => step.occurrenceId));
  const playable = ordered.filter((occurrence) => withSteps.has(occurrence.occurrenceId));
  const list = playable.length > 0 ? playable : ordered;
  const index = list.findIndex((occurrence) => occurrence.occurrenceId === base);
  if (index < 0) {
    return base;
  }
  if (index === 0) {
    return list[0].symbol;
  }
  return `${list[index - 1].symbol} → ${list[index].symbol}`;
}

export function difficultTransitionLabels(result: AttemptResult, exercise: ExerciseDefinition, limit: number = 3): string[] {
  const labels: string[] = [];
  result.summary.difficultOccurrenceIds.forEach((id) => {
    const label = transitionLabel(exercise, id);
    if (!labels.includes(label) && labels.length < limit) {
      labels.push(label);
    }
  });
  return labels;
}
