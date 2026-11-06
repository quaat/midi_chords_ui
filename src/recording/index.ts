/** MIDI performance recorder: capture, note pairing, playback timeline, MIDI export (framework-free). */

export * from "@/recording/types";
export { PerformanceRecorder } from "@/recording/recorder";
export type { RecorderOptions, RecorderSnapshot, RecorderStartOptions, RecorderStatus } from "@/recording/recorder";
export { countNoteOns, lastEventMs, pairRecordedNotes, recordedToInputEvent, sortRecordedEvents } from "@/recording/pairing";
export {
  RECORDING_CLICK_SOURCE_ID,
  RECORDING_EVENT_ID,
  barOccurrences,
  beatsToMs,
  buildClickTimeline,
  describeBeats,
  fitLengthToBars,
  formatClock,
  isClickTimeline,
  msToBeats,
  recordingBeats,
  recordingTimeline,
  recordingTimelineId
} from "@/recording/timeline";
export type { ClickTimelineOptions, RecordingTimelineOptions, RecordingTimelineResult } from "@/recording/timeline";
export { RECORDING_EXPORT_PPQ, buildMidiFromRecording, recordingControllerEvents, recordingFileName } from "@/recording/midiExport";
export type { RecordingMidiOptions } from "@/recording/midiExport";
