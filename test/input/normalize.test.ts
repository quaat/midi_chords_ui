import { describe, expect, it } from "vitest";
import { isPedalDown, isRealtimeMessage, parseMidiMessage } from "@/input/normalize";

const meta = { portId: "p1", portName: "Piano" };

describe("parseMidiMessage", () => {
  it("parses note on with 1-based channel and port identity", () => {
    expect(parseMidiMessage([0x92, 60, 100], 12.5, meta)).toEqual({
      source: "midi",
      type: "noteOn",
      timestampMs: 12.5,
      portId: "p1",
      portName: "Piano",
      channel: 3,
      midi: 60,
      velocity: 100
    });
  });

  it("normalises note on with velocity 0 to note off", () => {
    const event = parseMidiMessage(new Uint8Array([0x90, 64, 0]), 1, meta);
    expect(event?.type).toBe("noteOff");
    expect(event?.midi).toBe(64);
    expect(event?.velocity).toBe(0);
  });

  it("parses 0x8n note off and keeps release velocity", () => {
    const event = parseMidiMessage([0x8f, 64, 40], 1, meta);
    expect(event).toMatchObject({ type: "noteOff", midi: 64, velocity: 40, channel: 16 });
  });

  it("maps CC64/66/67 to sustain/sostenuto/soft with value", () => {
    expect(parseMidiMessage([0xb0, 64, 127], 0, meta)).toMatchObject({ type: "sustain", value: 127 });
    expect(parseMidiMessage([0xb0, 66, 0], 0, meta)).toMatchObject({ type: "sostenuto", value: 0 });
    expect(parseMidiMessage([0xb0, 67, 90], 0, meta)).toMatchObject({ type: "soft", value: 90 });
  });

  it("applies the CC64 threshold at 64", () => {
    expect(isPedalDown(63)).toBe(false);
    expect(isPedalDown(64)).toBe(true);
    expect(isPedalDown(0)).toBe(false);
    expect(isPedalDown(127)).toBe(true);
  });

  it("maps CC123 and CC120 to allNotesOff", () => {
    expect(parseMidiMessage([0xb1, 123, 0], 0, meta)).toMatchObject({ type: "allNotesOff", channel: 2 });
    expect(parseMidiMessage([0xb0, 120, 0], 0, meta)).toMatchObject({ type: "allNotesOff" });
  });

  it("ignores other controllers, program change, realtime, running status and short messages", () => {
    expect(parseMidiMessage([0xb0, 7, 100], 0, meta)).toBeNull();
    expect(parseMidiMessage([0xc0, 5, 0], 0, meta)).toBeNull();
    expect(parseMidiMessage([0xfe], 0, meta)).toBeNull();
    expect(parseMidiMessage([60, 100, 0], 0, meta)).toBeNull();
    expect(parseMidiMessage([0x90, 60], 0, meta)).toBeNull();
    expect(parseMidiMessage([0x90, 200, 10], 0, meta)).toBeNull();
    expect(parseMidiMessage([0xf0, 1, 2, 0xf7], 0, meta)).toBeNull();
  });

  it("can label events with another source and detects realtime bytes", () => {
    expect(parseMidiMessage([0x90, 60, 1], 0, meta, "replay")?.source).toBe("replay");
    expect(isRealtimeMessage([0xfe])).toBe(true);
    expect(isRealtimeMessage([0x90, 60, 1])).toBe(false);
  });
});
