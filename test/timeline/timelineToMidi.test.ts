import { describe, expect, it } from "vitest";
import { buildMidiFromTimeline, readTimelineMidiNotes } from "@/midi/timelineToMidi";
import { compileTimeline } from "@/timeline/compile";
import type { PerformanceTimeline } from "@/model/contracts";
import { chordEvent, makeSequence } from "./fixtures";

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...Array.from(bytes.slice(start, start + length)));
}

describe("buildMidiFromTimeline", () => {
  const timeline = compileTimeline(makeSequence([chordEvent("e1", 0, "C", 0, 4), chordEvent("e2", 1, "F", 4, 4)]), {
    accompaniment: "rootOnly",
    metronome: true
  });

  it("writes a valid SMF header and track", () => {
    const { bytes } = buildMidiFromTimeline(timeline, { ticksPerBeat: 480 });
    expect(ascii(bytes, 0, 4)).toBe("MThd");
    expect(ascii(bytes, 14, 4)).toBe("MTrk");
    expect((bytes[12] << 8) | bytes[13]).toBe(480);
    const trackLength = (bytes[18] << 24) | (bytes[19] << 16) | (bytes[20] << 8) | bytes[21];
    expect(trackLength).toBe(bytes.length - 22);
    expect(Array.from(bytes.slice(bytes.length - 3))).toEqual([0xff, 0x2f, 0x00]);
  });

  it("routes parts to channels and excludes metronome by default", () => {
    const notes = readTimelineMidiNotes(buildMidiFromTimeline(timeline).bytes).filter((note) => note.kind === "on");
    const channels = [...new Set(notes.map((note) => note.channel))].sort((a, b) => a - b);
    expect(channels).toEqual([1, 2]);
    expect(notes.filter((note) => note.channel === 2).map((note) => note.midi)).toEqual([36, 41]);
  });

  it("excludes muted parts", () => {
    const notes = readTimelineMidiNotes(buildMidiFromTimeline(timeline, { mutedParts: ["learner"] }).bytes);
    expect(notes.every((note) => note.channel === 2)).toBe(true);
    const onlyMetronome = readTimelineMidiNotes(buildMidiFromTimeline(timeline, { parts: ["metronome"] }).bytes);
    expect(onlyMetronome.filter((note) => note.kind === "on")).toHaveLength(8);
    expect(onlyMetronome.every((note) => note.channel === 10)).toBe(true);
  });

  it("exports the actual arpeggio onsets", () => {
    const arp = compileTimeline(makeSequence([chordEvent("e1", 0, "C", 0, 3)]), { arpeggiate: 1 });
    const ons = readTimelineMidiNotes(buildMidiFromTimeline(arp, { ticksPerBeat: 480 }).bytes).filter((note) => note.kind === "on");
    expect(ons.map((note) => [note.tick, note.midi])).toEqual([
      [0, 60],
      [480, 64],
      [960, 67]
    ]);
  });

  it("cuts overlapping same-pitch notes so the retrigger is clean (off before on)", () => {
    const overlapping: PerformanceTimeline = {
      ...timeline,
      notes: [
        { id: "a", eventId: "a", occurrenceId: "a#0", part: "learner", midi: 60, onsetBeat: 0, durationBeats: 2, velocity: 90 },
        { id: "b", eventId: "b", occurrenceId: "b#0", part: "learner", midi: 60, onsetBeat: 1, durationBeats: 2, velocity: 90 }
      ],
      totalBeats: 3
    };
    const events = readTimelineMidiNotes(buildMidiFromTimeline(overlapping, { ticksPerBeat: 100 }).bytes);
    expect(events.map((event) => [event.kind, event.tick])).toEqual([
      ["on", 0],
      ["off", 100],
      ["on", 100],
      ["off", 300]
    ]);
  });
});
