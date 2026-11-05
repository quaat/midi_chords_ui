/**
 * Local storage for user-authored and imported SongCharts ("pls:chart:<id>").
 *
 * Personal imports stay local: nothing here uploads or shares data, and imported charts are
 * marked `provenance.origin = "userImport"` by default because this app cannot verify a
 * file's claim to be original or cleared material.
 *
 * Files are wrapped in a versioned envelope `{ schemaVersion, kind: "songChart", chart }`.
 * A bare SongChart object (no envelope) is accepted as a version-0 document and wrapped.
 */

import type { SongChart } from "@/model/contracts";
import {
  isFiniteNumber,
  isNonEmptyString,
  isOneOf,
  isRecord,
  isString,
  isStringArray,
  validateKeyContextShape,
  validateTempoShape,
  validateTimeSignatureShape
} from "./guards";
import { parseJson, stableStringify } from "./json";
import { migrate, readSchemaVersion, type MigrationMap } from "./migrations";
import { fail, ok, type PersistenceErrorCode, type Result } from "./result";
import { checkIdSegment, listKeys, readKey, removeKey, writeKey, type StorageAdapter } from "./storage";
import { cloneJson, compareStrings, resolveStoreOptions, type ResolvedStoreOptions, type StoreOptions } from "./util";

export const CHART_SCHEMA_VERSION = 1;
export const CHART_KEY_PREFIX = "pls:chart:";

export function chartKey(id: string): string {
  return `${CHART_KEY_PREFIX}${id}`;
}

export interface ChartFile {
  schemaVersion: number;
  kind: "songChart";
  chart: SongChart;
  savedAt?: string;
}

export interface ChartSummary {
  id: string;
  title: string;
  version: number;
  origin: SongChart["provenance"]["origin"] | "unknown";
  problem?: PersistenceErrorCode;
}

export interface ChartImportOptions {
  /** Mark the chart as a personal import (default true). */
  markAsUserImport?: boolean;
}

const CONTENT_STATUSES = ["reviewed", "draft", "unavailable", "deferred"] as const;
const ORIGINS = ["original", "userImport", "cleared"] as const;
const EPSILON = 1e-6;

/** Quarter-note beats in a full bar of the given meter. */
function beatsPerBar(numerator: number, denominator: number): number {
  return (numerator * 4) / denominator;
}

/**
 * Structural validation of a SongChart: sections/bars/spans are well formed, spans fit
 * inside their bar without overlapping, ids are unique, and every performanceOrder entry
 * references an existing section. Returns issues (empty = valid).
 */
