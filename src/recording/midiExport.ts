/**
 * Standard MIDI File export of a performance recording.
 *
 * Reuses the timeline MIDI writer: the take is converted to a timeline with PRESSED note lengths
 * (key down → key up) and the recorded pedal controllers (CC64 sustain, CC66 sostenuto, CC67 soft)
 * are written as controller events, so the file carries the performance as played rather than
 * the pedal-flattened sounding lengths used for in-app playback. Recorded MIDI channels are kept.
 */
import { CC_SOFT, CC_SOSTENUTO, CC_SUSTAIN } from "@/input/normalize";
import type { MidiControllerEvent, TimelineMidiResult } from "@/midi/timelineToMidi";
import { buildMidiFromTimeline } from "@/midi/timelineToMidi";
import { msToBeats, recordingTimeline } from "@/recording/timeline";
import type { PerformanceRecording, RecordedEvent } from "@/recording/types";

export const RECORDING_EXPORT_PPQ = 480;

export interface RecordingMidiOptions {
  /** Default 480. */
  ticksPerBeat?: number;
  /** GM program (1-based). Default 1 = Acoustic Grand Piano. */
  program?: number;
  /** Write pedal CC events (default true). */
  includePedals?: boolean;
  /** Track name meta event; default the recording title. */
  trackName?: string;
}

function controllerNumber(type: RecordedEvent["type"]): number | null {
  switch (type) {
    case "sustain":
      return CC_SUSTAIN;
    case "sostenuto":
      return CC_SOSTENUTO;
    case "soft":
      return CC_SOFT;
    default:
      return null;
  }
}

/** Pedal events of a recording as timeline controller events (beats). */
export function recordingControllerEvents(recording: PerformanceRecording): MidiControllerEvent[] {
  const out: MidiControllerEvent[] = [];
  recording.events.forEach((event) => {
    const controller = controllerNumber(event.type);
    if (controller === null || event.atMs > recording.durationMs) {
      return;
    }
    out.push({
      beat: msToBeats(event.atMs, recording.tempo.bpm),
      channel: event.channel ?? 1,
      controller,
      value: Math.min(127, Math.max(0, Math.round(event.value ?? 0)))
    });
  });
  return out;
}

export function buildMidiFromRecording(recording: PerformanceRecording, options: RecordingMidiOptions = {}): TimelineMidiResult {
  const { timeline } = recordingTimeline(recording, { part: "learner", durations: "pressed", fitToBars: false, id: `export-${recording.id}` });
  const controllers = options.includePedals === false ? [] : recordingControllerEvents(recording);
  return buildMidiFromTimeline(timeline, {
    ticksPerBeat: options.ticksPerBeat ?? RECORDING_EXPORT_PPQ,
    program: options.program ?? 1,
    parts: ["learner"],
    channelMode: "note",
    controllers,
    trackName: options.trackName ?? recording.title
  });
}

/** "My take.mid" style file name: letters, digits, space, dash and underscore only. */
export function recordingFileName(title: string): string {
  const base = title.replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-") || "recording";
  return `${base.slice(0, 80)}.mid`;
}
