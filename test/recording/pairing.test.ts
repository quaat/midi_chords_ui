import { describe, expect, it } from "vitest";
import { countNoteOns, lastEventMs, pairRecordedNotes, sortRecordedEvents } from "@/recording";
import type { RecordedEvent } from "@/recording";

function on(midi: number, atMs: number, velocity = 100, extra: Partial<RecordedEvent> = {}): RecordedEvent {
  return { type: "noteOn", atMs, midi, velocity, source: "midi", portId: "p1", channel: 1, ...extra };
}

function off(midi: number, atMs: number, velocity = 0, extra: Partial<RecordedEvent> = {}): RecordedEvent {
  return { type: "noteOff", atMs, midi, velocity, source: "midi", portId: "p1", channel: 1, ...extra };
}

function sustain(value: number, atMs: number, extra: Partial<RecordedEvent> = {}): RecordedEvent {
  return { type: "sustain", atMs, value, source: "midi", portId: "p1", channel: 1, ...extra };
}

describe("pairRecordedNotes", () => {
  it("pairs a single note with its onset, pressed and sounding length", () => {
    const notes = pairRecordedNotes([on(60, 500, 90), off(60, 1200)], 3000);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ midi: 60, velocity: 90, onsetMs: 500, pressedMs: 700, soundingMs: 700, channel: 1, source: "midi", truncated: false });
  });

  it("keeps silence before the first note and between notes (rests)", () => {
    const notes = pairRecordedNotes([on(60, 1000), off(60, 1500), on(62, 2500), off(62, 2600)], 4000);
    expect(notes.map((note) => [note.onsetMs, note.pressedMs])).toEqual([
      [1000, 500],
      [2500, 100]
    ]);
  });

  it("keeps simultaneous notes of a chord with independent lengths", () => {
    const notes = pairRecordedNotes([on(60, 100), on(64, 100), on(67, 100), off(64, 400), off(60, 900), off(67, 1300)], 2000);
    expect(notes.map((note) => note.onsetMs)).toEqual([100, 100, 100]);
    expect(notes.map((note) => [note.midi, note.pressedMs])).toEqual([
      [60, 800],
      [64, 300],
      [67, 1200]
    ]);
  });

  it("preserves velocities and release velocities", () => {
    const notes = pairRecordedNotes([on(60, 0, 23), off(60, 100, 64), on(62, 200, 127), off(62, 300)], 400);
    expect(notes.map((note) => [note.velocity, note.releaseVelocity])).toEqual([
      [23, 64],
      [127, 0]
    ]);
  });

  it("pairs repeated notes of the same pitch in order", () => {
    const notes = pairRecordedNotes([on(60, 0), off(60, 100), on(60, 200), off(60, 350), on(60, 400), off(60, 410)], 1000);
    expect(notes.map((note) => [note.onsetMs, note.pressedMs, note.truncated])).toEqual([
      [0, 100, false],
      [200, 150, false],
      [400, 10, false]
    ]);
  });

  it("retriggering a held pitch closes the earlier note at the new attack", () => {
    const notes = pairRecordedNotes([on(60, 0), on(60, 300), off(60, 500)], 1000);
    expect(notes.map((note) => [note.onsetMs, note.pressedMs, note.soundingMs, note.truncated])).toEqual([
      [0, 300, 300, true],
      [300, 200, 200, false]
    ]);
  });

  it("extends sounding length while the sustain pedal is down, pressed length stays", () => {
    const notes = pairRecordedNotes([on(60, 0), sustain(127, 50), off(60, 200), sustain(0, 900)], 2000);
    expect(notes[0]).toMatchObject({ pressedMs: 200, soundingMs: 900, truncated: false });
  });

  it("a key released after the pedal comes up stops when released", () => {
    const notes = pairRecordedNotes([sustain(127, 0), on(60, 100), sustain(0, 300), off(60, 600)], 1000);
    expect(notes[0]).toMatchObject({ pressedMs: 500, soundingMs: 500 });
  });

  it("ignores an unmatched note-off", () => {
    const notes = pairRecordedNotes([off(64, 100), on(60, 200), off(60, 300)], 500);
    expect(notes).toHaveLength(1);
    expect(notes[0].midi).toBe(60);
  });

  it("treats a velocity-0 note-on as a note-off", () => {
    const notes = pairRecordedNotes([on(60, 0), on(60, 250, 0)], 500);
    expect(notes).toHaveLength(1);
    expect(notes[0].pressedMs).toBe(250);
  });

  it("closes notes still held or sustained at the stop boundary (truncated)", () => {
    const notes = pairRecordedNotes([on(60, 100), sustain(127, 150), on(64, 200), off(64, 300)], 1000);
    expect(notes.map((note) => [note.midi, note.pressedMs, note.soundingMs, note.truncated])).toEqual([
      [60, 900, 900, true],
      [64, 100, 800, true]
    ]);
  });

  it("closes a source's notes on allNotesOff (device reset/disconnect)", () => {
    const reset: RecordedEvent = { type: "allNotesOff", atMs: 400, source: "midi", portId: "p1", channel: 1 };
    const notes = pairRecordedNotes([on(60, 0), on(62, 100, 100, { portId: "p2" }), reset, off(62, 800, 0, { portId: "p2" })], 1000);
    expect(notes.map((note) => [note.midi, note.pressedMs, note.truncated])).toEqual([
      [60, 400, true],
      [62, 700, false]
    ]);
  });

  it("keeps sources apart: the same pitch on two devices does not cancel", () => {
    const notes = pairRecordedNotes([on(60, 0), on(60, 50, 80, { source: "touch", portId: undefined }), off(60, 100), off(60, 500, 0, { source: "touch", portId: undefined })], 1000);
    expect(notes.map((note) => [note.source, note.pressedMs])).toEqual([
      ["midi", 100],
      ["touch", 450]
    ]);
  });

  it("clamps events past the duration and sorts stably by time", () => {
    const events = [off(60, 900), on(60, 100)];
    expect(sortRecordedEvents(events).map((event) => event.type)).toEqual(["noteOn", "noteOff"]);
    const notes = pairRecordedNotes(events, 500);
    expect(notes[0].pressedMs).toBe(400);
    expect(lastEventMs(events)).toBe(900);
    expect(countNoteOns(events)).toBe(1);
  });

  it("returns nothing for an empty take", () => {
    expect(pairRecordedNotes([], 0)).toEqual([]);
  });
});
