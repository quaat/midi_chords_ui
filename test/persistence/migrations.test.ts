import { describe, expect, it } from "vitest";
import type { ProjectFile } from "@/model/contracts";
import { migrate, NEEDS_RECOMPILE_SETTING, PROJECT_MIGRATIONS } from "@/persistence/migrations";
import { legacyTextToProject, parseProjectJson, projectNeedsRecompile, withRecompiledSequence } from "@/persistence/projects";
import { validateProjectShape } from "@/persistence/guards";
import { makeSequence } from "./helpers";

const ctx = { now: "2026-11-04T09:00:00.000Z", newId: (prefix: string) => `${prefix}-fixed` };

describe("migrate()", () => {
  it("applies sequential migrations keyed by fromVersion", () => {
    const migrations = {
      0: (doc: Record<string, unknown>) => ({ ...doc, a: 1 }),
      1: (doc: Record<string, unknown>) => ({ ...doc, b: (doc.a as number) + 1 })
    };
    const result = migrate<{ schemaVersion: number; a: number; b: number }>({ x: true }, migrations, 2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ x: true, a: 1, b: 2, schemaVersion: 2 });
      expect(result.warnings[0]).toMatch(/v0 to v2/);
    }
  });

  it("refuses newer versions with unsupportedVersion and leaves the input untouched", () => {
    const raw = { schemaVersion: 7, kind: "project", nested: { keep: [1, 2, 3] } };
    const snapshot = JSON.stringify(raw);
    const result = migrate(raw, PROJECT_MIGRATIONS, 1, { label: "project" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("unsupportedVersion");
      expect(result.error.message).toMatch(/Update the app/);
      expect(result.error.preserved).toBe(raw);
    }
    expect(JSON.stringify(raw)).toBe(snapshot);
  });

  it("does not mutate the input while migrating", () => {
    const raw = { kind: "legacyText", text: "Dm7 G7 Cmaj7", settings: { tempoBpm: 90 } };
    const snapshot = JSON.stringify(raw);
    const result = migrate(raw, PROJECT_MIGRATIONS, 1, { context: ctx });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(raw)).toBe(snapshot);
  });

  it("reports validation issues as 'invalid' with details", () => {
    const result = migrate({ schemaVersion: 1, kind: "project" }, PROJECT_MIGRATIONS, 1, { validate: validateProjectShape });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid");
      expect(result.error.details.length).toBeGreaterThan(0);
    }
  });

  it("rejects non-object and bad-version documents as invalid", () => {
    const notObject = migrate([1, 2], PROJECT_MIGRATIONS, 1);
    expect(!notObject.ok && notObject.error.code).toBe("invalid");
    const badVersion = migrate({ schemaVersion: "one" }, PROJECT_MIGRATIONS, 1);
    expect(!badVersion.ok && badVersion.error.code).toBe("invalid");
  });

  it("rejects an unversioned document that is not a legacy text project", () => {
    const result = migrate({ hello: "world" }, PROJECT_MIGRATIONS, 1, { label: "project" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid");
  });
});

describe("legacy v0 text projects", () => {
  it("migrates { kind: legacyText } into a ProjectFile flagged needsRecompile", () => {
    const text = "Dm9 | G13 | Cmaj9\n";
    const result = parseProjectJson(JSON.stringify({ kind: "legacyText", text, settings: { tempoBpm: 84, voicingMode: "close" } }), ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const project = result.value;
    expect(project.schemaVersion).toBe(1);
    expect(project.kind).toBe("project");
    expect(project.id).toBe("project-fixed");
    expect(project.name).toBe("Dm9 | G13 | Cmaj9");
    expect(project.sourceText).toBe(text);
    expect(project.sequence.events).toEqual([]);
    expect(project.sequence.tempo.bpm).toBe(84);
    expect(project.settings?.[NEEDS_RECOMPILE_SETTING]).toBe(true);
    expect(project.settings?.voicingMode).toBe("close");
    expect(projectNeedsRecompile(project)).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/v0 to v1/);
  });

  it("legacyTextToProject + withRecompiledSequence clears the flag", () => {
    const result = legacyTextToProject("C F G", undefined, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const recompiled: ProjectFile = withRecompiledSequence(result.value, makeSequence("seq-new"));
    expect(projectNeedsRecompile(recompiled)).toBe(false);
    expect(recompiled.sequence.events).toHaveLength(3);
    expect(recompiled.sourceText).toBe("C F G");
    expect(projectNeedsRecompile(result.value)).toBe(true);
  });
});
