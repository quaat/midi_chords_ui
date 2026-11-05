import { describe, expect, it, vi } from "vitest";
import { createSessionStore, createStore, DEFAULT_SESSION_STATE, MAX_HINT_LEVEL, sessionReducer } from "@/state/sessionStore";

describe("sessionReducer", () => {
  it("returns the same object when nothing changes", () => {
    const s = DEFAULT_SESSION_STATE;
    expect(sessionReducer(s, { type: "setMode", mode: s.mode })).toBe(s);
    expect(sessionReducer(s, { type: "setLabelMode", labelMode: s.labelMode })).toBe(s);
  });

  it("applies shallow updates without mutating the previous state", () => {
    const s = DEFAULT_SESSION_STATE;
    const next = sessionReducer(s, { type: "setMode", mode: "practice" });
    expect(next).not.toBe(s);
    expect(next.mode).toBe("practice");
    expect(s.mode).toBe("explore");
    expect(next.pianoRange).toBe(s.pianoRange);
  });

  it("switching mode returns to the workspace view", () => {
    const inLearn = sessionReducer(DEFAULT_SESSION_STATE, { type: "setEntryView", view: "learn" });
    expect(inLearn.entryView).toBe("learn");
    expect(sessionReducer(inLearn, { type: "setMode", mode: "create" })).toMatchObject({ mode: "create", entryView: "workspace" });
  });

  it("toggles theme, focus mode and context panel", () => {
    let s = sessionReducer(DEFAULT_SESSION_STATE, { type: "toggleTheme" });
    expect(s.theme).toBe("dark");
    s = sessionReducer(s, { type: "toggleTheme" });
    expect(s.theme).toBe("light");
    s = sessionReducer(s, { type: "toggleFocusMode" });
    expect(s.focusMode).toBe(true);
    s = sessionReducer(s, { type: "toggleContextPanel" });
    expect(s.contextPanelOpen).toBe(!DEFAULT_SESSION_STATE.contextPanelOpen);
  });

  it("clamps hint levels", () => {
    let s = sessionReducer(DEFAULT_SESSION_STATE, { type: "setHintLevel", level: 99 });
    expect(s.hintLevel).toBe(MAX_HINT_LEVEL);
    s = sessionReducer(s, { type: "nextHint" });
    expect(s.hintLevel).toBe(MAX_HINT_LEVEL);
    s = sessionReducer(s, { type: "setHintLevel", level: -3 });
    expect(s.hintLevel).toBe(0);
    s = sessionReducer(s, { type: "nextHint" });
    expect(s.hintLevel).toBe(1);
    expect(sessionReducer(s, { type: "resetHints" }).hintLevel).toBe(0);
  });

  it("normalises piano ranges and respects a user-chosen range", () => {
    let s = sessionReducer(DEFAULT_SESSION_STATE, { type: "setPianoRange", range: { low: 49, high: 70 }, user: false });
    expect(s.pianoRange).toEqual({ low: 48, high: 71 });
    expect(s.pianoRangeLocked).toBe(false);
    s = sessionReducer(s, { type: "setPianoRange", range: { low: 10, high: 120 } });
    expect(s.pianoRange).toEqual({ low: 21, high: 108 });
    expect(s.pianoRangeLocked).toBe(true);
    const unchanged = sessionReducer(s, { type: "setPianoRange", range: { low: 60, high: 72 }, user: false });
    expect(unchanged).toBe(s);
    const shifted = sessionReducer({ ...s, pianoRange: { low: 48, high: 72 } }, { type: "shiftPianoRange", octaves: 1 });
    expect(shifted.pianoRange).toEqual({ low: 60, high: 84 });
  });

  it("opening material resets hints and returns to the workspace", () => {
    const s = { ...DEFAULT_SESSION_STATE, hintLevel: 2, entryView: "songs" as const };
    const next = sessionReducer(s, { type: "openMaterial", materialId: "chart-1", sequenceVersion: 3, mode: "practice" });
    expect(next).toMatchObject({ materialId: "chart-1", sequenceVersion: 3, mode: "practice", entryView: "workspace", hintLevel: 0 });
    expect(sessionReducer(next, { type: "setSequenceVersion", version: 4 }).sequenceVersion).toBe(4);
  });
});

describe("store", () => {
  it("notifies subscribers only on real changes and supports unsubscribe", () => {
    const store = createStore({ a: 1, b: "x" });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.setState({ a: 1 });
    expect(listener).toHaveBeenCalledTimes(0);
    store.setState({ a: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
    store.setState((s) => ({ b: s.b + "y" }));
    expect(store.getState()).toEqual({ a: 2, b: "xy" });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    store.setState({ a: 3 });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("session store dispatch goes through the reducer", () => {
    const store = createSessionStore({ theme: "dark" });
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.getState().theme).toBe("dark");
    const before = store.getState();
    store.dispatch({ type: "setTheme", theme: "dark" });
    expect(store.getState()).toBe(before);
    expect(listener).toHaveBeenCalledTimes(0);
    store.dispatch({ type: "setPracticeView", view: "chart" });
    expect(store.getState().practiceView).toBe("chart");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
