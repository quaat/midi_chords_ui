/**
 * MIDI byte → InputEvent normalisation (plan E09).
 *
 * Only complete, status-prefixed channel messages are understood. Running status is NOT
 * supported (Web MIDI always delivers complete messages with a status byte). Everything
 * that is not a note or one of the handled controllers returns `null` and is ignored.
 */

import type { InputEvent, InputSource } from "@/model/contracts";

export interface MidiPortMeta {
  portId: string;
  portName: string;
}

export const CC_SUSTAIN = 64;
export const CC_SOSTENUTO = 66;
export const CC_SOFT = 67;
export const CC_ALL_SOUND_OFF = 120;
export const CC_ALL_NOTES_OFF = 123;

/** Controller values at or above this are "pedal down" (MIDI 1.0 switch convention). */
export const PEDAL_DOWN_THRESHOLD = 64;

export function isPedalDown(value: number): boolean {
  return value >= PEDAL_DOWN_THRESHOLD;
}

export type MidiBytes = Uint8Array | ReadonlyArray<number>;

function isDataByte(value: number | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0x7f;
}

/**
 * Parse one complete MIDI message.
 *
 * - 0x9n with velocity 0 → "noteOff" (velocity 0)
 * - 0x8n → "noteOff" (velocity = release velocity)
 * - CC64 / CC66 / CC67 → "sustain" / "sostenuto" / "soft" with `value` (0..127)
 * - CC123 (all notes off) and CC120 (all sound off) → "allNotesOff"
 * - anything else → null
 *
 * Channels are reported 1-based (1..16).
 */
export function parseMidiMessage(
  data: MidiBytes,
  timestampMs: number,
  meta: MidiPortMeta,
  source: InputSource = "midi"
): InputEvent | null {
  if (data.length < 3) {
    return null;
  }
  const status = data[0];
  const d1 = data[1];
  const d2 = data[2];
  if (typeof status !== "number" || status < 0x80 || status > 0xef) {
    return null;
  }
  if (!isDataByte(d1) || !isDataByte(d2)) {
    return null;
  }

  const kind = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  const base: InputEvent = {
    source,
    type: "noteOn",
    timestampMs,
    portId: meta.portId,
    portName: meta.portName,
    channel
  };

  if (kind === 0x90) {
    if (d2 === 0) {
      return { ...base, type: "noteOff", midi: d1, velocity: 0 };
    }
    return { ...base, type: "noteOn", midi: d1, velocity: d2 };
  }
  if (kind === 0x80) {
    return { ...base, type: "noteOff", midi: d1, velocity: d2 };
  }
  if (kind === 0xb0) {
    if (d1 === CC_SUSTAIN) {
      return { ...base, type: "sustain", value: d2 };
    }
    if (d1 === CC_SOSTENUTO) {
      return { ...base, type: "sostenuto", value: d2 };
    }
    if (d1 === CC_SOFT) {
      return { ...base, type: "soft", value: d2 };
    }
    if (d1 === CC_ALL_NOTES_OFF || d1 === CC_ALL_SOUND_OFF) {
      return { ...base, type: "allNotesOff", value: d2 };
    }
  }
  return null;
}

/** True for single-byte system real-time messages (clock, active sensing, ...). */
export function isRealtimeMessage(data: MidiBytes): boolean {
  const status = data.length > 0 ? data[0] : undefined;
  return typeof status === "number" && status >= 0xf8;
}
