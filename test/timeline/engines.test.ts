import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SilentTimelineEngine, WebMidiTimelineEngine } from "@/playback/timelineEngines";
import { fakeClock } from "./fixtures";

describe("WebMidiTimelineEngine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("never lets an older noteOff silence a newer noteOn of the same pitch", () => {
    const send = vi.fn();
    const engine = new WebMidiTimelineEngine({ send }, fakeClock());
    const t0 = performance.now();
    engine.noteOn(60, 100, 1, t0);
    engine.noteOn(60, 100, 1, t0 + 50);
    engine.noteOff(60, 1, t0 + 100);
    engine.noteOff(60, 1, t0 + 150);

    vi.advanceTimersByTime(1);
    expect(send.mock.calls.map(([message]) => message)).toEqual([[0x90, 60, 100]]);
    vi.advanceTimersByTime(49);
    // Retrigger: clean note-off before the new attack.
    expect(send.mock.calls.map(([message]) => message)).toEqual([
      [0x90, 60, 100],
      [0x80, 60, 0],
      [0x90, 60, 100]
    ]);
    vi.advanceTimersByTime(50);
    // The older note-off at +100 is ignored.
    expect(send).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(50);
    expect(send).toHaveBeenCalledTimes(4);
    expect(send.mock.calls[3]?.[0]).toEqual([0x80, 60, 0]);
  });

  it("sends noteOff before noteOn when both are due at the same instant (loop wrap)", () => {
    const send = vi.fn();
    const engine = new WebMidiTimelineEngine({ send }, fakeClock());
    const t0 = performance.now();
    engine.noteOn(64, 90, 2, t0);
    engine.noteOff(64, 2, t0 + 100);
    engine.noteOn(64, 90, 2, t0 + 100);
    vi.advanceTimersByTime(100);
    expect(send.mock.calls.map(([message]) => message)).toEqual([
      [0x91, 64, 90],
      [0x81, 64, 0],
      [0x91, 64, 90]
    ]);
  });

  it("allNotesOff cancels pending timers and silences sounding notes", () => {
    const send = vi.fn();
    const engine = new WebMidiTimelineEngine({ send }, fakeClock());
    const t0 = performance.now();
    engine.noteOn(67, 110, 1, t0);
    engine.noteOn(72, 110, 1, t0 + 200);
    vi.advanceTimersByTime(10);
    engine.allNotesOff();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(send.mock.calls.map(([message]) => message)).toEqual([
      [0x90, 67, 110],
      [0x80, 67, 0],
      [0xb0, 123, 0]
    ]);
  });

  it("setOutput silences the previous output", () => {
    const first = vi.fn();
    const second = vi.fn();
    const engine = new WebMidiTimelineEngine({ send: first }, fakeClock());
    engine.noteOn(60, 100, 1, performance.now());
    vi.advanceTimersByTime(1);
    engine.setOutput({ send: second });
    expect(first.mock.calls.map(([message]) => message)).toContainEqual([0x80, 60, 0]);
    expect(second).toHaveBeenCalledTimes(0);
  });
});

describe("SilentTimelineEngine", () => {
  it("records calls in order", async () => {
    let now = 5;
    const engine = new SilentTimelineEngine(() => now);
    await engine.prepare();
    engine.noteOn(60, 90, 1, 10);
    now = 7;
    engine.noteOff(60, 1, 20);
    engine.allNotesOff();
    expect(engine.calls.map((call) => call.type)).toEqual(["prepare", "noteOn", "noteOff", "allNotesOff"]);
    expect(engine.noteOns()[0]).toEqual({ type: "noteOn", midi: 60, velocity: 90, channel: 1, atMs: 10, calledAtMs: 5 });
    expect(engine.noteOffs()[0].calledAtMs).toBe(7);
  });
});

describe("WebMidiTimelineEngine — channel-selective silence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allNotesOff(channel) leaves other channels' pending notes intact", () => {
    const send = vi.fn();
    const engine = new WebMidiTimelineEngine({ send }, fakeClock());
    const t0 = performance.now();
    engine.noteOn(60, 100, 1, t0 + 50);
    engine.noteOn(36, 100, 2, t0 + 50);
    engine.allNotesOff(1);
    vi.advanceTimersByTime(60);
    expect(send.mock.calls.map(([message]) => message)).toEqual([
      [0xb0, 123, 0],
      [0x91, 36, 100]
    ]);
  });
});
