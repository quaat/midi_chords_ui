/**
 * Performance recording contracts (MIDI performance recorder).
 *
 * A recording is the ordered list of normalised learner input events (note on/off, pedals,
 * resets) captured on the performance clock, stored RELATIVE to an explicit recording start
 * (`atMs`, milliseconds since beat 0 of the take). Notes are DERIVED from the events
 * (`pairRecordedNotes`), never stored as the source of truth, so later features (overdub,
 * editing, re-pairing with different pedal rules) can re-interpret the same capture.
 *
 * Tempo and time signature are fixed metadata for the whole take (v1); they only matter for
 * converting milliseconds to beats (playback timeline, MIDI ticks, bar fitting).
 */
import type { InputEventType, InputSource, TempoSpec, TimeSignatureSpec } from "@/model/contracts";

export const RECORDING_SCHEMA_VERSION = 1;
export const RECORDING_KIND = "recording";

/** Event types kept in a recording (`connection` events become `allNotesOff` for the port). */
export type RecordedEventType = Exclude<InputEventType, "connection">;

export const RECORDED_EVENT_TYPES: readonly RecordedEventType[] = ["noteOn", "noteOff", "sustain", "sostenuto", "soft", "allNotesOff"];

export interface RecordedEvent {
  type: RecordedEventType;
  /** Milliseconds since the recording start (beat 0). Never negative. */
  atMs: number;
  source: InputSource;
  /** MIDI port the event came from (MIDI input only). */
  portId?: string;
  /** 1-based MIDI channel (1..16). */
  channel?: number;
  midi?: number;
  /** noteOn: 1..127; noteOff: release velocity 0..127. */
  velocity?: number;
  /** Pedal/controller value 0..127. */
  value?: number;
}

export interface RecordedSource {
  source: InputSource;
  portId?: string;
  portName?: string;
}

export interface PerformanceRecording {
  schemaVersion: number;
  kind: typeof RECORDING_KIND;
  id: string;
  title: string;
  /** ISO timestamps. */
  createdAt: string;
  updatedAt: string;
  tempo: TempoSpec;
  timeSignature: TimeSignatureSpec;
  /** Count-in used when the take was recorded (0 = none); informational. */
  countInBeats: number;
  /** Total captured length (Record → Stop), including trailing silence. */
  durationMs: number;
  events: RecordedEvent[];
  sources: RecordedSource[];
}

/** A note derived from a recording's events. All times are ms since the recording start. */
export interface RecordedNote {
  id: string;
  midi: number;
  /** 1..127 */
  velocity: number;
  /** Release velocity when the device sent one (0 when unknown). */
  releaseVelocity: number;
  onsetMs: number;
  /** Key-press length (onset → key release). */
  pressedMs: number;
  /** Sounding length including sustain/sostenuto pedal hold; always >= pressedMs. */
  soundingMs: number;
  channel: number;
  source: InputSource;
  portId?: string;
  /** True when the note was closed by the stop boundary, a device reset/disconnect or a retrigger rather than its own release. */
  truncated: boolean;
}

/** Upper bound on events kept in one take (and accepted when loading one). */
export const MAX_RECORDING_EVENTS = 20000;
/** Upper bound on the length of one take. */
export const MAX_RECORDING_MS = 10 * 60 * 1000;
/** Upper bound on the serialised size of one saved recording (UTF-16 code units, ~ bytes/2). */
export const MAX_RECORDING_JSON_CHARS = 1_500_000;
