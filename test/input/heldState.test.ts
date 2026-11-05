import { describe, expect, it } from "vitest";
import type { InputEvent } from "@/model/contracts";
import { HeldStateTracker, sourceKeyOf } from "@/input/heldState";
import type { HeldChange } from "@/input/heldState";

function midi(type: InputEvent["type"], fields: Partial<InputEvent> = {}, portId = "p1", channel = 1): InputEvent {
  return { source: "midi", type, timestampMs: 0, portId, portName: portId, channel, ...fields };
}
const on = (note: number, t = 0, portId = "p1", velocity = 100): InputEvent => midi("noteOn", { midi: note, velocity, timestampMs: t }, portId);
const off = (note: number, t = 0, portId = "p1"): InputEvent => midi("noteOff", { midi: note, velocity: 0, timestampMs: t }, portId);
const pedal = (type: "sustain" | "sostenuto" | "soft", value: number, t = 0, portId = "p1"): InputEvent => midi(type, { value, timestampMs: t }, portId);

function track(): { tracker: HeldStateTracker; changes: HeldChange[] } {
  const tracker = new HeldStateTracker();
  const changes: HeldChange[] = [];
  tracker.onChange((change) => changes.push(change));
  return { tracker, changes };
}

describe("HeldStateTracker", () => {
  it("tracks pressed keys and emits attack/release", () => {
    const { tracker, changes } = track();
    tracker.apply(on(60, 1));
    tracker.apply(on(64, 2));
    expect(tracker.snapshot().pressed).toEqual([60, 64]);
    tracker.apply(off(60, 3));
    expect(tracker.snapshot().pressed).toEqual([64]);
    expect(changes.map((c) => c.kind)).toEqual(["attack", "attack", "release"]);
    expect(changes[0]).toMatchObject({ kind: "attack", midi: 60, velocity: 100, timestampMs: 1, source: "midi", retrigger: false });
    expect(changes[2]).toMatchObject({ kind: "release", midi: 60, stillSounding: false });
  });

  it("treats a zero-velocity noteOn as noteOff defensively", () => {
    const { tracker } = track();
    tracker.apply(on(60));
    tracker.apply(on(60, 1, "p1", 0));
    expect(tracker.sounding()).toEqual([]);
  });

  it("retriggers a held key: stays pressed and emits another attack", () => {
    const { tracker, changes } = track();
    tracker.apply(on(60, 1));
    tracker.apply(on(60, 2, "p1", 80));
    expect(tracker.snapshot().pressed).toEqual([60]);
    const attacks = changes.filter((c) => c.kind === "attack");
    expect(attacks).toHaveLength(2);
    expect(attacks[1]).toMatchObject({ retrigger: true, velocity: 80, timestampMs: 2 });
    tracker.apply(off(60));
    expect(tracker.sounding()).toEqual([]);
  });

  it("release while sustained keeps sounding until pedal up", () => {
    const { tracker, changes } = track();
    tracker.apply(on(60));
    tracker.apply(pedal("sustain", 127));
    tracker.apply(off(60));
    expect(tracker.snapshot()).toEqual({ pressed: [], sustained: [60], sustainDown: true, sostenutoDown: false, softDown: false });
    expect(tracker.sounding()).toEqual([60]);
    expect(changes[changes.length - 1]).toMatchObject({ kind: "release", stillSounding: true });
    tracker.apply(pedal("sustain", 0));
    expect(tracker.sounding()).toEqual([]);
    expect(changes[changes.length - 1]).toMatchObject({ kind: "pedal", pedal: "sustain", down: false, damped: [60] });
  });

  it("sustain release clears sustained notes but keeps pressed ones", () => {
    const { tracker } = track();
    tracker.apply(pedal("sustain", 100));
    tracker.apply(on(60));
    tracker.apply(on(67));
    tracker.apply(off(60));
    tracker.apply(pedal("sustain", 10));
    expect(tracker.snapshot().pressed).toEqual([67]);
    expect(tracker.snapshot().sustained).toEqual([]);
  });

  it("applies the CC64 threshold and ignores repeated values (half-pedal stream)", () => {
    const { tracker, changes } = track();
    tracker.apply(pedal("sustain", 63));
    expect(tracker.snapshot().sustainDown).toBe(false);
    expect(changes).toHaveLength(0);
    tracker.apply(pedal("sustain", 64));
    tracker.apply(pedal("sustain", 90));
    tracker.apply(pedal("sustain", 127));
    expect(tracker.snapshot().sustainDown).toBe(true);
    expect(changes.filter((c) => c.kind === "pedal")).toHaveLength(1);
  });

  it("noteOff of a sustained-only key changes nothing", () => {
    const { tracker, changes } = track();
    tracker.apply(on(60));
    tracker.apply(pedal("sustain", 127));
    tracker.apply(off(60));
    const before = changes.length;
    expect(tracker.apply(off(60))).toEqual([]);
    expect(changes.length).toBe(before);
    expect(tracker.snapshot().sustained).toEqual([60]);
  });

  it("re-pressing a sustained key moves it back to pressed", () => {
    const { tracker, changes } = track();
    tracker.apply(on(60));
    tracker.apply(pedal("sustain", 127));
    tracker.apply(off(60));
    tracker.apply(on(60, 5));
    expect(tracker.snapshot().pressed).toEqual([60]);
    expect(tracker.snapshot().sustained).toEqual([]);
    expect(changes[changes.length - 1]).toMatchObject({ kind: "attack", retrigger: true });
  });

  it("sostenuto captures only keys pressed at the moment it goes down", () => {
    const { tracker } = track();
    tracker.apply(on(48));
    tracker.apply(on(52));
    tracker.apply(pedal("sostenuto", 127));
    tracker.apply(on(72));
    tracker.apply(off(48));
    tracker.apply(off(52));
    tracker.apply(off(72));
    expect(tracker.snapshot().sustained).toEqual([48, 52]);
    expect(tracker.snapshot().pressed).toEqual([]);
    expect(tracker.sounding()).toEqual([48, 52]);
    tracker.apply(pedal("sostenuto", 0));
    expect(tracker.sounding()).toEqual([]);
  });

  it("sostenuto-held notes survive a sustain release; sustain-held survive sostenuto release", () => {
    const { tracker } = track();
    tracker.apply(on(48));
    tracker.apply(pedal("sostenuto", 127));
    tracker.apply(pedal("sustain", 127));
    tracker.apply(on(60));
    tracker.apply(off(48));
    tracker.apply(off(60));
    expect(tracker.sounding()).toEqual([48, 60]);
    tracker.apply(pedal("sustain", 0));
    expect(tracker.sounding()).toEqual([48]);
    tracker.apply(pedal("sustain", 127));
    tracker.apply(on(62));
    tracker.apply(off(62));
    tracker.apply(pedal("sostenuto", 0));
    expect(tracker.sounding()).toEqual([48, 62]);
  });

  it("tracks the soft pedal as a flag", () => {
    const { tracker } = track();
    tracker.apply(pedal("soft", 127));
    expect(tracker.snapshot().softDown).toBe(true);
    tracker.apply(pedal("soft", 0));
    expect(tracker.snapshot().softDown).toBe(false);
  });

  it("allNotesOff clears that source; reset (panic) clears everything", () => {
    const { tracker, changes } = track();
    tracker.apply(on(60, 0, "p1"));
    tracker.apply(pedal("sustain", 127, 0, "p1"));
    tracker.apply(on(62, 0, "p2"));
    tracker.apply(midi("allNotesOff", { value: 0 }, "p1"));
    expect(tracker.sounding()).toEqual([62]);
    expect(tracker.snapshot().sustainDown).toBe(false);
    expect(changes[changes.length - 1]).toMatchObject({ kind: "reset", reason: "allNotesOff", cleared: [60] });
    tracker.reset();
    expect(tracker.snapshot()).toEqual({ pressed: [], sustained: [], sustainDown: false, sostenutoDown: false, softDown: false });
    expect(changes[changes.length - 1]).toMatchObject({ kind: "reset", reason: "reset", sourceKey: null, cleared: [62] });
  });

  it("isolates ports: two ports holding the same pitch", () => {
    const { tracker } = track();
    tracker.apply(on(60, 0, "a"));
    tracker.apply(on(60, 0, "b"));
    tracker.apply(off(60, 1, "a"));
    expect(tracker.snapshot().pressed).toEqual([60]);
    expect(tracker.snapshotFor(sourceKeyOf({ source: "midi", portId: "a", channel: 1 }))?.pressed).toEqual([]);
    expect(tracker.snapshotFor(sourceKeyOf({ source: "midi", portId: "b", channel: 1 }))?.pressed).toEqual([60]);
    tracker.apply(off(60, 2, "b"));
    expect(tracker.sounding()).toEqual([]);
  });

  it("isolates channels on the same port and pedal state per source", () => {
    const { tracker } = track();
    tracker.apply(midi("sustain", { value: 127 }, "p1", 1));
    tracker.apply(midi("noteOn", { midi: 60, velocity: 90 }, "p1", 2));
    tracker.apply(midi("noteOff", { midi: 60, velocity: 0 }, "p1", 2));
    expect(tracker.sounding()).toEqual([]);
  });

  it("disconnect clears only that port's state", () => {
    const { tracker, changes } = track();
    tracker.apply(on(60, 0, "a"));
    tracker.apply(midi("noteOn", { midi: 61, velocity: 90 }, "a", 2));
    tracker.apply(on(64, 0, "b"));
    tracker.apply({ source: "midi", type: "connection", timestampMs: 5, portId: "a", connected: false });
    expect(tracker.sounding()).toEqual([64]);
    const resets = changes.filter((c) => c.kind === "reset");
    expect(resets).toHaveLength(2);
    expect(resets.every((c) => c.kind === "reset" && c.reason === "disconnect" && c.portId === "a")).toBe(true);
  });

  it("keys keyboard and touch as single sources, independent of MIDI", () => {
    const { tracker } = track();
    expect(sourceKeyOf({ source: "computerKeyboard", channel: 1 })).toBe("computerKeyboard");
    tracker.apply({ source: "computerKeyboard", type: "noteOn", timestampMs: 0, midi: 60, velocity: 96, channel: 1 });
    tracker.apply(on(60));
    tracker.apply(off(60));
    expect(tracker.snapshot().pressed).toEqual([60]);
    expect(tracker.sourceKeys()).toEqual(["computerKeyboard", "midi:p1#1"]);
  });
});
