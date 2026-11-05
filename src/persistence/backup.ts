/**
 * Whole-app backup: one "pls-backup" v1 JSON document with projects, charts, progress and
 * preferences. Every entry is validated before anything is written; damaged or too-new
 * entries are skipped with warnings instead of aborting the whole restore.
 */

import type { ProgressFile, ProjectFile, SongChart } from "@/model/contracts";
import { isRecord } from "./guards";
import { parseJson, stableStringify } from "./json";
import { migrate, type MigrationMap } from "./migrations";
import type { ChartStore } from "./charts";
import { chartFromUnknown } from "./charts";
import type { Preferences, PreferencesStore } from "./preferences";
import type { ProgressImportMode, ProgressStore } from "./progress";
import { progressFromUnknown } from "./progress";
import type { ProjectStore } from "./projects";
import { projectFromUnknown } from "./projects";
import { fail, ok, type Result } from "./result";
import { STORAGE_NAMESPACE, type StorageAdapter } from "./storage";

export const BACKUP_SCHEMA_VERSION = 1;
export const BACKUP_KIND = "pls-backup";

export interface BackupFile {
  schemaVersion: number;
  kind: typeof BACKUP_KIND;
  exportedAt: string;
  projects: ProjectFile[];
  charts: SongChart[];
  progress: ProgressFile | null;
  preferences: Preferences | null;
}

export interface BackupStores {
  projects: ProjectStore;
  charts: ChartStore;
  progress: ProgressStore;
  preferences: PreferencesStore;
}

export type BackupImportMode = ProgressImportMode;

export interface BackupImportReport {
  projects: { written: number; skipped: number; removed: number };
  charts: { written: number; skipped: number; removed: number };
  progress: "replaced" | "merged" | "skipped";
  preferences: "replaced" | "kept" | "skipped";
}

const BACKUP_MIGRATIONS: MigrationMap = {};

function validateBackupEnvelope(value: unknown): string[] {
  if (!isRecord(value)) return ["backup must be an object"];
  const issues: string[] = [];
  if (value.kind !== BACKUP_KIND) issues.push(`backup.kind must be "${BACKUP_KIND}"`);
  if (!Array.isArray(value.projects)) issues.push("backup.projects must be an array");
  if (!Array.isArray(value.charts)) issues.push("backup.charts must be an array");
  if (value.progress !== null && !isRecord(value.progress)) issues.push("backup.progress must be an object or null");
  if (value.preferences !== null && !isRecord(value.preferences)) issues.push("backup.preferences must be an object or null");
  return issues;
}

/** Collect everything into one backup document. Unreadable records are listed as warnings. */
export function exportAll(stores: BackupStores, now: Date = new Date()): Result<string> {
  const warnings: string[] = [];
  const projects: ProjectFile[] = [];
  const listed = stores.projects.list();
  if (!listed.ok) return listed;
  warnings.push(...listed.warnings);
  for (const summary of listed.value) {
    if (summary.problem !== undefined) {
      warnings.push(`Project "${summary.name}" was not included because it cannot be opened (${summary.problem}).`);
      continue;
    }
    const project = stores.projects.get(summary.id);
    if (project.ok && project.value !== null) projects.push(project.value);
    else if (!project.ok) warnings.push(`Project "${summary.name}" was not included: ${project.error.message}`);
  }
  const charts: SongChart[] = [];
  const chartList = stores.charts.list();
  if (!chartList.ok) return chartList;
  warnings.push(...chartList.warnings);
  for (const summary of chartList.value) {
    if (summary.problem !== undefined) continue;
    const chart = stores.charts.get(summary.id);
    if (chart.ok && chart.value !== null) charts.push(chart.value);
  }
  let progress: ProgressFile | null = null;
  const loadedProgress = stores.progress.load();
  if (loadedProgress.ok) progress = loadedProgress.value;
  else warnings.push(`Progress was not included: ${loadedProgress.error.message}`);
  let preferences: Preferences | null = null;
  const loadedPreferences = stores.preferences.get();
  if (loadedPreferences.ok) preferences = loadedPreferences.value;
  const backup: BackupFile = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    kind: BACKUP_KIND,
    exportedAt: now.toISOString(),
    projects,
    charts,
    progress,
    preferences
  };
  return ok(stableStringify(backup), warnings);
}

/**
 * Restore a backup. "replace" makes local data match the backup (projects/charts not in it
 * are removed, progress and preferences replaced). "merge" keeps local data: projects are
 * written when new or more recently updated, charts when new or of a higher version,
 * progress is unioned, and local preferences are kept.
 */
