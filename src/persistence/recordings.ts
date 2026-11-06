/**
 * Local storage for performance recordings ("pls:recording:<id>") with a small index
 * ("pls:recording-index") so listing does not read every (potentially large) record.
 *
 * Recordings are kept separate from projects: a take is a performance, not authored chord
 * material. Same safety rules as projects: validation before every write, size/event limits,
 * a failed write leaves the previous record intact, and records written by a newer app version
 * are never overwritten.
 */

import type { PerformanceRecording, RecordedEvent } from "@/recording/types";
import { MAX_RECORDING_EVENTS, MAX_RECORDING_JSON_CHARS, MAX_RECORDING_MS, RECORDED_EVENT_TYPES, RECORDING_KIND, RECORDING_SCHEMA_VERSION } from "@/recording/types";
import { INPUT_SOURCES, isFiniteNumber, isOneOf, isRecord, isString, isTimestamp, validateTempoShape, validateTimeSignatureShape } from "./guards";
import { parseJson } from "./json";
import { migrate, readSchemaVersion, type MigrationContext, type MigrationMap } from "./migrations";
import { fail, failWith, ok, type PersistenceErrorCode, type Result } from "./result";
import { checkIdSegment, listKeys, readKey, removeKey, writeKey, type StorageAdapter } from "./storage";
import { bumpTimestamp, cloneJson, compareStrings, resolveStoreOptions, type ResolvedStoreOptions, type StoreOptions } from "./util";

export const RECORDING_KEY_PREFIX = "pls:recording:";
export const RECORDING_INDEX_KEY = "pls:recording-index";
export const RECORDING_INDEX_VERSION = 1;

/** Recordings start at v1; there is no legacy format. */
export const RECORDING_MIGRATIONS: MigrationMap = {};

export function recordingKey(id: string): string {
  return `${RECORDING_KEY_PREFIX}${id}`;
}

export interface RecordingSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  durationMs: number;
  tempoBpm: number;
  noteCount: number;
  schemaVersion: number;
  /** Set when the record exists but cannot be opened by this app version. */
  problem?: PersistenceErrorCode;
}

interface RecordingIndexDoc {
  schemaVersion: number;
  kind: "recordingIndex";
  entries: RecordingSummary[];
}

