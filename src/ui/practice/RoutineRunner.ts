/**
 * Routine runner (plan E28): an ordered playlist of content items (warm-up, exercise, chart
 * section, concept) with per-item settings, resumable from `progress.routineState`.
 *
 * - Routines are content (`contentBundle.routines`). Progress stores only
 *   `{ itemIndex, completedItemIds }` per routine (saved after every item).
 * - Learner edits (per-item tempo/key/assistance) and added song sections are kept in
 *   localStorage under `pls:ui:routine-overrides` through the stores' adapter, because the
 *   progress contract has no field for them.
 * - Completing a routine is never treated as evidence of mastery or healthy technique.
 *
 * Pure cursor functions (`resumeCursor`, `completeItem`, `skipItem`, ...) are tested in
 * test/ui/practiceRoutine.test.ts; the runtime-facing functions drive Practice via openExercise.ts.
 */
import type { AssistanceLevel, PracticeRoutine, RoutineItem, SpelledPitchClass } from "@/model/contracts";
import { getChart, getConcept, getExerciseSpec, getRoutine, getWarmup } from "@/content";
import type { ProgressStore, StorageAdapter } from "@/persistence";
import { createStore } from "@/state/sessionStore";
import type { Store } from "@/state/sessionStore";
import { notifyProgressChanged } from "@/ui/myPractice/progressStore";
import type { OpenResult } from "@/ui/practice/openExercise";
import { defaultArrangementId, openArrangementInPractice, openExerciseInPractice, openWarmupInPractice } from "@/ui/practice/openExercise";
import type { PracticeNavigator, PracticeRoutineRef } from "@/ui/practice/practiceRequests";
import { requestConcept } from "@/ui/practice/practiceRequests";

// ---------------------------------------------------------------------------
// Pure cursor
// ---------------------------------------------------------------------------

export interface RoutineCursor {
  itemIndex: number;
  completedItemIds: string[];
}

/** First item at/after `from` that is not completed (items.length when none). */
export function nextPendingIndex(items: readonly RoutineItem[], completedItemIds: readonly string[], from: number): number {
  const done = new Set(completedItemIds);
  for (let i = Math.max(0, from); i < items.length; i += 1) {
    if (!done.has(items[i].id)) {
      return i;
    }
  }
  return items.length;
}

/** Where to continue from a stored state (unknown item ids are dropped; finished stays finished). */
export function resumeCursor(items: readonly RoutineItem[], stored?: { itemIndex: number; completedItemIds: string[] } | null): RoutineCursor {
  if (!stored) {
    return { itemIndex: 0, completedItemIds: [] };
  }
  const ids = new Set(items.map((item) => item.id));
  const completed = stored.completedItemIds.filter((id) => ids.has(id));
  const start = Math.max(0, Math.min(items.length, Math.floor(Number.isFinite(stored.itemIndex) ? stored.itemIndex : 0)));
  return { itemIndex: start >= items.length ? items.length : nextPendingIndex(items, completed, start), completedItemIds: completed };
}

/** Mark an item done and move to the next pending item after it. */
export function completeItem(items: readonly RoutineItem[], cursor: RoutineCursor, itemId: string): RoutineCursor {
  const index = items.findIndex((item) => item.id === itemId);
  if (index < 0) {
    return cursor;
  }
  const completed = cursor.completedItemIds.includes(itemId) ? cursor.completedItemIds.slice() : [...cursor.completedItemIds, itemId];
  return { itemIndex: nextPendingIndex(items, completed, index + 1), completedItemIds: completed };
}

/** Move past the current item without completing it. */
export function skipItem(items: readonly RoutineItem[], cursor: RoutineCursor): RoutineCursor {
  const next = Math.min(items.length, cursor.itemIndex + 1);
  return { itemIndex: next >= items.length ? items.length : nextPendingIndex(items, cursor.completedItemIds, next), completedItemIds: cursor.completedItemIds.slice() };
}

export function isRoutineFinished(items: readonly RoutineItem[], cursor: RoutineCursor): boolean {
  return cursor.itemIndex >= items.length;
}

// ---------------------------------------------------------------------------
// Learner overrides (kept outside the progress contract)
// ---------------------------------------------------------------------------

export const ROUTINE_OVERRIDES_KEY = "pls:ui:routine-overrides";

export interface RoutineItemOverride {
  tempoBpm?: number;
  key?: SpelledPitchClass;
  assistance?: AssistanceLevel;
}

export interface RoutineOverrides {
  items: Record<string, RoutineItemOverride>;
  added: RoutineItem[];
}

export function emptyOverrides(): RoutineOverrides {
  return { items: {}, added: [] };
}

