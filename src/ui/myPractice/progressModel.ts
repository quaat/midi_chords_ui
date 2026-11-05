/**
 * My Practice view models (plan E19/E31). Pure builders over a ProgressFile:
 * - evidence rows keep read / listened / assisted / independent / transfer as five separate
 *   counts (never one mastery number), with key/tempo/assistance combinations as sub-rows;
 * - review suggestions carry their transparent reason;
 * - difficult transitions are described with chord symbols when a describer is supplied;
 * - "continue" turns the last attempt's next action into something the UI can open.
 */
import type { AttemptResult, ExerciseDefinition, NextAction, ProgressFile, SpelledPitchClass } from "@/model/contracts";
import type { ExerciseSpec } from "@/content/authoring";
import { isPublishedStatus } from "@/content/validate";
import type { EvidenceKind, ReviewCandidate } from "@/persistence/progressQueries";
import { difficultTransitions, evidenceByConcept, lastAttempt, scoringVersionNote, suggestReview } from "@/persistence/progressQueries";
import { transitionLabel } from "@/ui/practice/reviewModel";

export const EVIDENCE_COLUMNS: { kind: EvidenceKind; label: string; description: string }[] = [
  { kind: "read", label: "Read", description: "Read the concept page" },
  { kind: "listened", label: "Listened", description: "Listened to the example (not scored)" },
  { kind: "assisted", label: "Assisted", description: "Played correctly with hints or full visual help" },
  { kind: "independent", label: "Independent", description: "Played correctly without hints" },
  { kind: "transfer", label: "Transfer", description: "Played correctly in another key without hints" }
];

const ASSISTANCE_LABELS: Readonly<Record<"full" | "reduced" | "none", string>> = {
  full: "full hints",
  reduced: "reduced hints",
  none: "no hints"
};

export type EvidenceCounts = Record<EvidenceKind, number>;

function emptyCounts(): EvidenceCounts {
  return { read: 0, listened: 0, assisted: 0, independent: 0, transfer: 0 };
}

export interface EvidenceComboRow {
  comboId: string;
  label: string;
  counts: EvidenceCounts;
}

export interface EvidenceRow {
  conceptId: string;
  title: string;
  counts: EvidenceCounts;
  lastAt: string;
  combos: EvidenceComboRow[];
}

export function evidenceRows(progress: ProgressFile, conceptTitle: (conceptId: string) => string): EvidenceRow[] {
  const summaries = evidenceByConcept(progress);
  const rows: EvidenceRow[] = Object.keys(summaries).map((conceptId) => {
    const summary = summaries[conceptId];
    const counts = emptyCounts();
    EVIDENCE_COLUMNS.forEach((column) => {
      const stat = summary.kinds[column.kind];
      counts[column.kind] = stat ? stat.count : 0;
    });
    const combos: EvidenceComboRow[] = summary.combinations.map((combo) => {
      const comboCounts = emptyCounts();
      EVIDENCE_COLUMNS.forEach((column) => {
        const stat = combo.kinds[column.kind];
        comboCounts[column.kind] = stat ? stat.count : 0;
      });
      const parts: string[] = [];
      parts.push(combo.keyId === "any" ? "any key" : combo.keyLabel);
      if (combo.tempoBpm !== undefined) parts.push(`${Math.round(combo.tempoBpm)} BPM`);
      if (combo.assistance !== undefined) parts.push(ASSISTANCE_LABELS[combo.assistance]);
      return { comboId: combo.comboId, label: parts.join(" · "), counts: comboCounts };
    });
    return { conceptId, title: conceptTitle(conceptId), counts, lastAt: summary.lastAt, combos };
  });
  return rows.sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : a.title.localeCompare(b.title)));
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

/** Every published exercise spec with its first concept. */
export function reviewCandidates(specs: readonly ExerciseSpec[]): ReviewCandidate[] {
  return specs
    .filter((spec) => isPublishedStatus(spec.status) && spec.conceptIds.length > 0)
    .map((spec) => ({ exerciseId: spec.id, conceptId: spec.conceptIds[0] }));
}

export interface SuggestionRow {
  exerciseId: string;
  title: string;
  conceptId: string;
  conceptTitle: string;
  reason: string;
  kind: "review" | "consolidate" | "new";
  due: boolean;
}

export interface SuggestionOptions {
  limit?: number;
  describeOccurrence?: (exerciseId: string, occurrenceId: string) => string | undefined;
}

export function suggestionRows(
  progress: ProgressFile,
  now: Date | string | number,
  specs: readonly ExerciseSpec[],
  conceptTitle: (conceptId: string) => string,
  options: SuggestionOptions = {}
): SuggestionRow[] {
  const titles = new Map(specs.map((spec) => [spec.id, spec.title]));
  const suggestions = suggestReview(progress, now, reviewCandidates(specs), {
    limit: options.limit ?? 5,
    describeOccurrence: options.describeOccurrence
  });
  return suggestions.map((suggestion) => ({
    exerciseId: suggestion.exerciseId,
    title: titles.get(suggestion.exerciseId) ?? suggestion.exerciseId,
    conceptId: suggestion.conceptId,
    conceptTitle: conceptTitle(suggestion.conceptId),
    reason: suggestion.reason,
    kind: suggestion.kind,
    due: suggestion.due
  }));
}

// ---------------------------------------------------------------------------
// Difficult transitions
// ---------------------------------------------------------------------------

export interface TransitionRow {
  key: string;
  exerciseId: string;
  exerciseTitle: string;
  label: string;
  pitchMisses: number;
  timingMisses: number;
  attempts: number;
  missingRoles: string;
}

