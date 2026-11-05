/**
 * Versioned UI preferences under "pls:preferences". Unknown or invalid fields fall back to
 * defaults with a warning (preferences are low-stakes), but a file written by a newer app
 * version is never overwritten implicitly.
 */

import { isFiniteNumber, isOneOf, isRecord } from "./guards";
import { parseJson } from "./json";
import { readSchemaVersion } from "./migrations";
import { fail, ok, type Result } from "./result";
import { readKey, removeKey, writeKey, type StorageAdapter } from "./storage";
import { cloneJson, resolveStoreOptions, type ResolvedStoreOptions, type StoreOptions } from "./util";

export const PREFERENCES_KEY = "pls:preferences";
export const PREFERENCES_SCHEMA_VERSION = 1;

export const THEMES = ["system", "light", "dark"] as const;
export const LABEL_MODES = ["none", "noteNames", "degrees", "roles"] as const;
export const PREFERRED_INPUT_SOURCES = ["auto", "midi", "computerKeyboard", "touch"] as const;
export const REDUCED_MOTION = ["system", "reduce", "noPreference"] as const;
export const ONBOARDING_CHOICES = ["learningChords", "betterVoicings"] as const;

export type ThemePreference = (typeof THEMES)[number];
export type LabelMode = (typeof LABEL_MODES)[number];
export type PreferredInputSource = (typeof PREFERRED_INPUT_SOURCES)[number];
export type ReducedMotionPreference = (typeof REDUCED_MOTION)[number];
export type OnboardingChoice = (typeof ONBOARDING_CHOICES)[number];

export const LATENCY_OFFSET_LIMIT_MS = 1000;

export interface Preferences {
  theme: ThemePreference;
  labelMode: LabelMode;
  /** Visible piano range in MIDI note numbers (inclusive). */
  pianoRange: { low: number; high: number };
  inputSource: PreferredInputSource;
  /** Added to learner input timestamps before timing assessment (ms, ±1000). */
  latencyOffsetMs: number;
  reducedMotion: ReducedMotionPreference;
  /** First-session choice; undefined until the learner picks one. */
  onboardingChoice?: OnboardingChoice;
}

export interface PreferencesFile extends Preferences {
  schemaVersion: number;
  kind: "preferences";
  updatedAt: string;
}

const DEFAULTS: Preferences = {
  theme: "system",
  labelMode: "noteNames",
  pianoRange: { low: 36, high: 96 },
  inputSource: "auto",
  latencyOffsetMs: 0,
  reducedMotion: "system"
};

export const DEFAULT_PREFERENCES: Readonly<Preferences> = Object.freeze(DEFAULTS);

export function defaultPreferences(): Preferences {
  return cloneJson(DEFAULTS);
}

function rangeIssue(value: unknown): string | null {
  if (!isRecord(value)) return "pianoRange must be { low, high }";
  const { low, high } = value;
  if (!isFiniteNumber(low) || !isFiniteNumber(high) || !Number.isInteger(low) || !Number.isInteger(high)) {
    return "pianoRange.low and pianoRange.high must be whole MIDI note numbers";
  }
  if (low < 0 || high > 127 || low >= high) return "pianoRange must satisfy 0 <= low < high <= 127";
  return null;
}

/** Check one field; returns an issue string or null. */
function fieldIssue(field: keyof Preferences, value: unknown): string | null {
  switch (field) {
    case "theme":
      return isOneOf(value, THEMES) ? null : `theme must be one of ${THEMES.join(", ")}`;
    case "labelMode":
      return isOneOf(value, LABEL_MODES) ? null : `labelMode must be one of ${LABEL_MODES.join(", ")}`;
    case "pianoRange":
      return rangeIssue(value);
    case "inputSource":
      return isOneOf(value, PREFERRED_INPUT_SOURCES) ? null : `inputSource must be one of ${PREFERRED_INPUT_SOURCES.join(", ")}`;
    case "latencyOffsetMs":
      return isFiniteNumber(value) && Math.abs(value) <= LATENCY_OFFSET_LIMIT_MS
        ? null
        : `latencyOffsetMs must be a number between -${LATENCY_OFFSET_LIMIT_MS} and ${LATENCY_OFFSET_LIMIT_MS}`;
    case "reducedMotion":
      return isOneOf(value, REDUCED_MOTION) ? null : `reducedMotion must be one of ${REDUCED_MOTION.join(", ")}`;
    case "onboardingChoice":
      return value === undefined || isOneOf(value, ONBOARDING_CHOICES) ? null : `onboardingChoice must be one of ${ONBOARDING_CHOICES.join(", ")}`;
    default:
      return `unknown preference "${String(field)}"`;
  }
}

