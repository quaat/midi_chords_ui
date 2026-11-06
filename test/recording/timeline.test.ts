import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SilentTimelineEngine } from "@/playback/timelineEngines";
import { Transport } from "@/playback/transport";
import {
  buildClickTimeline,
  describeBeats,
  fitLengthToBars,
  formatClock,
  isClickTimeline,
  pairRecordedNotes,
  recordingTimeline
} from "@/recording";
import type { PerformanceRecording, RecordedEvent } from "@/recording";
import { fakeClock } from "../timeline/fixtures";

function on(midi: number, atMs: number, velocity = 100, channel = 1): RecordedEvent {
  return { type: "noteOn", atMs, midi, velocity, source: "midi", portId: "p1", channel };
}

function off(midi: number, atMs: number, channel = 1): RecordedEvent {
  return { type: "noteOff", atMs, midi, velocity: 0, source: "midi", portId: "p1", channel };
}

function sustain(value: number, atMs: number): RecordedEvent {
  return { type: "sustain", atMs, value, source: "midi", portId: "p1", channel: 1 };
}

export function makeRecording(events: RecordedEvent[], durationMs: number, bpm = 120): PerformanceRecording {
  return {
    schemaVersion: 1,
    kind: "recording",
    id: "take-a",
    title: "Take A",
    createdAt: "2026-11-06T20:00:00.000Z",
    updatedAt: "2026-11-06T20:00:00.000Z",
    tempo: { bpm },
    timeSignature: { numerator: 4, denominator: 4 },
    countInBeats: 0,
    durationMs,
    events,
    sources: [{ source: "midi", portId: "p1", portName: "Fake" }]
  };
}

describe("recordingTimeline", () => {
  const recording = makeRecording([on(60, 500, 90), on(64, 500, 70, 3), off(64, 750, 3), sustain(127, 600), off(60, 1000), sustain(0, 1500), on(62, 2500), off(62, 2600)], 4000);

  it("converts ms to beats at the take's tempo with sounding lengths by default", () => {
    const { timeline, notes, recordedBeats } = recordingTimeline(recording);
    expect(notes).toHaveLength(3);
    expect(recordedBeats).toBe(8);
    expect(timeline.totalBeats).toBe(8);
    expect(timeline.tempo.bpm).toBe(120);
    expect(timeline.sourceId).toBe("take-a");
    expect(timeline.notes.map((note) => [note.midi, note.onsetBeat, Number(note.durationBeats.toFixed(3)), note.velocity, note.part, note.channel])).toEqual([
      [60, 1, 2, 90, "accompaniment", 1],
      [64, 1, 0.5, 70, "accompaniment", 3],
      [62, 5, 0.2, 100, "accompaniment", 1]
    ]);
  });

  it("can use pressed lengths and another part", () => {
    const { timeline } = recordingTimeline(recording, { durations: "pressed", part: "learner" });
    expect(timeline.notes.map((note) => [note.midi, note.durationBeats, note.part])).toEqual([
      [60, 1, "learner"],
      [64, 0.5, "learner"],
      [62, 0.2, "learner"]
    ]);
  });

  it("creates one occurrence per bar with 'Bar n' labels, the last one partial", () => {
    const { timeline } = recordingTimeline(makeRecording([on(60, 0), off(60, 100)], 9000));
    expect(timeline.totalBeats).toBe(18);
    expect(timeline.occurrences.map((occ) => [occ.symbol, occ.startBeat, occ.durationBeats])).toEqual([
      ["Bar 1", 0, 4],
      ["Bar 2", 4, 4],
      ["Bar 3", 8, 4],
      ["Bar 4", 12, 4],
      ["Bar 5", 16, 2]
    ]);
    expect(timeline.notes[0].occurrenceId).toBe("recording#0");
  });

  it("fits the length to whole bars without moving notes", () => {
    const late = makeRecording([on(60, 0), off(60, 200), on(62, 7900), off(62, 8100)], 8600); // 17.2 beats: 4 bars + a bit
    const exact = recordingTimeline(late);
    const fitted = recordingTimeline(late, { fitToBars: true });
    expect(exact.timeline.totalBeats).toBeCloseTo(17.2, 6);
    expect(fitted.timeline.totalBeats).toBe(16);
    expect(fitted.timeline.id).toBe("rec-take-a~bars");
    expect(fitted.timeline.notes.map((note) => note.onsetBeat)).toEqual(exact.timeline.notes.map((note) => note.onsetBeat));
    expect(fitted.timeline.occurrences).toHaveLength(4);
  });

  it("gives a very short note a tiny positive length so it is not dropped", () => {
    const { timeline } = recordingTimeline(makeRecording([on(60, 100), off(60, 100)], 1000));
    expect(timeline.notes[0].durationBeats).toBeGreaterThan(0);
  });

  it("accepts pre-paired notes", () => {
    const notes = pairRecordedNotes(recording.events, recording.durationMs);
    const result = recordingTimeline(recording, { notes });
    expect(result.notes).toEqual(notes);
    expect(result.notes).not.toBe(notes);
  });
});

