import { describe, expect, it } from "vitest";
import type { InputEvent } from "@/model/contracts";
import { ComputerKeyboardInput, TouchInput, parseMidiMessage } from "@/input";
import { PerformanceRecorder, countNoteOns, pairRecordedNotes } from "@/recording";

const PORT = { portId: "p1", portName: "Fake Piano" };

function setup(options: { maxEvents?: number; maxMs?: number } = {}) {
  let now = 1000;
  const recorder = new PerformanceRecorder({
    now: () => now,
    nowIso: () => "2026-11-06T20:00:00.000Z",
    newId: (prefix) => `${prefix}-1`,
    ...options
  });
  const clock = {
    get now(): number {
      return now;
    },
    set(value: number): void {
      now = value;
    }
  };
  const midi = (bytes: number[], atMs: number): void => {
    const event = parseMidiMessage(bytes, atMs, PORT);
    if (!event) {
      throw new Error("unparsed");
    }
    recorder.handleEvent(event);
  };
  return { recorder, clock, midi };
}

function start(recorder: PerformanceRecorder, zeroMs?: number, countInBeats = 0): void {
  const started = recorder.start({ tempo: { bpm: 120 }, timeSignature: { numerator: 4, denominator: 4 }, countInBeats, zeroMs, title: "Take 1" });
  expect(started).toBe(true);
}

describe("PerformanceRecorder — lifecycle", () => {
  it("goes idle → recording → ready and keeps the recording start explicit", () => {
    const { recorder, clock, midi } = setup();
    expect(recorder.getStatus()).toBe("idle");
    start(recorder);
    expect(recorder.getStatus()).toBe("recording");
    midi([0x90, 60, 100], 1500);
    midi([0x80, 60, 0], 2000);
    clock.set(3000);
    const take = recorder.stop();
    expect(recorder.getStatus()).toBe("ready");
    expect(take).not.toBeNull();
    expect(take?.id).toBe("rec-1");
    expect(take?.title).toBe("Take 1");
    expect(take?.durationMs).toBe(2000);
    expect(take?.tempo.bpm).toBe(120);
    expect(take?.timeSignature).toEqual({ numerator: 4, denominator: 4 });
    expect(take?.events.map((event) => [event.type, event.atMs, event.midi, event.velocity])).toEqual([
      ["noteOn", 500, 60, 100],
      ["noteOff", 1000, 60, 0]
    ]);
    expect(take?.sources).toEqual([{ source: "midi", portId: "p1", portName: "Fake Piano" }]);
    expect(recorder.elapsedMs()).toBe(2000);
  });

  it("ignores events while idle and after stop; a second start replaces the take", () => {
    const { recorder, clock, midi } = setup();
    midi([0x90, 60, 100], 1000);
    expect(recorder.getSnapshot().eventCount).toBe(0);
    start(recorder);
    midi([0x90, 60, 100], 1100);
    clock.set(1500);
    recorder.stop();
    midi([0x90, 62, 100], 1600);
    expect(recorder.getTake()?.events).toHaveLength(1);
    expect(recorder.start({ tempo: { bpm: 90 }, timeSignature: { numerator: 3, denominator: 4 } })).toBe(true);
    expect(recorder.getTake()).toBeNull();
    expect(recorder.start({ tempo: { bpm: 90 }, timeSignature: { numerator: 3, denominator: 4 } })).toBe(false);
  });

  it("stop() while notes are held returns a take whose pairing closes them at the boundary", () => {
    const { recorder, clock, midi } = setup();
    start(recorder);
    midi([0x90, 60, 100], 1000);
    midi([0xb0, 64, 127], 1200);
    midi([0x90, 64, 100], 1500);
    midi([0x80, 64, 0], 1600);
    clock.set(2500);
    const take = recorder.stop();
    if (!take) throw new Error("no take");
    expect(take.events.filter((event) => event.type === "allNotesOff")).toHaveLength(0);
    const notes = pairRecordedNotes(take.events, take.durationMs);
    expect(notes.map((note) => [note.midi, note.pressedMs, note.soundingMs, note.truncated])).toEqual([
      [60, 1500, 1500, true],
      [64, 100, 1000, true]
    ]);
  });

  it("stopping an empty take yields zero notes (the owner discards it)", () => {
    const { recorder, clock } = setup();
    start(recorder);
    clock.set(1800);
    const take = recorder.stop();
    expect(take?.events).toEqual([]);
    expect(countNoteOns(take?.events ?? [])).toBe(0);
    expect(take?.durationMs).toBe(800);
    recorder.discard();
    expect(recorder.getStatus()).toBe("idle");
  });

  it("discard aborts a running take; setTake installs a saved one; retitle keeps it", () => {
    const { recorder, midi } = setup();
    start(recorder);
    midi([0x90, 60, 100], 1100);
    recorder.discard();
    expect(recorder.getStatus()).toBe("idle");
    expect(recorder.getTake()).toBeNull();
    const saved = {
      schemaVersion: 1,
      kind: "recording" as const,
      id: "rec-saved",
      title: "Saved",
      createdAt: "2026-11-06T20:00:00.000Z",
      updatedAt: "2026-11-06T20:00:00.000Z",
      tempo: { bpm: 100 },
      timeSignature: { numerator: 4, denominator: 4 },
      countInBeats: 0,
      durationMs: 1000,
      events: [{ type: "noteOn" as const, atMs: 0, midi: 60, velocity: 80, source: "midi" as const }],
      sources: []
    };
    expect(recorder.setTake(saved)).toBe(true);
    expect(recorder.getStatus()).toBe("ready");
    expect(recorder.getSnapshot().noteCount).toBe(1);
    expect(recorder.retitle("Renamed")?.title).toBe("Renamed");
    expect(recorder.getTake()?.id).toBe("rec-saved");
  });
});

