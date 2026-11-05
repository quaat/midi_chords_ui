/**
 * Local progress model (E19): attempts, evidence, routine state and goals in ONE versioned
 * document under "pls:progress".
 *
 * - Attempts keep their exerciseVersion/scoringVersion exactly as recorded; nothing here
 *   rescores or rewrites history.
 * - Evidence kinds (read/listened/assisted/independent/transfer) are stored as-is and are
 *   never collapsed into a single mastery value.
 * - A stored file that is damaged or newer than this app is never overwritten implicitly:
 *   mutations fail until the learner exports the raw data (`readRaw()`) and/or calls
 *   `reset()` or `importJson(..., "replace")`.
 */

import type { AttemptResult, ProgressEvidence, ProgressFile } from "@/model/contracts";
import { PROGRESS_SCHEMA_VERSION } from "@/model/contracts";
import { isStringArray, validateAttemptShape, validateEvidenceShape, validateProgressEnvelope, validateRoutineStateShape } from "./guards";
import { parseJson, stableStringify } from "./json";
import { migrate, PROGRESS_MIGRATIONS, type MigrationContext } from "./migrations";
import { fail, ok, type Result } from "./result";
import { readKey, removeKey, writeKey, type StorageAdapter } from "./storage";
import { cloneJson, compareStrings, resolveStoreOptions, type ResolvedStoreOptions, type StoreOptions } from "./util";

export const PROGRESS_KEY = "pls:progress";
export const DEFAULT_MAX_ATTEMPTS = 2000;
export const DEFAULT_MAX_EVIDENCE = 5000;

export type RoutineProgressState = ProgressFile["routineState"][string];

export interface RoutineStateInput {
  itemIndex: number;
  completedItemIds: string[];
  updatedAt?: string;
}

export type ProgressImportMode = "replace" | "merge";

export interface ProgressLimits {
  maxAttempts: number;
  maxEvidence: number;
}

