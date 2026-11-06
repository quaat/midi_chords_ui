import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SilentTimelineEngine } from "@/playback/timelineEngines";
import { isClickTimeline } from "@/recording";
import { StudioRuntimeCore } from "@/ui/runtime/runtimeCore";
import { controllerEvents, noteEvents, parseSmf } from "../recording/smf";

async function setup(): Promise<{ runtime: StudioRuntimeCore; engine: SilentTimelineEngine; cleanup: () => void }> {
  const runtime = new StudioRuntimeCore();
  const engine = new SilentTimelineEngine();
  await runtime.transport.setEngine(engine);
  const cleanup = runtime.start();
  runtime.transport.setCountIn(0);
  runtime.transport.setMetronome(false);
  runtime.setMonitoring(false); // the Tone monitor engine cannot run under Node
  return { runtime, engine, cleanup };
}

/** Play a note on the on-screen piano for `holdMs`, then wait `gapMs`. */
function playTouch(runtime: StudioRuntimeCore, midi: number, velocity: number, holdMs: number, gapMs: number): void {
  runtime.touchNoteOn(midi, velocity);
  vi.advanceTimersByTime(holdMs);
  runtime.touchNoteOff(midi);
  vi.advanceTimersByTime(gapMs);
}

describe("StudioRuntimeCore — performance recorder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("records on-screen piano input into a take without touching the editor material", async () => {
    const { runtime, cleanup } = await setup();
    const material = runtime.materialStore.getState();
    const editorTimeline = material.timeline;
    expect(editorTimeline).not.toBeNull();

    const started = await runtime.startRecording();
    expect(started.ok).toBe(true);
    expect(runtime.recordingStore.getState().status).toBe("recording");
    expect(runtime.transport.getTimeline()).toBe(editorTimeline); // no click track without count-in/metronome
    vi.advanceTimersByTime(500);
    runtime.touchNoteOn(60, 100);
    runtime.touchNoteOn(64, 80);
    vi.advanceTimersByTime(250);
    runtime.touchNoteOff(64);
    vi.advanceTimersByTime(250);
    runtime.touchNoteOff(60);
    vi.advanceTimersByTime(1000);
    expect(runtime.recordingStore.getState().noteCount).toBe(2);

    const stopped = runtime.stopRecording();
    expect(stopped.ok).toBe(true);
    const state = runtime.recordingStore.getState();
    expect(state.status).toBe("ready");
    expect(state.take?.durationMs).toBe(2000);
    expect(state.take?.title).toBe("Take 1");
    expect(state.notes.map((note) => [note.midi, note.velocity, note.onsetMs, note.pressedMs, note.source])).toEqual([
      [60, 100, 500, 500, "touch"],
      [64, 80, 500, 250, "touch"]
    ]);
    expect(state.dirty).toBe(true);
    expect(runtime.materialStore.getState().sourceKind).toBe("project");
    expect(runtime.materialStore.getState().timeline).toBe(editorTimeline);
    expect(runtime.input.held.snapshot().pressed).toEqual([]);
    cleanup();
  });

  it("plays the take as 'recording' material on the shared transport without producing learner input", async () => {
    const { runtime, engine, cleanup } = await setup();
    await runtime.startRecording();
    playTouch(runtime, 60, 100, 300, 200);
    playTouch(runtime, 62, 90, 300, 200);
    runtime.stopRecording();
    const take = runtime.recordingStore.getState().take;
    if (!take) throw new Error("no take");

    const attacks: number[] = [];
    runtime.input.subscribeAttacks((attack) => attacks.push(attack.midi));
    engine.clear();
    const played = await runtime.playRecording();
    expect(played.ok).toBe(true);
    const material = runtime.materialStore.getState();
    expect(material.sourceKind).toBe("recording");
    expect(material.sourceId).toBe(take.id);
    expect(material.title).toBe("Take 1");
    expect(runtime.transport.getSnapshot().state).toBe("playing");
    vi.advanceTimersByTime(1200);
    expect(engine.noteOns().map((call) => call.midi)).toEqual([60, 62]);
    expect(engine.noteOns().every((call) => call.channel === 2)).toBe(true); // accompaniment channel
    expect(engine.noteOffs()).toHaveLength(2);
    expect(attacks).toEqual([]);
    expect(runtime.input.held.snapshot().pressed).toEqual([]);
    expect(runtime.transport.getSnapshot().state).toBe("stopped");
    expect(runtime.positionStore.getState().timelineId).toBe(runtime.transport.getTimeline()?.id ?? null);

    // Live playing while the take is loaded still reaches the learner input, not the take.
    runtime.touchNoteOn(72, 100);
    expect(attacks).toEqual([72]);
    runtime.touchNoteOff(72);
    expect(runtime.recordingStore.getState().take).toBe(take);
    cleanup();
  });

  it("loops the full take, pauses/resumes, restarts and refits to bars in place", async () => {
    const { runtime, cleanup } = await setup();
    await runtime.startRecording();
    vi.advanceTimersByTime(100);
    playTouch(runtime, 60, 100, 400, 4000); // 4.5 s ≈ 9 beats at 120 BPM
    runtime.stopRecording();
    const bpm = runtime.recordingStore.getState().take?.tempo.bpm ?? 0;
    const recordedBeats = (4500 * bpm) / 60000;

    runtime.setRecordingLoop(true);
    let snapshot = runtime.transport.getSnapshot();
    expect(snapshot.loop).toEqual({ startBeat: 0, endBeat: recordedBeats });
    await runtime.playRecording();
    vi.advanceTimersByTime(6000);
    expect(runtime.transport.getSnapshot().state).toBe("playing");
    expect(runtime.transport.getSnapshot().loopPass).toBeGreaterThanOrEqual(1);
    runtime.pauseRecordingPlayback();
    expect(runtime.transport.getSnapshot().state).toBe("paused");
    await runtime.playRecording();
    expect(runtime.transport.getSnapshot().state).toBe("playing");
    await runtime.restartRecordingPlayback();
    expect(runtime.transport.getSnapshot().positionBeats).toBeLessThan(0.1);

    runtime.setRecordingFitToBars(true);
    await vi.advanceTimersByTimeAsync(10); // the in-place reload resumes playback asynchronously
    snapshot = runtime.transport.getSnapshot();
    const barBeats = 4;
    expect(snapshot.totalBeats % barBeats).toBe(0);
    expect(snapshot.loop).toEqual({ startBeat: 0, endBeat: snapshot.totalBeats });
    expect(snapshot.state).toBe("playing");
    expect(runtime.materialStore.getState().sourceKind).toBe("recording");

    runtime.setRecordingLoop(false);
    expect(runtime.transport.getSnapshot().loop).toBeNull();
    runtime.stopRecordingPlayback();
    expect(runtime.transport.getSnapshot().state).toBe("stopped");
    expect(runtime.transport.getSoundingNotes()).toEqual([]);
    cleanup();
  });

  it("uses the transport count-in/metronome as a click track and restores the material afterwards", async () => {
    const { runtime, engine, cleanup } = await setup();
    const original = runtime.transport.getTimeline();
    runtime.transport.setLoop({ startBeat: 0, endBeat: 4 });
    runtime.transport.setCountIn(4);
    runtime.transport.setMetronome(true);
    engine.clear();

    const started = await runtime.startRecording();
    expect(started.ok).toBe(true);
    expect(isClickTimeline(runtime.transport.getTimeline())).toBe(true);
    expect(runtime.transport.getSnapshot().state).toBe("countingIn");
    expect(runtime.transport.getSnapshot().loop).toBeNull();
    expect(runtime.recordingStore.getState().status).toBe("countIn");
    runtime.touchNoteOn(50, 100); // during the count-in: not part of the take
    runtime.touchNoteOff(50);
    const bpm = runtime.transport.getSnapshot().tempoBpm;
    vi.advanceTimersByTime(Math.ceil((4 * 60000) / bpm) + 100); // four count-in beats
    expect(runtime.transport.getSnapshot().state).toBe("playing");
    expect(runtime.recordingStore.getState().status).toBe("recording");
    const clicks = engine.noteOns().filter((call) => call.channel === 10);
    expect(clicks.length).toBeGreaterThanOrEqual(4);
    vi.advanceTimersByTime(400);
    playTouch(runtime, 60, 100, 500, 1000);
    runtime.stopRecording();

    const state = runtime.recordingStore.getState();
    expect(state.status).toBe("ready");
    expect(state.take?.countInBeats).toBe(4);
    expect(state.fitToBars).toBe(true);
    expect(state.notes.map((note) => [note.midi, Math.round(note.onsetMs)])).toEqual([[60, 500]]); // sub-ms clock rounding
    expect(runtime.transport.getTimeline()).toBe(original);
    expect(runtime.transport.getSnapshot().loop).toEqual({ startBeat: 0, endBeat: 4 });
    expect(runtime.transport.getSnapshot().state).toBe("stopped");
    expect(engine.calls[engine.calls.length - 1].type).toBe("allNotesOff");
    cleanup();
  });

  it("stopping the transport during a click-track take finishes the take", async () => {
    const { runtime, cleanup } = await setup();
    runtime.transport.setMetronome(true);
    await runtime.startRecording();
    vi.advanceTimersByTime(300);
    playTouch(runtime, 60, 100, 200, 100);
    runtime.stop();
    await Promise.resolve();
    await Promise.resolve();
    expect(runtime.recordingStore.getState().status).toBe("ready");
    expect(isClickTimeline(runtime.transport.getTimeline())).toBe(false);
    cleanup();
  });

  it("editor material loaded mid-take abandons the click track but keeps recording", async () => {
    const { runtime, cleanup } = await setup();
    runtime.transport.setMetronome(true);
    await runtime.startRecording();
    vi.advanceTimersByTime(300);
    runtime.loadEditorSequence();
    expect(isClickTimeline(runtime.transport.getTimeline())).toBe(false);
    expect(runtime.recordingStore.getState().status).toBe("recording");
    playTouch(runtime, 60, 100, 200, 100);
    runtime.stopRecording();
    expect(runtime.recordingStore.getState().notes).toHaveLength(1);
    cleanup();
  });

  it("discards an empty take and a running take; the cleanup stops a take", async () => {
    const { runtime, cleanup } = await setup();
    await runtime.startRecording();
    vi.advanceTimersByTime(500);
    const stopped = runtime.stopRecording();
    expect(stopped.ok).toBe(false);
    expect(runtime.recordingStore.getState().status).toBe("idle");
    expect(runtime.recordingStore.getState().message).toMatch(/Nothing was played/);

    await runtime.startRecording();
    playTouch(runtime, 60, 100, 100, 100);
    runtime.discardRecording();
    expect(runtime.recordingStore.getState().status).toBe("idle");
    expect(runtime.recordingStore.getState().take).toBeNull();

    await runtime.startRecording();
    playTouch(runtime, 60, 100, 100, 100);
    cleanup();
    expect(runtime.recorder.isActive()).toBe(false);
    expect(runtime.recordingStore.getState().status).toBe("ready");
  });

  it("saves, lists, reopens, renames, deletes and exports takes; a failed save keeps the take", async () => {
    const { runtime, cleanup } = await setup();
    await runtime.startRecording();
    playTouch(runtime, 60, 100, 300, 300);
    runtime.stopRecording();
    runtime.setRecordingTitle("Blues loop");
    const saved = runtime.saveRecording();
    expect(saved.ok).toBe(true);
    const state = runtime.recordingStore.getState();
    expect(state.savedId).toBe(state.take?.id ?? null);
    expect(state.dirty).toBe(false);
    const listed = runtime.listRecordings();
    expect(listed.ok && listed.value.map((entry) => entry.title)).toEqual(["Blues loop"]);
    const id = state.take?.id ?? "";

    // Second take replaces the first in memory; reopening restores the saved one.
    await runtime.startRecording();
    playTouch(runtime, 64, 100, 300, 300);
    runtime.stopRecording();
    expect(runtime.recordingStore.getState().take?.id).not.toBe(id);
    const opened = runtime.loadSavedRecording(id);
    expect(opened.ok).toBe(true);
    expect(runtime.recordingStore.getState().take?.title).toBe("Blues loop");
    expect(runtime.recordingStore.getState().notes.map((note) => note.midi)).toEqual([60]);

    expect(runtime.renameRecording(id, "Blues loop 2").ok).toBe(true);
    expect(runtime.recordingStore.getState().take?.title).toBe("Blues loop 2");
    expect(runtime.recordingStore.getState().dirty).toBe(false);

    const midi = runtime.exportRecordingMidi();
    expect(midi?.fileName).toBe("Blues-loop-2.mid");
    const track = parseSmf(midi?.bytes ?? new Uint8Array()).tracks[0];
    expect(noteEvents(track).map((note) => [note.midi, note.on])).toEqual([
      [60, true],
      [60, false]
    ]);
    expect(controllerEvents(track)).toEqual([]);
    expect(runtime.exportRecordingMidi(id)?.bytes.length).toBe(midi?.bytes.length);

    expect(runtime.deleteRecording(id).ok).toBe(true);
    expect(runtime.recordingStore.getState().savedId).toBeNull();
    expect(runtime.recordingStore.getState().dirty).toBe(true);
    const after = runtime.listRecordings();
    expect(after.ok && after.value).toEqual([]);

    // Storage failure: the take stays available for export.
    const originalSave = runtime.stores.recordings.save.bind(runtime.stores.recordings);
    runtime.stores.recordings.save = () => ({ ok: false, error: Object.assign(new Error("Local storage is full."), { code: "quota", details: [] }) }) as never;
    const failed = runtime.saveRecording();
    expect(failed.ok).toBe(false);
    expect(failed.message).toMatch(/export it as MIDI/);
    expect(runtime.recordingStore.getState().take?.title).toBe("Blues loop 2");
    expect(runtime.exportRecordingMidi()).not.toBeNull();
    runtime.stores.recordings.save = originalSave;
    cleanup();
  });

  it("keeps the progression MIDI export separate and unchanged while a take is loaded", async () => {
    const { runtime, cleanup } = await setup();
    const before = runtime.exportMidi();
    await runtime.startRecording();
    playTouch(runtime, 60, 100, 300, 300);
    runtime.stopRecording();
    await runtime.playRecording();
    const after = runtime.exportMidi();
    expect(Array.from(after.bytes)).toEqual(Array.from(before.bytes));
    expect(after.fileName).not.toBe(runtime.exportRecordingMidi()?.fileName);
    cleanup();
  });

  it("starting a take stops demonstration/playback and closes the recorder's held notes on panic", async () => {
    const { runtime, cleanup } = await setup();
    await runtime.playForMe();
    expect(runtime.materialStore.getState().demonstrating).toBe(true);
    await runtime.startRecording();
    await Promise.resolve();
    await Promise.resolve();
    expect(runtime.materialStore.getState().demonstrating).toBe(false);
    expect(runtime.transport.getSnapshot().state).toBe("stopped");
    vi.advanceTimersByTime(100);
    runtime.touchNoteOn(60, 100);
    vi.advanceTimersByTime(200);
    runtime.panic();
    vi.advanceTimersByTime(200);
    runtime.stopRecording();
    const notes = runtime.recordingStore.getState().notes;
    expect(notes.map((note) => [note.pressedMs, note.truncated])).toEqual([[200, true]]);
    expect(runtime.recordingStore.getState().warnings[0]).toMatch(/panic/);
    cleanup();
  });
});
