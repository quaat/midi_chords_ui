/**
 * Standard MIDI File export from a compiled PerformanceTimeline (plan E10).
 *
 * The export reflects the SELECTED performed arrangement: the exact onsets/durations that
 * playback and visuals use (arpeggios included), only for the selected parts, each part on its
 * routed channel. Low-level SMF writing mirrors src/midi/buildMidiFile.ts (format 0, one track).
 */
import type { PartId, PerformanceTimeline, PerformedNote } from "@/model/contracts";

interface TimedEvent {
  tick: number;
  priority: number;
  seq: number;
  data: number[];
}

function encodeVarLen(input: number): number[] {
  let value = Math.max(0, Math.floor(input));
  let buffer = value & 0x7f;
  const out: number[] = [];
  while ((value >>= 7) > 0) {
    buffer <<= 8;
    buffer |= (value & 0x7f) | 0x80;
  }
  for (;;) {
    out.push(buffer & 0xff);
    if (buffer & 0x80) {
      buffer >>= 8;
    } else {
      break;
    }
  }
  return out;
}

function numberToBytes(value: number, length: number): number[] {
  const out: number[] = [];
  for (let i = length - 1; i >= 0; i -= 1) {
    out.push((value >> (8 * i)) & 0xff);
  }
  return out;
}

function buildTrackChunk(events: TimedEvent[]): Uint8Array {
  const sorted = [...events].sort((a, b) => {
    if (a.tick !== b.tick) {
      return a.tick - b.tick;
    }
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return a.seq - b.seq;
  });
  let lastTick = 0;
  const bytes: number[] = [];
  sorted.forEach((event) => {
    bytes.push(...encodeVarLen(event.tick - lastTick), ...event.data);
    lastTick = event.tick;
  });
  return new Uint8Array([0x4d, 0x54, 0x72, 0x6b, ...numberToBytes(bytes.length, 4), ...bytes]);
}

/** Track-name text as bytes (ASCII subset; other characters become "?"), at most 127 bytes. */
function encodeTrackName(name: string): number[] {
  const out: number[] = [];
  for (const char of name) {
    const code = char.charCodeAt(0);
    out.push(code >= 0x20 && code <= 0x7e ? code : 0x3f);
    if (out.length >= 127) {
      break;
    }
  }
  return out;
}

function buildHeaderChunk(ppq: number): Uint8Array {
  return new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x01, ...numberToBytes(ppq, 2)]);
}

export const DEFAULT_EXPORT_PARTS: PartId[] = ["learner", "accompaniment", "demonstration"];

export const DEFAULT_EXPORT_CHANNELS: Record<PartId, number> = {
  learner: 1,
  accompaniment: 2,
  demonstration: 3,
  metronome: 10
};

export interface TimelineMidiOptions {
  /** Parts to include. Default learner + accompaniment + demonstration (no metronome). */
  parts?: PartId[];
  /** Parts muted in the player; always excluded (applied after `parts`). */
  mutedParts?: PartId[];
  /** Pulses per quarter note. Default 480. */
  ticksPerBeat?: number;
  /** GM program number, 1-based (1 = Acoustic Grand Piano), for all melodic channels. Default 1. */
  program?: number;
  /** Per-part program override (1-based). */
  programByPart?: Partial<Record<PartId, number>>;
  /** 1-based channel per part. Defaults: learner 1, accompaniment 2, demonstration 3, metronome 10. */
  channelByPart?: Partial<Record<PartId, number>>;
  /** Tempo override; default the timeline tempo. */
  tempoBpm?: number;
  /**
   * "part" (default): every note of a part goes to that part's routed channel.
   * "note": a note's own `channel` (1-based) wins when present; notes without one use the part channel.
   */
  channelMode?: "part" | "note";
  /** Controller (CC) events to write, e.g. recorded sustain pedal. */
  controllers?: MidiControllerEvent[];
  /** Sequence/track name meta event (FF 03) at tick 0. */
  trackName?: string;
}

export interface MidiControllerEvent {
  /** Musical time in quarter-note beats. */
  beat: number;
  /** 1-based channel. */
  channel: number;
  /** Controller number 0..127 (64 = sustain). */
  controller: number;
  /** 0..127 */
  value: number;
}

export interface TimelineMidiResult {
  bytes: Uint8Array;
  /** Present when the runtime provides `Blob`. */
  blob?: Blob;
}

const DRUM_CHANNEL_INDEX = 9;

function clampChannelIndex(channel: number): number {
  return Math.min(15, Math.max(0, Math.round(channel) - 1));
}

