import { describe, expect, it } from "vitest";
import type { InputEvent } from "@/model/contracts";
import { ComputerKeyboardInput } from "@/input/computerKeyboard";
import type { KeyEventTarget } from "@/input/computerKeyboard";
import { HeldStateTracker } from "@/input/heldState";

function setup(baseMidi?: number) {
  const clock = { t: 100 };
  const keyboard = new ComputerKeyboardInput({ baseMidi, now: () => clock.t });
  const events: InputEvent[] = [];
  keyboard.onEvent((event) => events.push(event));
  return { keyboard, events, clock };
}
const down = (code: string, repeat = false) => ({ code, key: "", repeat });
const up = (code: string) => ({ code, key: "", repeat: false });

describe("ComputerKeyboardInput", () => {
  it("maps the lower row from C3 and the upper row one octave higher", () => {
    const { keyboard, events } = setup();
    for (const code of ["KeyZ", "KeyS", "KeyM", "Comma", "KeyQ", "Digit2", "KeyU", "KeyI"]) {
      keyboard.handleKeyDown(down(code));
    }
    expect(events.map((e) => e.midi)).toEqual([48, 49, 59, 60, 60, 61, 71, 72]);
    expect(events.every((e) => e.source === "computerKeyboard" && e.type === "noteOn" && e.timestampMs === 100)).toBe(true);
  });

  it("ignores auto-repeat keydown", () => {
    const { keyboard, events } = setup();
    keyboard.handleKeyDown(down("KeyZ"));
    keyboard.handleKeyDown(down("KeyZ", true));
    keyboard.handleKeyDown(down("KeyZ", true));
    expect(events).toHaveLength(1);
    keyboard.handleKeyUp(up("KeyZ"));
    expect(events.map((e) => e.type)).toEqual(["noteOn", "noteOff"]);
  });

  it("shifts octaves with - and = and releases held notes at their original pitch", () => {
    const { keyboard, events, clock } = setup();
    keyboard.handleKeyDown(down("KeyZ"));
    expect(keyboard.handleKeyDown(down("Equal"))).toBe(true);
    expect(keyboard.getBaseMidi()).toBe(60);
    clock.t = 200;
    keyboard.handleKeyUp(up("KeyZ"));
    keyboard.handleKeyDown(down("KeyZ"));
    keyboard.handleKeyDown(down("Minus"));
    keyboard.handleKeyDown(down("Minus"));
    expect(keyboard.getBaseMidi()).toBe(36);
    expect(events.map((e) => [e.type, e.midi, e.timestampMs])).toEqual([
      ["noteOn", 48, 100],
      ["noteOff", 48, 200],
      ["noteOn", 60, 200]
    ]);
  });

  it("clamps octave shifts to the MIDI range", () => {
    const { keyboard } = setup(120);
    expect(keyboard.getBaseMidi()).toBe(103);
    for (let i = 0; i < 20; i += 1) {
      keyboard.shiftOctave(-1);
    }
    expect(keyboard.getBaseMidi()).toBe(0);
  });

  it("uses Space as sustain and ignores modifier shortcuts", () => {
    const { keyboard, events } = setup();
    keyboard.handleKeyDown(down("Space"));
    keyboard.handleKeyDown(down("Space", true));
    keyboard.handleKeyUp(up("Space"));
    expect(events.map((e) => [e.type, e.value])).toEqual([
      ["sustain", 127],
      ["sustain", 0]
    ]);
    expect(keyboard.handleKeyDown({ code: "KeyC", key: "c", repeat: false, ctrlKey: true })).toBe(false);
    expect(events).toHaveLength(2);
  });

  it("falls back to key when code is missing", () => {
    const { keyboard, events } = setup();
    keyboard.handleKeyDown({ code: "", key: "X", repeat: false });
    expect(events[0].midi).toBe(50);
  });

  it("releaseAll releases every note and the pedal; feeds a held-state tracker cleanly", () => {
    const { keyboard, events } = setup();
    const tracker = new HeldStateTracker();
    keyboard.onEvent((event) => tracker.apply(event));
    keyboard.handleKeyDown(down("Space"));
    keyboard.handleKeyDown(down("KeyZ"));
    keyboard.handleKeyDown(down("KeyC"));
    keyboard.releaseAll();
    expect(keyboard.heldNotes()).toEqual([]);
    expect(events.slice(-3).map((e) => e.type)).toEqual(["noteOff", "noteOff", "sustain"]);
    expect(tracker.sounding()).toEqual([]);
  });

  it("attach releases all on blur and visibilitychange, and detaches", () => {
    const { keyboard, events } = setup();
    const handlers = new Map<string, (event: Event) => void>();
    const target: KeyEventTarget = {
      addEventListener: (type, listener) => {
        handlers.set(type, listener);
      },
      removeEventListener: (type) => {
        handlers.delete(type);
      }
    };
    const detach = keyboard.attach(target);
    let prevented = 0;
    const keydown = { code: "KeyZ", key: "z", repeat: false, target: null, preventDefault: () => (prevented += 1) };
    handlers.get("keydown")?.(keydown as unknown as Event);
    expect(prevented).toBe(1);
    expect(keyboard.heldNotes()).toEqual([48]);
    handlers.get("blur")?.({} as Event);
    expect(keyboard.heldNotes()).toEqual([]);
    handlers.get("keydown")?.({ ...keydown, code: "KeyX" } as unknown as Event);
    handlers.get("visibilitychange")?.({} as Event);
    expect(keyboard.heldNotes()).toEqual([]);
    const typing = { code: "KeyC", key: "c", repeat: false, target: { tagName: "input" }, preventDefault: () => (prevented += 1) };
    handlers.get("keydown")?.(typing as unknown as Event);
    expect(keyboard.heldNotes()).toEqual([]);
    detach();
    expect(handlers.size).toBe(0);
    expect(events.map((e) => e.type)).toEqual(["noteOn", "noteOff", "noteOn", "noteOff"]);
  });
});