function readAll(adapter: StorageAdapter): Record<string, RoutineOverrides> {
  try {
    const raw = adapter.get(ROUTINE_OVERRIDES_KEY);
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, RoutineOverrides>) : {};
  } catch {
    return {};
  }
}

export function readRoutineOverrides(adapter: StorageAdapter, routineId: string): RoutineOverrides {
  const found = readAll(adapter)[routineId];
  if (!found || typeof found !== "object") {
    return emptyOverrides();
  }
  return {
    items: found.items && typeof found.items === "object" ? found.items : {},
    added: Array.isArray(found.added) ? found.added.filter((item) => item && typeof item.id === "string" && typeof item.refId === "string") : []
  };
}

export function writeRoutineOverrides(adapter: StorageAdapter, routineId: string, overrides: RoutineOverrides): boolean {
  try {
    const all = readAll(adapter);
    all[routineId] = overrides;
    adapter.set(ROUTINE_OVERRIDES_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

/** Content items with the learner's per-item edits applied, plus added items. */
export function effectiveItems(routine: PracticeRoutine, overrides: RoutineOverrides): RoutineItem[] {
  const items = [...routine.items, ...overrides.added];
  return items.map((item) => {
    const patch = overrides.items[item.id];
    if (!patch) {
      return item;
    }
    const settings = { ...item.settings };
    if (patch.tempoBpm !== undefined) settings.tempoBpm = patch.tempoBpm;
    if (patch.key !== undefined) settings.key = patch.key;
    if (patch.assistance !== undefined) settings.assistance = patch.assistance;
    return { ...item, settings };
  });
}

/** Learner-facing title of an item. */
export function routineItemTitle(item: RoutineItem): string {
  switch (item.kind) {
    case "exercise": {
      const spec = getExerciseSpec(item.refId);
      return spec ? spec.title : item.refId;
    }
    case "warmup": {
      const warmup = getWarmup(item.refId);
      return warmup ? warmup.title : item.refId;
    }
    case "chart": {
      const chart = getChart(item.refId);
      const section = chart && item.settings.sectionId ? chart.sections.find((candidate) => candidate.id === item.settings.sectionId) : undefined;
      return chart ? `${chart.title}${section ? `, section ${section.label}` : ""}` : item.refId;
    }
    case "concept": {
      const concept = getConcept(item.refId);
      return concept ? `Read: ${concept.title}` : item.refId;
    }
    default:
      return item.refId;
  }
}

export const ROUTINE_KIND_LABELS: Readonly<Record<RoutineItem["kind"], string>> = {
  warmup: "Warm-up",
  exercise: "Exercise",
  chart: "Song",
  concept: "Concept"
};

// ---------------------------------------------------------------------------
// Active routine (runtime-facing)
// ---------------------------------------------------------------------------

export interface ActiveRoutine {
  routineId: string;
  title: string;
  items: RoutineItem[];
  cursor: RoutineCursor;
  paused: boolean;
  message: string | null;
}

export interface RoutineState {
  active: ActiveRoutine | null;
}

export const routineStore: Store<RoutineState> = createStore<RoutineState>({ active: null });

/** What the routine functions need from the runtime. */
export interface RoutineRuntime extends PracticeNavigator {
  stores: { progress: ProgressStore; adapter: StorageAdapter };
  navigate: PracticeNavigator["navigate"] & { openEntry: (view: "workspace" | "learn" | "songs" | "myPractice") => void };
}

function setActive(active: ActiveRoutine | null): void {
  routineStore.setState({ active });
}

function save(runtime: RoutineRuntime, active: ActiveRoutine): string | null {
  const result = runtime.stores.progress.setRoutineState(active.routineId, {
    itemIndex: active.cursor.itemIndex,
    completedItemIds: active.cursor.completedItemIds
  });
  notifyProgressChanged();
  return result.ok ? null : `Routine progress was not saved: ${result.error.message}`;
}

function loadActive(runtime: RoutineRuntime, routineId: string, fromStart: boolean): ActiveRoutine | null {
  const routine = getRoutine(routineId);
  if (!routine) {
    return null;
  }
  const items = effectiveItems(routine, readRoutineOverrides(runtime.stores.adapter, routineId));
  const stored = fromStart ? null : runtime.stores.progress.getRoutineState(routineId);
  let cursor = resumeCursor(items, stored);
  if (isRoutineFinished(items, cursor)) {
    cursor = { itemIndex: 0, completedItemIds: [] };
  }
  return { routineId, title: routine.title, items, cursor, paused: false, message: null };
}

/** Open one item. Concept items open Learn (and count as done once opened). */
export function openRoutineItem(runtime: RoutineRuntime, active: ActiveRoutine, index: number): OpenResult {
  const item = active.items[index];
  if (!item) {
    return { ok: false, message: "That routine item does not exist." };
  }
  const routine: PracticeRoutineRef = { routineId: active.routineId, itemId: item.id };
  const settings = item.settings;
  switch (item.kind) {
    case "exercise": {
      const spec = getExerciseSpec(item.refId);
      const transpose = settings.key && spec && spec.key && (spec.key.tonic.letter !== settings.key.letter || spec.key.tonic.accidental !== settings.key.accidental) ? settings.key : undefined;
      return openExerciseInPractice(runtime, item.refId, { transposeTo: transpose, tempoBpm: settings.tempoBpm, assistance: settings.assistance, routine });
    }
    case "warmup":
      return openWarmupInPractice(runtime, item.refId, { tempoBpm: settings.tempoBpm, repeats: settings.repeats, hand: settings.hand, assistance: settings.assistance, routine });
    case "chart": {
      const chart = getChart(item.refId);
      if (!chart) {
        return { ok: false, message: `The song chart "${item.refId}" was not found.` };
      }
      const arrangementId = defaultArrangementId(chart);
      if (!arrangementId) {
        return { ok: false, message: `"${chart.title}" has no arrangement to practise.` };
      }
      return openArrangementInPractice(runtime, chart.id, arrangementId, { sectionId: settings.sectionId, tempoBpm: settings.tempoBpm, assistance: settings.assistance, routine });
    }
    case "concept":
      requestConcept(item.refId);
      runtime.navigate.openEntry("learn");
      return { ok: true, message: "Opened the concept in Learn." };
    default:
      return { ok: false, message: "Unknown routine item." };
  }
}

function openCurrent(runtime: RoutineRuntime, active: ActiveRoutine): OpenResult {
  if (isRoutineFinished(active.items, active.cursor)) {
    const finished = { ...active, message: "Routine finished. Completing it is a practice habit, not a mastery score." };
    setActive(finished);
    return { ok: true, message: finished.message ?? "" };
  }
  const result = openRoutineItem(runtime, active, active.cursor.itemIndex);
  const item = active.items[active.cursor.itemIndex];
  if (result.ok && item && item.kind === "concept") {
    // Reading a concept page completes that item.
    const next = { ...active, cursor: completeItem(active.items, active.cursor, item.id), message: null };
    setActive(next);
    save(runtime, next);
    return result;
  }
  setActive({ ...active, paused: false, message: result.ok ? null : result.message });
  return result;
}

/** Start (or resume from saved progress) a content routine and open its current item. */
export function startRoutine(runtime: RoutineRuntime, routineId: string, options: { fromStart?: boolean } = {}): OpenResult {
  const active = loadActive(runtime, routineId, options.fromStart === true);
  if (!active) {
    return { ok: false, message: `The routine "${routineId}" was not found.` };
  }
  const message = save(runtime, active);
  setActive({ ...active, message });
  return openCurrent(runtime, routineStore.getState().active ?? active);
}

/** Called by Practice after an attempt for a routine item was recorded. */
export function completeRoutineItem(runtime: RoutineRuntime, ref: PracticeRoutineRef): void {
  const active = routineStore.getState().active;
  if (!active || active.routineId !== ref.routineId) {
    return;
  }
  const next: ActiveRoutine = { ...active, cursor: completeItem(active.items, active.cursor, ref.itemId), message: null };
  next.message = save(runtime, next);
  if (isRoutineFinished(next.items, next.cursor) && next.message === null) {
    next.message = "Routine finished. Completing it is a practice habit, not a mastery score.";
  }
  setActive(next);
}

export function continueRoutine(runtime: RoutineRuntime): OpenResult {
  const active = routineStore.getState().active;
  if (!active) {
    return { ok: false, message: "No routine is active." };
  }
  return openCurrent(runtime, active);
}

export function skipRoutineItem(runtime: RoutineRuntime): OpenResult {
  const active = routineStore.getState().active;
  if (!active) {
    return { ok: false, message: "No routine is active." };
  }
  const next: ActiveRoutine = { ...active, cursor: skipItem(active.items, active.cursor), message: null };
  next.message = save(runtime, next);
  setActive(next);
  if (next.paused) {
    return { ok: true, message: "Skipped." };
  }
  return openCurrent(runtime, next);
}

export function pauseRoutine(runtime: RoutineRuntime): void {
  const active = routineStore.getState().active;
  if (!active) {
    return;
  }
  const next: ActiveRoutine = { ...active, paused: true };
  next.message = save(runtime, next) ?? "Paused — your place is saved. Resume any time, also after a reload.";
  setActive(next);
}

export function resumeRoutine(runtime: RoutineRuntime): OpenResult {
  const active = routineStore.getState().active;
  if (!active) {
    return { ok: false, message: "No routine is active." };
  }
  return openCurrent(runtime, { ...active, paused: false });
}

export function stopRoutine(): void {
  setActive(null);
}

/** Jump to an item (it stays pending until an attempt is recorded). */
export function openRoutineItemAt(runtime: RoutineRuntime, index: number): OpenResult {
  const active = routineStore.getState().active;
  if (!active || index < 0 || index >= active.items.length) {
    return { ok: false, message: "That routine item does not exist." };
  }
  const next: ActiveRoutine = { ...active, cursor: { itemIndex: index, completedItemIds: active.cursor.completedItemIds.slice() }, paused: false, message: null };
  setActive(next);
  save(runtime, next);
  return openCurrent(runtime, next);
}

/** Save per-item edits (tempo/key/assistance) for the active routine. */
export function updateRoutineItem(runtime: RoutineRuntime, itemId: string, override: RoutineItemOverride): boolean {
  const active = routineStore.getState().active;
  if (!active) {
    return false;
  }
  const overrides = readRoutineOverrides(runtime.stores.adapter, active.routineId);
  const merged: RoutineItemOverride = { ...(overrides.items[itemId] ?? {}), ...override };
  overrides.items = { ...overrides.items, [itemId]: merged };
  const saved = writeRoutineOverrides(runtime.stores.adapter, active.routineId, overrides);
  const routine = getRoutine(active.routineId);
  if (routine) {
    setActive({ ...active, items: effectiveItems(routine, overrides), message: saved ? "Item settings saved." : "Item settings apply now but could not be saved in this browser." });
  }
  return saved;
}

/** Reset the learner's edits of one item back to the authored settings. */
export function resetRoutineItem(runtime: RoutineRuntime, itemId: string): void {
  const active = routineStore.getState().active;
  if (!active) {
    return;
  }
  const overrides = readRoutineOverrides(runtime.stores.adapter, active.routineId);
  const items = { ...overrides.items };
  delete items[itemId];
  overrides.items = items;
  writeRoutineOverrides(runtime.stores.adapter, active.routineId, overrides);
  const routine = getRoutine(active.routineId);
  if (routine) {
    setActive({ ...active, items: effectiveItems(routine, overrides), message: "Item settings reset." });
  }
}

/** Append a song section (same item contract as authored chart items) to the active routine. */
export function addChartSectionToRoutine(runtime: RoutineRuntime, chartId: string, sectionId: string, tempoBpm?: number): boolean {
  const active = routineStore.getState().active;
  if (!active) {
    return false;
  }
  const overrides = readRoutineOverrides(runtime.stores.adapter, active.routineId);
  const settings: RoutineItem["settings"] = { sectionId };
  if (tempoBpm !== undefined) settings.tempoBpm = tempoBpm;
  const item: RoutineItem = { id: `user-${chartId}-${sectionId}-${Date.now().toString(36)}`, kind: "chart", refId: chartId, settings };
  overrides.added = [...overrides.added, item];
  const saved = writeRoutineOverrides(runtime.stores.adapter, active.routineId, overrides);
  const routine = getRoutine(active.routineId);
  if (routine) {
    const items = effectiveItems(routine, overrides);
    const cursor = isRoutineFinished(active.items, active.cursor) ? { itemIndex: items.length - 1, completedItemIds: active.cursor.completedItemIds } : active.cursor;
    setActive({ ...active, items, cursor, message: saved ? "Song section added to the routine." : "Added for now; it could not be saved in this browser." });
  }
  return saved;
}

/** Saved routines that can be resumed (not finished), newest first. */
export function resumableRoutines(routineState: Record<string, { itemIndex: number; completedItemIds: string[]; updatedAt: string }>, adapter: StorageAdapter | null): { routineId: string; title: string; itemIndex: number; itemCount: number; nextTitle: string; updatedAt: string }[] {
  const out: { routineId: string; title: string; itemIndex: number; itemCount: number; nextTitle: string; updatedAt: string }[] = [];
  Object.keys(routineState).forEach((routineId) => {
    const routine = getRoutine(routineId);
    if (!routine) {
      return;
    }
    const items = effectiveItems(routine, adapter ? readRoutineOverrides(adapter, routineId) : emptyOverrides());
    const cursor = resumeCursor(items, routineState[routineId]);
    if (isRoutineFinished(items, cursor)) {
      return;
    }
    out.push({
      routineId,
      title: routine.title,
      itemIndex: cursor.itemIndex,
      itemCount: items.length,
      nextTitle: routineItemTitle(items[cursor.itemIndex]),
      updatedAt: routineState[routineId].updatedAt
    });
  });
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}
