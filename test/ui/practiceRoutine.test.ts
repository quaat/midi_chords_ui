import { beforeEach, describe, expect, it } from "vitest";
import type { RoutineItem } from "@/model/contracts";
import { getRoutine } from "@/content";
import { createMemoryAdapter, createStores } from "@/persistence";
import type { PracticePayload, PracticeRequest } from "@/ui/runtime/practicePayload";
import { clearRequestExtras, consumeConceptRequest, getRequestExtras } from "@/ui/practice/practiceRequests";
import {
  ROUTINE_OVERRIDES_KEY,
  addChartSectionToRoutine,
  completeItem,
  completeRoutineItem,
  continueRoutine,
  effectiveItems,
  emptyOverrides,
  isRoutineFinished,
  nextPendingIndex,
  pauseRoutine,
  readRoutineOverrides,
  resumableRoutines,
  resumeCursor,
  routineStore,
  skipItem,
  skipRoutineItem,
  startRoutine,
  stopRoutine,
  updateRoutineItem,
  writeRoutineOverrides
} from "@/ui/practice/RoutineRunner";
import type { RoutineRuntime } from "@/ui/practice/RoutineRunner";

function items(...ids: string[]): RoutineItem[] {
  return ids.map((id) => ({ id, kind: "exercise", refId: `ex-${id}`, settings: {} }));
}

function fakeRuntime(): RoutineRuntime & { opened: PracticePayload[]; entries: string[] } {
  let request: PracticeRequest | null = null;
  let counter = 0;
  const opened: PracticePayload[] = [];
  const entries: string[] = [];
  const stores = createStores(createMemoryAdapter());
  return {
    opened,
    entries,
    stores: { progress: stores.progress, adapter: stores.adapter },
    navigate: {
      openInPractice: (payload: PracticePayload) => {
        counter += 1;
        request = { ...payload, requestId: counter, requestedAt: 0 };
        opened.push(payload);
      },
      openEntry: (view) => {
        entries.push(view);
      }
    },
    practiceRequestStore: { getState: () => ({ request }) }
  };
}

describe("routine cursor", () => {
  const list = items("a", "b", "c");

  it("finds the next pending item", () => {
    expect(nextPendingIndex(list, [], 0)).toBe(0);
    expect(nextPendingIndex(list, ["a", "b"], 0)).toBe(2);
    expect(nextPendingIndex(list, ["c"], 2)).toBe(3);
  });

  it("completes items in order and finishes", () => {
    let cursor = resumeCursor(list, null);
    expect(cursor).toEqual({ itemIndex: 0, completedItemIds: [] });
    cursor = completeItem(list, cursor, "a");
    expect(cursor).toEqual({ itemIndex: 1, completedItemIds: ["a"] });
    cursor = completeItem(list, cursor, "b");
    cursor = completeItem(list, cursor, "c");
    expect(isRoutineFinished(list, cursor)).toBe(true);
    expect(completeItem(list, cursor, "zzz")).toBe(cursor);
  });

  it("skips without completing and resumes from stored state", () => {
    const skipped = skipItem(list, { itemIndex: 0, completedItemIds: [] });
    expect(skipped).toEqual({ itemIndex: 1, completedItemIds: [] });
    // Resume: unknown ids are dropped, completed items are passed over.
    expect(resumeCursor(list, { itemIndex: 1, completedItemIds: ["b", "gone"] })).toEqual({ itemIndex: 2, completedItemIds: ["b"] });
    expect(resumeCursor(list, { itemIndex: 99, completedItemIds: [] }).itemIndex).toBe(3);
    expect(resumeCursor(list, { itemIndex: Number.NaN, completedItemIds: [] }).itemIndex).toBe(0);
  });
});

describe("routine overrides", () => {
  it("applies per-item settings and appended items without touching content", () => {
    const routine = getRoutine("routine-starter-15");
    if (!routine) throw new Error("missing routine");
    const adapter = createMemoryAdapter();
    expect(readRoutineOverrides(adapter, routine.id)).toEqual(emptyOverrides());
    const overrides = { items: { "rs15-2-scale": { tempoBpm: 60, assistance: "none" as const } }, added: [{ id: "user-x", kind: "chart" as const, refId: "evening-loop", settings: { sectionId: "B" } }] };
    expect(writeRoutineOverrides(adapter, routine.id, overrides)).toBe(true);
    expect(adapter.get(ROUTINE_OVERRIDES_KEY)).toContain("rs15-2-scale");
    const effective = effectiveItems(routine, readRoutineOverrides(adapter, routine.id));
    expect(effective).toHaveLength(routine.items.length + 1);
    expect(effective[1].settings.tempoBpm).toBe(60);
    expect(effective[1].settings.assistance).toBe("none");
    expect(effective[1].settings.range).toEqual(routine.items[1].settings.range);
    expect(routine.items[1].settings.tempoBpm).toBe(70);
  });
});

