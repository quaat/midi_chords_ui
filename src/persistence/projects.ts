/**
 * Local project storage. Each project is one record ("pls:project:<id>"); a small index
 * ("pls:project-index") holds summaries so listing does not read every record. When the
 * index is missing or damaged it is rebuilt from the records.
 */

import type { MusicalSequence, ProjectFile } from "@/model/contracts";
import { PROJECT_SCHEMA_VERSION } from "@/model/contracts";
import { isFiniteNumber, isRecord, isString, isTimestamp, validateProjectShape } from "./guards";
import { parseJson, stableStringify } from "./json";
import { migrate, NEEDS_RECOMPILE_SETTING, PROJECT_MIGRATIONS, readSchemaVersion, type LegacyTextProject, type MigrationContext } from "./migrations";
import { fail, failWith, ok, type PersistenceErrorCode, type Result } from "./result";
import { checkIdSegment, listKeys, readKey, removeKey, writeKey, type StorageAdapter } from "./storage";
import { bumpTimestamp, cloneJson, compareStrings, resolveStoreOptions, type ResolvedStoreOptions, type StoreOptions } from "./util";

export const PROJECT_KEY_PREFIX = "pls:project:";
export const PROJECT_INDEX_KEY = "pls:project-index";
export const PROJECT_INDEX_VERSION = 1;

export function projectKey(id: string): string {
  return `${PROJECT_KEY_PREFIX}${id}`;
}

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
  /** Set when the record exists but cannot be opened by this app version. */
  problem?: PersistenceErrorCode;
}

interface ProjectIndexDoc {
  schemaVersion: number;
  kind: "projectIndex";
  entries: ProjectSummary[];
}

export interface ProjectImportOptions {
  /** Give the imported project a fresh id (e.g. to import a copy alongside the original). */
  assignNewId?: boolean;
  context?: Partial<MigrationContext>;
}

export interface ProjectSaveOptions {
  /** Bump updatedAt (default true). Restores from backup keep the original timestamps. */
  touch?: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Parse → migrate → validate a project document (already-parsed JSON). */
export function projectFromUnknown(raw: unknown, context?: Partial<MigrationContext>): Result<ProjectFile> {
  return migrate<ProjectFile>(raw, PROJECT_MIGRATIONS, PROJECT_SCHEMA_VERSION, {
    label: "project",
    validate: validateProjectShape,
    context
  });
}

/** Parse exported project JSON (or a legacy `{ kind: "legacyText" }` document). Never throws. */
export function parseProjectJson(text: string, context?: Partial<MigrationContext>): Result<ProjectFile> {
  const parsed = parseJson(text, "project file");
  if (!parsed.ok) return parsed;
  return projectFromUnknown(parsed.value, context);
}

/** Pretty JSON with stable key order for export/download. */
export function exportProjectJson(project: ProjectFile): string {
  return stableStringify(project);
}

/** Wrap legacy chord text in a project; the sequence must then be recompiled (see migrations). */
export function legacyTextToProject(
  text: string,
  settings?: Record<string, unknown>,
  context?: Partial<MigrationContext>
): Result<ProjectFile> {
  const legacy: LegacyTextProject = { kind: "legacyText", text };
  if (settings !== undefined) legacy.settings = settings;
  return projectFromUnknown(legacy, context);
}

/** True when the sequence is a placeholder that must be rebuilt from `sourceText`. */
export function projectNeedsRecompile(project: ProjectFile): boolean {
  return project.settings !== undefined && project.settings[NEEDS_RECOMPILE_SETTING] === true;
}

/** Attach a freshly compiled sequence and clear the needsRecompile flag (does not save). */
export function withRecompiledSequence(project: ProjectFile, sequence: MusicalSequence): ProjectFile {
  const next = cloneJson(project);
  next.sequence = cloneJson(sequence);
  if (next.settings !== undefined) {
    const settings: Record<string, unknown> = { ...next.settings };
    delete settings[NEEDS_RECOMPILE_SETTING];
    next.settings = settings;
  }
  return next;
}

function summarize(project: ProjectFile): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    schemaVersion: project.schemaVersion
  };
}

function sortSummaries(entries: ProjectSummary[]): ProjectSummary[] {
  return entries.slice().sort((a, b) => compareStrings(b.updatedAt, a.updatedAt) || compareStrings(a.id, b.id));
}

