import type { PerformedNote } from "@/model/contracts";
import { secondsToBeats } from "@/timeline/clock";

/** Default 1-based output channel for metronome/count-in clicks (GM percussion). */
export const DEFAULT_METRONOME_CHANNEL = 10;

/** GM percussion (channel 10): 76 = Hi Wood Block (accent), 77 = Low Wood Block (beat). */
export const METRONOME_ACCENT_MIDI = 76;
export const METRONOME_BEAT_MIDI = 77;
export const METRONOME_ACCENT_VELOCITY = 120;
export const METRONOME_BEAT_VELOCITY = 80;

/** Event/occurrence ids used for generated clicks (they do not belong to a sequence event). */
export const METRONOME_EVENT_ID = "metronome";
export const COUNT_IN_EVENT_ID = "countIn";

const EPSILON = 1e-6;

/** Click length in beats: at most a sixteenth, about 80 ms of sound. */
export function clickDurationBeats(bpm: number): number {
  return Math.min(0.25, secondsToBeats(0.08, bpm));
}

export interface MetronomeOptions {
  /** First beat (inclusive) to click on; clicks fall on integer beats. Default 0. */
  startBeat?: number;
  /** Last beat (exclusive). */
  endBeat: number;
  /** Quarter-note beats per bar (see `beatsPerBar`). Default 4. */
  beatsPerBar?: number;
  bpm: number;
}

function isBarStart(beat: number, barLength: number): boolean {
  if (barLength <= 0) {
    return false;
  }
  const barIndex = Math.floor((beat + EPSILON) / barLength);
  return Math.abs(beat - barIndex * barLength) < EPSILON;
}

/**
 * Build metronome clicks (part "metronome") on every integer beat in [startBeat, endBeat).
 * Beat 1 of every bar is accented through velocity (and the GM accent block).
 * IDs: `metronome#<barIndex>:metronome:<beatIndex>` — stable for a given bar grid.
 */
export function buildMetronomeNotes(options: MetronomeOptions): PerformedNote[] {
  const barLength = options.beatsPerBar !== undefined && options.beatsPerBar > 0 ? options.beatsPerBar : 4;
  const start = Math.ceil((options.startBeat ?? 0) - EPSILON) + 0; // "+ 0" turns Math.ceil's -0 into +0
  const duration = clickDurationBeats(options.bpm);
  const notes: PerformedNote[] = [];
  for (let beat = start; beat < options.endBeat - EPSILON; beat += 1) {
    const accent = isBarStart(beat, barLength);
    const barIndex = Math.floor((beat + EPSILON) / barLength);
    const occurrenceId = `${METRONOME_EVENT_ID}#${barIndex}`;
    notes.push({
      id: `${occurrenceId}:metronome:${beat}`,
      eventId: METRONOME_EVENT_ID,
      occurrenceId,
      part: "metronome",
      midi: accent ? METRONOME_ACCENT_MIDI : METRONOME_BEAT_MIDI,
      onsetBeat: beat,
      durationBeats: Math.min(duration, options.endBeat - beat),
      velocity: accent ? METRONOME_ACCENT_VELOCITY : METRONOME_BEAT_VELOCITY
    });
  }
  return notes;
}

export interface CountInOptions {
  /** The beat the count-in leads into (default 0, giving negative onsets). */
  targetBeat?: number;
  /** Quarter-note beats per bar, used to accent bar starts relative to the target. Default 4. */
  beatsPerBar?: number;
}

/**
 * Count-in clicks that end exactly at `targetBeat`: onsets targetBeat - beats, ..., targetBeat - 1.
 * The first click and every click a whole bar before the target are accented.
 * Part "metronome", eventId "countIn"; these never belong to a compiled timeline (timeline notes
 * never start before 0) — the transport plays them before the start position.
 */
export function countInNotes(beats: number, bpm: number, options: CountInOptions = {}): PerformedNote[] {
  const count = Math.max(0, Math.round(beats));
  const target = options.targetBeat ?? 0;
  const barLength = options.beatsPerBar !== undefined && options.beatsPerBar > 0 ? options.beatsPerBar : 4;
  const duration = clickDurationBeats(bpm);
  const occurrenceId = `${COUNT_IN_EVENT_ID}#0`;
  const notes: PerformedNote[] = [];
  for (let k = 0; k < count; k += 1) {
    const beatsBeforeTarget = count - k;
    const accent = k === 0 || isBarStart(beatsBeforeTarget, barLength);
    notes.push({
      id: `${occurrenceId}:metronome:${k}`,
      eventId: COUNT_IN_EVENT_ID,
      occurrenceId,
      part: "metronome",
      midi: accent ? METRONOME_ACCENT_MIDI : METRONOME_BEAT_MIDI,
      onsetBeat: target - beatsBeforeTarget,
      durationBeats: duration,
      velocity: accent ? METRONOME_ACCENT_VELOCITY : METRONOME_BEAT_VELOCITY
    });
  }
  return notes;
}
