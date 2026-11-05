import { describe, expect, it } from "vitest";
import type { ProjectFile } from "@/model/contracts";
import { PROJECT_INDEX_KEY, ProjectStore, projectKey } from "@/persistence/projects";
import { createMemoryAdapter } from "@/persistence/storage";
import { counterIds, makeSequence, quotaAdapter, steppingClock } from "./helpers";

function setup() {
  const adapter = createMemoryAdapter();
  const store = new ProjectStore(adapter, { now: steppingClock(), newId: counterIds() });
  return { adapter, store };
}

function mustCreate(store: ProjectStore, name: string): ProjectFile {
  const result = store.createProject(name, makeSequence(), "Dm9 G13 Cmaj9");
  if (!result.ok) throw result.error;
  return result.value;
}

describe("ProjectStore", () => {
  it("save/list/get/remove round trip", () => {
    const { store } = setup();
    const a = mustCreate(store, "First");
    const b = mustCreate(store, "Second");
    const listed = store.list();
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.value.map((entry) => entry.name)).toEqual(["Second", "First"]);
    const got = store.get(a.id);
    expect(got.ok && got.value).toEqual(a);
    const removed = store.remove(b.id);
    expect(removed.ok && removed.value).toBe(true);
    const again = store.get(b.id);
    expect(again.ok && again.value).toBeNull();
    const missing = store.remove("nope");
    expect(missing.ok && missing.value).toBe(false);
  });

  it("save bumps updatedAt and keeps createdAt", () => {
    const { store } = setup();
    const project = mustCreate(store, "Bump");
    const saved = store.save({ ...project, name: "Bumped" });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.createdAt).toBe(project.createdAt);
    expect(Date.parse(saved.value.updatedAt)).toBeGreaterThan(Date.parse(project.updatedAt));
    const listed = store.list();
    if (listed.ok) expect(listed.value[0]).toMatchObject({ name: "Bumped", updatedAt: saved.value.updatedAt });
  });

  it("updatedAt strictly increases even when the clock does not move", () => {
    const adapter = createMemoryAdapter();
    const store = new ProjectStore(adapter, { now: () => new Date("2026-11-01T00:00:00.000Z"), newId: counterIds() });
    const created = store.createProject("Same ms", makeSequence());
    if (!created.ok) throw created.error;
    const saved = store.save(created.value);
    if (!saved.ok) throw saved.error;
    expect(saved.value.updatedAt > created.value.updatedAt).toBe(true);
  });

  it("listing reads only the index and the index stays consistent after remove", () => {
    const { adapter, store } = setup();
    const a = mustCreate(store, "A");
    mustCreate(store, "B");
    store.remove(a.id);
    const index = JSON.parse(adapter.get(PROJECT_INDEX_KEY) as string) as { entries: { id: string }[] };
    expect(index.entries.map((entry) => entry.id)).toEqual(["project-2"]);
    // Corrupt a record: list() still uses the index without reading records.
    adapter.set(projectKey("project-2"), "{oops");
    const listed = store.list();
    expect(listed.ok && listed.value.map((entry) => entry.id)).toEqual(["project-2"]);
  });

  it("rebuilds a damaged index from the records", () => {
    const { adapter, store } = setup();
    mustCreate(store, "A");
    mustCreate(store, "B");
    adapter.set(PROJECT_INDEX_KEY, "not json");
    const listed = store.list();
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.map((entry) => entry.name).sort()).toEqual(["A", "B"]);
    expect(listed.warnings.join(" ")).toMatch(/rebuilt/);
    expect(JSON.parse(adapter.get(PROJECT_INDEX_KEY) as string).entries).toHaveLength(2);
  });

  it("rejects invalid projects without writing", () => {
    const { adapter, store } = setup();
    const bad = { ...mustCreate(store, "Ok"), id: "bad", sequence: { id: "s" } } as unknown as ProjectFile;
    const result = store.save(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid");
    expect(adapter.get(projectKey("bad"))).toBeNull();
  });

  it("export/import round trip with stable, pretty JSON", () => {
    const { store } = setup();
    const project = mustCreate(store, "Export me");
    const json = store.exportProjectJson(project);
    expect(json.startsWith('{\n  "schemaVersion": 1,\n  "kind": "project",\n  "id": ')).toBe(true);
    expect(store.exportProjectJson(JSON.parse(json) as ProjectFile)).toBe(json);
    const imported = store.importProjectJson(json);
    expect(imported.ok && imported.value).toEqual(project);
  });

  it("import can assign a fresh id", () => {
    const { store } = setup();
    const project = mustCreate(store, "Copy source");
    const imported = store.importProjectJson(store.exportProjectJson(project), { assignNewId: true });
    expect(imported.ok).toBe(true);
    if (imported.ok) {
      expect(imported.value.id).not.toBe(project.id);
      expect(imported.value.sequence.id).toBe(`${imported.value.id}-sequence`);
    }
  });

  it("corrupt JSON fails with code 'corrupt'", () => {
    const { store } = setup();
    const result = store.importProjectJson('{"schemaVersion": 1, "kind": ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("corrupt");
    const empty = store.importProjectJson("   ");
    expect(!empty.ok && empty.error.code).toBe("corrupt");
  });

  it("a newer schemaVersion fails as unsupportedVersion; stored data is untouched", () => {
    const { adapter, store } = setup();
    const project = mustCreate(store, "Future");
    const future = JSON.stringify({ ...project, schemaVersion: 99, extra: { fancy: true } });
    adapter.set(projectKey(project.id), future);
    const got = store.get(project.id);
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.error.code).toBe("unsupportedVersion");
    const save = store.save(project);
    expect(save.ok).toBe(false);
    if (!save.ok) expect(save.error.code).toBe("unsupportedVersion");
    expect(adapter.get(projectKey(project.id))).toBe(future);
    const imported = store.importProjectJson(future);
    expect(!imported.ok && imported.error.code).toBe("unsupportedVersion");
  });

  it("quota errors surface as 'quota' and leave the previous version intact", () => {
    const { adapter, arm } = quotaAdapter();
    const store = new ProjectStore(adapter, { now: steppingClock(), newId: counterIds() });
    const project = mustCreate(store, "Before");
    const before = adapter.get(projectKey(project.id));
    const indexBefore = adapter.get(PROJECT_INDEX_KEY);
    arm();
    const result = store.save({ ...project, name: "After" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("quota");
    expect(adapter.get(projectKey(project.id))).toBe(before);
    expect(adapter.get(PROJECT_INDEX_KEY)).toBe(indexBefore);
    const got = store.get(project.id);
    expect(got.ok && got.value?.name).toBe("Before");
  });

  it("rolls the record back when only the index write fails", () => {
    const inner = createMemoryAdapter();
    let failIndex = false;
    const adapter = {
      get: (key: string) => inner.get(key),
      set: (key: string, value: string) => {
        if (failIndex && key === PROJECT_INDEX_KEY) {
          const error = new Error("full");
          error.name = "QuotaExceededError";
          throw error;
        }
        inner.set(key, value);
      },
      remove: (key: string) => inner.remove(key),
      keys: () => inner.keys()
    };
    const store = new ProjectStore(adapter, { now: steppingClock(), newId: counterIds() });
    const project = mustCreate(store, "Original");
    const before = inner.get(projectKey(project.id));
    failIndex = true;
    const result = store.save({ ...project, name: "Changed" });
    expect(!result.ok && result.error.code).toBe("quota");
    expect(inner.get(projectKey(project.id))).toBe(before);
  });

  it("duplicate creates an independent copy", () => {
    const { store } = setup();
    const project = mustCreate(store, "Original");
    const copy = store.duplicate(project.id);
    expect(copy.ok).toBe(true);
    if (!copy.ok) return;
    expect(copy.value.id).not.toBe(project.id);
    expect(copy.value.name).toBe("Original (copy)");
    expect(copy.value.sequence.events).toEqual(project.sequence.events);
    expect(copy.value.sequence.id).not.toBe(project.sequence.id);
    const listed = store.list();
    expect(listed.ok && listed.value).toHaveLength(2);
    const missing = store.duplicate("missing");
    expect(missing.ok).toBe(false);
  });
});
