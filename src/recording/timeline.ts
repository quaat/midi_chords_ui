/**
 * Recording → PerformanceTimeline (playback on the shared transport) and the click-track
 * timeline used while recording. Pure.
 *
 * Playback uses the SOUNDING length of every note (key press extended by the sustain/sostenuto
 * pedal) so the take sounds as performed on an instrument without pedal support in the output;
 * MIDI export uses the pressed length plus the pedal controller events instead (see midiExport.ts).
 */
import type { PartId, PerformanceOccurrence, PerformanceTimeline, PerformedNote, TimeSignatureSpec } from "@/model/contracts";
import { METRONOME_EVENT_ID, buildMetronomeNotes } from "@/playback/metronome";
import { beatsPerBar } from "@/timeline/clock";
import { compareNotes } from "@/timeline/compile";
import { pairRecordedNotes } from "@/recording/pairing";
import type { PerformanceRecording, RecordedNote } from "@/recording/types";

export const RECORDING_EVENT_ID = "recording";
export const RECORDING_CLICK_SOURCE_ID = "recording-click";

const EPSILON = 1e-6;
/** A note shorter than this (ms) is still given a tiny positive length so playback and export keep it. */
const MIN_NOTE_MS = 1;

export function msToBeats(ms: number, bpm: number): number {
  const safe = Number.isFinite(bpm) && bpm > 0 ? bpm : 120;
  return (ms * safe) / 60000;
}

export function beatsToMs(beats: number, bpm: number): number {
  const safe = Number.isFinite(bpm) && bpm > 0 ? bpm : 120;
  return (beats * 60000) / safe;
}

/** Recorded length in quarter-note beats at the take's tempo. */
export function recordingBeats(recording: PerformanceRecording): number {
  return msToBeats(recording.durationMs, recording.tempo.bpm);
}

/**
 * Loop length in beats "fitted" to whole bars: the NEAREST whole number of bars to the recorded
 * length (at least one bar), but never fewer bars than needed to contain every note onset — a
 * take stopped slightly after the last bar line loops as the intended number of bars, while
 * intentional trailing silence of half a bar or more is kept.
 */
export function fitLengthToBars(durationBeats: number, lastOnsetBeat: number, barBeats: number): number {
  const bar = Number.isFinite(barBeats) && barBeats > 0 ? barBeats : 4;
  const nearest = Math.max(1, Math.round(durationBeats / bar));
  const needed = Math.max(1, Math.ceil((lastOnsetBeat + EPSILON) / bar));
  return Math.max(nearest, needed) * bar;
}

export interface RecordingTimelineOptions {
  /** Part the notes are tagged with. Default "accompaniment" (piano accompaniment layer; channel 2 over MIDI). */
  part?: PartId;
  /** "sounding" (pedal-extended, default) or "pressed" (key release only). */
  durations?: "sounding" | "pressed";
  /** Round the total length to whole bars (see `fitLengthToBars`). Default false. */
  fitToBars?: boolean;
  id?: string;
  /** Pre-paired notes (avoids pairing twice). */
  notes?: readonly RecordedNote[];
}

export interface RecordingTimelineResult {
  timeline: PerformanceTimeline;
  notes: RecordedNote[];
  /** Recorded length before any bar fitting. */
  recordedBeats: number;
  barBeats: number;
}

export function recordingTimelineId(recording: PerformanceRecording, fitToBars: boolean): string {
  return `rec-${recording.id}${fitToBars ? "~bars" : ""}`;
}

