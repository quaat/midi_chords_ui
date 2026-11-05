/**
 * Pure, deterministic queries over a ProgressFile. Nothing here writes or rescores data.
 *
 * Evidence kinds stay distinct: a learner who has read about a concept, listened to it,
 * played it with assistance, played it independently, or transferred it to a new key has
 * five different kinds of evidence; there is deliberately no single "mastery" number.
 */

import type { AssistanceLevel, AttemptResult, ChordRole, KeyContext, ProgressEvidence, ProgressFile } from "@/model/contracts";
import { compareStrings, toEpochMs } from "./util";

export type EvidenceKind = ProgressEvidence["kind"];

/** Ordered from least to most demanding; used only to report the furthest kind reached. */
export const EVIDENCE_KIND_ORDER: readonly EvidenceKind[] = ["read", "listened", "assisted", "independent", "transfer"];

const DAY_MS = 24 * 60 * 60 * 1000;

export function evidenceRank(kind: EvidenceKind): number {
  return EVIDENCE_KIND_ORDER.indexOf(kind);
}

const ACCIDENTAL_TEXT: Record<number, string> = { [-2]: "bb", [-1]: "b", 0: "", 1: "#", 2: "x" };

export function keyContextId(key: KeyContext | undefined): string {
  if (key === undefined) return "any";
  return `${key.tonic.letter}${ACCIDENTAL_TEXT[key.tonic.accidental] ?? ""}:${key.mode}`;
}

export function keyContextLabel(key: KeyContext | undefined): string {
  if (key === undefined) return "any key";
  return `${key.tonic.letter}${ACCIDENTAL_TEXT[key.tonic.accidental] ?? ""} ${key.mode}`;
}

function attemptTime(attempt: AttemptResult): string {
  return attempt.completedAt ?? attempt.startedAt;
}

// ---------------------------------------------------------------------------
// Evidence by concept
// ---------------------------------------------------------------------------

export interface EvidenceKindStat {
  count: number;
  firstAt: string;
  lastAt: string;
}

export type EvidenceKindStats = Partial<Record<EvidenceKind, EvidenceKindStat>>;

export interface EvidenceCombination {
  /** `${keyId}|${tempo}|${assistance}` — stable and sortable. */
  comboId: string;
  keyId: string;
  keyLabel: string;
  key?: KeyContext;
  tempoBpm?: number;
  assistance?: AssistanceLevel;
  /** Furthest kind reached in this combination (convenience only; see `kinds`). */
  best: EvidenceKind;
  /** Every kind observed in this combination, kept separately. */
  kinds: EvidenceKindStats;
}

export interface ConceptEvidenceSummary {
  conceptId: string;
  combinations: EvidenceCombination[];
  /** Per-kind totals across all combinations (distinct kinds, never merged). */
  kinds: EvidenceKindStats;
  lastAt: string;
}

function addStat(stats: EvidenceKindStats, kind: EvidenceKind, at: string): void {
  const current = stats[kind];
  if (current === undefined) {
    stats[kind] = { count: 1, firstAt: at, lastAt: at };
    return;
  }
  current.count += 1;
  if (compareStrings(at, current.firstAt) < 0) current.firstAt = at;
  if (compareStrings(at, current.lastAt) > 0) current.lastAt = at;
}