describe("PerformanceRecorder — capture rules", () => {
  it("drops unmatched note-offs but keeps every pedal value (half-pedalling)", () => {
    const { recorder, clock, midi } = setup();
    start(recorder);
    midi([0x80, 64, 0], 1100);
    midi([0xb0, 64, 40], 1200);
    midi([0xb0, 64, 90], 1300);
    midi([0xb0, 64, 100], 1400);
    clock.set(2000);
    const take = recorder.stop();
    expect(take?.events.map((event) => [event.type, event.value])).toEqual([
      ["sustain", 40],
      ["sustain", 90],
      ["sustain", 100]
    ]);
  });

  it("counts attacks live and notifies subscribers", () => {
    const { recorder, midi } = setup();
    let notified = 0;
    recorder.subscribe(() => {
      notified += 1;
    });
    start(recorder);
    const before = notified;
    midi([0x90, 60, 100], 1100);
    midi([0x90, 64, 100], 1100);
    midi([0x80, 60, 0], 1300);
    expect(recorder.getSnapshot().noteCount).toBe(2);
    expect(notified).toBe(before + 2);
  });

  it("keeps a stable snapshot object between changes", () => {
    const { recorder, midi } = setup();
    start(recorder);
    const a = recorder.getSnapshot();
    expect(recorder.getSnapshot()).toBe(a);
    midi([0x90, 60, 100], 1100);
    expect(recorder.getSnapshot()).not.toBe(a);
  });

  it("a device disconnect closes that port's notes with an allNotesOff and warns", () => {
    const { recorder, clock, midi } = setup();
    start(recorder);
    midi([0x90, 60, 100], 1100);
    const disconnect: InputEvent = { source: "midi", type: "connection", timestampMs: 1600, portId: "p1", portName: "Fake Piano", connected: false };
    recorder.handleEvent(disconnect);
    midi([0x80, 60, 0], 1900); // late note-off after the reset: ignored
    clock.set(2500);
    const take = recorder.stop();
    if (!take) throw new Error("no take");
    expect(take.events.map((event) => [event.type, event.atMs])).toEqual([
      ["noteOn", 100],
      ["allNotesOff", 600]
    ]);
    expect(recorder.getSnapshot().warnings[0]).toMatch(/disconnected/);
    const notes = pairRecordedNotes(take.events, take.durationMs);
    expect(notes[0]).toMatchObject({ pressedMs: 500, truncated: true });
  });

  it("closePort (input switch) and reset (panic) close open notes at the given time", () => {
    const { recorder, clock, midi } = setup();
    start(recorder);
    midi([0x90, 60, 100], 1100);
    recorder.closePort("p1", 1400);
    recorder.closePort("p1", 1450); // nothing open any more: no event
    midi([0x90, 62, 100], 1500);
    recorder.reset(1800, "panic");
    clock.set(2000);
    const take = recorder.stop();
    expect(take?.events.map((event) => [event.type, event.atMs, event.midi])).toEqual([
      ["noteOn", 100, 60],
      ["allNotesOff", 400, undefined],
      ["noteOn", 500, 62],
      ["allNotesOff", 800, undefined]
    ]);
    const notes = pairRecordedNotes(take?.events ?? [], 1000);
    expect(notes.map((note) => note.pressedMs)).toEqual([300, 300]);
  });

  it("count-in: attacks before the downbeat are dropped except a short anticipation, pedal state carries over", () => {
    const { recorder, clock, midi } = setup();
    start(recorder, 3000, 4);
    expect(recorder.getStatus()).toBe("countIn");
    expect(recorder.elapsedMs()).toBe(0);
    midi([0x90, 48, 100], 1500); // during the count-in: dropped
    midi([0xb0, 64, 127], 1600); // pedal down before the downbeat: remembered
    midi([0x80, 48, 0], 1700);
    midi([0x90, 60, 100], 2950); // 50 ms early: kept at 0
    clock.set(3000);
    recorder.tick();
    expect(recorder.getStatus()).toBe("recording");
    midi([0x80, 60, 0], 3400);
    midi([0xb0, 64, 0], 3800);
    clock.set(4000);
    const take = recorder.stop();
    if (!take) throw new Error("no take");
    expect(take.countInBeats).toBe(4);
    expect(take.events.map((event) => [event.type, event.atMs])).toEqual([
      ["sustain", 0],
      ["noteOn", 0],
      ["noteOff", 400],
      ["sustain", 800]
    ]);
    const notes = pairRecordedNotes(take.events, take.durationMs);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ midi: 60, onsetMs: 0, pressedMs: 400, soundingMs: 800 });
  });

  it("stopping during the count-in yields an empty take", () => {
    const { recorder, clock, midi } = setup();
    start(recorder, 3000, 4);
    midi([0x90, 60, 100], 1500);
    clock.set(2000);
    const take = recorder.stop();
    expect(take?.durationMs).toBe(0);
    expect(take?.events).toEqual([]);
  });

  it("writes a sustain-down at 0 when the pedal was already down at start", () => {
    const { recorder, clock } = setup();
    recorder.start({ tempo: { bpm: 120 }, timeSignature: { numerator: 4, denominator: 4 }, initialPedals: { sustainDown: true, sostenutoDown: false, softDown: false } });
    recorder.handleEvent({ source: "touch", type: "noteOn", timestampMs: 1200, midi: 60, velocity: 90, channel: 1 });
    recorder.handleEvent({ source: "touch", type: "noteOff", timestampMs: 1300, midi: 60, velocity: 0, channel: 1 });
    clock.set(2000);
    const take = recorder.stop();
    expect(take?.events.map((event) => [event.type, event.atMs, event.value])).toEqual([
      ["sustain", 0, 127],
      ["noteOn", 200, undefined],
      ["noteOff", 300, undefined]
    ]);
    const notes = pairRecordedNotes(take?.events ?? [], 1000);
    expect(notes[0]).toMatchObject({ pressedMs: 100, soundingMs: 800, truncated: true });
  });

  it("stops accepting events at the event limit and reports it", () => {
    const { recorder, midi } = setup({ maxEvents: 3 });
    start(recorder);
    midi([0x90, 60, 100], 1100);
    midi([0x80, 60, 0], 1200);
    midi([0x90, 62, 100], 1300);
    midi([0x80, 62, 0], 1400);
    const snapshot = recorder.getSnapshot();
    expect(snapshot.limitReached).toBe(true);
    expect(snapshot.eventCount).toBe(3);
    expect(snapshot.warnings[0]).toMatch(/maximum number/);
  });

  it("flags the length limit and clamps the take length", () => {
    const { recorder, clock, midi } = setup({ maxMs: 5000 });
    start(recorder);
    midi([0x90, 60, 100], 1100);
    midi([0x80, 60, 0], 7000);
    expect(recorder.getSnapshot().limitReached).toBe(true);
    clock.set(9000);
    const take = recorder.stop();
    expect(take?.durationMs).toBe(5000);
    expect(take?.events).toHaveLength(1);
  });
});

