import { describe, expect, it } from "vitest";
import type { ProjectFile } from "@/model/contracts";
import {
  HISTORY_LIMIT,
  canRedo,
  canUndo,
  createInitialCreateState,
  createReducer,
  deriveTextAndLost,
  isDirty,
  nextEventId,
  previewPathways
} from "@/ui/create/createState";
import type { CreateAction, CreateState } from "@/ui/create/createState";

const TEXT = "C | 1\nAm | 1\nF | 1\nG | 1";

function run(state: CreateState, ...actions: CreateAction[]): CreateState {
  return actions.reduce((current, action) => createReducer(current, action), state);
}

function initial(text: string = TEXT): CreateState {
  return createInitialCreateState({ text, sequenceId: "seq-test", name: "Test" });
}

describe("createState reducer", () => {
  it("parses the initial text into a sequence", () => {
    const state = initial();
    expect(state.present.sequence.events.map((e) => e.symbol)).toEqual(["C", "Am", "F", "G"]);
    expect(state.present.sequence.totalBeats).toBe(16);
    expect(state.present.sequence.version).toBe(1);
    expect(state.present.parseErrors).toEqual([]);
  });

  it("bumps the sequence version on every operation, including undo and redo", () => {
    let state = initial();
    const versions: number[] = [state.present.sequence.version];
    state = run(state, { type: "setTempo", bpm: 100 });
    versions.push(state.present.sequence.version);
    state = run(state, { type: "setDuration", eventId: "ev-2", beats: 2 });
    versions.push(state.present.sequence.version);
    state = run(state, { type: "undo" });
    versions.push(state.present.sequence.version);
    state = run(state, { type: "redo" });
    versions.push(state.present.sequence.version);
    for (let i = 1; i < versions.length; i += 1) {
      expect(versions[i]).toBeGreaterThan(versions[i - 1]);
    }
  });

  it("setDuration reflows later events and the total", () => {
    const state = run(initial(), { type: "setDuration", eventId: "ev-2", beats: 2 });
    const events = state.present.sequence.events;
    expect(events[1].durationBeats).toBe(2);
    expect(events[2].startBeat).toBe(6);
    expect(events[3].startBeat).toBe(10);
    expect(state.present.sequence.totalBeats).toBe(14);
    expect(state.present.text).toBe("C | 1\nAm | 0.5\nF | 1\nG | 1");
  });

  it("undo restores the previous document and redo re-applies it", () => {
    const start = initial();
    const edited = run(start, { type: "remove", eventId: "ev-3" });
    expect(edited.present.sequence.events.map((e) => e.symbol)).toEqual(["C", "Am", "G"]);
    expect(canUndo(edited)).toBe(true);
    const undone = run(edited, { type: "undo" });
    expect(undone.present.sequence.events.map((e) => e.symbol)).toEqual(["C", "Am", "F", "G"]);
    expect(undone.present.text).toBe(TEXT);
    expect(canRedo(undone)).toBe(true);
    const redone = run(undone, { type: "redo" });
    expect(redone.present.sequence.events.map((e) => e.symbol)).toEqual(["C", "Am", "G"]);
    expect(canRedo(redone)).toBe(false);
  });

  it("a new edit clears the redo stack", () => {
    const state = run(initial(), { type: "remove", eventId: "ev-1" }, { type: "undo" }, { type: "setTempo", bpm: 120 });
    expect(canRedo(state)).toBe(false);
  });

  it("bounds the history to HISTORY_LIMIT entries", () => {
    let state = initial();
    for (let i = 0; i < HISTORY_LIMIT + 20; i += 1) {
      state = run(state, { type: "setTempo", bpm: 60 + (i % 100) + (i >= 100 ? 1 : 0) });
      state = run(state, { type: "setTempo", bpm: 200 });
    }
    expect(state.past.length).toBe(HISTORY_LIMIT);
  });

  it("coalesces a typing burst into one undo step", () => {
    const state = run(initial(), { type: "setText", text: "C | 1\nD" }, { type: "setText", text: "C | 1\nDm" }, { type: "setText", text: "C | 1\nDm7 | 1" });
    expect(state.present.sequence.events.map((e) => e.symbol)).toEqual(["C", "Dm7"]);
    const undone = run(state, { type: "undo" });
    expect(undone.present.text).toBe(TEXT);
  });

  it("keeps parse errors while valid lines still become events", () => {
    const state = run(initial(), { type: "setText", text: "C | 1\nnot a chord\nG | 1" });
    expect(state.present.parseErrors.length).toBeGreaterThan(0);
    expect(state.present.sequence.events.map((e) => e.symbol)).toEqual(["C", "G"]);
  });

  it("rejects an invalid symbol with a notice and no history entry", () => {
    const start = initial();
    const state = run(start, { type: "setSymbol", eventId: "ev-1", symbol: "H#%" });
    expect(state.present).toBe(start.present);
    expect(state.notice).toMatch(/not a chord symbol/);
    expect(state.past.length).toBe(0);
  });

  it("setSymbol, insertAfter, move", () => {
    let state = run(initial(), { type: "setSymbol", eventId: "ev-1", symbol: "Cmaj7" });
    expect(state.present.sequence.events[0].symbol).toBe("Cmaj7");
    expect(state.present.sequence.events[0].chord?.quality).toBe("maj7");
    state = run(state, { type: "insertAfter", eventId: "ev-1", symbol: "Dm7", durationBeats: 2 });
    expect(state.present.sequence.events.map((e) => e.symbol)).toEqual(["Cmaj7", "Dm7", "Am", "F", "G"]);
    expect(state.present.sequence.events[1].id).toBe("ev-5");
    expect(state.selectedEventId).toBe("ev-5");
    state = run(state, { type: "move", eventId: "ev-5", delta: 10 });
    expect(state.present.sequence.events.map((e) => e.symbol)).toEqual(["Cmaj7", "Am", "F", "G", "Dm7"]);
    expect(state.present.sequence.events[4].startBeat).toBe(16);
    expect(nextEventId(state.present.sequence.events)).toBe("ev-6");
  });

  it("per-chord voicings are disclosed as lost in text, and 'all' sets the default", () => {
    let state = run(initial(), { type: "setVoicingRecipe", eventId: "ev-2", recipeId: "close-triads-rh" });
    expect(state.present.sequence.events[1].voicingRecipeId).toBe("close-triads-rh");
    expect(state.present.text).toBe(TEXT);
    const lost = deriveTextAndLost(state).lost;
    expect(lost.some((line) => line.includes("close-triads-rh") && line.includes("not stored in chord text"))).toBe(true);
    state = run(state, { type: "setVoicingRecipe", eventId: "all", recipeId: "open" });
    expect(state.present.sequence.defaultVoicingRecipeId).toBe("open");
    expect(state.present.sequence.events.every((e) => e.voicingRecipeId === undefined)).toBe(true);
    expect(deriveTextAndLost(state).lost.some((line) => line.includes('Default voicing recipe "open"'))).toBe(true);
  });

  it("keeps per-chord recipes through text edits where the chord is unchanged", () => {
    const state = run(initial(), { type: "setVoicingRecipe", eventId: "ev-1", recipeId: "open" }, { type: "setText", text: "C | 1\nAm | 2\nF | 1\nG | 1" });
    expect(state.present.sequence.events[0].voicingRecipeId).toBe("open");
  });

  it("applyPathways inserts approach chords and undo restores the original text", () => {
    const original = "# my tune\nC | 1\nF | 1";
    const start = initial(original);
    const preview = previewPathways(original, "secondaryDominant", undefined, 1);
    expect(preview.ok).toBe(true);
    expect(preview.changed).toBe(true);
    const applied = run(start, { type: "applyPathways", mode: "secondaryDominant" });
    expect(applied.present.text).toBe(preview.text);
    expect(applied.present.sequence.events.length).toBeGreaterThan(2);
    expect(applied.present.sequence.events.map((e) => e.symbol)).toContain("C7");
    expect(applied.past[applied.past.length - 1].text).toBe(original);
    const undone = run(applied, { type: "undo" });
    expect(undone.present.text).toBe(original);
  });

  it("applyPathways refuses text with parse errors", () => {
    const start = run(initial(), { type: "setText", text: "C | 1\n???" });
    const state = run(start, { type: "applyPathways", mode: "tritoneSubstitution" });
    expect(state.present).toBe(start.present);
    expect(state.notice).toMatch(/Fix the errors/);
  });

  it("loadProject resets history, marks clean, and newProject is dirty", () => {
    const edited = run(initial(), { type: "setTempo", bpm: 101 });
    const project: ProjectFile = {
      schemaVersion: 1,
      kind: "project",
      id: "p1",
      name: "Saved",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      sequence: { ...edited.present.sequence, id: "seq-p1", version: 3 },
      sourceText: "C | 1\nAm | 1\nF | 1\nG | 1"
    };
    const loaded = run(edited, { type: "loadProject", project });
    expect(loaded.past.length).toBe(0);
    expect(loaded.project.id).toBe("p1");
    expect(isDirty(loaded)).toBe(false);
    expect(loaded.present.sequence.version).toBeGreaterThan(edited.present.sequence.version);
    const changed = run(loaded, { type: "setTempo", bpm: 70 });
    expect(isDirty(changed)).toBe(true);
    const saved = run(changed, { type: "markSaved", projectId: "p1", name: "Saved" });
    expect(isDirty(saved)).toBe(false);
    const fresh = run(saved, { type: "newProject", sequenceId: "seq-new" });
    expect(fresh.project.id).toBeNull();
    expect(isDirty(fresh)).toBe(true);
    expect(fresh.present.sequence.id).toBe("seq-new");
    expect(fresh.past.length).toBe(0);
  });

  it("time signature changes regenerate the text measures", () => {
    const state = run(initial(), { type: "setTimeSignature", timeSignature: { numerator: 2, denominator: 4 } });
    expect(state.present.text.split("\n")[0]).toBe("C | 2");
    const bad = run(state, { type: "setTimeSignature", timeSignature: { numerator: 3, denominator: 5 } });
    expect(bad.notice).not.toBeNull();
  });
});