export function evidenceByConcept(progress: ProgressFile): Record<string, ConceptEvidenceSummary> {
  const byConcept = new Map<string, { summary: ConceptEvidenceSummary; combos: Map<string, EvidenceCombination> }>();
  for (const evidence of progress.evidence) {
    if (evidence.conceptId === undefined) continue;
    let entry = byConcept.get(evidence.conceptId);
    if (entry === undefined) {
      entry = { summary: { conceptId: evidence.conceptId, combinations: [], kinds: {}, lastAt: evidence.at }, combos: new Map() };
      byConcept.set(evidence.conceptId, entry);
    }
    const keyId = keyContextId(evidence.key);
    const comboId = `${keyId}|${evidence.tempoBpm ?? "-"}|${evidence.assistance ?? "-"}`;
    let combo = entry.combos.get(comboId);
    if (combo === undefined) {
      combo = { comboId, keyId, keyLabel: keyContextLabel(evidence.key), best: evidence.kind, kinds: {} };
      if (evidence.key !== undefined) combo.key = { tonic: { ...evidence.key.tonic }, mode: evidence.key.mode };
      if (evidence.tempoBpm !== undefined) combo.tempoBpm = evidence.tempoBpm;
      if (evidence.assistance !== undefined) combo.assistance = evidence.assistance;
      entry.combos.set(comboId, combo);
    }
    if (evidenceRank(evidence.kind) > evidenceRank(combo.best)) combo.best = evidence.kind;
    addStat(combo.kinds, evidence.kind, evidence.at);
    addStat(entry.summary.kinds, evidence.kind, evidence.at);
    if (compareStrings(evidence.at, entry.summary.lastAt) > 0) entry.summary.lastAt = evidence.at;
  }
  const out: Record<string, ConceptEvidenceSummary> = {};
  for (const conceptId of Array.from(byConcept.keys()).sort()) {
    const entry = byConcept.get(conceptId);
    if (entry === undefined) continue;
    entry.summary.combinations = Array.from(entry.combos.values()).sort((a, b) => compareStrings(a.comboId, b.comboId));
    out[conceptId] = entry.summary;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Attempts
// ---------------------------------------------------------------------------

export function attemptsForExercise(progress: ProgressFile, exerciseId: string): AttemptResult[] {
  return progress.attempts
    .filter((attempt) => attempt.exerciseId === exerciseId)
    .sort((a, b) => compareStrings(a.startedAt, b.startedAt) || compareStrings(a.id, b.id));
}

/** Most recent attempt (by completion, else start time), optionally for one exercise. */
export function lastAttempt(progress: ProgressFile, exerciseId?: string): AttemptResult | undefined {
  let latest: AttemptResult | undefined;
  for (const attempt of progress.attempts) {
    if (exerciseId !== undefined && attempt.exerciseId !== exerciseId) continue;
    if (
      latest === undefined ||
      compareStrings(attemptTime(attempt), attemptTime(latest)) > 0 ||
      (attemptTime(attempt) === attemptTime(latest) && compareStrings(attempt.id, latest.id) > 0)
    ) {
      latest = attempt;
    }
  }
  return latest;
}

export interface ScoringVersionNote {
  scoringVersion: string;
  exerciseVersion: number;
  current?: string;
  /** True when the attempt was scored by a different scoring version than the current one. */
  changed: boolean;
  text: string;
}

/**
 * Describe which scoring version produced an attempt's result. Past results are always
 * shown as originally recorded; when scoring has changed since, say so instead of rescoring.
 */
export function scoringVersionNote(attempt: AttemptResult, currentScoringVersion?: string): ScoringVersionNote {
  const changed = currentScoringVersion !== undefined && currentScoringVersion !== attempt.scoringVersion;
  const text = changed
    ? `Scored with scoring version ${attempt.scoringVersion} (current: ${currentScoringVersion}); shown as originally recorded.`
    : `Scored with scoring version ${attempt.scoringVersion}.`;
  const note: ScoringVersionNote = { scoringVersion: attempt.scoringVersion, exerciseVersion: attempt.exerciseVersion, changed, text };
  if (currentScoringVersion !== undefined) note.current = currentScoringVersion;
  return note;
}

// ---------------------------------------------------------------------------
// Difficult transitions
// ---------------------------------------------------------------------------

export interface DifficultTransition {
  exerciseId: string;
  occurrenceId: string;
  /** Missing + extra notes on incorrect pitch observations (at least 1 per incorrect step). */
  pitchMisses: number;
  /** Onsets judged early, late, or missed. */
  timingMisses: number;
  /** Times the attempt summary flagged this occurrence as difficult. */
  flagged: number;
  attemptCount: number;
  missingRoles: Partial<Record<ChordRole, number>>;
  lastAt: string;
  score: number;
}

export interface DifficultTransitionOptions {
  exerciseId?: string;
  limit?: number;
}

function pitchMissCount(missingMidi: number[], extraMidi: number[]): number {
  return Math.max(1, missingMidi.length + extraMidi.length);
}

export function difficultTransitions(progress: ProgressFile, options: DifficultTransitionOptions = {}): DifficultTransition[] {
  const table = new Map<string, DifficultTransition>();
  const ensure = (exerciseId: string, occurrenceId: string, at: string): DifficultTransition => {
    const id = JSON.stringify([exerciseId, occurrenceId]);
    let entry = table.get(id);
    if (entry === undefined) {
      entry = { exerciseId, occurrenceId, pitchMisses: 0, timingMisses: 0, flagged: 0, attemptCount: 0, missingRoles: {}, lastAt: at, score: 0 };
      table.set(id, entry);
    }
    if (compareStrings(at, entry.lastAt) > 0) entry.lastAt = at;
    return entry;
  };
  for (const attempt of progress.attempts) {
    if (options.exerciseId !== undefined && attempt.exerciseId !== options.exerciseId) continue;
    const at = attemptTime(attempt);
    const touched = new Set<DifficultTransition>();
    for (const obs of attempt.pitch) {
      if (obs.correct) continue;
      const entry = ensure(attempt.exerciseId, obs.occurrenceId, at);
      entry.pitchMisses += pitchMissCount(obs.missingMidi, obs.extraMidi);
      for (const role of obs.missingRoles) entry.missingRoles[role] = (entry.missingRoles[role] ?? 0) + 1;
      touched.add(entry);
    }
    for (const obs of attempt.timing) {
      if (obs.verdict === "onTime") continue;
      const entry = ensure(attempt.exerciseId, obs.occurrenceId, at);
      entry.timingMisses += 1;
      touched.add(entry);
    }
    for (const occurrenceId of attempt.summary.difficultOccurrenceIds) {
      const entry = ensure(attempt.exerciseId, occurrenceId, at);
      entry.flagged += 1;
      touched.add(entry);
    }
    for (const entry of touched) entry.attemptCount += 1;
  }
  const rows = Array.from(table.values());
  for (const row of rows) row.score = row.pitchMisses + row.timingMisses + row.flagged;
  rows.sort(
    (a, b) =>
      b.score - a.score ||
      compareStrings(b.lastAt, a.lastAt) ||
      compareStrings(a.exerciseId, b.exerciseId) ||
      compareStrings(a.occurrenceId, b.occurrenceId)
  );
  const filtered = rows.filter((row) => row.score > 0);
  return options.limit === undefined ? filtered : filtered.slice(0, Math.max(0, options.limit));
}

// ---------------------------------------------------------------------------
// Review suggestions
// ---------------------------------------------------------------------------

/** Spaced intervals (days) after 1, 2, 3, 4+ separate days of independent/transfer evidence. */
export const REVIEW_INTERVAL_DAYS: readonly number[] = [1, 3, 7, 14];

export interface ReviewCandidate {
  exerciseId: string;
  conceptId: string;
}

export interface ReviewSuggestion {
  exerciseId: string;
  conceptId: string;
  /** review = spaced review of independent work; consolidate = only assisted/listened/read so far; new = no history. */
  kind: "review" | "consolidate" | "new";
  due: boolean;
  priority: number;
  /** Transparent, learner-facing explanation of why this is suggested. */
  reason: string;
  intervalDays?: number;
  daysSinceLast?: number;
  lastEvidenceKind?: EvidenceKind;
}

export interface SuggestReviewOptions {
  limit?: number;
  /** Also return scheduled-but-not-yet-due reviews (ranked after due ones). */
  includeNotDue?: boolean;
  /** Human label for an occurrence (e.g. its chord symbol "Dm9"); defaults to the occurrence id. */
  describeOccurrence?: (exerciseId: string, occurrenceId: string) => string | undefined;
}

const ROLE_PLURAL: Record<ChordRole, [string, string]> = {
  root: ["root", "roots"],
  third: ["third", "thirds"],
  fifth: ["fifth", "fifths"],
  sixth: ["sixth", "sixths"],
  seventh: ["seventh", "sevenths"],
  ninth: ["ninth", "ninths"],
  eleventh: ["eleventh", "elevenths"],
  thirteenth: ["thirteenth", "thirteenths"],
  suspension: ["suspension", "suspensions"],
  added: ["added tone", "added tones"]
};

const KIND_LABEL: Record<EvidenceKind, string> = {
  read: "reading",
  listened: "listening",
  assisted: "assisted practice",
  independent: "independent",
  transfer: "transfer"
};

function daysAgoText(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

interface MissSummary {
  count: number;
  text: string;
}

/** The single most-missed thing in an attempt, phrased like "2 missed sevenths in Dm9". */
function summarizeMisses(attempt: AttemptResult, describe: SuggestReviewOptions["describeOccurrence"]): MissSummary | null {
  const label = (occurrenceId: string): string => describe?.(attempt.exerciseId, occurrenceId) ?? occurrenceId;
  const perOccurrence = new Map<string, { roles: Map<ChordRole, number>; notes: number; timing: number }>();
  const get = (occurrenceId: string) => {
    let entry = perOccurrence.get(occurrenceId);
    if (entry === undefined) {
      entry = { roles: new Map(), notes: 0, timing: 0 };
      perOccurrence.set(occurrenceId, entry);
    }
    return entry;
  };
  for (const obs of attempt.pitch) {
    if (obs.correct) continue;
    const entry = get(obs.occurrenceId);
    for (const role of obs.missingRoles) entry.roles.set(role, (entry.roles.get(role) ?? 0) + 1);
    entry.notes += pitchMissCount(obs.missingMidi, obs.extraMidi);
  }
  for (const obs of attempt.timing) {
    if (obs.verdict !== "onTime") get(obs.occurrenceId).timing += 1;
  }
  let best: { occurrenceId: string; count: number; text: string } | null = null;
  for (const occurrenceId of Array.from(perOccurrence.keys()).sort()) {
    const entry = perOccurrence.get(occurrenceId);
    if (entry === undefined) continue;
    let candidate: { count: number; text: string } | null = null;
    const roles = Array.from(entry.roles.entries()).sort((a, b) => b[1] - a[1] || compareStrings(a[0], b[0]));
    const topRole = roles[0];
    if (topRole !== undefined) {
      const [singular, pluralForm] = ROLE_PLURAL[topRole[0]];
      candidate = { count: topRole[1], text: `${topRole[1]} missed ${topRole[1] === 1 ? singular : pluralForm} in ${label(occurrenceId)}` };
    } else if (entry.notes > 0) {
      candidate = { count: entry.notes, text: `${plural(entry.notes, "wrong or missing note", "wrong or missing notes")} in ${label(occurrenceId)}` };
    } else if (entry.timing > 0) {
      candidate = { count: entry.timing, text: `${plural(entry.timing, "mistimed onset", "mistimed onsets")} in ${label(occurrenceId)}` };
    }
    if (candidate !== null && (best === null || candidate.count > best.count)) best = { occurrenceId, ...candidate };
  }
  return best === null ? null : { count: best.count, text: best.text };
}

function attemptHadMisses(attempt: AttemptResult): boolean {
  return attempt.pitch.some((obs) => !obs.correct) || attempt.summary.difficultOccurrenceIds.length > 0;
}

function utcDay(iso: string): string {
  return iso.slice(0, 10);
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Rank review suggestions for the given candidates with a simple, explainable heuristic:
 * after 1, 2, 3, 4+ separate days of independent/transfer evidence the next review is due
 * after 1, 3, 7, 14 days; a later attempt with misses resets the interval to 1 day.
 * Candidates without independent evidence are suggested for consolidation, then new ones.
 * Ordering is deterministic (priority, then exerciseId, then conceptId).
 */
export function suggestReview(
  progress: ProgressFile,
  now: Date | string | number,
  candidates: ReviewCandidate[],
  options: SuggestReviewOptions = {}
): ReviewSuggestion[] {
  const nowMs = toEpochMs(now);
  const seen = new Set<string>();
  const suggestions: ReviewSuggestion[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.exerciseId)) continue;
    seen.add(candidate.exerciseId);
    const relevant = progress.evidence.filter(
      (evidence) =>
        evidence.exerciseId === candidate.exerciseId || (evidence.exerciseId === undefined && evidence.conceptId === candidate.conceptId)
    );
    const strong = relevant.filter((evidence) => evidence.kind === "independent" || evidence.kind === "transfer");
    const latestAttempt = lastAttempt(progress, candidate.exerciseId);
    const misses = latestAttempt === undefined ? null : summarizeMisses(latestAttempt, options.describeOccurrence);
    const missBonus = misses === null ? 0 : Math.min(misses.count, 10) * 0.1;

    if (strong.length > 0) {
      let lastStrong = strong[0];
      for (const evidence of strong) {
        if (compareStrings(evidence.at, lastStrong.at) > 0 || (evidence.at === lastStrong.at && evidence.kind === "transfer")) lastStrong = evidence;
      }
      const successDays = new Set(strong.map((evidence) => utcDay(evidence.at))).size;
      let intervalDays = REVIEW_INTERVAL_DAYS[Math.min(successDays, REVIEW_INTERVAL_DAYS.length) - 1];
      let lapsed = false;
      if (latestAttempt !== undefined && compareStrings(attemptTime(latestAttempt), lastStrong.at) > 0 && attemptHadMisses(latestAttempt)) {
        intervalDays = REVIEW_INTERVAL_DAYS[0];
        lapsed = true;
      }
      const daysSince = Math.max(0, Math.floor((nowMs - Date.parse(lastStrong.at)) / DAY_MS));
      const due = daysSince >= intervalDays;
      if (!due && options.includeNotDue !== true) continue;
      const parts = [`Last ${KIND_LABEL[lastStrong.kind]} attempt ${daysAgoText(daysSince)}`];
      if (misses !== null) parts.push(misses.text);
      let reason = parts.join(", ");
      if (lapsed) reason += "; a later attempt had misses, so the review interval restarted at 1 day";
      else reason += due ? ` (review interval ${plural(intervalDays, "day", "days")})` : ` (next review in ${plural(intervalDays - daysSince, "day", "days")})`;
      suggestions.push({
        exerciseId: candidate.exerciseId,
        conceptId: candidate.conceptId,
        kind: "review",
        due,
        priority: round((due ? 1 : 0) + daysSince / intervalDays + missBonus),
        reason,
        intervalDays,
        daysSinceLast: daysSince,
        lastEvidenceKind: lastStrong.kind
      });
      continue;
    }

    if (relevant.length > 0 || latestAttempt !== undefined) {
      let lastKind: EvidenceKind | undefined;
      let lastAt: string | undefined;
      for (const evidence of relevant) {
        if (lastKind === undefined || evidenceRank(evidence.kind) > evidenceRank(lastKind)) lastKind = evidence.kind;
        if (lastAt === undefined || compareStrings(evidence.at, lastAt) > 0) lastAt = evidence.at;
      }
      if (latestAttempt !== undefined && (lastAt === undefined || compareStrings(attemptTime(latestAttempt), lastAt) > 0)) {
        lastAt = attemptTime(latestAttempt);
      }
      const daysSince = lastAt === undefined ? 0 : Math.max(0, Math.floor((nowMs - Date.parse(lastAt)) / DAY_MS));
      const how = lastKind === undefined ? "Practised" : `Practised with ${KIND_LABEL[lastKind]}`;
      const parts = [`${how} ${daysAgoText(daysSince)} but not yet played independently`];
      if (misses !== null) parts.push(misses.text);
      const suggestion: ReviewSuggestion = {
        exerciseId: candidate.exerciseId,
        conceptId: candidate.conceptId,
        kind: "consolidate",
        due: true,
        priority: round(1.5 + missBonus),
        reason: parts.join(", "),
        daysSinceLast: daysSince
      };
      if (lastKind !== undefined) suggestion.lastEvidenceKind = lastKind;
      suggestions.push(suggestion);
      continue;
    }

    suggestions.push({
      exerciseId: candidate.exerciseId,
      conceptId: candidate.conceptId,
      kind: "new",
      due: true,
      priority: 0.5,
      reason: "Not practised yet"
    });
  }
  suggestions.sort(
    (a, b) =>
      Number(b.due) - Number(a.due) ||
      b.priority - a.priority ||
      compareStrings(a.exerciseId, b.exerciseId) ||
      compareStrings(a.conceptId, b.conceptId)
  );
  return options.limit === undefined ? suggestions : suggestions.slice(0, Math.max(0, options.limit));
}