export function validateChartShape(value: unknown): string[] {
  if (!isRecord(value)) return ["chart must be an object"];
  const issues: string[] = [];
  if (!isNonEmptyString(value.id)) issues.push("chart.id must be a non-empty string");
  if (!isFiniteNumber(value.version)) issues.push("chart.version must be a number");
  if (!isString(value.title)) issues.push("chart.title must be a string");
  if (value.composer !== undefined && !isString(value.composer)) issues.push("chart.composer must be a string");
  if (value.key !== undefined) issues.push(...validateKeyContextShape(value.key, "chart.key"));
  const meterIssues = validateTimeSignatureShape(value.timeSignature, "chart.timeSignature");
  issues.push(...meterIssues);
  issues.push(...validateTempoShape(value.tempo, "chart.tempo"));
  if (value.pickupBeats !== undefined && (!isFiniteNumber(value.pickupBeats) || value.pickupBeats < 0)) {
    issues.push("chart.pickupBeats must be a number >= 0");
  }
  let fullBar: number | null = null;
  if (meterIssues.length === 0 && isRecord(value.timeSignature)) {
    fullBar = beatsPerBar(value.timeSignature.numerator as number, value.timeSignature.denominator as number);
  }

  const sectionIds = new Set<string>();
  const barIds = new Set<string>();
  const spanIds = new Set<string>();
  if (!Array.isArray(value.sections) || value.sections.length === 0) {
    issues.push("chart.sections must be a non-empty array");
  } else {
    value.sections.forEach((section: unknown, sectionIndex: number) => {
      const at = `chart.sections[${sectionIndex}]`;
      if (!isRecord(section)) {
        issues.push(`${at} must be an object`);
        return;
      }
      if (!isNonEmptyString(section.id)) issues.push(`${at}.id must be a non-empty string`);
      else if (sectionIds.has(section.id)) issues.push(`${at}.id "${section.id}" is used by more than one section`);
      else sectionIds.add(section.id);
      if (!isString(section.label)) issues.push(`${at}.label must be a string`);
      if (section.repeat !== undefined && (!isFiniteNumber(section.repeat) || !Number.isInteger(section.repeat) || section.repeat < 1)) {
        issues.push(`${at}.repeat must be a whole number >= 1`);
      }
      if (!Array.isArray(section.bars)) {
        issues.push(`${at}.bars must be an array`);
        return;
      }
      section.bars.forEach((bar: unknown, barIndex: number) => {
        const barAt = `${at}.bars[${barIndex}]`;
        if (!isRecord(bar)) {
          issues.push(`${barAt} must be an object`);
          return;
        }
        if (!isNonEmptyString(bar.id)) issues.push(`${barAt}.id must be a non-empty string`);
        else if (barIds.has(bar.id)) issues.push(`${barAt}.id "${bar.id}" is used by more than one bar`);
        else barIds.add(bar.id);
        let barLength: number | null = fullBar;
        if (bar.beats !== undefined) {
          if (!isFiniteNumber(bar.beats) || bar.beats <= 0) {
            issues.push(`${barAt}.beats must be a positive number`);
            barLength = null;
          } else {
            barLength = bar.beats;
          }
        }
        if (!Array.isArray(bar.spans)) {
          issues.push(`${barAt}.spans must be an array`);
          return;
        }
        const ranges: { start: number; end: number; index: number }[] = [];
        bar.spans.forEach((span: unknown, spanIndex: number) => {
          const spanAt = `${barAt}.spans[${spanIndex}]`;
          if (!isRecord(span)) {
            issues.push(`${spanAt} must be an object`);
            return;
          }
          if (!isNonEmptyString(span.id)) issues.push(`${spanAt}.id must be a non-empty string`);
          else if (spanIds.has(span.id)) issues.push(`${spanAt}.id "${span.id}" is used by more than one span`);
          else spanIds.add(span.id);
          if (!isString(span.symbol)) issues.push(`${spanAt}.symbol must be a string`);
          const startOk = isFiniteNumber(span.startBeat) && span.startBeat >= 0;
          const durationOk = isFiniteNumber(span.durationBeats) && span.durationBeats > 0;
          if (!startOk) issues.push(`${spanAt}.startBeat must be a number >= 0`);
          if (!durationOk) issues.push(`${spanAt}.durationBeats must be a positive number`);
          if (startOk && durationOk) {
            const start = span.startBeat as number;
            const end = start + (span.durationBeats as number);
            if (barLength !== null && end > barLength + EPSILON) issues.push(`${spanAt} ends after the bar (beat ${end} of ${barLength})`);
            ranges.push({ start, end, index: spanIndex });
          }
        });
        ranges.sort((a, b) => a.start - b.start || a.index - b.index);
        for (let i = 1; i < ranges.length; i += 1) {
          if (ranges[i].start < ranges[i - 1].end - EPSILON) {
            issues.push(`${barAt}.spans[${ranges[i].index}] overlaps spans[${ranges[i - 1].index}]`);
          }
        }
      });
    });
  }

  if (!Array.isArray(value.performanceOrder) || value.performanceOrder.length === 0) {
    issues.push("chart.performanceOrder must be a non-empty array of section ids");
  } else {
    value.performanceOrder.forEach((sectionId: unknown, index: number) => {
      if (!isString(sectionId)) issues.push(`chart.performanceOrder[${index}] must be a section id`);
      else if (!sectionIds.has(sectionId)) issues.push(`chart.performanceOrder[${index}] refers to unknown section "${sectionId}"`);
    });
  }

  const provenance = value.provenance;
  if (!isRecord(provenance) || !isOneOf(provenance.origin, ORIGINS)) {
    issues.push(`chart.provenance.origin must be one of ${ORIGINS.join(", ")}`);
  }
  if (!isStringArray(value.arrangementIds)) issues.push("chart.arrangementIds must be an array of strings");
  const meta = value.meta;
  if (!isRecord(meta)) {
    issues.push("chart.meta must be an object");
  } else {
    if (!isFiniteNumber(meta.version)) issues.push("chart.meta.version must be a number");
    if (!isOneOf(meta.status, CONTENT_STATUSES)) issues.push(`chart.meta.status must be one of ${CONTENT_STATUSES.join(", ")}`);
  }
  return issues;
}

function validateChartFileShape(value: unknown): string[] {
  if (!isRecord(value)) return ["chart file must be an object"];
  const issues: string[] = [];
  if (value.kind !== "songChart") issues.push('chart file kind must be "songChart"');
  issues.push(...validateChartShape(value.chart));
  return issues;
}

/** v0 → v1: a bare SongChart object becomes `{ kind: "songChart", chart }`. */
function wrapBareChart(doc: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(doc.sections) || !Array.isArray(doc.performanceOrder)) {
    throw new Error("expected a song chart with sections and performanceOrder");
  }
  return { schemaVersion: 1, kind: "songChart", chart: doc };
}

export const CHART_MIGRATIONS: MigrationMap = { 0: wrapBareChart };

export function chartFromUnknown(raw: unknown): Result<SongChart> {
  const migrated = migrate<ChartFile>(raw, CHART_MIGRATIONS, CHART_SCHEMA_VERSION, {
    label: "song chart",
    validate: validateChartFileShape
  });
  if (!migrated.ok) return migrated;
  return ok(migrated.value.chart, migrated.warnings);
}

