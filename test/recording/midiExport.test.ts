import { describe, expect, it } from "vitest";
import { buildMidiFromTimeline, readTimelineMidiNotes } from "@/midi/timelineToMidi";
import { compileTimeline } from "@/timeline/compile";
import { buildMidiFromRecording, recordingControllerEvents, recordingFileName } from "@/recording";
import type { PerformanceRecording, RecordedEvent } from "@/recording";
import { chordEvent, makeSequence } from "../timeline/fixtures";
import { controllerEvents, noteEvents, parseSmf, tempoMicros, timeSignature, trackName } from "./smf";

function on(midi: number, atMs: number, velocity = 100, channel = 1): RecordedEvent {
  return { type: "noteOn", atMs, midi, velocity, source: "midi", portId: "p1", channel };
}

function off(midi: number, atMs: number, channel = 1): RecordedEvent {
  return { type: "noteOff", atMs, midi, velocity: 0, source: "midi", portId: "p1", channel };
}

function pedal(type: "sustain" | "sostenuto" | "soft", value: number, atMs: number): RecordedEvent {
  return { type, atMs, value, source: "midi", portId: "p1", channel: 1 };
}

function recording(events: RecordedEvent[], durationMs: number, bpm = 120): PerformanceRecording {
  return {
    schemaVersion: 1,
    kind: "recording",
    id: "take-x",
    title: "My take",
    createdAt: "2026-11-06T20:00:00.000Z",
    updatedAt: "2026-11-06T20:00:00.000Z",
    tempo: { bpm },
    timeSignature: { numerator: 3, denominator: 4 },
    countInBeats: 0,
    durationMs,
    events,
    sources: [{ source: "midi", portId: "p1" }]
  };
}

describe("buildMidiFromRecording (verified with an independent SMF reader)", () => {
  const take = recording(
    [pedal("sustain", 127, 250), on(60, 500, 90), on(64, 500, 70, 3), off(64, 750, 3), off(60, 1000), pedal("sustain", 0, 1500), on(62, 2500, 50), off(62, 2600), pedal("soft", 100, 2600)],
    4000
  );

  it("writes a valid format-0 file at 480 PPQ with tempo, time signature and track name", () => {
    const { bytes } = buildMidiFromRecording(take);
    const file = parseSmf(bytes);
    expect(file.format).toBe(0);
    expect(file.trackCount).toBe(1);
    expect(file.division).toBe(480);
    const track = file.tracks[0];
    expect(trackName(track)).toBe("My take");
    expect(timeSignature(track)).toEqual({ numerator: 3, denominator: 4 });
    expect(tempoMicros(track)).toBe(500000);
    expect(track[track.length - 1].metaType).toBe(0x2f);
  });

  it("writes note on/off at the recorded ticks with pressed lengths, velocities and channels", () => {
    const { bytes } = buildMidiFromRecording(take);
    const notes = noteEvents(parseSmf(bytes).tracks[0]);
    expect(notes).toEqual([
      { tick: 480, channel: 1, midi: 60, velocity: 90, on: true },
      { tick: 480, channel: 3, midi: 64, velocity: 70, on: true },
      { tick: 720, channel: 3, midi: 64, velocity: 0, on: false },
      { tick: 960, channel: 1, midi: 60, velocity: 0, on: false },
      { tick: 2400, channel: 1, midi: 62, velocity: 50, on: true },
      { tick: 2496, channel: 1, midi: 62, velocity: 0, on: false }
    ]);
  });

  it("writes the pedal controllers (CC64/CC67) at their ticks and before notes at the same tick", () => {
    const { bytes } = buildMidiFromRecording(take);
    const track = parseSmf(bytes).tracks[0];
    expect(controllerEvents(track)).toEqual([
      { tick: 240, channel: 1, controller: 64, value: 127 },
      { tick: 1440, channel: 1, controller: 64, value: 0 },
      { tick: 2496, channel: 1, controller: 67, value: 100 }
    ]);
    const at2496 = track.filter((event) => event.tick === 2496 && event.kind === "channel").map((event) => event.status & 0xf0);
    expect(at2496).toEqual([0xb0, 0x80]);
    expect(recordingControllerEvents(take)).toHaveLength(3);
    const noPedals = parseSmf(buildMidiFromRecording(take, { includePedals: false }).bytes).tracks[0];
    expect(controllerEvents(noPedals)).toEqual([]);
  });

  it("keeps trailing silence: the end of track lies at the recorded length", () => {
    const { bytes } = buildMidiFromRecording(take);
    const track = parseSmf(bytes).tracks[0];
    expect(track[track.length - 1].tick).toBe(8 * 480);
  });

  it("writes an empty take as a valid file with only meta events", () => {
    const { bytes } = buildMidiFromRecording(recording([], 1000));
    const track = parseSmf(bytes).tracks[0];
    expect(noteEvents(track)).toEqual([]);
    expect(track[track.length - 1].tick).toBe(960);
  });

  it("uses a sanitised file name", () => {
    expect(recordingFileName("Take 1")).toBe("Take-1.mid");
    expect(recordingFileName("  ii–V–I / jam?  ")).toBe("iiVI-jam.mid");
    expect(recordingFileName("")).toBe("recording.mid");
  });
});

describe("existing progression export", () => {
  const timeline = compileTimeline(makeSequence([chordEvent("e1", 0, "C", 0, 4), chordEvent("e2", 1, "F", 4, 4)]), { accompaniment: "rootOnly" });

  it("is unchanged by the new options when they are not used", () => {
    const plain = buildMidiFromTimeline(timeline).bytes;
    const explicit = buildMidiFromTimeline(timeline, { channelMode: "part", controllers: [], trackName: "" }).bytes;
    expect(Array.from(explicit)).toEqual(Array.from(plain));
    const track = parseSmf(plain).tracks[0];
    expect(trackName(track)).toBeNull();
    expect(controllerEvents(track)).toEqual([]);
    expect(readTimelineMidiNotes(plain).filter((note) => note.kind === "on").map((note) => note.channel)).toEqual([1, 1, 1, 2, 1, 1, 1, 2]);
  });

  it("routes by part unless channelMode is 'note'", () => {
    const withChannels = { ...timeline, notes: timeline.notes.map((note) => ({ ...note, channel: 5 })) };
    const byPart = parseSmf(buildMidiFromTimeline(withChannels).bytes).tracks[0];
    expect(new Set(noteEvents(byPart).map((note) => note.channel))).toEqual(new Set([1, 2]));
    const byNote = parseSmf(buildMidiFromTimeline(withChannels, { channelMode: "note" }).bytes).tracks[0];
    expect(new Set(noteEvents(byNote).map((note) => note.channel))).toEqual(new Set([5]));
  });
});
