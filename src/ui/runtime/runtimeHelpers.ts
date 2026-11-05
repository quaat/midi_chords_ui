/**
 * Pure helpers for the studio runtime (no React, no audio). Tested in test/ui/runtime*.test.ts.
 */
import type {
  InputSource,
  PartId,
  PerformanceOccurrence,
  PerformanceTimeline,
  PerformedNote,
  TimeSignatureSpec
} from "@/model/contracts";
import type { InputSourceSelection, ThemeName } from "@/state/sessionStore";
import type { LabelMode } from "@/ui/piano/pianoLabels";
import type {
  LabelMode as PreferenceLabelMode,
  PreferredInputSource,
  ReducedMotionPreference,
  ThemePreference
} from "@/persistence/preferences";
import { compareNotes } from "@/timeline/compile";
import { toBarBeat } from "@/ui/stage/positionFormat";

const EPSILON = 1e-6;

// ---------------------------------------------------------------------------
// Demonstration ("Play it for me")
// ---------------------------------------------------------------------------

/**
 * Copy of a timeline whose learner part is re-tagged as part "demonstration" (ids unchanged, so
 * the same notes are referenced). Accompaniment and metronome stay as they are. The copy gets
 * its own timeline id (`<id>~demo`) so listeners can tell it apart.
 */
export function asDemonstration(timeline: PerformanceTimeline): PerformanceTimeline {
  const notes: PerformedNote[] = timeline.notes.map((note) => (note.part === "learner" ? { ...note, part: "demonstration" as PartId } : note));
  notes.sort(compareNotes);
  return { ...timeline, id: `${timeline.id}~demo`, notes };
}

export function isDemonstrationTimeline(timeline: PerformanceTimeline | null): boolean {
  return timeline !== null && /~demo$/.test(timeline.id);
}

// ---------------------------------------------------------------------------
// Position labels and current/next lookup
// ---------------------------------------------------------------------------

/** Compact "bar.beat" label (1-based, "3.2"); during a count-in "Count-in N". */
export function formatPositionLabel(positionBeats: number, timeSignature?: TimeSignatureSpec): string {
  const bb = toBarBeat(Number.isFinite(positionBeats) ? positionBeats : 0, timeSignature);
  if (bb.countIn) {
    return `Count-in ${bb.beat}`;
  }
  return `${bb.bar}.${bb.beat}`;
}

export interface CurrentNext {
  /** Index into the occurrences sorted by start; -1 when nothing is current/upcoming. */
  index: number;
  current: PerformanceOccurrence | null;
  next: PerformanceOccurrence | null;
  /** True when the position lies inside `current` (false: it is upcoming — count-in/gap/stopped at 0). */
  sounding: boolean;
}

export function sortOccurrences(timeline: PerformanceTimeline): PerformanceOccurrence[] {
  return [...timeline.occurrences].sort((a, b) => a.startBeat - b.startBeat || (a.occurrenceId < b.occurrenceId ? -1 : a.occurrenceId > b.occurrenceId ? 1 : 0));
}

/**
 * Occurrence at `beat` (or the next upcoming one during count-in and gaps) and the one after it.
 * After the end of the timeline: index -1, nothing current.
 */
export function findCurrentAndNext(timeline: PerformanceTimeline | null, beat: number, sorted?: readonly PerformanceOccurrence[]): CurrentNext {
  if (!timeline) {
    return { index: -1, current: null, next: null, sounding: false };
  }
  const list = sorted ?? sortOccurrences(timeline);
  for (let i = 0; i < list.length; i += 1) {
    const occ = list[i];
    if (beat < occ.startBeat + occ.durationBeats - EPSILON) {
      const sounding = beat >= occ.startBeat - EPSILON;
      return { index: i, current: occ, next: list[i + 1] ?? null, sounding };
    }
  }
  return { index: -1, current: null, next: null, sounding: false };
}

/** Learner notes (pass 0 of `eventId`, else the given occurrence) sorted low → high. */
export function learnerNotesOf(timeline: PerformanceTimeline | null, occurrenceId: string | null): PerformedNote[] {
  if (!timeline || occurrenceId === null) {
    return [];
  }
  return timeline.notes.filter((note) => note.occurrenceId === occurrenceId && note.part === "learner").sort((a, b) => a.midi - b.midi || a.onsetBeat - b.onsetBeat);
}

