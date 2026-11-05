import { describe, expect, it } from "vitest";
import { createStores, estimateUsageBytes, exportAll, importAll } from "@/persistence";
import { createMemoryAdapter } from "@/persistence/storage";
import { counterIds, makeAttempt, makeChart, makeEvidence, makeSequence, steppingClock } from "./helpers";

function populated() {
  const stores = createStores(createMemoryAdapter(), { now: steppingClock(), newId: counterIds() });
  const project = stores.projects.createProject("Backup me", makeSequence(), "Dm9 G13 Cmaj9");
  if (!project.ok) throw project.error;
  stores.charts.save(makeChart());
  stores.progress.recordAttempt(makeAttempt("a1"), [makeEvidence("independent", "2026-11-01T10:05:00.000Z")]);
  stores.preferences.update({ theme: "dark", onboardingChoice: "learningChords" });
  return { stores, project: project.value };
}

describe("backup", () => {
  it("export/import replace round trip", () => {
    const { stores, project } = populated();
    const exported = exportAll(stores, new Date("2026-11-04T00:00:00.000Z"));
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    const doc = JSON.parse(exported.value) as Record<string, unknown>;
    expect(doc).toMatchObject({ schemaVersion: 1, kind: "pls-backup", exportedAt: "2026-11-04T00:00:00.000Z" });

    const target = createStores(createMemoryAdapter(), { now: steppingClock("2026-12-01T00:00:00.000Z"), newId: (prefix) => `${prefix}-local` });
    target.projects.createProject("Will be removed", makeSequence("other"));
    const report = importAll(exported.value, target, "replace");
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value).toMatchObject({ projects: { written: 1, removed: 1 }, charts: { written: 1 }, progress: "replaced", preferences: "replaced" });
    const restored = target.projects.get(project.id);
    expect(restored.ok && restored.value).toEqual(project);
    const listed = target.projects.list();
    expect(listed.ok && listed.value.map((entry) => entry.id)).toEqual([project.id]);
    const progress = target.progress.load();
    expect(progress.ok && progress.value.attempts.map((attempt) => attempt.id)).toEqual(["a1"]);
    const prefs = target.preferences.get();
    expect(prefs.ok && prefs.value).toMatchObject({ theme: "dark", onboardingChoice: "learningChords" });
    const chart = target.charts.get("chart-1");
    expect(chart.ok && chart.value?.provenance.origin).toBe("original");
  });

  it("merge does not duplicate and keeps local preferences", () => {
    const { stores } = populated();
    const exported = exportAll(stores);
    if (!exported.ok) throw exported.error;
    stores.preferences.update({ theme: "light" });
    const report = importAll(exported.value, stores, "merge");
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.projects).toMatchObject({ written: 0, skipped: 1 });
    expect(report.value.preferences).toBe("kept");
    const progress = stores.progress.load();
    expect(progress.ok && progress.value.attempts).toHaveLength(1);
    expect(progress.ok && progress.value.evidence).toHaveLength(1);
    const listed = stores.projects.list();
    expect(listed.ok && listed.value).toHaveLength(1);
    const prefs = stores.preferences.get();
    expect(prefs.ok && prefs.value.theme).toBe("light");
  });

  it("rejects corrupt and newer backups without touching data", () => {
    const { stores } = populated();
    const before = estimateUsageBytes(stores.adapter);
    const corrupt = importAll("{nope", stores, "replace");
    expect(!corrupt.ok && corrupt.error.code).toBe("corrupt");
    const future = importAll(JSON.stringify({ schemaVersion: 2, kind: "pls-backup", projects: [], charts: [], progress: null, preferences: null }), stores, "replace");
    expect(!future.ok && future.error.code).toBe("unsupportedVersion");
    const wrongKind = importAll(JSON.stringify({ schemaVersion: 1, kind: "project", projects: [], charts: [], progress: null, preferences: null }), stores, "replace");
    expect(!wrongKind.ok && wrongKind.error.code).toBe("invalid");
    expect(estimateUsageBytes(stores.adapter)).toBe(before);
  });

  it("skips damaged entries with warnings", () => {
    const target = createStores(createMemoryAdapter());
    const text = JSON.stringify({ schemaVersion: 1, kind: "pls-backup", exportedAt: "2026-11-04T00:00:00.000Z", projects: [{ schemaVersion: 1, kind: "project" }], charts: [], progress: null, preferences: null });
    const report = importAll(text, target, "merge");
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.projects).toMatchObject({ written: 0, skipped: 1 });
    expect(report.warnings.join(" ")).toMatch(/Skipped project #1/);
  });

  it("estimateUsageBytes counts only this app's keys", () => {
    const adapter = createMemoryAdapter({ "other-app": "x".repeat(100), "pls:a": "1234" });
    expect(estimateUsageBytes(adapter)).toBe((5 + 4) * 2);
  });
});
