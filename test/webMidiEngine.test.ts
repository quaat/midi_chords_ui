import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebMidiPlaybackEngine } from "@/playback/webMidiEngine";

describe("WebMidiPlaybackEngine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not send stale note-off when the same note retriggers", () => {
    const engine = new WebMidiPlaybackEngine();
    const send = vi.fn();
    engine.setOutput({ send } as unknown as MIDIOutput);

    engine.scheduleNote(60, 100, 0, 0.1, 1);
    engine.scheduleNote(60, 100, 0.05, 0.1, 1);

    vi.advanceTimersByTime(1);
    vi.advanceTimersByTime(49);
    vi.advanceTimersByTime(50);

    expect(send).toHaveBeenCalledTimes(4);
    expect(send.mock.calls.map(([message]) => message)).toEqual([
      [0x80, 60, 0],
      [0x90, 60, 100],
      [0x80, 60, 0],
      [0x90, 60, 100]
    ]);

    vi.advanceTimersByTime(50);
    expect(send).toHaveBeenCalledTimes(5);
    expect(send.mock.calls[4]?.[0]).toEqual([0x80, 60, 0]);
  });

  it("clears scheduled note timers on stopAll", () => {
    const engine = new WebMidiPlaybackEngine();
    const send = vi.fn();
    engine.setOutput({ send } as unknown as MIDIOutput);

    engine.scheduleNote(67, 110, 0.2, 0.2, 1);
    engine.stopAll(1);
    vi.advanceTimersByTime(1000);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toEqual([0xb0, 123, 0]);
  });
});
