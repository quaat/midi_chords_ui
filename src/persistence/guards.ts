/**
 * Small hand-written structural guards (no schema library). Validators return a list of
 * human-readable issues; an empty list means the shape is acceptable. They check the
 * structure persistence relies on, not musical correctness.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Shared fragments
// ---------------------------------------------------------------------------

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"] as const;
const ACCIDENTALS = [-2, -1, 0, 1, 2];

export function validateSpelledPitchClassShape(value: unknown, path: string): string[] {
  if (!isRecord(value)) return [`${path} must be an object`];
  const issues: string[] = [];
  if (!isOneOf(value.letter, LETTERS)) issues.push(`${path}.letter must be one of ${LETTERS.join(", ")}`);
  if (typeof value.accidental !== "number" || !ACCIDENTALS.includes(value.accidental)) {
    issues.push(`${path}.accidental must be -2, -1, 0, 1 or 2`);
  }
  return issues;
}

export function validateKeyContextShape(value: unknown, path: string): string[] {
  if (!isRecord(value)) return [`${path} must be an object`];
  const issues = validateSpelledPitchClassShape(value.tonic, `${path}.tonic`);
  if (!isNonEmptyString(value.mode)) issues.push(`${path}.mode must be a scale id`);
  return issues;
}

export function validateTimeSignatureShape(value: unknown, path: string): string[] {
  if (!isRecord(value)) return [`${path} must be an object`];
  const issues: string[] = [];
  const { numerator, denominator } = value;
  if (!isFiniteNumber(numerator) || !Number.isInteger(numerator) || numerator < 1 || numerator > 32) {
    issues.push(`${path}.numerator must be an integer from 1 to 32`);
  }
  if (!isFiniteNumber(denominator) || ![1, 2, 4, 8, 16, 32].includes(denominator)) {
    issues.push(`${path}.denominator must be a power of two from 1 to 32`);
  }
  return issues;
}

export function validateTempoShape(value: unknown, path: string): string[] {
  if (!isRecord(value)) return [`${path} must be an object`];
  if (!isFiniteNumber(value.bpm) || value.bpm <= 0 || value.bpm > 1000) return [`${path}.bpm must be a positive number`];
  return [];
}

// ---------------------------------------------------------------------------
// MusicalSequence / ProjectFile
// ---------------------------------------------------------------------------

export function validateSequenceShape(value: unknown, path = "sequence"): string[] {
  if (!isRecord(value)) return [`${path} must be an object`];
  const issues: string[] = [];
  if (!isNonEmptyString(value.id)) issues.push(`${path}.id must be a non-empty string`);
  if (!isFiniteNumber(value.version)) issues.push(`${path}.version must be a number`);
  issues.push(...validateTempoShape(value.tempo, `${path}.tempo`));
  issues.push(...validateTimeSignatureShape(value.timeSignature, `${path}.timeSignature`));
  if (value.key !== undefined) issues.push(...validateKeyContextShape(value.key, `${path}.key`));
  if (!isFiniteNumber(value.totalBeats) || value.totalBeats < 0) issues.push(`${path}.totalBeats must be a number >= 0`);
  if (!Array.isArray(value.events)) {
    issues.push(`${path}.events must be an array`);
  } else {
    value.events.forEach((event: unknown, index: number) => {
      const at = `${path}.events[${index}]`;
      if (!isRecord(event)) {
        issues.push(`${at} must be an object`);
        return;
      }
      if (!isNonEmptyString(event.id)) issues.push(`${at}.id must be a non-empty string`);
      if (event.kind !== "chord" && event.kind !== "rest") issues.push(`${at}.kind must be "chord" or "rest"`);
      if (!isString(event.symbol)) issues.push(`${at}.symbol must be a string`);
      if (!isFiniteNumber(event.startBeat) || event.startBeat < 0) issues.push(`${at}.startBeat must be a number >= 0`);
      if (!isFiniteNumber(event.durationBeats) || event.durationBeats < 0) issues.push(`${at}.durationBeats must be a number >= 0`);
    });
  }
  return issues;
}

export function validateProjectShape(value: unknown): string[] {
  if (!isRecord(value)) return ["project must be an object"];
  const issues: string[] = [];
  if (!isFiniteNumber(value.schemaVersion)) issues.push("project.schemaVersion must be a number");
  if (value.kind !== "project") issues.push('project.kind must be "project"');
  if (!isNonEmptyString(value.id)) issues.push("project.id must be a non-empty string");
  if (!isString(value.name)) issues.push("project.name must be a string");
  if (!isTimestamp(value.createdAt)) issues.push("project.createdAt must be an ISO timestamp");
  if (!isTimestamp(value.updatedAt)) issues.push("project.updatedAt must be an ISO timestamp");
  if (value.sourceText !== undefined && !isString(value.sourceText)) issues.push("project.sourceText must be a string");
  if (value.settings !== undefined && !isRecord(value.settings)) issues.push("project.settings must be an object");
  issues.push(...validateSequenceShape(value.sequence, "project.sequence"));
  return issues;
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export const ATTEMPT_MODES = ["listen", "assisted", "step", "timed", "free"] as const;
export const INPUT_SOURCES = ["midi", "computerKeyboard", "touch", "replay"] as const;
export const ASSISTANCE_LEVELS = ["full", "reduced", "none"] as const;
export const EVIDENCE_KINDS = ["read", "listened", "assisted", "independent", "transfer"] as const;
export const HANDS = ["left", "right", "either", "both"] as const;
export const POLICY_KINDS = ["exactVoicing", "roles", "pitchClass", "listen", "free"] as const;
const TIMING_VERDICTS = ["early", "onTime", "late", "missed"] as const;

export function validateAttemptShape(value: unknown, path = "attempt"): string[] {
  if (!isRecord(value)) return [`${path} must be an object`];
  const issues: string[] = [];
  if (!isNonEmptyString(value.id)) issues.push(`${path}.id must be a non-empty string`);
  if (!isNonEmptyString(value.exerciseId)) issues.push(`${path}.exerciseId must be a non-empty string`);
  if (!isFiniteNumber(value.exerciseVersion)) issues.push(`${path}.exerciseVersion must be a number`);
  if (!isNonEmptyString(value.scoringVersion)) issues.push(`${path}.scoringVersion must be a non-empty string`);
  if (!isTimestamp(value.startedAt)) issues.push(`${path}.startedAt must be an ISO timestamp`);
  if (value.completedAt !== undefined && !isTimestamp(value.completedAt)) issues.push(`${path}.completedAt must be an ISO timestamp`);
  if (!isOneOf(value.mode, ATTEMPT_MODES)) issues.push(`${path}.mode must be one of ${ATTEMPT_MODES.join(", ")}`);
  if (!isOneOf(value.inputSource, INPUT_SOURCES)) issues.push(`${path}.inputSource must be one of ${INPUT_SOURCES.join(", ")}`);
  if (!isOneOf(value.assistance, ASSISTANCE_LEVELS)) issues.push(`${path}.assistance must be one of ${ASSISTANCE_LEVELS.join(", ")}`);
  if (!isFiniteNumber(value.hintLevel)) issues.push(`${path}.hintLevel must be a number`);
  if (!isRecord(value.policy) || !isOneOf(value.policy.kind, POLICY_KINDS)) issues.push(`${path}.policy.kind must be a known answer policy`);
  if (value.key !== undefined) issues.push(...validateKeyContextShape(value.key, `${path}.key`));
  if (!Array.isArray(value.pitch)) {
    issues.push(`${path}.pitch must be an array`);
  } else {
    value.pitch.forEach((obs: unknown, index: number) => {
      const at = `${path}.pitch[${index}]`;
      if (!isRecord(obs)) {
        issues.push(`${at} must be an object`);
        return;
      }
      if (!isString(obs.occurrenceId)) issues.push(`${at}.occurrenceId must be a string`);
      if (!isBoolean(obs.correct)) issues.push(`${at}.correct must be a boolean`);
      if (!Array.isArray(obs.missingMidi)) issues.push(`${at}.missingMidi must be an array`);
      if (!Array.isArray(obs.extraMidi)) issues.push(`${at}.extraMidi must be an array`);
      if (!isStringArray(obs.missingRoles)) issues.push(`${at}.missingRoles must be an array of roles`);
    });
  }
  if (!Array.isArray(value.timing)) {
    issues.push(`${path}.timing must be an array`);
  } else {
    value.timing.forEach((obs: unknown, index: number) => {
      const at = `${path}.timing[${index}]`;
      if (!isRecord(obs)) {
        issues.push(`${at} must be an object`);
        return;
      }
      if (!isString(obs.occurrenceId)) issues.push(`${at}.occurrenceId must be a string`);
      if (!isOneOf(obs.verdict, TIMING_VERDICTS)) issues.push(`${at}.verdict must be one of ${TIMING_VERDICTS.join(", ")}`);
    });
  }
  const summary = value.summary;
  if (!isRecord(summary)) {
    issues.push(`${path}.summary must be an object`);
  } else {
    if (!isFiniteNumber(summary.stepsCompleted)) issues.push(`${path}.summary.stepsCompleted must be a number`);
    if (!isFiniteNumber(summary.stepsTotal)) issues.push(`${path}.summary.stepsTotal must be a number`);
    if (!isStringArray(summary.difficultOccurrenceIds)) issues.push(`${path}.summary.difficultOccurrenceIds must be an array of strings`);
  }
  return issues;
}

export function validateEvidenceShape(value: unknown, path = "evidence"): string[] {
  if (!isRecord(value)) return [`${path} must be an object`];
  const issues: string[] = [];
  if (!isOneOf(value.kind, EVIDENCE_KINDS)) issues.push(`${path}.kind must be one of ${EVIDENCE_KINDS.join(", ")}`);
  if (!isTimestamp(value.at)) issues.push(`${path}.at must be an ISO timestamp`);
  const refs = ["conceptId", "exerciseId", "chartId", "routineId"];
  for (const ref of refs) {
    if (value[ref] !== undefined && !isNonEmptyString(value[ref])) issues.push(`${path}.${ref} must be a non-empty string`);
  }
  const record: Record<string, unknown> = value;
  if (!refs.some((ref) => isNonEmptyString(record[ref]))) {
    issues.push(`${path} must reference a conceptId, exerciseId, chartId or routineId`);
  }
  if (value.attemptId !== undefined && !isNonEmptyString(value.attemptId)) issues.push(`${path}.attemptId must be a string`);
  if (value.key !== undefined) issues.push(...validateKeyContextShape(value.key, `${path}.key`));
  if (value.tempoBpm !== undefined && (!isFiniteNumber(value.tempoBpm) || value.tempoBpm <= 0)) issues.push(`${path}.tempoBpm must be a positive number`);
  if (value.hand !== undefined && !isOneOf(value.hand, HANDS)) issues.push(`${path}.hand must be one of ${HANDS.join(", ")}`);
  if (value.policy !== undefined && !isOneOf(value.policy, POLICY_KINDS)) issues.push(`${path}.policy must be a known answer policy kind`);
  if (value.assistance !== undefined && !isOneOf(value.assistance, ASSISTANCE_LEVELS)) issues.push(`${path}.assistance must be one of ${ASSISTANCE_LEVELS.join(", ")}`);
  return issues;
}

export function validateRoutineStateShape(value: unknown, path: string): string[] {
  if (!isRecord(value)) return [`${path} must be an object`];
  const issues: string[] = [];
  if (!isFiniteNumber(value.itemIndex) || !Number.isInteger(value.itemIndex) || value.itemIndex < 0) {
    issues.push(`${path}.itemIndex must be an integer >= 0`);
  }
  if (!isTimestamp(value.updatedAt)) issues.push(`${path}.updatedAt must be an ISO timestamp`);
  if (!isStringArray(value.completedItemIds)) issues.push(`${path}.completedItemIds must be an array of strings`);
  return issues;
}

/**
 * Top-level progress structure only. Individual attempts/evidence entries are checked
 * separately so one damaged entry does not discard a whole history (it is dropped with a
 * warning instead).
 */
export function validateProgressEnvelope(value: unknown): string[] {
  if (!isRecord(value)) return ["progress must be an object"];
  const issues: string[] = [];
  if (!isFiniteNumber(value.schemaVersion)) issues.push("progress.schemaVersion must be a number");
  if (value.kind !== "progress") issues.push('progress.kind must be "progress"');
  if (!Array.isArray(value.attempts)) issues.push("progress.attempts must be an array");
  if (!Array.isArray(value.evidence)) issues.push("progress.evidence must be an array");
  if (!isRecord(value.routineState)) issues.push("progress.routineState must be an object");
  if (!isStringArray(value.goals)) issues.push("progress.goals must be an array of strings");
  if (!isTimestamp(value.updatedAt)) issues.push("progress.updatedAt must be an ISO timestamp");
  return issues;
}