/** Unique MIDI numbers, ascending. */
export function uniqueSorted(values: readonly number[]): number[] {
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

export function sameMidiSet(a: readonly number[], b: readonly number[]): boolean {
  const left = uniqueSorted(a);
  const right = uniqueSorted(b);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

// ---------------------------------------------------------------------------
// Audition timelines
// ---------------------------------------------------------------------------

export interface AuditionNote {
  midi: number;
  onsetBeat: number;
  durationBeats: number;
  velocity?: number;
}

export const AUDITION_EVENT_ID = "audition";

/** A tiny throwaway timeline (part "demonstration") for A/B listening. */
export function buildAuditionTimeline(notes: readonly AuditionNote[], tempoBpm: number, id: string = "audition"): PerformanceTimeline {
  const valid = notes.filter((note) => Number.isFinite(note.midi) && note.midi >= 0 && note.midi <= 127 && note.durationBeats > 0);
  const occurrenceId = `${AUDITION_EVENT_ID}#0`;
  const performed: PerformedNote[] = valid.map((note, index) => ({
    id: `${id}:n${index}`,
    eventId: AUDITION_EVENT_ID,
    occurrenceId,
    part: "demonstration",
    midi: Math.round(note.midi),
    onsetBeat: Math.max(0, note.onsetBeat),
    durationBeats: note.durationBeats,
    velocity: Math.min(127, Math.max(1, Math.round(note.velocity ?? 90)))
  }));
  performed.sort(compareNotes);
  let total = 0;
  performed.forEach((note) => {
    total = Math.max(total, note.onsetBeat + note.durationBeats);
  });
  return {
    id,
    sourceId: AUDITION_EVENT_ID,
    sourceVersion: 0,
    tempo: { bpm: tempoBpm > 0 ? tempoBpm : 90 },
    timeSignature: { numerator: 4, denominator: 4 },
    notes: performed,
    occurrences: [{ occurrenceId, eventId: AUDITION_EVENT_ID, passIndex: 0, startBeat: 0, durationBeats: total, symbol: "audition" }],
    totalBeats: total
  };
}

/** Block chord: every pitch at beat 0 for `durationBeats`. */
export function chordAuditionNotes(midi: readonly number[], durationBeats: number = 2): AuditionNote[] {
  return uniqueSorted(midi).map((value) => ({ midi: value, onsetBeat: 0, durationBeats }));
}

/** One note after another (scale runs): `beatsPerNote` each. */
export function runAuditionNotes(midi: readonly number[], beatsPerNote: number = 0.5): AuditionNote[] {
  return midi.map((value, index) => ({ midi: value, onsetBeat: index * beatsPerNote, durationBeats: beatsPerNote * 0.95 }));
}

// ---------------------------------------------------------------------------
// Preferences <-> session mapping
// ---------------------------------------------------------------------------

/** Preferences store a coarser label vocabulary than the piano. */
export function labelModeFromPreference(value: PreferenceLabelMode): LabelMode {
  switch (value) {
    case "none":
      return "none";
    case "degrees":
    case "roles":
      return "chordDegrees";
    default:
      return "noteNames";
  }
}

/** Lossy: scale degrees are saved as "degrees" (restored as chord degrees); fingers as note names. */
export function labelModeToPreference(value: LabelMode): PreferenceLabelMode {
  switch (value) {
    case "none":
      return "none";
    case "chordDegrees":
    case "scaleDegrees":
      return "degrees";
    default:
      return "noteNames";
  }
}

/** "auto" keeps the session default. */
export function inputSourceFromPreference(value: PreferredInputSource): InputSourceSelection | null {
  return value === "auto" ? null : value;
}

/** "none" (listen only) is not a stored preference; it is saved as "auto". */
export function inputSourceToPreference(value: InputSourceSelection): PreferredInputSource {
  return value === "none" ? "auto" : value;
}

export function themeFromPreference(value: ThemePreference, systemDark: boolean): ThemeName {
  if (value === "light" || value === "dark") {
    return value;
  }
  return systemDark ? "dark" : "light";
}

export function reducedMotionFromPreference(value: ReducedMotionPreference, systemReduce: boolean): boolean {
  if (value === "reduce") {
    return true;
  }
  if (value === "noPreference") {
    return false;
  }
  return systemReduce;
}

/** Short "C4 · velocity 80 · touch" text for the device panel. */
export function describeAttack(noteName: string, velocity: number, source: InputSource): string {
  const sourceText = source === "computerKeyboard" ? "computer keys" : source === "touch" ? "on-screen piano" : source === "midi" ? "MIDI" : "replay";
  return `${noteName} · velocity ${velocity} · ${sourceText}`;
}
