import { describe, expect, it } from "vitest";
import type { InputEvent } from "@/model/contracts";
import { TouchInput } from "@/input/touch";

function setup() {
  const touch = new TouchInput({ now: () => 7 });
  const events: InputEvent[] = [];
  touch.onEvent((event) => events.push(event));
  return { touch, events };
}

describe("TouchInput", () => {
  it("converts press/release into touch InputEvents", () => {
    const { touch, events } = setup();
    touch.press(60, 1);
    touch.release(60, 1);
    expect(events).toEqual([
      { source: "touch", type: "noteOn", timestampMs: 7, channel: 1, midi: 60, velocity: 90 },
      { source: "touch", type: "noteOff", timestampMs: 7, channel: 1, midi: 60, velocity: 0 }
    ]);
  });

  it("releases on pointercancel / lost capture and on releaseAll", () => {
    const { touch, events } = setup();
    touch.press(60, 1);
    touch.press(64, 2);
    touch.cancel(1);
    expect(touch.heldNotes()).toEqual([64]);
    touch.press(67, 3);
    touch.releaseAll();
    expect(touch.heldNotes()).toEqual([]);
    expect(events.filter((e) => e.type === "noteOff").map((e) => e.midi)).toEqual([60, 64, 67]);
  });

  it("keeps a pitch held while another pointer holds it and supports sliding", () => {
    const { touch, events } = setup();
    touch.press(60, 1);
    touch.press(60, 2);
    touch.release(60, 1);
    expect(events.filter((e) => e.type === "noteOff")).toHaveLength(0);
    touch.moveTo(62, 2);
    expect(events.map((e) => [e.type, e.midi])).toEqual([
      ["noteOn", 60],
      ["noteOn", 60],
      ["noteOff", 60],
      ["noteOn", 62]
    ]);
    touch.release(999, 42);
    expect(touch.heldNotes()).toEqual([62]);
  });
});