export function transitionRows(
  progress: ProgressFile,
  exerciseTitle: (exerciseId: string) => string,
  describe: (exerciseId: string, occurrenceId: string) => string | undefined,
  limit: number = 6
): TransitionRow[] {
  return difficultTransitions(progress, { limit }).map((entry) => {
    const roles = Object.keys(entry.missingRoles)
      .map((role) => `${role} ×${entry.missingRoles[role as keyof typeof entry.missingRoles] ?? 0}`)
      .join(", ");
    return {
      key: `${entry.exerciseId}|${entry.occurrenceId}`,
      exerciseId: entry.exerciseId,
      exerciseTitle: exerciseTitle(entry.exerciseId),
      label: describe(entry.exerciseId, entry.occurrenceId) ?? entry.occurrenceId,
      pitchMisses: entry.pitchMisses,
      timingMisses: entry.timingMisses,
      attempts: entry.attemptCount,
      missingRoles: roles
    };
  });
}

/** Describer over compiled exercises ("Dm7 → G7"), with a small cache. */
export function occurrenceDescriber(compile: (exerciseId: string) => ExerciseDefinition | null): (exerciseId: string, occurrenceId: string) => string | undefined {
  const cache = new Map<string, ExerciseDefinition | null>();
  return (exerciseId, occurrenceId) => {
    let exercise = cache.get(exerciseId);
    if (exercise === undefined) {
      try {
        exercise = compile(exerciseId);
      } catch {
        exercise = null;
      }
      cache.set(exerciseId, exercise);
    }
    if (!exercise) {
      return undefined;
    }
    return transitionLabel(exercise, occurrenceId);
  };
}

// ---------------------------------------------------------------------------
// Continue
// ---------------------------------------------------------------------------

export type ContinueTarget =
  | {
      kind: "exercise";
      exerciseId: string;
      mode?: "step" | "timed";
      tempoBpm?: number;
      transposeTo?: SpelledPitchClass;
      assistance?: "reduced" | "none";
      loopRegion?: { startBeat: number; endBeat: number; occurrenceIds: string[] };
    }
  | { kind: "chart"; chartId: string; arrangementId: string }
  | { kind: "concept"; conceptId: string };

export interface ContinueModel {
  attempt: AttemptResult;
  title: string;
  label: string;
  target: ContinueTarget | null;
}

function payloadNumber(action: NextAction, key: string): number | undefined {
  const value = action.payload ? action.payload[key] : undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** What "Continue" opens for an attempt (its recorded next action, applied to the same exercise). */
export function continueTarget(attempt: AttemptResult): ContinueTarget | null {
  if (attempt.exerciseId.startsWith("chart:")) {
    const [, chartId, arrangementId] = attempt.exerciseId.split(":");
    return chartId && arrangementId ? { kind: "chart", chartId, arrangementId } : null;
  }
  if (attempt.exerciseId.includes(":")) {
    // Explore payloads, scale runs and material snapshots cannot be reopened from history.
    return null;
  }
  const action = attempt.nextAction;
  const base: ContinueTarget = { kind: "exercise", exerciseId: attempt.exerciseId };
  if (!action) {
    return base;
  }
  switch (action.kind) {
    case "retrySlower": {
      const tempo = payloadNumber(action, "tempoBpm");
      return tempo !== undefined ? { ...base, mode: "timed", tempoBpm: tempo } : { ...base, mode: "timed" };
    }
    case "loopTransition": {
      const startBeat = payloadNumber(action, "startBeat");
      const endBeat = payloadNumber(action, "endBeat");
      const raw = action.payload ? action.payload["occurrenceIds"] : undefined;
      const occurrenceIds = Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
      if (startBeat === undefined || endBeat === undefined) return base;
      return { ...base, mode: attempt.mode === "timed" ? "timed" : "step", loopRegion: { startBeat, endBeat, occurrenceIds } };
    }
    case "reduceHints":
      return { ...base, assistance: attempt.assistance === "reduced" || attempt.assistance === "none" ? "none" : "reduced" };
    case "transpose": {
      const tonic = action.payload ? action.payload["tonic"] : undefined;
      if (tonic && typeof tonic === "object" && typeof (tonic as SpelledPitchClass).letter === "string" && typeof (tonic as SpelledPitchClass).accidental === "number") {
        return { ...base, transposeTo: { letter: (tonic as SpelledPitchClass).letter, accidental: (tonic as SpelledPitchClass).accidental } };
      }
      return base;
    }
    case "reviewConcept": {
      const conceptId = action.payload ? action.payload["conceptId"] : undefined;
      return typeof conceptId === "string" ? { kind: "concept", conceptId } : base;
    }
    default:
      return base;
  }
}

export function continueModel(progress: ProgressFile, exerciseTitle: (exerciseId: string) => string): ContinueModel | null {
  const attempt = lastAttempt(progress);
  if (!attempt) {
    return null;
  }
  return {
    attempt,
    title: exerciseTitle(attempt.exerciseId),
    label: attempt.nextAction ? attempt.nextAction.label : "Practise it again",
    target: continueTarget(attempt)
  };
}

// ---------------------------------------------------------------------------
// Scoring version
// ---------------------------------------------------------------------------

/** A note when some attempts were scored by another scoring version (never silently rescored). */
export function scoringVersionSummary(progress: ProgressFile, currentScoringVersion: string): string | null {
  const older = progress.attempts.filter((attempt) => attempt.scoringVersion !== currentScoringVersion);
  if (older.length === 0) {
    return null;
  }
  const versions = Array.from(new Set(older.map((attempt) => attempt.scoringVersion)));
  const example = scoringVersionNote(older[older.length - 1], currentScoringVersion);
  return `${older.length} attempt${older.length === 1 ? " was" : "s were"} scored with an earlier scoring version (${versions.join(", ")}); they are shown as originally recorded. ${example.text}`;
}