export function recordingTimeline(recording: PerformanceRecording, options: RecordingTimelineOptions = {}): RecordingTimelineResult {
  const bpm = recording.tempo.bpm;
  const part: PartId = options.part ?? "accompaniment";
  const notes = options.notes ? [...options.notes] : pairRecordedNotes(recording.events, recording.durationMs);
  const barBeats = beatsPerBar(recording.timeSignature.numerator, recording.timeSignature.denominator);
  const id = options.id ?? recordingTimelineId(recording, options.fitToBars === true);
  const recordedBeats = msToBeats(recording.durationMs, bpm);

  let lastOnset = 0;
  const performed: PerformedNote[] = notes.map((note, index) => {
    const ms = options.durations === "pressed" ? note.pressedMs : note.soundingMs;
    const onsetBeat = msToBeats(note.onsetMs, bpm);
    lastOnset = Math.max(lastOnset, onsetBeat);
    const barIndex = Math.floor((onsetBeat + EPSILON) / barBeats);
    const performedNote: PerformedNote = {
      id: `${id}:n${index}`,
      eventId: RECORDING_EVENT_ID,
      occurrenceId: `${RECORDING_EVENT_ID}#${barIndex}`,
      part,
      midi: note.midi,
      onsetBeat,
      durationBeats: msToBeats(Math.max(MIN_NOTE_MS, ms), bpm),
      velocity: note.velocity,
      channel: note.channel
    };
    return performedNote;
  });
  performed.sort(compareNotes);

  const totalBeats = options.fitToBars ? fitLengthToBars(recordedBeats, lastOnset, barBeats) : recordedBeats;
  const occurrences = barOccurrences(totalBeats, barBeats);

  return {
    timeline: {
      id,
      sourceId: recording.id,
      sourceVersion: 0,
      tempo: { bpm },
      timeSignature: { ...recording.timeSignature },
      notes: performed,
      occurrences,
      totalBeats
    },
    notes,
    recordedBeats,
    barBeats
  };
}

/** One occurrence per (possibly partial) bar: symbols "Bar 1", "Bar 2", ... */
export function barOccurrences(totalBeats: number, barBeats: number): PerformanceOccurrence[] {
  const out: PerformanceOccurrence[] = [];
  const bars = Math.max(0, Math.ceil((totalBeats - EPSILON) / barBeats));
  for (let bar = 0; bar < bars; bar += 1) {
    const startBeat = bar * barBeats;
    const occurrenceId = `${RECORDING_EVENT_ID}#${bar}`;
    out.push({
      occurrenceId,
      eventId: RECORDING_EVENT_ID,
      passIndex: 0,
      startBeat,
      durationBeats: Math.min(barBeats, totalBeats - startBeat),
      symbol: `Bar ${bar + 1}`
    });
  }
  return out;
}

export interface ClickTimelineOptions {
  bpm: number;
  timeSignature: TimeSignatureSpec;
  /** Length of the click track (the maximum take length). */
  totalBeats: number;
  /** Include metronome clicks (otherwise the timeline is silent and only the transport count-in sounds). */
  metronome: boolean;
  id?: string;
}

/** Silent (or clicking) timeline played by the transport while a take is captured. */
export function buildClickTimeline(options: ClickTimelineOptions): PerformanceTimeline {
  const total = Math.max(1, options.totalBeats);
  const bar = beatsPerBar(options.timeSignature.numerator, options.timeSignature.denominator);
  const notes = options.metronome ? buildMetronomeNotes({ startBeat: 0, endBeat: total, beatsPerBar: bar, bpm: options.bpm }) : [];
  return {
    id: options.id ?? RECORDING_CLICK_SOURCE_ID,
    sourceId: RECORDING_CLICK_SOURCE_ID,
    sourceVersion: 0,
    tempo: { bpm: options.bpm },
    timeSignature: { ...options.timeSignature },
    notes,
    occurrences: [{ occurrenceId: `${METRONOME_EVENT_ID}#0`, eventId: METRONOME_EVENT_ID, passIndex: 0, startBeat: 0, durationBeats: total, symbol: "Recording" }],
    totalBeats: total
  };
}

export function isClickTimeline(timeline: PerformanceTimeline | null): boolean {
  return timeline !== null && timeline.sourceId === RECORDING_CLICK_SOURCE_ID;
}

/** "4 bars", "2 bars + 1.5 beats", "3 beats" style length label. */
export function describeBeats(beats: number, barBeats: number): string {
  const bar = Number.isFinite(barBeats) && barBeats > 0 ? barBeats : 4;
  const bars = Math.floor((beats + EPSILON) / bar);
  const rest = beats - bars * bar;
  const restText = rest > 0.05 ? `${rest.toFixed(1)} beat${rest.toFixed(1) === "1.0" ? "" : "s"}` : "";
  if (bars === 0) {
    return restText || "0 beats";
  }
  const barText = `${bars} bar${bars === 1 ? "" : "s"}`;
  return restText ? `${barText} + ${restText}` : barText;
}

/** "m:ss.t" clock label. */
export function formatClock(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  return `${minutes}:${seconds < 10 ? "0" : ""}${seconds.toFixed(1)}`;
}
