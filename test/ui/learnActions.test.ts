import { describe, expect, it } from "vitest";
import type { StudioRuntimeCore } from "@/ui/runtime/runtimeCore";
import { openChartInSongs, outcomeMessage, showOnPiano } from "@/ui/learn/learnActions";
import { consumeChartRequest } from "@/ui/songs/songsRequests";

describe("learn actions", () => {
  it("reports failed opens from message or reason fields", () => {
    expect(outcomeMessage({ ok: true, message: "Opened" })).toBeNull();
    expect(outcomeMessage({ ok: false, message: "No such exercise" })).toBe("No such exercise");
    expect(outcomeMessage({ ok: false, reason: "Cannot compile" })).toBe("Cannot compile");
    expect(outcomeMessage(undefined)).toBeNull();
  });

  it("shows targets in Explore's layer without leaving the Learn view", () => {
    const calls: unknown[] = [];
    let state = { mode: "practice", entryView: "learn" };
    const fake = {
      setExploreTargets: (...args: unknown[]) => calls.push(args),
      session: {
        getState: () => state,
        setState: (patch: Partial<typeof state>) => {
          state = { ...state, ...patch };
        }
      }
    } as unknown as StudioRuntimeCore;
    showOnPiano(fake, [{ midi: 70, noteName: "B♭", degreeLabel: "b6" }], null, "sixth", "learn");
    expect(calls.length).toBe(1);
    expect(state).toEqual({ mode: "explore", entryView: "learn" });
  });

  it("opens a chart through the songs request store", () => {
    let view = "";
    const fake = { navigate: { openEntry: (v: string) => (view = v) } } as unknown as StudioRuntimeCore;
    openChartInSongs(fake, "evening-loop", { sectionId: "B" });
    expect(view).toBe("songs");
    expect(consumeChartRequest()).toMatchObject({ chartId: "evening-loop", sectionId: "B" });
  });
});