describe("fitLengthToBars", () => {
  it("rounds to the nearest bar but never drops a note onset, minimum one bar", () => {
    expect(fitLengthToBars(16.6, 12, 4)).toBe(16);
    expect(fitLengthToBars(17.9, 12, 4)).toBe(16);
    expect(fitLengthToBars(18.1, 12, 4)).toBe(20);
    expect(fitLengthToBars(20.2, 16.5, 4)).toBe(20);
    expect(fitLengthToBars(16.6, 16.2, 4)).toBe(20);
    expect(fitLengthToBars(1.5, 0.5, 4)).toBe(4);
    expect(fitLengthToBars(0, 0, 3)).toBe(3);
  });
});

describe("click timeline and labels", () => {
  it("builds a metronome-only click track of the requested length", () => {
    const click = buildClickTimeline({ bpm: 100, timeSignature: { numerator: 3, denominator: 4 }, totalBeats: 12, metronome: true });
    expect(isClickTimeline(click)).toBe(true);
    expect(click.notes).toHaveLength(12);
    expect(click.notes.every((note) => note.part === "metronome")).toBe(true);
    expect(click.notes.filter((note) => note.velocity === 120)).toHaveLength(4);
    const silent = buildClickTimeline({ bpm: 100, timeSignature: { numerator: 4, denominator: 4 }, totalBeats: 8, metronome: false });
    expect(silent.notes).toEqual([]);
    expect(silent.totalBeats).toBe(8);
  });

  it("formats lengths and clocks", () => {
    expect(describeBeats(16, 4)).toBe("4 bars");
    expect(describeBeats(17.5, 4)).toBe("4 bars + 1.5 beats");
    expect(describeBeats(3, 4)).toBe("3.0 beats");
    expect(describeBeats(4, 4)).toBe("1 bar");
    expect(formatClock(0)).toBe("0:00.0");
    expect(formatClock(65432)).toBe("1:05.4");
  });
});

describe("recording playback on the transport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("plays the recorded onsets, lengths and velocities and leaves no note sounding at the end", async () => {
    const engine = new SilentTimelineEngine();
    const transport = new Transport(engine, { clock: fakeClock(), countInBeats: 0 });
    const recording = makeRecording([on(60, 500, 90), on(64, 500, 70), off(64, 750), off(60, 1000), on(62, 2500, 50), off(62, 2600)], 4000);
    transport.load(recordingTimeline(recording).timeline);
    const t0 = performance.now();
    await transport.play();
    vi.advanceTimersByTime(4200);
    const ons = engine.noteOns().map((call) => [call.midi, call.velocity, (call.atMs ?? 0) - t0]);
    expect(ons).toEqual([
      [60, 90, 500],
      [64, 70, 500],
      [62, 50, 2500]
    ]);
    const offs = engine.noteOffs().map((call) => [call.midi, (call.atMs ?? 0) - t0]);
    expect(offs).toEqual([
      [64, 750],
      [60, 1000],
      [62, 2600]
    ]);
    expect(transport.getSnapshot().state).toBe("stopped");
    expect(transport.getSoundingNotes()).toEqual([]);
    transport.dispose();
  });

  it("loops the whole take (trailing silence included) and releases notes at the loop boundary", async () => {
    const engine = new SilentTimelineEngine();
    const transport = new Transport(engine, { clock: fakeClock(), countInBeats: 0 });
    // 2-beat take at 120 BPM: a note that is still held at the loop end.
    const recording = makeRecording([on(60, 0), off(60, 900)], 1000);
    const { timeline } = recordingTimeline(recording);
    transport.load(timeline);
    transport.setLoop({ startBeat: 0, endBeat: timeline.totalBeats });
    const t0 = performance.now();
    await transport.play();
    vi.advanceTimersByTime(3100);
    const ons = engine.noteOns().map((call) => (call.atMs ?? 0) - t0);
    expect(ons).toEqual([0, 1000, 2000, 3000]);
    const offs = engine.noteOffs().map((call) => (call.atMs ?? 0) - t0);
    expect(offs.slice(0, 3)).toEqual([900, 1900, 2900]);
    expect(transport.getSnapshot().state).toBe("playing");
    transport.stop();
    expect(engine.calls[engine.calls.length - 1].type).toBe("allNotesOff");
    expect(transport.getSoundingNotes()).toEqual([]);
    transport.dispose();
  });

  it("pause/resume keeps the position and restart from 0 re-attacks the first chord", async () => {
    const engine = new SilentTimelineEngine();
    const transport = new Transport(engine, { clock: fakeClock(), countInBeats: 0 });
    const recording = makeRecording([on(60, 0), off(60, 1500), on(62, 1000), off(62, 1500)], 2000);
    transport.load(recordingTimeline(recording).timeline);
    await transport.play();
    vi.advanceTimersByTime(600);
    transport.pause();
    expect(transport.getSnapshot().state).toBe("paused");
    expect(transport.getSnapshot().positionBeats).toBeCloseTo(1.2, 3);
    expect(transport.getSoundingNotes()).toEqual([]);
    engine.clear();
    await transport.play();
    vi.advanceTimersByTime(50);
    expect(engine.noteOns().map((call) => call.midi)).toEqual([60]); // chased: still sounding at 1.2 beats
    vi.advanceTimersByTime(600);
    expect(engine.noteOns().map((call) => call.midi)).toEqual([60, 62]);
    engine.clear();
    await transport.play(0);
    vi.advanceTimersByTime(50);
    expect(engine.noteOns().map((call) => call.midi)).toEqual([60]);
    transport.dispose();
  });
});