export function importAll(text: string, stores: BackupStores, mode: BackupImportMode): Result<BackupImportReport> {
  const parsed = parseJson(text, "backup file");
  if (!parsed.ok) return parsed;
  const envelope = migrate<Record<string, unknown>>(parsed.value, BACKUP_MIGRATIONS, BACKUP_SCHEMA_VERSION, {
    label: "backup",
    validate: validateBackupEnvelope
  });
  if (!envelope.ok) return envelope;
  const doc = envelope.value;
  const warnings: string[] = [...envelope.warnings];

  // 1. Validate everything first.
  const projects: ProjectFile[] = [];
  let projectsSkipped = 0;
  (doc.projects as unknown[]).forEach((raw, index) => {
    const project = projectFromUnknown(raw);
    if (project.ok) projects.push(project.value);
    else {
      projectsSkipped += 1;
      warnings.push(`Skipped project #${index + 1}: ${project.error.message}`);
    }
  });
  const charts: SongChart[] = [];
  let chartsSkipped = 0;
  (doc.charts as unknown[]).forEach((raw, index) => {
    const chart = chartFromUnknown(raw);
    if (chart.ok) charts.push(chart.value);
    else {
      chartsSkipped += 1;
      warnings.push(`Skipped song chart #${index + 1}: ${chart.error.message}`);
    }
  });
  let progressValid = false;
  if (doc.progress !== null) {
    const checked = progressFromUnknown(doc.progress, stores.progress.limits);
    if (checked.ok) progressValid = true;
    else warnings.push(`Progress was not restored: ${checked.error.message}`);
  }

  // 2. Write.
  const report: BackupImportReport = {
    projects: { written: 0, skipped: projectsSkipped, removed: 0 },
    charts: { written: 0, skipped: chartsSkipped, removed: 0 },
    progress: "skipped",
    preferences: "skipped"
  };

  const existingProjects = stores.projects.list();
  if (!existingProjects.ok) return existingProjects;
  for (const project of projects) {
    if (mode === "merge") {
      const current = existingProjects.value.find((entry) => entry.id === project.id);
      if (current !== undefined && current.problem === undefined && current.updatedAt >= project.updatedAt) {
        report.projects.skipped += 1;
        continue;
      }
    }
    const saved = stores.projects.save(project, { touch: false });
    if (!saved.ok) return fail(saved.error.code, `Restore stopped while saving project "${project.name}": ${saved.error.message}`, { details: warnings });
    report.projects.written += 1;
  }
  if (mode === "replace") {
    const keep = new Set(projects.map((project) => project.id));
    for (const entry of existingProjects.value) {
      if (keep.has(entry.id)) continue;
      const removed = stores.projects.remove(entry.id);
      if (removed.ok && removed.value) report.projects.removed += 1;
    }
  }

  const existingCharts = stores.charts.list();
  if (!existingCharts.ok) return existingCharts;
  for (const chart of charts) {
    if (mode === "merge") {
      const current = existingCharts.value.find((entry) => entry.id === chart.id);
      if (current !== undefined && current.problem === undefined && current.version >= chart.version) {
        report.charts.skipped += 1;
        continue;
      }
    }
    const saved = stores.charts.save(chart);
    if (!saved.ok) return fail(saved.error.code, `Restore stopped while saving song chart "${chart.title}": ${saved.error.message}`, { details: warnings });
    report.charts.written += 1;
  }
  if (mode === "replace") {
    const keep = new Set(charts.map((chart) => chart.id));
    for (const entry of existingCharts.value) {
      if (keep.has(entry.id)) continue;
      const removed = stores.charts.remove(entry.id);
      if (removed.ok && removed.value) report.charts.removed += 1;
    }
  }

  if (progressValid) {
    const imported = stores.progress.importDocument(doc.progress, mode);
    if (imported.ok) {
      report.progress = mode === "replace" ? "replaced" : "merged";
      warnings.push(...imported.warnings);
    } else {
      warnings.push(`Progress was not restored: ${imported.error.message}`);
    }
  }

  if (doc.preferences !== null) {
    if (mode === "replace") {
      const replaced = stores.preferences.replace(doc.preferences);
      if (replaced.ok) {
        report.preferences = "replaced";
        warnings.push(...replaced.warnings);
      } else {
        warnings.push(`Preferences were not restored: ${replaced.error.message}`);
      }
    } else {
      report.preferences = "kept";
    }
  }
  return ok(report, warnings);
}

/** Approximate bytes used by this app's keys (UTF-16: 2 bytes per character). */
export function estimateUsageBytes(adapter: StorageAdapter, prefix: string = STORAGE_NAMESPACE): number {
  try {
    let total = 0;
    for (const key of adapter.keys()) {
      if (!key.startsWith(prefix)) continue;
      const value = adapter.get(key);
      total += (key.length + (value === null ? 0 : value.length)) * 2;
    }
    return total;
  } catch {
    return 0;
  }
}