function isSummary(value: unknown): value is ProjectSummary {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    isTimestamp(value.createdAt) &&
    isTimestamp(value.updatedAt) &&
    isFiniteNumber(value.schemaVersion)
  );
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class ProjectStore {
  private readonly adapter: StorageAdapter;
  private readonly options: ResolvedStoreOptions;

  constructor(adapter: StorageAdapter, options: StoreOptions = {}) {
    this.adapter = adapter;
    this.options = resolveStoreOptions(options);
  }

  private context(): Partial<MigrationContext> {
    return { now: this.options.now().toISOString(), newId: this.options.newId };
  }

  /** Summaries, most recently updated first. Reads only the index unless it must be rebuilt. */
  list(): Result<ProjectSummary[]> {
    const index = this.readIndex();
    if (index.ok && index.value !== null) return ok(sortSummaries(index.value));
    const warnings: string[] = [];
    if (!index.ok) {
      if (index.error.code === "unavailable") return index;
      warnings.push("The project list was damaged and has been rebuilt from saved projects.");
    }
    const rebuilt = this.rebuildIndex();
    if (!rebuilt.ok) return rebuilt;
    return ok(rebuilt.value, [...warnings, ...rebuilt.warnings]);
  }

  /** Scan every project record and rewrite the index (best effort). */
  rebuildIndex(): Result<ProjectSummary[]> {
    const keys = listKeys(this.adapter, PROJECT_KEY_PREFIX);
    if (!keys.ok) return keys;
    const entries: ProjectSummary[] = [];
    const warnings: string[] = [];
    for (const key of keys.value) {
      const id = key.slice(PROJECT_KEY_PREFIX.length);
      const raw = readKey(this.adapter, key);
      if (!raw.ok) return raw;
      if (raw.value === null) continue;
      const parsed = parseJson(raw.value, "project");
      if (!parsed.ok) {
        warnings.push(`Project "${id}" is damaged and cannot be opened.`);
        entries.push({ id, name: id, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), schemaVersion: 0, problem: "corrupt" });
        continue;
      }
      const project = projectFromUnknown(parsed.value, this.context());
      if (project.ok) {
        entries.push(summarize(project.value));
        continue;
      }
      const doc = parsed.value;
      const version = isRecord(doc) ? readSchemaVersion(doc) : null;
      entries.push({
        id,
        name: isRecord(doc) && isString(doc.name) ? doc.name : id,
        createdAt: isRecord(doc) && isTimestamp(doc.createdAt) ? doc.createdAt : new Date(0).toISOString(),
        updatedAt: isRecord(doc) && isTimestamp(doc.updatedAt) ? doc.updatedAt : new Date(0).toISOString(),
        schemaVersion: version ?? 0,
        problem: project.error.code
      });
      warnings.push(`Project "${id}" cannot be opened: ${project.error.message}`);
    }
    const sorted = sortSummaries(entries);
    const written = this.writeIndex(sorted);
    if (!written.ok) warnings.push("The rebuilt project list could not be saved; it will be rebuilt again next time.");
    return ok(sorted, warnings);
  }

  get(id: string): Result<ProjectFile | null> {
    const checked = checkIdSegment(id, "project");
    if (!checked.ok) return checked;
    const raw = readKey(this.adapter, projectKey(id));
    if (!raw.ok) return raw;
    if (raw.value === null) return ok(null);
    const parsed = parseJson(raw.value, "saved project");
    if (!parsed.ok) return parsed;
    return projectFromUnknown(parsed.value, this.context());
  }

  /**
   * Validate and write a project, bumping updatedAt (unless `touch: false`). A failed
   * write (e.g. quota) leaves the previously saved version intact. A stored record written
   * by a newer app version is never overwritten.
   */
  save(project: ProjectFile, options: ProjectSaveOptions = {}): Result<ProjectFile> {
    const checked = checkIdSegment(project.id, "project");
    if (!checked.ok) return checked;
    if (isFiniteNumber(project.schemaVersion) && project.schemaVersion > PROJECT_SCHEMA_VERSION) {
      return fail("unsupportedVersion", `This project uses schema v${project.schemaVersion}; update the app to save it.`);
    }
    const key = projectKey(project.id);
    const previousRaw = readKey(this.adapter, key);
    if (!previousRaw.ok) return previousRaw;
    if (previousRaw.value !== null) {
      const previous = parseJson(previousRaw.value, "saved project");
      if (previous.ok && isRecord(previous.value)) {
        const storedVersion = readSchemaVersion(previous.value);
        if (storedVersion !== null && storedVersion > PROJECT_SCHEMA_VERSION) {
          return fail(
            "unsupportedVersion",
            "This project was saved by a newer version of the app; saving here would discard its newer data. Update the app or save as a copy.",
            { preserved: previousRaw.value }
          );
        }
      }
    }
    const now = this.options.now();
    const next: ProjectFile = cloneJson(project);
    next.schemaVersion = PROJECT_SCHEMA_VERSION;
    next.kind = "project";
    if (!isTimestamp(next.createdAt)) next.createdAt = now.toISOString();
    if (options.touch !== false || !isTimestamp(next.updatedAt)) {
      next.updatedAt = bumpTimestamp(isTimestamp(project.updatedAt) ? project.updatedAt : undefined, now);
    }
    const issues = validateProjectShape(next);
    if (issues.length > 0) {
      return fail("invalid", "The project is incomplete and was not saved.", { details: issues });
    }
    const written = writeKey(this.adapter, key, JSON.stringify(next));
    if (!written.ok) return written;

    const indexed = this.upsertIndex(summarize(next));
    if (!indexed.ok) {
      // Keep record and index consistent: restore the previous record.
      if (previousRaw.value !== null) writeKey(this.adapter, key, previousRaw.value);
      else removeKey(this.adapter, key);
      return indexed;
    }
    return ok(cloneJson(next), indexed.warnings);
  }

  /** Remove a project; returns false when it did not exist. */
  remove(id: string): Result<boolean> {
    const checked = checkIdSegment(id, "project");
    if (!checked.ok) return checked;
    const key = projectKey(id);
    const existing = readKey(this.adapter, key);
    if (!existing.ok) return existing;
    const removed = removeKey(this.adapter, key);
    if (!removed.ok) return removed;
    const warnings: string[] = [];
    const index = this.readIndex();
    if (index.ok && index.value !== null) {
      const written = this.writeIndex(index.value.filter((entry) => entry.id !== id));
      if (!written.ok) {
        // Dropping the index forces a rebuild from records, which no longer include this one.
        removeKey(this.adapter, PROJECT_INDEX_KEY);
        warnings.push("The project list will be rebuilt on next load.");
      }
    } else {
      removeKey(this.adapter, PROJECT_INDEX_KEY);
    }
    return ok(existing.value !== null, warnings);
  }

  createProject(name: string, sequence: MusicalSequence, sourceText?: string, settings?: Record<string, unknown>): Result<ProjectFile> {
    const nowIso = this.options.now().toISOString();
    const project: ProjectFile = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      kind: "project",
      id: this.options.newId("project"),
      name,
      createdAt: nowIso,
      updatedAt: nowIso,
      sequence: cloneJson(sequence)
    };
    if (sourceText !== undefined) project.sourceText = sourceText;
    if (settings !== undefined) project.settings = cloneJson(settings);
    return this.save(project, { touch: false });
  }

  /** Copy a project under a new id (and a new sequence id so attempts are not confused). */
  duplicate(id: string, name?: string): Result<ProjectFile> {
    const source = this.get(id);
    if (!source.ok) return source;
    if (source.value === null) return fail("invalid", `There is no saved project "${id}" to duplicate.`);
    const copyId = this.options.newId("project");
    const nowIso = this.options.now().toISOString();
    const copy = cloneJson(source.value);
    copy.id = copyId;
    copy.name = name ?? `${source.value.name} (copy)`;
    copy.createdAt = nowIso;
    copy.updatedAt = nowIso;
    copy.sequence.id = `${copyId}-sequence`;
    return this.save(copy, { touch: false });
  }

  exportProjectJson(project: ProjectFile): string {
    return exportProjectJson(project);
  }

  /** Parse/migrate/validate an exported project. Does NOT save; call `save()` to keep it. */
  importProjectJson(text: string, options: ProjectImportOptions = {}): Result<ProjectFile> {
    const parsed = parseProjectJson(text, { ...this.context(), ...options.context });
    if (!parsed.ok) return parsed;
    if (options.assignNewId !== true) return parsed;
    const project = parsed.value;
    const newId = this.options.newId("project");
    project.id = newId;
    project.sequence.id = `${newId}-sequence`;
    return ok(project, parsed.warnings);
  }

  // -- index ---------------------------------------------------------------

  private readIndex(): Result<ProjectSummary[] | null> {
    const raw = readKey(this.adapter, PROJECT_INDEX_KEY);
    if (!raw.ok) return raw;
    if (raw.value === null) return ok(null);
    const parsed = parseJson(raw.value, "project list");
    if (!parsed.ok) return parsed;
    const doc = parsed.value;
    if (!isRecord(doc) || doc.kind !== "projectIndex" || !Array.isArray(doc.entries)) {
      return fail("corrupt", "The project list is damaged.");
    }
    if (isFiniteNumber(doc.schemaVersion) && doc.schemaVersion > PROJECT_INDEX_VERSION) {
      return fail("unsupportedVersion", "The project list was written by a newer version of the app.");
    }
    if (!doc.entries.every(isSummary)) return fail("corrupt", "The project list is damaged.");
    return ok((doc.entries as ProjectSummary[]).map((entry) => cloneJson(entry)));
  }

  private writeIndex(entries: ProjectSummary[]): Result<undefined> {
    const doc: ProjectIndexDoc = { schemaVersion: PROJECT_INDEX_VERSION, kind: "projectIndex", entries: sortSummaries(entries) };
    return writeKey(this.adapter, PROJECT_INDEX_KEY, JSON.stringify(doc));
  }

  private upsertIndex(summary: ProjectSummary): Result<undefined> {
    const index = this.readIndex();
    let entries: ProjectSummary[];
    const warnings: string[] = [];
    if (index.ok && index.value !== null) {
      entries = index.value;
    } else {
      if (!index.ok && index.error.code === "unavailable") return failWith(index.error);
      const rebuilt = this.rebuildIndex();
      if (!rebuilt.ok) return rebuilt;
      entries = rebuilt.value;
      if (!index.ok) warnings.push("The project list was damaged and has been rebuilt.");
    }
    const next = entries.filter((entry) => entry.id !== summary.id);
    next.push(summary);
    const written = this.writeIndex(next);
    if (!written.ok) return written;
    return ok(undefined, warnings);
  }
}

export function createProjectStore(adapter: StorageAdapter, options: StoreOptions = {}): ProjectStore {
  return new ProjectStore(adapter, options);
}
