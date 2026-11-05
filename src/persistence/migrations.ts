/**
 * Versioned-schema migration. Documents carry `schemaVersion`; a missing version means a
 * legacy (version 0) document. Migrations are keyed by the version they upgrade FROM and
 * are applied one step at a time until the target version is reached.
 *
 * Safety rules
 * - The input is never mutated (migrations run on a deep clone).
 * - A document newer than this app supports fails with "unsupportedVersion" and is handed
 *   back untouched in `error.preserved`; callers must not overwrite stored data with it.
 * - After migrating, the result is validated with a hand-written structural guard.
 */

import type { MusicalSequence, ProjectFile, TimeSignatureSpec } from "@/model/contracts";
import { isFiniteNumber, isRecord, validateTimeSignatureShape } from "./guards";
import { fail, ok, type Result } from "./result";
import { cloneJson, generateId } from "./util";

export interface MigrationContext {
  /** ISO timestamp used for createdAt/updatedAt of documents created by a migration. */
  now: string;
  newId: (prefix: string) => string;
}

export type Migration = (doc: Record<string, unknown>, context: MigrationContext) => Record<string, unknown>;

/** Keyed by the schema version a migration upgrades FROM (0 → 1 is `migrations[0]`). */
export type MigrationMap = Record<number, Migration>;

export interface MigrateOptions {
  /** Used in messages, e.g. "project", "progress file". */
  label?: string;
  /** Structural guard run on the migrated document; returns issues (empty = valid). */
  validate?: (doc: unknown) => string[];
  context?: Partial<MigrationContext>;
}

export function readSchemaVersion(doc: Record<string, unknown>): number | null {
  const version = doc.schemaVersion;
  if (version === undefined) return 0;
  if (!isFiniteNumber(version) || !Number.isInteger(version) || version < 0) return null;
  return version;
}

export function migrate<T>(raw: unknown, migrations: MigrationMap, targetVersion: number, options: MigrateOptions = {}): Result<T> {
  const label = options.label ?? "document";
  if (!isRecord(raw)) {
    return fail("invalid", `This ${label} is not a JSON object.`, { preserved: raw });
  }
  const startVersion = readSchemaVersion(raw);
  if (startVersion === null) {
    return fail("invalid", `This ${label} has an invalid schemaVersion.`, { preserved: raw });
  }
  if (startVersion > targetVersion) {
    return fail(
      "unsupportedVersion",
      `This ${label} was saved by a newer version of the app (schema v${startVersion}; this app reads up to v${targetVersion}). Update the app to open it. The data has not been changed.`,
      { preserved: raw }
    );
  }
  const context: MigrationContext = {
    now: options.context?.now ?? new Date().toISOString(),
    newId: options.context?.newId ?? generateId
  };
  const warnings: string[] = [];
  let doc: Record<string, unknown> = cloneJson(raw);
  let version = startVersion;
  while (version < targetVersion) {
    const step = migrations[version];
    if (step === undefined) {
      if (version === 0) {
        return fail("invalid", `This file has no schemaVersion and is not a recognised ${label}.`, { preserved: raw });
      }
      return fail("unsupportedVersion", `There is no upgrade path for a ${label} at schema v${version}.`, { preserved: raw });
    }
    let next: Record<string, unknown>;
    try {
      next = step(doc, context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return fail("invalid", `This ${label} could not be upgraded from schema v${version}: ${message}`, {
        original: error,
        preserved: raw
      });
    }
    if (!isRecord(next)) {
      return fail("invalid", `Upgrading this ${label} from schema v${version} produced no document.`, { preserved: raw });
    }
    next.schemaVersion = version + 1;
    doc = next;
    version += 1;
  }
  if (startVersion < targetVersion) {
    warnings.push(`Upgraded ${label} from schema v${startVersion} to v${targetVersion}.`);
  }
  if (options.validate !== undefined) {
    const issues = options.validate(doc);
    if (issues.length > 0) {
      return fail("invalid", `This ${label} is missing required information or is damaged (${issues.length} problem${issues.length === 1 ? "" : "s"}).`, {
        details: issues,
        preserved: raw
      });
    }
  }
  return ok(doc as unknown as T, warnings);
}

// ---------------------------------------------------------------------------
// Project migrations
// ---------------------------------------------------------------------------

/**
 * The previous app kept chord text only in memory; the closest thing to a v0 "project" is
 * the text plus its synth settings. Such a document has no schemaVersion.
 */
export interface LegacyTextProject {
  kind: "legacyText";
  text: string;
  settings?: Record<string, unknown>;
  name?: string;
}

/** Settings flag: the sequence is a placeholder and must be rebuilt from `sourceText`. */
export const NEEDS_RECOMPILE_SETTING = "needsRecompile";

function legacyName(doc: Record<string, unknown>, text: string): string {
  if (typeof doc.name === "string" && doc.name.trim() !== "") return doc.name.trim();
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== "");
  if (firstLine === undefined) return "Imported progression";
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine;
}

/**
 * v0 → v1: wrap `{ kind: "legacyText", text, settings? }` into a ProjectFile.
 *
 * Persistence cannot parse chord text (the parser lives in another module), so the
 * sequence is an EMPTY placeholder and `settings.needsRecompile` is set to `true`. When the
 * app opens such a project it must recompile the sequence from `sourceText` with the chord
 * parser, then save it via `withRecompiledSequence()` which clears the flag. The original
 * legacy settings are kept alongside the flag.
 */
export function migrateLegacyTextProject(doc: Record<string, unknown>, context: MigrationContext): Record<string, unknown> {
  if (doc.kind !== "legacyText" || typeof doc.text !== "string") {
    throw new Error('legacy projects must look like { "kind": "legacyText", "text": "..." }');
  }
  const text = doc.text;
  const legacySettings: Record<string, unknown> = isRecord(doc.settings) ? cloneJson(doc.settings) : {};
  const id = typeof doc.id === "string" && doc.id.trim() !== "" ? doc.id : context.newId("project");
  const name = legacyName(doc, text);
  const tempoValue = legacySettings.tempoBpm;
  const bpm = isFiniteNumber(tempoValue) && tempoValue > 0 && tempoValue <= 1000 ? tempoValue : 120;
  const timeSignature: TimeSignatureSpec =
    validateTimeSignatureShape(legacySettings.timeSignature, "settings.timeSignature").length === 0
      ? cloneJson(legacySettings.timeSignature as TimeSignatureSpec)
      : { numerator: 4, denominator: 4 };
  const sequence: MusicalSequence = {
    id: `${id}-sequence`,
    version: 0,
    title: name,
    tempo: { bpm },
    timeSignature,
    events: [],
    totalBeats: 0
  };
  const project: ProjectFile = {
    schemaVersion: 1,
    kind: "project",
    id,
    name,
    createdAt: context.now,
    updatedAt: context.now,
    sequence,
    sourceText: text,
    settings: { ...legacySettings, [NEEDS_RECOMPILE_SETTING]: true, migratedFrom: "legacyText" }
  };
  return project as unknown as Record<string, unknown>;
}

export const PROJECT_MIGRATIONS: MigrationMap = {
  0: migrateLegacyTextProject
};

/** Progress starts at v1; there is no legacy progress format. */
export const PROGRESS_MIGRATIONS: MigrationMap = {};
