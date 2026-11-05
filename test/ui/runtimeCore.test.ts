import { describe, expect, it } from "vitest";
import { chordFromSymbol } from "@/music/chords";
import { chordPracticePayload } from "@/ui/runtime/practicePayload";
import { SilentTimelineEngine } from "@/playback/timelineEngines";
import type { SchedulerClock } from "@/timeline/clock";
import { StudioRuntimeCore } from "@/ui/runtime/runtimeCore";

function manualClock(): SchedulerClock {
  return { now: () => 1000, setTimeout: () => 0, clearTimeout: () => undefined };
}

describe("StudioRuntimeCore (headless, without start())", () => {
  it("loads the editor document as material", () => {
    const runtime = new StudioRuntimeCore();
    expect(runtime.materialStore.getState().timeline).toBeNull();
    runtime.loadEditorSequence();
    const material = runtime.materialStore.getState();
    expect(material.sourceKind).toBe("project");
    expect(material.timeline).not.toBeNull();
    expect(material.sequence).toBe(runtime.editor.getState().present.sequence);
    expect(runtime.transport.getTimeline()).toBe(material.timeline);
    expect(runtime.session.getState().materialId).toBe(material.sourceId);
    expect(runtime.positionStore.getState().index).toBe(0);
  });

  it("recompiles with playback options and voicing recipes", () => {
    const runtime = new StudioRuntimeCore();
    runtime.loadEditorSequence();
    const plain = runtime.materialStore.getState().timeline;
    runtime.setPlaybackOptions({ accompaniment: "rootOnly" });
    runtime.loadEditorSequence();
    const withAccompaniment = runtime.materialStore.getState().timeline;
    expect(withAccompaniment?.notes.some((n) => n.part === "accompaniment")).toBe(true);
    expect(plain?.notes.some((n) => n.part === "accompaniment")).toBe(false);
    runtime.editor.dispatch({ type: "setVoicingRecipe", eventId: "all", recipeId: "close-rp" });
    runtime.loadEditorSequence();
    expect(runtime.materialStore.getState().version).toBe(runtime.editor.getState().present.sequence.version);
  });

  it("navigates: practice request, explore symbol, create text", () => {
    const runtime = new StudioRuntimeCore();
    const payload = chordPracticePayload(chordFromSymbol("C"), [{ midi: 60 }, { midi: 64 }, { midi: 67 }]);
    runtime.navigate.openInPractice(payload);
    const request = runtime.practiceRequestStore.getState().request;
    expect(request?.requestId).toBe(1);
    expect(request?.timeline).toBe(payload.timeline);
    expect(runtime.session.getState().mode).toBe("practice");
    expect(runtime.materialStore.getState().sourceKind).toBe("exercise");

    runtime.navigate.openInExplore("Dm9");
    expect(runtime.explore.getState().symbol).toBe("Dm9");
    expect(runtime.session.getState().mode).toBe("explore");

    runtime.navigate.openInCreate("F | 1\nG | 1", "Two chords");
    expect(runtime.editor.getState().present.sequence.events.map((e) => e.symbol)).toEqual(["F", "G"]);
    expect(runtime.editor.getState().project.name).toBe("Two chords");
    expect(runtime.session.getState().mode).toBe("create");
  });

  it("saves, lists, reopens and exports projects (memory storage)", () => {
    const runtime = new StudioRuntimeCore();
    const saved = runtime.saveProject({ name: "My tune" });
    expect(saved.ok).toBe(true);
    const id = runtime.editor.getState().project.id;
    expect(id).not.toBeNull();
    const list = runtime.stores.projects.list();
    expect(list.ok && list.value.map((p) => p.name)).toEqual(["My tune"]);
    runtime.editor.dispatch({ type: "setTempo", bpm: 77 });
    const json = runtime.exportProjectJson();
    const imported = runtime.importProjectJson(json);
    expect(imported.ok).toBe(true);
    expect(runtime.editor.getState().present.sequence.tempo.bpm).toBe(77);
    expect(runtime.editor.getState().project.id).not.toBe(id);
    const midi = runtime.exportMidi();
    expect(midi.bytes.length).toBeGreaterThan(20);
    expect(midi.fileName).toMatch(/\.mid$/);
  });

  it("Play it for me plays a demonstration copy once and restores the material", async () => {
    const runtime = new StudioRuntimeCore();
    runtime.transport.injectClock(manualClock());
    await runtime.transport.setEngine(new SilentTimelineEngine(() => 1000));
    const cleanup = runtime.start();
    const original = runtime.materialStore.getState().timeline;
    expect(original).not.toBeNull();
    await runtime.playForMe();
    expect(runtime.materialStore.getState().demonstrating).toBe(true);
    expect(runtime.transport.getTimeline()?.id).toBe(`${original?.id}~demo`);
    expect(runtime.transport.getTimeline()?.notes.some((n) => n.part === "learner")).toBe(false);
    runtime.stop();
    await Promise.resolve();
    await Promise.resolve();
    expect(runtime.materialStore.getState().demonstrating).toBe(false);
    expect(runtime.transport.getTimeline()).toBe(original);
    cleanup();
  });
});