export interface ProgressStoreOptions extends StoreOptions {
  maxAttempts?: number;
  maxEvidence?: number;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function createEmptyProgress(nowIso: string): ProgressFile {
  return {
    schemaVersion: PROGRESS_SCHEMA_VERSION,
    kind: "progress",
    attempts: [],
    evidence: [],
    routineState: {},
    goals: [],
    updatedAt: nowIso
  };
}

/** Identity used to dedupe evidence on merge: every recorded field, in a fixed order. */
export function evidenceIdentity(evidence: ProgressEvidence): string {
  const key = evidence.key === undefined ? "" : `${evidence.key.tonic.letter}${evidence.key.tonic.accidental}:${evidence.key.mode}`;
  return JSON.stringify([
    evidence.kind,
    evidence.conceptId ?? "",
    evidence.exerciseId ?? "",
    evidence.chartId ?? "",
    evidence.routineId ?? "",
    evidence.attemptId ?? "",
    key,
    evidence.tempoBpm ?? "",
    evidence.hand ?? "",
    evidence.policy ?? "",
    evidence.assistance ?? "",
    evidence.at
  ]);
}

function compareAttempts(a: AttemptResult, b: AttemptResult): number {
  return compareStrings(a.startedAt, b.startedAt) || compareStrings(a.id, b.id);
}

function compareEvidence(a: ProgressEvidence, b: ProgressEvidence): number {
  return compareStrings(a.at, b.at) || compareStrings(evidenceIdentity(a), evidenceIdentity(b));
}

function normalizeGoals(goals: string[]): string[] {
  const out: string[] = [];
  for (const goal of goals) {
    const trimmed = goal.trim();
    if (trimmed !== "" && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

/**
 * Dedupe (attempts by id — later entries win; evidence by identity), sort oldest-first,
 * and trim the oldest entries beyond the limits. Returns warnings describing any trim.
 */
export function normalizeProgress(progress: ProgressFile, limits: ProgressLimits): { progress: ProgressFile; warnings: string[] } {
  const warnings: string[] = [];
  const attemptsById = new Map<string, AttemptResult>();
  for (const attempt of progress.attempts) attemptsById.set(attempt.id, attempt);
  let attempts = Array.from(attemptsById.values()).sort(compareAttempts);
  if (attempts.length > limits.maxAttempts) {
    const dropped = attempts.length - limits.maxAttempts;
    attempts = attempts.slice(dropped);
    warnings.push(`Removed the ${dropped} oldest attempt${dropped === 1 ? "" : "s"} to stay within ${limits.maxAttempts} saved attempts.`);
  }
  const evidenceById = new Map<string, ProgressEvidence>();
  for (const evidence of progress.evidence) evidenceById.set(evidenceIdentity(evidence), evidence);
  let evidence = Array.from(evidenceById.values()).sort(compareEvidence);
  if (evidence.length > limits.maxEvidence) {
    const dropped = evidence.length - limits.maxEvidence;
    evidence = evidence.slice(dropped);
    warnings.push(`Removed the ${dropped} oldest evidence entr${dropped === 1 ? "y" : "ies"} to stay within ${limits.maxEvidence}.`);
  }
  return {
    progress: {
      ...progress,
      schemaVersion: PROGRESS_SCHEMA_VERSION,
      kind: "progress",
      attempts,
      evidence,
      goals: normalizeGoals(progress.goals)
    },
    warnings
  };
}

/**
 * Union of two progress files. Existing attempts win over incoming ones with the same id
 * (merging never rewrites recorded history); evidence is unioned by identity; routine state
 * keeps the more recently updated entry; goals are unioned in order.
 */
export function mergeProgress(existing: ProgressFile, incoming: ProgressFile, limits: ProgressLimits, nowIso: string): { progress: ProgressFile; warnings: string[] } {
  const known = new Set(existing.attempts.map((attempt) => attempt.id));
  const attempts = [...existing.attempts, ...incoming.attempts.filter((attempt) => !known.has(attempt.id))];
  const routineState: ProgressFile["routineState"] = { ...cloneJson(existing.routineState) };
  for (const [routineId, state] of Object.entries(incoming.routineState)) {
    const current = routineState[routineId];
    if (current === undefined || compareStrings(state.updatedAt, current.updatedAt) > 0) routineState[routineId] = cloneJson(state);
  }
  return normalizeProgress(
    {
      schemaVersion: PROGRESS_SCHEMA_VERSION,
      kind: "progress",
      attempts,
      evidence: [...existing.evidence, ...incoming.evidence],
      routineState,
      goals: [...existing.goals, ...incoming.goals],
      updatedAt: nowIso
    },
    limits
  );
}

/**
 * Migrate + validate a parsed progress document. Damaged individual attempts/evidence/
 * routine entries are dropped with a warning rather than discarding the whole history.
 */
export function progressFromUnknown(raw: unknown, limits: ProgressLimits, context?: Partial<MigrationContext>): Result<ProgressFile> {
  const migrated = migrate<Record<string, unknown>>(raw, PROGRESS_MIGRATIONS, PROGRESS_SCHEMA_VERSION, {
    label: "progress file",
    validate: validateProgressEnvelope,
    context
  });
  if (!migrated.ok) return migrated;
  const doc = migrated.value;
  const warnings = [...migrated.warnings];
  const attempts: AttemptResult[] = [];
  (doc.attempts as unknown[]).forEach((attempt, index) => {
    const issues = validateAttemptShape(attempt, `attempts[${index}]`);
    if (issues.length === 0) attempts.push(attempt as AttemptResult);
    else warnings.push(`Skipped a damaged attempt (${issues[0]}).`);
  });
  const evidence: ProgressEvidence[] = [];
  (doc.evidence as unknown[]).forEach((entry, index) => {
    const issues = validateEvidenceShape(entry, `evidence[${index}]`);
    if (issues.length === 0) evidence.push(entry as ProgressEvidence);
    else warnings.push(`Skipped a damaged evidence entry (${issues[0]}).`);
  });
  const routineState: ProgressFile["routineState"] = {};
  const rawRoutine = doc.routineState as Record<string, unknown>;
  for (const routineId of Object.keys(rawRoutine).sort()) {
    const state = rawRoutine[routineId];
    const issues = validateRoutineStateShape(state, `routineState.${routineId}`);
    if (issues.length === 0) routineState[routineId] = state as RoutineProgressState;
    else warnings.push(`Skipped damaged routine state for "${routineId}".`);
  }
  const normalized = normalizeProgress(
    {
      schemaVersion: PROGRESS_SCHEMA_VERSION,
      kind: "progress",
      attempts,
      evidence,
      routineState,
      goals: isStringArray(doc.goals) ? doc.goals : [],
      updatedAt: doc.updatedAt as string
    },
    limits
  );
  return ok(normalized.progress, [...warnings, ...normalized.warnings]);
}

export function parseProgressJson(text: string, limits: ProgressLimits, context?: Partial<MigrationContext>): Result<ProgressFile> {
  const parsed = parseJson(text, "progress file");
  if (!parsed.ok) return parsed;
  return progressFromUnknown(parsed.value, limits, context);
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class ProgressStore {
  private readonly adapter: StorageAdapter;
  private readonly options: ResolvedStoreOptions;
  readonly limits: ProgressLimits;

  constructor(adapter: StorageAdapter, options: ProgressStoreOptions = {}) {
    this.adapter = adapter;
    this.options = resolveStoreOptions(options);
    this.limits = {
      maxAttempts: Math.max(1, Math.floor(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)),
      maxEvidence: Math.max(1, Math.floor(options.maxEvidence ?? DEFAULT_MAX_EVIDENCE))
    };
  }

  private nowIso(): string {
    return this.options.now().toISOString();
  }

  /**
   * The saved progress, or a new empty v1 file when none exists yet (the empty file is not
   * written until the first change). Damaged/newer files fail without being touched.
   */
  load(): Result<ProgressFile> {
    const raw = readKey(this.adapter, PROGRESS_KEY);
    if (!raw.ok) return raw;
    if (raw.value === null) return ok(createEmptyProgress(this.nowIso()));
    return parseProgressJson(raw.value, this.limits, { now: this.nowIso(), newId: this.options.newId });
  }

  /** The stored text exactly as saved (for recovery when it cannot be loaded). */
  readRaw(): string | null {
    const raw = readKey(this.adapter, PROGRESS_KEY);
    return raw.ok ? raw.value : null;
  }

  private write(progress: ProgressFile, warnings: string[]): Result<ProgressFile> {
    const written = writeKey(this.adapter, PROGRESS_KEY, JSON.stringify(progress));
    if (!written.ok) return written;
    return ok(cloneJson(progress), warnings);
  }

  private update(mutate: (progress: ProgressFile) => Result<ProgressFile>): Result<ProgressFile> {
    const loaded = this.load();
    if (!loaded.ok) return loaded;
    const mutated = mutate(cloneJson(loaded.value));
    if (!mutated.ok) return mutated;
    const normalized = normalizeProgress({ ...mutated.value, updatedAt: this.nowIso() }, this.limits);
    return this.write(normalized.progress, [...loaded.warnings, ...mutated.warnings, ...normalized.warnings]);
  }

  /**
   * Append an attempt (an attempt with the same id replaces the earlier record, e.g. when an
   * in-progress attempt completes). Optional evidence is written in the same update.
   * The oldest attempts beyond the cap are trimmed.
   */
  recordAttempt(attempt: AttemptResult, evidence: ProgressEvidence[] = []): Result<ProgressFile> {
    const issues = validateAttemptShape(attempt);
    if (issues.length > 0) return fail("invalid", "The attempt is incomplete and was not recorded.", { details: issues });
    const evidenceIssues = evidence.flatMap((entry, index) => validateEvidenceShape(entry, `evidence[${index}]`));
    if (evidenceIssues.length > 0) return fail("invalid", "The evidence is incomplete and was not recorded.", { details: evidenceIssues });
    return this.update((progress) => {
      const copy = cloneJson(attempt);
      const existingIndex = progress.attempts.findIndex((entry) => entry.id === copy.id);
      if (existingIndex >= 0) progress.attempts[existingIndex] = copy;
      else progress.attempts.push(copy);
      progress.evidence.push(...cloneJson(evidence));
      return ok(progress);
    });
  }

  recordEvidence(evidence: ProgressEvidence | ProgressEvidence[]): Result<ProgressFile> {
    const entries = Array.isArray(evidence) ? evidence : [evidence];
    const issues = entries.flatMap((entry, index) => validateEvidenceShape(entry, `evidence[${index}]`));
    if (issues.length > 0) return fail("invalid", "The evidence is incomplete and was not recorded.", { details: issues });
    return this.update((progress) => {
      progress.evidence.push(...cloneJson(entries));
      return ok(progress);
    });
  }

  setRoutineState(routineId: string, state: RoutineStateInput): Result<ProgressFile> {
    if (routineId.trim() === "") return fail("invalid", "A routine id is required.");
    const next: RoutineProgressState = {
      itemIndex: state.itemIndex,
      completedItemIds: state.completedItemIds.slice(),
      updatedAt: state.updatedAt ?? this.nowIso()
    };
    const issues = validateRoutineStateShape(next, `routineState.${routineId}`);
    if (issues.length > 0) return fail("invalid", "The routine state is invalid and was not saved.", { details: issues });
    return this.update((progress) => {
      progress.routineState[routineId] = next;
      return ok(progress);
    });
  }

  /** Undefined when the routine has no saved state or progress cannot be read. */
  getRoutineState(routineId: string): RoutineProgressState | undefined {
    const loaded = this.load();
    if (!loaded.ok) return undefined;
    const state = loaded.value.routineState[routineId];
    return state === undefined ? undefined : cloneJson(state);
  }

  clearRoutineState(routineId: string): Result<ProgressFile> {
    return this.update((progress) => {
      delete progress.routineState[routineId];
      return ok(progress);
    });
  }

  /** Replace the learner-selected goals (trimmed, deduplicated, order kept). */
  setGoals(goals: string[]): Result<ProgressFile> {
    if (!isStringArray(goals)) return fail("invalid", "Goals must be a list of text entries.");
    return this.update((progress) => {
      progress.goals = normalizeGoals(goals);
      return ok(progress);
    });
  }

  exportJson(): Result<string> {
    const loaded = this.load();
    if (!loaded.ok) return loaded;
    return ok(stableStringify(loaded.value), loaded.warnings);
  }

  /** Import a progress export. "replace" is also the recovery path for damaged local data. */
  importJson(text: string, mode: ProgressImportMode): Result<ProgressFile> {
    const parsed = parseJson(text, "progress file");
    if (!parsed.ok) return parsed;
    return this.importDocument(parsed.value, mode);
  }

  importDocument(raw: unknown, mode: ProgressImportMode): Result<ProgressFile> {
    const incoming = progressFromUnknown(raw, this.limits, { now: this.nowIso(), newId: this.options.newId });
    if (!incoming.ok) return incoming;
    if (mode === "replace") {
      const normalized = normalizeProgress({ ...incoming.value, updatedAt: this.nowIso() }, this.limits);
      return this.write(normalized.progress, [...incoming.warnings, ...normalized.warnings]);
    }
    const current = this.load();
    if (!current.ok) return current;
    const merged = mergeProgress(current.value, incoming.value, this.limits, this.nowIso());
    return this.write(merged.progress, [...incoming.warnings, ...current.warnings, ...merged.warnings]);
  }

  /** Delete all local progress. Export first if it should be kept. */
  reset(): Result<ProgressFile> {
    const removed = removeKey(this.adapter, PROGRESS_KEY);
    if (!removed.ok) return removed;
    return ok(createEmptyProgress(this.nowIso()));
  }
}

export function createProgressStore(adapter: StorageAdapter, options: ProgressStoreOptions = {}): ProgressStore {
  return new ProgressStore(adapter, options);
}