const FIELDS: readonly (keyof Preferences)[] = ["theme", "labelMode", "pianoRange", "inputSource", "latencyOffsetMs", "reducedMotion", "onboardingChoice"];

/** Field-by-field: keep valid values, replace invalid ones with defaults (with warnings). */
export function sanitizePreferences(raw: unknown): { preferences: Preferences; warnings: string[] } {
  const preferences = defaultPreferences();
  const warnings: string[] = [];
  if (!isRecord(raw)) return { preferences, warnings: ["Preferences were unreadable; defaults are in use."] };
  const target = preferences as unknown as Record<string, unknown>;
  for (const field of FIELDS) {
    if (!(field in raw)) continue;
    const value = raw[field];
    const issue = fieldIssue(field, value);
    if (issue === null) {
      if (value !== undefined) target[field] = cloneJson(value);
    } else {
      warnings.push(`Ignored saved preference: ${issue}.`);
    }
  }
  return { preferences, warnings };
}

export class PreferencesStore {
  private readonly adapter: StorageAdapter;
  private readonly options: ResolvedStoreOptions;

  constructor(adapter: StorageAdapter, options: StoreOptions = {}) {
    this.adapter = adapter;
    this.options = resolveStoreOptions(options);
  }

  private readStored(): Result<{ preferences: Preferences; newer: boolean }> {
    const raw = readKey(this.adapter, PREFERENCES_KEY);
    if (!raw.ok) return raw;
    if (raw.value === null) return ok({ preferences: defaultPreferences(), newer: false });
    const parsed = parseJson(raw.value, "preferences");
    if (!parsed.ok) {
      return ok({ preferences: defaultPreferences(), newer: false }, ["Saved preferences were damaged; defaults are in use."]);
    }
    const doc = parsed.value;
    const version = isRecord(doc) ? readSchemaVersion(doc) : null;
    const sanitized = sanitizePreferences(doc);
    const newer = version !== null && version > PREFERENCES_SCHEMA_VERSION;
    const warnings = sanitized.warnings;
    if (newer) warnings.unshift("Preferences were saved by a newer version of the app; only recognised settings are applied.");
    return ok({ preferences: sanitized.preferences, newer }, warnings);
  }

  /** Current preferences (defaults when none are saved). Never fails for damaged data. */
  get(): Result<Preferences> {
    const stored = this.readStored();
    if (!stored.ok) return stored;
    return ok(stored.value.preferences, stored.warnings);
  }

  /** Apply a partial update. Passing `onboardingChoice: undefined` clears the choice. */
  update(patch: Partial<Preferences>): Result<Preferences> {
    const issues: string[] = [];
    for (const field of Object.keys(patch) as (keyof Preferences)[]) {
      const issue = fieldIssue(field, patch[field]);
      if (issue !== null) issues.push(issue);
    }
    if (issues.length > 0) return fail("invalid", "Some preferences are not valid and nothing was saved.", { details: issues });
    const stored = this.readStored();
    if (!stored.ok) return stored;
    if (stored.value.newer) {
      return fail("unsupportedVersion", "Preferences were saved by a newer version of the app; update the app to change them here.");
    }
    const next: Preferences = { ...stored.value.preferences };
    const target = next as unknown as Record<string, unknown>;
    for (const field of Object.keys(patch) as (keyof Preferences)[]) {
      const value = patch[field];
      if (value === undefined) delete target[field];
      else target[field] = cloneJson(value);
    }
    return this.write(next);
  }

  /** Replace all preferences from untrusted data (e.g. a backup), sanitising field by field. */
  replace(raw: unknown): Result<Preferences> {
    const sanitized = sanitizePreferences(raw);
    const written = this.write(sanitized.preferences);
    if (!written.ok) return written;
    return ok(written.value, sanitized.warnings);
  }

  reset(): Result<Preferences> {
    const removed = removeKey(this.adapter, PREFERENCES_KEY);
    if (!removed.ok) return removed;
    return ok(defaultPreferences());
  }

  private write(preferences: Preferences): Result<Preferences> {
    const file: PreferencesFile = {
      ...preferences,
      schemaVersion: PREFERENCES_SCHEMA_VERSION,
      kind: "preferences",
      updatedAt: this.options.now().toISOString()
    };
    const written = writeKey(this.adapter, PREFERENCES_KEY, JSON.stringify(file));
    if (!written.ok) return written;
    return ok(cloneJson(preferences));
  }
}

export function createPreferencesStore(adapter: StorageAdapter, options: StoreOptions = {}): PreferencesStore {
  return new PreferencesStore(adapter, options);
}