/** Parse an exported chart (envelope or bare chart). Never throws; does not save. */
export function parseChartJson(text: string, options: ChartImportOptions = {}): Result<SongChart> {
  const parsed = parseJson(text, "song chart file");
  if (!parsed.ok) return parsed;
  const chart = chartFromUnknown(parsed.value);
  if (!chart.ok) return chart;
  if (options.markAsUserImport !== false && chart.value.provenance.origin !== "userImport") {
    const declared = chart.value.provenance.origin;
    chart.value.provenance = {
      ...chart.value.provenance,
      origin: "userImport",
      note: chart.value.provenance.note ?? `Imported locally; the file declared origin "${declared}".`
    };
  }
  return chart;
}

export function exportChartJson(chart: SongChart): string {
  const file: ChartFile = { schemaVersion: CHART_SCHEMA_VERSION, kind: "songChart", chart };
  return stableStringify(file);
}

export class ChartStore {
  private readonly adapter: StorageAdapter;
  private readonly options: ResolvedStoreOptions;

  constructor(adapter: StorageAdapter, options: StoreOptions = {}) {
    this.adapter = adapter;
    this.options = resolveStoreOptions(options);
  }

  /** Summaries sorted by title then id (reads each chart record; charts are few). */
  list(): Result<ChartSummary[]> {
    const keys = listKeys(this.adapter, CHART_KEY_PREFIX);
    if (!keys.ok) return keys;
    const out: ChartSummary[] = [];
    const warnings: string[] = [];
    for (const key of keys.value) {
      const id = key.slice(CHART_KEY_PREFIX.length);
      const raw = readKey(this.adapter, key);
      if (!raw.ok) return raw;
      if (raw.value === null) continue;
      const parsed = parseJson(raw.value, "saved song chart");
      const chart = parsed.ok ? chartFromUnknown(parsed.value) : parsed;
      if (chart.ok) {
        out.push({ id: chart.value.id, title: chart.value.title, version: chart.value.version, origin: chart.value.provenance.origin });
      } else {
        out.push({ id, title: id, version: 0, origin: "unknown", problem: chart.error.code });
        warnings.push(`Song chart "${id}" cannot be opened: ${chart.error.message}`);
      }
    }
    out.sort((a, b) => compareStrings(a.title.toLowerCase(), b.title.toLowerCase()) || compareStrings(a.id, b.id));
    return ok(out, warnings);
  }

  get(id: string): Result<SongChart | null> {
    const checked = checkIdSegment(id, "song chart");
    if (!checked.ok) return checked;
    const raw = readKey(this.adapter, chartKey(id));
    if (!raw.ok) return raw;
    if (raw.value === null) return ok(null);
    const parsed = parseJson(raw.value, "saved song chart");
    if (!parsed.ok) return parsed;
    return chartFromUnknown(parsed.value);
  }

  /** Validate and save; a failed write leaves the previous version intact. */
  save(chart: SongChart): Result<SongChart> {
    const checked = checkIdSegment(chart.id, "song chart");
    if (!checked.ok) return checked;
    const issues = validateChartShape(chart);
    if (issues.length > 0) return fail("invalid", "The song chart has problems and was not saved.", { details: issues });
    const key = chartKey(chart.id);
    const existing = readKey(this.adapter, key);
    if (!existing.ok) return existing;
    if (existing.value !== null) {
      const parsed = parseJson(existing.value, "saved song chart");
      if (parsed.ok && isRecord(parsed.value)) {
        const version = readSchemaVersion(parsed.value);
        if (version !== null && version > CHART_SCHEMA_VERSION) {
          return fail("unsupportedVersion", "This song chart was saved by a newer version of the app; update the app to change it.", {
            preserved: existing.value
          });
        }
      }
    }
    const file: ChartFile = { schemaVersion: CHART_SCHEMA_VERSION, kind: "songChart", chart: cloneJson(chart), savedAt: this.options.now().toISOString() };
    const written = writeKey(this.adapter, key, JSON.stringify(file));
    if (!written.ok) return written;
    return ok(cloneJson(chart));
  }

  remove(id: string): Result<boolean> {
    const checked = checkIdSegment(id, "song chart");
    if (!checked.ok) return checked;
    const existing = readKey(this.adapter, chartKey(id));
    if (!existing.ok) return existing;
    const removed = removeKey(this.adapter, chartKey(id));
    if (!removed.ok) return removed;
    return ok(existing.value !== null);
  }

  importChartJson(text: string, options: ChartImportOptions = {}): Result<SongChart> {
    return parseChartJson(text, options);
  }

  exportChartJson(chart: SongChart): string {
    return exportChartJson(chart);
  }
}

export function createChartStore(adapter: StorageAdapter, options: StoreOptions = {}): ChartStore {
  return new ChartStore(adapter, options);
}