describe("routine runner with a runtime", () => {
  beforeEach(() => {
    clearRequestExtras();
    stopRoutine();
  });

  it("starts the starter routine at the warm-up with item settings and a routine ref", () => {
    const runtime = fakeRuntime();
    const result = startRoutine(runtime, "routine-starter-15");
    expect(result.ok).toBe(true);
    expect(runtime.opened).toHaveLength(1);
    const extras = getRequestExtras(result.requestId ?? -1);
    expect(extras?.source).toBe("warmup");
    expect(extras?.routine).toEqual({ routineId: "routine-starter-15", itemId: "rs15-1-warmup" });
    expect(extras?.exercise?.timeline.tempo.bpm).toBe(60);
    expect(runtime.stores.progress.getRoutineState("routine-starter-15")?.itemIndex).toBe(0);
  });

  it("saves after each item and resumes where it left off", () => {
    const runtime = fakeRuntime();
    startRoutine(runtime, "routine-starter-15");
    completeRoutineItem(runtime, { routineId: "routine-starter-15", itemId: "rs15-1-warmup" });
    const stored = runtime.stores.progress.getRoutineState("routine-starter-15");
    expect(stored?.itemIndex).toBe(1);
    expect(stored?.completedItemIds).toEqual(["rs15-1-warmup"]);
    pauseRoutine(runtime);
    expect(routineStore.getState().active?.paused).toBe(true);

    // "Reload": a fresh active state from the stored progress.
    stopRoutine();
    const resumed = startRoutine(runtime, "routine-starter-15");
    expect(resumed.ok).toBe(true);
    const extras = getRequestExtras(resumed.requestId ?? -1);
    expect(extras?.specId).toBe("ex-c-major-run");
    expect(extras?.tempoBpm).toBe(70);
    expect(extras?.assistance).toBe("reduced");

    const loaded = runtime.stores.progress.load();
    if (!loaded.ok) throw new Error("progress did not load");
    const listed = resumableRoutines(loaded.value.routineState, runtime.stores.adapter);
    expect(listed[0]?.routineId).toBe("routine-starter-15");
    expect(listed[0]?.itemIndex).toBe(1);
  });

  it("skips to the chart item, opens its section, and records edits and added sections", () => {
    const runtime = fakeRuntime();
    startRoutine(runtime, "routine-starter-15", { fromStart: true });
    skipRoutineItem(runtime); // → scale
    skipRoutineItem(runtime); // → harmony
    const third = skipRoutineItem(runtime); // → song
    expect(third.ok).toBe(true);
    const extras = getRequestExtras(third.requestId ?? -1);
    expect(extras?.chartId).toBe("evening-loop");
    expect(extras?.sectionId).toBe("A");
    expect(extras?.loopRegion).toBeTruthy();
    expect(routineStore.getState().active?.cursor.completedItemIds).toEqual([]);

    expect(updateRoutineItem(runtime, "rs15-4-song", { tempoBpm: 70 })).toBe(true);
    expect(routineStore.getState().active?.items[3].settings.tempoBpm).toBe(70);
    expect(addChartSectionToRoutine(runtime, "evening-loop", "B")).toBe(true);
    const active = routineStore.getState().active;
    expect(active?.items).toHaveLength(5);
    expect(active?.items[4]).toMatchObject({ kind: "chart", refId: "evening-loop", settings: { sectionId: "B" } });
  });

  it("opens concept items in Learn and hands over the concept id", () => {
    const runtime = fakeRuntime();
    startRoutine(runtime, "routine-starter-15");
    const active = routineStore.getState().active;
    if (!active) throw new Error("no active routine");
    routineStore.setState({ active: { ...active, items: [{ id: "c1", kind: "concept", refId: "triads", settings: {} }, ...active.items], cursor: { itemIndex: 0, completedItemIds: [] } } });
    continueRoutine(runtime);
    expect(runtime.entries).toContain("learn");
    expect(consumeConceptRequest()).toBe("triads");
    expect(routineStore.getState().active?.cursor.completedItemIds).toContain("c1");
  });
});