export function buildMidiFromTimeline(timeline: PerformanceTimeline, options: TimelineMidiOptions = {}): TimelineMidiResult {
  const ppq = Math.max(24, Math.round(options.ticksPerBeat ?? 480));
  const muted = new Set<PartId>(options.mutedParts ?? []);
  const parts = (options.parts ?? DEFAULT_EXPORT_PARTS).filter((part) => !muted.has(part));
  const channels: Record<PartId, number> = { ...DEFAULT_EXPORT_CHANNELS, ...(options.channelByPart ?? {}) };
  const bpm = options.tempoBpm !== undefined && options.tempoBpm > 0 ? options.tempoBpm : timeline.tempo.bpm;
  const denominatorPow = Math.max(0, Math.round(Math.log2(Math.max(1, timeline.timeSignature.denominator))));
  const tempoMicros = Math.round(60_000_000 / Math.max(1, bpm));

  const events: TimedEvent[] = [];
  let seq = 0;
  const push = (tick: number, priority: number, data: number[]): void => {
    events.push({ tick, priority, seq: seq++, data });
  };

  if (options.trackName !== undefined && options.trackName !== "") {
    const text = encodeTrackName(options.trackName);
    push(0, -1, [0xff, 0x03, ...encodeVarLen(text.length), ...text]);
  }
  push(0, 0, [0xff, 0x58, 0x04, timeline.timeSignature.numerator & 0xff, denominatorPow, 24, 8]);
  push(0, 1, [0xff, 0x51, 0x03, ...numberToBytes(tempoMicros, 3)]);

  const notes = timeline.notes.filter((note) => parts.includes(note.part) && note.durationBeats > 0 && note.midi >= 0 && note.midi <= 127);
  const channelOf = (note: PerformedNote): number => {
    if (options.channelMode === "note" && typeof note.channel === "number" && Number.isFinite(note.channel)) {
      return clampChannelIndex(note.channel);
    }
    return clampChannelIndex(channels[note.part]);
  };

  // Program changes for each melodic channel in use.
  const programmed = new Set<number>();
  notes.forEach((note) => {
    const ch = channelOf(note);
    if (ch === DRUM_CHANNEL_INDEX || programmed.has(ch)) {
      return;
    }
    programmed.add(ch);
    const program = Math.min(127, Math.max(0, Math.round(options.programByPart?.[note.part] ?? options.program ?? 1) - 1));
    push(0, 2, [0xc0 | ch, program]);
  });

  // Controller events (priority 4: after set-up, before note-offs/ons at the same tick).
  let controllerTick = 0;
  (options.controllers ?? []).forEach((event) => {
    if (!Number.isFinite(event.beat) || event.beat < 0) {
      return;
    }
    const tick = Math.round(event.beat * ppq);
    const ch = clampChannelIndex(event.channel);
    const controller = Math.min(127, Math.max(0, Math.round(event.controller)));
    const value = Math.min(127, Math.max(0, Math.round(event.value)));
    push(tick, 4, [0xb0 | ch, controller, value]);
    controllerTick = Math.max(controllerTick, tick);
  });

  // Group per (channel, pitch) so overlapping attacks of the same pitch retrigger cleanly:
  // a note is cut where the next attack of the same pitch begins.
  const groups = new Map<string, { ch: number; midi: number; notes: PerformedNote[] }>();
  notes.forEach((note) => {
    const ch = channelOf(note);
    const key = `${ch}:${note.midi}`;
    const group = groups.get(key);
    if (group) {
      group.notes.push(note);
    } else {
      groups.set(key, { ch, midi: note.midi, notes: [note] });
    }
  });

  let lastTick = Math.max(controllerTick, Math.round(Math.max(0, timeline.totalBeats) * ppq));
  groups.forEach((group) => {
    const sorted = [...group.notes].sort((a, b) => a.onsetBeat - b.onsetBeat);
    for (let i = 0; i < sorted.length; i += 1) {
      const note = sorted[i];
      const start = Math.max(0, Math.round(note.onsetBeat * ppq));
      let end = Math.round((note.onsetBeat + note.durationBeats) * ppq);
      const next = sorted[i + 1];
      if (next) {
        const nextStart = Math.max(0, Math.round(next.onsetBeat * ppq));
        if (nextStart <= start) {
          // Simultaneous duplicate attack: keep the longer one.
          if (next.durationBeats < note.durationBeats) {
            sorted[i + 1] = note;
          }
          continue;
        }
        end = Math.min(end, nextStart);
      }
      end = Math.max(start + 1, end);
      const velocity = Math.min(127, Math.max(1, Math.round(note.velocity)));
      // Note-offs sort before note-ons at the same tick (priority 5 < 10).
      push(start, 10, [0x90 | group.ch, group.midi, velocity]);
      push(end, 5, [0x80 | group.ch, group.midi, 0]);
      lastTick = Math.max(lastTick, end);
    }
  });

  push(lastTick, 100, [0xff, 0x2f, 0x00]);

  const header = buildHeaderChunk(ppq);
  const track = buildTrackChunk(events);
  const bytes = new Uint8Array(header.length + track.length);
  bytes.set(header, 0);
  bytes.set(track, header.length);

  const result: TimelineMidiResult = { bytes };
  if (typeof Blob !== "undefined") {
    result.blob = new Blob([bytes], { type: "audio/midi" });
  }
  return result;
}

export interface ParsedMidiNote {
  tick: number;
  channel: number;
  midi: number;
  velocity: number;
  kind: "on" | "off";
}

/**
 * Minimal reader for the single-track files written above (used by tests and diagnostics).
 * Supports running-status-free channel messages and meta events only.
 */
export function readTimelineMidiNotes(bytes: Uint8Array): ParsedMidiNote[] {
  const out: ParsedMidiNote[] = [];
  let pos = 14; // header
  if (bytes.length < 22) {
    return out;
  }
  pos += 8; // "MTrk" + length
  let tick = 0;
  const readVar = (): number => {
    let value = 0;
    for (;;) {
      const byte = bytes[pos];
      pos += 1;
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0 || pos >= bytes.length) {
        return value;
      }
    }
  };
  while (pos < bytes.length) {
    tick += readVar();
    const status = bytes[pos];
    pos += 1;
    if (status === 0xff) {
      pos += 1; // meta type
      const length = readVar();
      pos += length;
      continue;
    }
    const type = status & 0xf0;
    const channel = (status & 0x0f) + 1;
    if (type === 0x90 || type === 0x80) {
      const midi = bytes[pos];
      const velocity = bytes[pos + 1];
      pos += 2;
      out.push({ tick, channel, midi, velocity, kind: type === 0x90 && velocity > 0 ? "on" : "off" });
    } else if (type === 0xc0 || type === 0xd0) {
      pos += 1;
    } else {
      pos += 2;
    }
  }
  return out;
}