export interface RecordingSaveOptions {
  /** Bump updatedAt (default true). */
  touch?: boolean;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isMidiByte(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0 && value <= 127;
}

export function validateRecordedEventShape(value: unknown, path: string): string[] {
  if (!isRecord(value)) return [`${path} must be an object`];
  const issues: string[] = [];
  if (!isOneOf(value.type, RECORDED_EVENT_TYPES)) issues.push(`${path}.type must be one of ${RECORDED_EVENT_TYPES.join(", ")}`);
  if (!isFiniteNumber(value.atMs) || value.atMs < 0) issues.push(`${path}.atMs must be a number >= 0`);
  if (!isOneOf(value.source, INPUT_SOURCES)) issues.push(`${path}.source must be one of ${INPUT_SOURCES.join(", ")}`);
  if (value.portId !== undefined && !isString(value.portId)) issues.push(`${path}.portId must be a string`);
  if (value.channel !== undefined && (!isFiniteNumber(value.channel) || !Number.isInteger(value.channel) || value.channel < 1 || value.channel > 16)) {
    issues.push(`${path}.channel must be an integer from 1 to 16`);
  }
  if (value.midi !== undefined && !isMidiByte(value.midi)) issues.push(`${path}.midi must be an integer from 0 to 127`);
  if (value.velocity !== undefined && !isMidiByte(value.velocity)) issues.push(`${path}.velocity must be an integer from 0 to 127`);
  if (value.value !== undefined && !isMidiByte(value.value)) issues.push(`${path}.value must be an integer from 0 to 127`);
  if ((value.type === "noteOn" || value.type === "noteOff") && value.midi === undefined) issues.push(`${path}.midi is required for note events`);
  return issues;
}

export function validateRecordingShape(value: unknown): string[] {
  if (!isRecord(value)) return ["recording must be an object"];
  const issues: string[] = [];
  if (!isFiniteNumber(value.schemaVersion)) issues.push("recording.schemaVersion must be a number");
  if (value.kind !== RECORDING_KIND) issues.push(`recording.kind must be "${RECORDING_KIND}"`);
  if (!isString(value.id) || value.id.trim() === "") issues.push("recording.id must be a non-empty string");
  if (!isString(value.title)) issues.push("recording.title must be a string");
  if (!isTimestamp(value.createdAt)) issues.push("recording.createdAt must be an ISO timestamp");
  if (!isTimestamp(value.updatedAt)) issues.push("recording.updatedAt must be an ISO timestamp");
  issues.push(...validateTempoShape(value.tempo, "recording.tempo"));
  issues.push(...validateTimeSignatureShape(value.timeSignature, "recording.timeSignature"));
  if (!isFiniteNumber(value.countInBeats) || value.countInBeats < 0) issues.push("recording.countInBeats must be a number >= 0");
  if (!isFiniteNumber(value.durationMs) || value.durationMs < 0 || value.durationMs > MAX_RECORDING_MS) {
    issues.push(`recording.durationMs must be a number from 0 to ${MAX_RECORDING_MS}`);
  }
  if (!Array.isArray(value.events)) {
    issues.push("recording.events must be an array");
  } else if (value.events.length > MAX_RECORDING_EVENTS) {
    issues.push(`recording.events has ${value.events.length} entries; at most ${MAX_RECORDING_EVENTS} are supported`);
  } else {
    value.events.forEach((event: unknown, index: number) => {
      issues.push(...validateRecordedEventShape(event, `recording.events[${index}]`));
    });
  }
  if (!Array.isArray(value.sources)) {
    issues.push("recording.sources must be an array");
  } else {
    value.sources.forEach((source: unknown, index: number) => {
      const at = `recording.sources[${index}]`;
      if (!isRecord(source)) {
        issues.push(`${at} must be an object`);
        return;
      }
      if (!isOneOf(source.source, INPUT_SOURCES)) issues.push(`${at}.source must be one of ${INPUT_SOURCES.join(", ")}`);
      if (source.portId !== undefined && !isString(source.portId)) issues.push(`${at}.portId must be a string`);
      if (source.portName !== undefined && !isString(source.portName)) issues.push(`${at}.portName must be a string`);
    });
  }
  return issues;
}

/** Parse → migrate → validate a recording document (already-parsed JSON). */
export function recordingFromUnknown(raw: unknown, context?: Partial<MigrationContext>): Result<PerformanceRecording> {
  return migrate<PerformanceRecording>(raw, RECORDING_MIGRATIONS, RECORDING_SCHEMA_VERSION, {
    label: "recording",
    validate: validateRecordingShape,
    context
  });
}

function countNotes(events: readonly RecordedEvent[]): number {
  return events.filter((event) => event.type === "noteOn").length;
}

function summarize(recording: PerformanceRecording): RecordingSummary {
  return {
    id: recording.id,
    title: recording.title,
    createdAt: recording.createdAt,
    updatedAt: recording.updatedAt,
    durationMs: recording.durationMs,
    tempoBpm: recording.tempo.bpm,
    noteCount: countNotes(recording.events),
    schemaVersion: recording.schemaVersion
  };
}

function sortSummaries(entries: RecordingSummary[]): RecordingSummary[] {
  return entries.slice().sort((a, b) => compareStrings(b.updatedAt, a.updatedAt) || compareStrings(a.id, b.id));
}

function isSummary(value: unknown): value is RecordingSummary {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.title) &&
    isTimestamp(value.createdAt) &&
    isTimestamp(value.updatedAt) &&
    isFiniteNumber(value.durationMs) &&
    isFiniteNumber(value.tempoBpm) &&
    isFiniteNumber(value.noteCount) &&
    isFiniteNumber(value.schemaVersion)
  );
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class RecordingStore {
  private readonly adapter: StorageAdapter;
  private readonly options: ResolvedStoreOptions;

  constructor(adapter: StorageAdapter, options: StoreOptions = {}) {
    this.adapter = adapter;
    this.options = resolveStoreOptions(options);
  }

  private context(): Partial<MigrationContext> {
    return { now: this.options.now().toISOString(), newId: this.options.newId };
  }

  /** Summaries, most recently updated first. */
  list(): Result<RecordingSummary[]> {
    const index = this.readIndex();
    if (index.ok && index.value !== null) return ok(sortSummaries(index.value));
    const warnings: string[] = [];
    if (!index.ok) {
      if (index.error.code === "unavailable") return index;
      warnings.push("The recording list was damaged and has been rebuilt from saved recordings.");
    }
    const rebuilt = this.rebuildIndex();
    if (!rebuilt.ok) return rebuilt;
    return ok(rebuilt.value, [...warnings, ...rebuilt.warnings]);
  }

  rebuildIndex(): Result<RecordingSummary[]> {
    const keys = listKeys(this.adapter, RECORDING_KEY_PREFIX);
    if (!keys.ok) return keys;
    const entries: RecordingSummary[] = [];
    const warnings: string[] = [];
    for (const key of keys.value) {
      const id = key.slice(RECORDING_KEY_PREFIX.length);
      const raw = readKey(this.adapter, key);
      if (!raw.ok) return raw;
      if (raw.value === null) continue;
      const parsed = parseJson(raw.value, "recording");
      const epoch = new Date(0).toISOString();
      if (!parsed.ok) {
        warnings.push(`Recording "${id}" is damaged and cannot be opened.`);
        entries.push({ id, title: id, createdAt: epoch, updatedAt: epoch, durationMs: 0, tempoBpm: 0, noteCount: 0, schemaVersion: 0, problem: "corrupt" });
        continue;
      }
      const recording = recordingFromUnknown(parsed.value, this.context());
      if (recording.ok) {
        entries.push(summarize(recording.value));
        continue;
      }
      const doc = parsed.value;
      const version = isRecord(doc) ? readSchemaVersion(doc) : null;
      entries.push({
        id,
        title: isRecord(doc) && isString(doc.title) ? doc.title : id,
        createdAt: isRecord(doc) && isTimestamp(doc.createdAt) ? doc.createdAt : epoch,
        updatedAt: isRecord(doc) && isTimestamp(doc.updatedAt) ? doc.updatedAt : epoch,
        durationMs: isRecord(doc) && isFiniteNumber(doc.durationMs) ? doc.durationMs : 0,
        tempoBpm: 0,
        noteCount: 0,
        schemaVersion: version ?? 0,
        problem: recording.error.code
      });
      warnings.push(`Recording "${id}" cannot be opened: ${recording.error.message}`);
    }
    const sorted = sortSummaries(entries);
    const written = this.writeIndex(sorted);
    if (!written.ok) warnings.push("The rebuilt recording list could not be saved; it will be rebuilt again next time.");
    return ok(sorted, warnings);
  }

  get(id: string): Result<PerformanceRecording | null> {
    const checked = checkIdSegment(id, "recording");
    if (!checked.ok) return checked;
    const raw = readKey(this.adapter, recordingKey(id));
    if (!raw.ok) return raw;
    if (raw.value === null) return ok(null);
    const parsed = parseJson(raw.value, "saved recording");
    if (!parsed.ok) return parsed;
    return recordingFromUnknown(parsed.value, this.context());
  }

  /**
   * Validate and write a recording (bumping updatedAt unless `touch: false`). A failed write
   * (quota, size limit) leaves the previously saved version intact and never loses the caller's
   * in-memory take.
   */
  save(recording: PerformanceRecording, options: RecordingSaveOptions = {}): Result<PerformanceRecording> {
    const checked = checkIdSegment(recording.id, "recording");
    if (!checked.ok) return checked;
    if (isFiniteNumber(recording.schemaVersion) && recording.schemaVersion > RECORDING_SCHEMA_VERSION) {
      return fail("unsupportedVersion", `This recording uses schema v${recording.schemaVersion}; update the app to save it.`);
    }
    const key = recordingKey(recording.id);
    const previousRaw = readKey(this.adapter, key);
    if (!previousRaw.ok) return previousRaw;
    if (previousRaw.value !== null) {
      const previous = parseJson(previousRaw.value, "saved recording");
      if (previous.ok && isRecord(previous.value)) {
        const storedVersion = readSchemaVersion(previous.value);
        if (storedVersion !== null && storedVersion > RECORDING_SCHEMA_VERSION) {
          return fail("unsupportedVersion", "This recording was saved by a newer version of the app; saving here would discard its newer data.", {
            preserved: previousRaw.value
          });
        }
      }
    }
    const now = this.options.now();
    const next: PerformanceRecording = cloneJson(recording);
    next.schemaVersion = RECORDING_SCHEMA_VERSION;
    next.kind = RECORDING_KIND;
    if (!isTimestamp(next.createdAt)) next.createdAt = now.toISOString();
    if (options.touch !== false || !isTimestamp(next.updatedAt)) {
      next.updatedAt = bumpTimestamp(isTimestamp(recording.updatedAt) ? recording.updatedAt : undefined, now);
    }
    const issues = validateRecordingShape(next);
    if (issues.length > 0) {
      return fail("invalid", "The recording is incomplete and was not saved.", { details: issues });
    }
    const text = JSON.stringify(next);
    if (text.length > MAX_RECORDING_JSON_CHARS) {
      return fail("invalid", `This recording is too large to save locally (${Math.round(text.length / 1024)} KB). Export it as a MIDI file instead.`);
    }
    const written = writeKey(this.adapter, key, text);
    if (!written.ok) return written;

    const indexed = this.upsertIndex(summarize(next));
    if (!indexed.ok) {
      if (previousRaw.value !== null) writeKey(this.adapter, key, previousRaw.value);
      else removeKey(this.adapter, key);
      return indexed;
    }
    return ok(cloneJson(next), indexed.warnings);
  }

  /** Change the title of a saved recording. */
  rename(id: string, title: string): Result<PerformanceRecording> {
    const found = this.get(id);
    if (!found.ok) return found;
    if (found.value === null) return fail("invalid", "That recording no longer exists.");
    const trimmed = title.trim();
    if (trimmed === "") return fail("invalid", "The recording needs a name.");
    return this.save({ ...found.value, title: trimmed });
  }

  /** Remove a recording; returns false when it did not exist. */
  remove(id: string): Result<boolean> {
    const checked = checkIdSegment(id, "recording");
    if (!checked.ok) return checked;
    const key = recordingKey(id);
    const existing = readKey(this.adapter, key);
    if (!existing.ok) return existing;
    const removed = removeKey(this.adapter, key);
    if (!removed.ok) return removed;
    const warnings: string[] = [];
    const index = this.readIndex();
    if (index.ok && index.value !== null) {
      const written = this.writeIndex(index.value.filter((entry) => entry.id !== id));
      if (!written.ok) {
        removeKey(this.adapter, RECORDING_INDEX_KEY);
        warnings.push("The recording list will be rebuilt on next load.");
      }
    } else {
      removeKey(this.adapter, RECORDING_INDEX_KEY);
    }
    return ok(existing.value !== null, warnings);
  }

  // -- index ---------------------------------------------------------------

  private readIndex(): Result<RecordingSummary[] | null> {
    const raw = readKey(this.adapter, RECORDING_INDEX_KEY);
    if (!raw.ok) return raw;
    if (raw.value === null) return ok(null);
    const parsed = parseJson(raw.value, "recording list");
    if (!parsed.ok) return parsed;
    const doc = parsed.value;
    if (!isRecord(doc) || doc.kind !== "recordingIndex" || !Array.isArray(doc.entries)) {
      return fail("corrupt", "The recording list is damaged.");
    }
    if (isFiniteNumber(doc.schemaVersion) && doc.schemaVersion > RECORDING_INDEX_VERSION) {
      return fail("unsupportedVersion", "The recording list was written by a newer version of the app.");
    }
    if (!doc.entries.every(isSummary)) return fail("corrupt", "The recording list is damaged.");
    return ok((doc.entries as RecordingSummary[]).map((entry) => cloneJson(entry)));
  }

  private writeIndex(entries: RecordingSummary[]): Result<undefined> {
    const doc: RecordingIndexDoc = { schemaVersion: RECORDING_INDEX_VERSION, kind: "recordingIndex", entries: sortSummaries(entries) };
    return writeKey(this.adapter, RECORDING_INDEX_KEY, JSON.stringify(doc));
  }

  private upsertIndex(summary: RecordingSummary): Result<undefined> {
    const index = this.readIndex();
    let entries: RecordingSummary[];
    const warnings: string[] = [];
    if (index.ok && index.value !== null) {
      entries = index.value;
    } else {
      if (!index.ok && index.error.code === "unavailable") return failWith(index.error);
      const rebuilt = this.rebuildIndex();
      if (!rebuilt.ok) return rebuilt;
      entries = rebuilt.value;
      if (!index.ok) warnings.push("The recording list was damaged and has been rebuilt.");
    }
    const next = entries.filter((entry) => entry.id !== summary.id);
    next.push(summary);
    const written = this.writeIndex(next);
    if (!written.ok) return written;
    return ok(undefined, warnings);
  }
}

export function createRecordingStore(adapter: StorageAdapter, options: StoreOptions = {}): RecordingStore {
  return new RecordingStore(adapter, options);
}
