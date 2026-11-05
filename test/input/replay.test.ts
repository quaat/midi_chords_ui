import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InputEvent } from "@/model/contracts";
import { ReplayInput, parseInputLog, rawToInputEvents, serializeInputLog } from "@/input/replay";
import { HeldStateTracker } from "@/input/heldState";

const recorded: InputEvent[] = [
  { source: "midi", type: "noteOn", timestampMs: 1000, portId: "p", channel: 1, midi: 60, velocity: 90 },
  { source: "midi", type: "noteOn", timestampMs: 1010, portId: "p", channel: 1, midi: 64, velocity: 80 },
  { source: "midi", type: "sustain", timestampMs: 1200, portId: "p", channel: 1, value: 127 },
  { source: "midi", type: "noteOff", timestampMs: 1500, portId: "p", channel: 1, midi: 60, velocity: 0 },
  { source: "midi", type: "noteOff", timestampMs: 1500, portId: "p", channel: 1, midi: 64, velocity: 0 },
  { source: "midi", type: "sustain", timestampMs: 2000, portId: "p", channel: 1, value: 0 }
];

describe("ReplayInput", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reproduces timestamps in order with fake timers", () => {
    const replay = new ReplayInput(recorded);
    const seen: { at: number; event: InputEvent }[] = [];
    const t0 = performance.now();
    replay.onEvent((event) => seen.push({ at: performance.now() - t0, event }));
    let done = false;
    replay.onDone(() => {
      done = true;
    });
    replay.start();
    expect(seen).toHaveLength(1);
    vi.advanceTimersByTime(9);
    expect(seen).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(seen).toHaveLength(2);
    vi.advanceTimersByTime(1000);
    expect(done).toBe(true);
    expect(seen.map((s) => s.event.timestampMs)).toEqual([1000, 1010, 1200, 1500, 1500, 2000]);
    expect(seen.map((s) => s.at)).toEqual([0, 10, 200, 500, 500, 1000]);
    expect(seen.map((s) => s.event.midi ?? s.event.value)).toEqual([60, 64, 127, 60, 64, 0]);
    expect(seen.every((s) => s.event.source === "replay")).toBe(true);
  });

  it("time-scales playback and rebases timestamps", () => {
    const replay = new ReplayInput(recorded, { speed: 2, startTimestampMs: 0, source: "preserve" });
    const seen: InputEvent[] = [];
    replay.onEvent((event) => seen.push(event));
    replay.start();
    vi.advanceTimersByTime(499);
    expect(seen).toHaveLength(5);
    vi.advanceTimersByTime(1);
    expect(seen.map((e) => e.timestampMs)).toEqual([0, 5, 100, 250, 250, 500]);
    expect(seen[0].source).toBe("midi");
  });

  it("sorts unordered input stably and can be stopped", () => {
    const shuffled = [recorded[3], recorded[0], recorded[4], recorded[1]];
    const replay = new ReplayInput(shuffled);
    expect(replay.events().map((e) => e.midi)).toEqual([60, 64, 60, 64]);
    const seen: InputEvent[] = [];
    replay.onEvent((event) => seen.push(event));
    replay.start();
    vi.advanceTimersByTime(20);
    replay.stop();
    vi.advanceTimersByTime(5000);
    expect(seen).toHaveLength(2);
    expect(replay.isRunning()).toBe(false);
  });

  it("drives a held-state tracker deterministically (pedal-held release)", () => {
    const tracker = new HeldStateTracker();
    const replay = new ReplayInput(recorded);
    replay.onEvent((event) => tracker.apply(event));
    replay.start();
    vi.advanceTimersByTime(600);
    expect(tracker.snapshot()).toMatchObject({ pressed: [], sustained: [60, 64], sustainDown: true });
    vi.advanceTimersByTime(400);
    expect(tracker.sounding()).toEqual([]);
  });

  it("replays raw MIDI bytes, skipping echoes and unknown messages", () => {
    const raw = [
      { data: [0x90, 60, 100], timestampMs: 10, portId: "p", portName: "Piano" },
      { data: [0x90, 60, 100], timestampMs: 11, portId: "p", echo: true },
      { data: [0xb0, 7, 1], timestampMs: 12, portId: "p" },
      { data: [0x90, 60, 0], timestampMs: 30, portId: "p" }
    ];
    expect(rawToInputEvents(raw).map((e) => e.type)).toEqual(["noteOn", "noteOff"]);
    const replay = ReplayInput.fromRaw(raw);
    const seen: InputEvent[] = [];
    replay.onEvent((event) => seen.push(event));
    replay.flush();
    expect(seen.map((e) => [e.type, e.timestampMs, e.source, e.portName])).toEqual([
      ["noteOn", 10, "replay", "Piano"],
      ["noteOff", 30, "replay", ""]
    ]);
  });
});

describe("input log JSON", () => {
  it("round-trips events and raw bytes", () => {
    const text = serializeInputLog({
      events: recorded,
      raw: [{ data: [0x90, 60, 100], timestampMs: 1000, portId: "p" }],
      createdAt: "2026-11-04T10:00:00.000Z",
      device: { name: "CASIO USB-MIDI" },
      latencyOffsetMs: 8
    });
    const result = parseInputLog(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.log.kind).toBe("inputLog");
      expect(result.log.version).toBe(1);
      expect(result.log.events).toEqual(recorded);
      expect(result.log.raw).toEqual([{ data: [0x90, 60, 100], timestampMs: 1000, portId: "p" }]);
      expect(result.log.latencyOffsetMs).toBe(8);
      expect(result.log.device).toEqual({ name: "CASIO USB-MIDI" });
    }
  });

  it("rejects wrong version, wrong kind, bad JSON and invalid events", () => {
    const good = JSON.parse(serializeInputLog({ events: recorded })) as Record<string, unknown>;
    expect(parseInputLog(JSON.stringify({ ...good, version: 2 }))).toMatchObject({ ok: false, error: expect.stringContaining("version") });
    expect(parseInputLog(JSON.stringify({ ...good, kind: "project" })).ok).toBe(false);
    expect(parseInputLog("{nope").ok).toBe(false);
    expect(parseInputLog(JSON.stringify({ ...good, events: [{ source: "midi", type: "bogus", timestampMs: 1 }] })).ok).toBe(false);
    expect(parseInputLog(JSON.stringify({ ...good, events: [{ source: "midi", type: "noteOn", timestampMs: "x" }] })).ok).toBe(false);
    expect(parseInputLog(JSON.stringify({ ...good, raw: [{ data: [300], timestampMs: 1, portId: "p" }] })).ok).toBe(false);
  });
});
