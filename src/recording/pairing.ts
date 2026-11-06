/**
 * Note pairing: recorded events → RecordedNotes (pure, deterministic).
 *
 * The events are replayed through a fresh `HeldStateTracker`, so note-on/off matching, velocity-0
 * note-offs, retriggers, unmatched note-offs, sustain/sostenuto hold and per-source resets follow
 * exactly the rules the live input pipeline uses. Every note that is still open at the end of the
 * take (held key, pedal-sustained, or lost note-off) is closed at `durationMs` and flagged
 * `truncated`.
 */
import type { InputEvent } from "@/model/contracts";
import { HeldStateTracker } from "@/input/heldState";
import type { RecordedEvent, RecordedNote } from "@/recording/types";

interface OpenNote {
  note: RecordedNote;
  pressed: boolean;
}

function openKey(sourceKey: string, midi: number): string {
  return `${sourceKey}|${midi}`;
}

export function recordedToInputEvent(event: RecordedEvent): InputEvent {
  const input: InputEvent = { source: event.source, type: event.type, timestampMs: event.atMs };
  if (event.portId !== undefined) input.portId = event.portId;
  if (event.channel !== undefined) input.channel = event.channel;
  if (event.midi !== undefined) input.midi = event.midi;
  if (event.velocity !== undefined) input.velocity = event.velocity;
  if (event.value !== undefined) input.value = event.value;
  return input;
}

/** Stable order: by time, then by original index (so a note-off before a note-on at the same ms stays first). */
export function sortRecordedEvents(events: readonly RecordedEvent[]): RecordedEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.atMs - b.event.atMs || a.index - b.index)
    .map((item) => item.event);
}

/**
 * Derive notes from events. `durationMs` is the stop boundary: nothing sounds past it.
 * Notes are returned in onset order (ties: by original event order).
 */
export function pairRecordedNotes(events: readonly RecordedEvent[], durationMs: number): RecordedNote[] {
  const end = Math.max(0, Number.isFinite(durationMs) ? durationMs : 0);
  const tracker = new HeldStateTracker();
  const open = new Map<string, OpenNote>();
  const notes: RecordedNote[] = [];
  let counter = 0;

  const closeSounding = (entry: OpenNote, atMs: number, truncated: boolean): void => {
    const note = entry.note;
    if (entry.pressed) {
      note.pressedMs = Math.max(0, atMs - note.onsetMs);
      entry.pressed = false;
    }
    note.soundingMs = Math.max(note.pressedMs, atMs - note.onsetMs);
    if (truncated) {
      note.truncated = true;
    }
  };

  for (const recorded of sortRecordedEvents(events)) {
    const atMs = Math.min(end, Math.max(0, recorded.atMs));
    const event = recordedToInputEvent({ ...recorded, atMs });
    const changes = tracker.apply(event);
    for (const change of changes) {
      switch (change.kind) {
        case "attack": {
          const key = openKey(change.sourceKey, change.midi);
          const existing = open.get(key);
          if (existing) {
            // Retrigger: the earlier note stops sounding when the key is struck again.
            closeSounding(existing, atMs, true);
            open.delete(key);
          }
          counter += 1;
          const note: RecordedNote = {
            id: `n${counter}`,
            midi: change.midi,
            velocity: Math.min(127, Math.max(1, Math.round(change.velocity))),
            releaseVelocity: 0,
            onsetMs: atMs,
            pressedMs: 0,
            soundingMs: 0,
            channel: change.channel ?? event.channel ?? 1,
            source: change.source,
            truncated: false
          };
          if (change.portId !== undefined) {
            note.portId = change.portId;
          }
          notes.push(note);
          open.set(key, { note, pressed: true });
          break;
        }
        case "release": {
          const entry = open.get(openKey(change.sourceKey, change.midi));
          if (!entry) {
            break;
          }
          entry.note.pressedMs = Math.max(0, atMs - entry.note.onsetMs);
          entry.pressed = false;
          if (event.type === "noteOff" && typeof event.velocity === "number") {
            entry.note.releaseVelocity = Math.min(127, Math.max(0, Math.round(event.velocity)));
          }
          if (!change.stillSounding) {
            closeSounding(entry, atMs, false);
            open.delete(openKey(change.sourceKey, change.midi));
          }
          break;
        }
        case "pedal": {
          for (const midi of change.damped) {
            const key = openKey(change.sourceKey, midi);
            const entry = open.get(key);
            if (entry && !entry.pressed) {
              closeSounding(entry, atMs, false);
              open.delete(key);
            }
          }
          break;
        }
        case "reset": {
          for (const [key, entry] of [...open.entries()]) {
            if (change.sourceKey === null || key.startsWith(`${change.sourceKey}|`)) {
              closeSounding(entry, atMs, true);
              open.delete(key);
            }
          }
          break;
        }
        default:
          break;
      }
    }
  }

  // Stop boundary: anything still pressed or sustained ends here.
  for (const entry of open.values()) {
    closeSounding(entry, end, true);
  }
  open.clear();

  return notes;
}

/** Highest `atMs` in the events (0 when empty). */
export function lastEventMs(events: readonly RecordedEvent[]): number {
  let last = 0;
  for (const event of events) {
    if (event.atMs > last) {
      last = event.atMs;
    }
  }
  return last;
}

/** Number of note attacks in the events. */
export function countNoteOns(events: readonly RecordedEvent[]): number {
  let count = 0;
  for (const event of events) {
    if (event.type === "noteOn" && (event.velocity ?? 0) > 0) {
      count += 1;
    }
  }
  return count;
}