describe("PerformanceRecorder — other input sources", () => {
  it("records the computer keyboard (notes and space-bar sustain)", () => {
    const { recorder, clock } = setup();
    let keyNow = 1000;
    const keyboard = new ComputerKeyboardInput({ now: () => keyNow });
    keyboard.onEvent((event) => recorder.handleEvent(event));
    start(recorder);
    keyNow = 1250;
    keyboard.handleKeyDown({ code: "Space", key: " ", repeat: false });
    keyNow = 1500;
    keyboard.handleKeyDown({ code: "KeyZ", key: "z", repeat: false });
    keyNow = 1600;
    keyboard.handleKeyDown({ code: "KeyZ", key: "z", repeat: true }); // auto-repeat ignored
    keyNow = 1800;
    keyboard.handleKeyUp({ code: "KeyZ", key: "z", repeat: false });
    keyNow = 2200;
    keyboard.handleKeyUp({ code: "Space", key: " ", repeat: false });
    clock.set(3000);
    const take = recorder.stop();
    if (!take) throw new Error("no take");
    expect(take.sources).toEqual([{ source: "computerKeyboard" }]);
    const notes = pairRecordedNotes(take.events, take.durationMs);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ midi: 48, velocity: 96, onsetMs: 500, pressedMs: 300, soundingMs: 700, source: "computerKeyboard" });
  });

  it("records the on-screen piano with velocities", () => {
    const { recorder, clock } = setup();
    let touchNow = 1000;
    const touch = new TouchInput({ now: () => touchNow });
    touch.onEvent((event) => recorder.handleEvent(event));
    start(recorder);
    touchNow = 1100;
    touch.press(64, 1, 55);
    touch.press(67, 2, 70);
    touchNow = 1400;
    touch.release(64, 1);
    touchNow = 1900;
    touch.releaseAll();
    clock.set(2000);
    const take = recorder.stop();
    const notes = pairRecordedNotes(take?.events ?? [], take?.durationMs ?? 0);
    expect(notes.map((note) => [note.midi, note.velocity, note.onsetMs, note.pressedMs, note.source])).toEqual([
      [64, 55, 100, 300, "touch"],
      [67, 70, 100, 800, "touch"]
    ]);
  });
});
