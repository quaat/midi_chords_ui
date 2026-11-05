/**
 * Pure drawing math for the 2D falling-note stage (plan E12).
 *
 * The stage is a pure function of (timeline, transport snapshot, layout, size): nothing
 * here keeps time, so pause / seek / loop / tempo changes cannot drift the picture.
 * Coordinates are CSS px; the renderer applies devicePixelRatio.
 */
import type {
  PartId,
  PerformanceOccurrence,
  PerformanceTimeline,
  PerformedNote,
  TimeSignatureSpec,
  TransportSnapshot
} from "@/model/contracts";
import type { KeyLayout } from "@/ui/piano/geometry";

export interface StageRect {
  midi: number;
  black: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Anything with a pitch, an onset and a duration in beats. */
export interface BeatSpan {
  midi: number;
  onsetBeat: number;
  durationBeats: number;
}

export interface NoteRectOptions {
  /** y of the strike line (default: stageHeight, i.e. the bottom edge touching the piano). */
  strikeY?: number;
  /** Horizontal scale from layout px to stage px (default 1). */
  scaleX?: number;
  /** Horizontal inset on each side, in stage px (default 0). */
  insetPx?: number;
}

export function beatsPerBar(timeSignature: TimeSignatureSpec | undefined): number {
  if (!timeSignature || timeSignature.denominator <= 0 || timeSignature.numerator <= 0) {
    return 4;
  }
  return (timeSignature.numerator * 4) / timeSignature.denominator;
}

/** Pixels per beat so that `lookaheadBeats` fill the distance from the top to the strike line. */
export function pixelsPerBeatFor(stageHeight: number, lookaheadBeats: number, strikeY: number = stageHeight): number {
  if (lookaheadBeats <= 0 || strikeY <= 0) {
    return 0;
  }
  return strikeY / lookaheadBeats;
}

/** Screen y of a beat: the strike line at the current position, earlier = lower. */
export function beatToY(beat: number, positionBeats: number, pixelsPerBeat: number, strikeY: number): number {
  return strikeY - (beat - positionBeats) * pixelsPerBeat;
}

/**
 * Rectangle for a note. The bottom edge reaches the strike line exactly at the onset;
 * height = durationBeats × pixelsPerBeat; x/width follow the key's lane exactly.
 * Returns null when the pitch is outside the layout's range (clipped).
 */
export function noteScreenRect(
  note: BeatSpan,
  snapshot: Pick<TransportSnapshot, "positionBeats">,
  layout: KeyLayout,
  pixelsPerBeat: number,
  stageHeight: number,
  options: NoteRectOptions = {}
): StageRect | null {
  const lane = layout.laneX(note.midi);
  if (!lane) {
    return null;
  }
  const strikeY = options.strikeY ?? stageHeight;
  const scaleX = options.scaleX ?? 1;
  const inset = options.insetPx ?? 0;
  const bottom = beatToY(note.onsetBeat, snapshot.positionBeats, pixelsPerBeat, strikeY);
  const height = Math.max(0, note.durationBeats) * pixelsPerBeat;
  const width = Math.max(0, lane.width * scaleX - inset * 2);
  return {
    midi: note.midi,
    black: lane.black,
    x: lane.x * scaleX + inset,
    y: bottom - height,
    width,
    height
  };
}

export function rectIntersectsStage(rect: StageRect, stageWidth: number, stageHeight: number): boolean {
  return rect.y < stageHeight && rect.y + rect.height > 0 && rect.x < stageWidth && rect.x + rect.width > 0;
}

// ---------------------------------------------------------------------------
// Timeline indexing (cached per timeline object)
// ---------------------------------------------------------------------------

interface TimelineIndex {
  notes: PerformedNote[];
  maxDuration: number;
  occurrences: PerformanceOccurrence[];
  notesByOccurrence: Map<string, PerformedNote[]>;
}

const indexCache = new WeakMap<PerformanceTimeline, TimelineIndex>();

function indexFor(timeline: PerformanceTimeline): TimelineIndex {
  const cached = indexCache.get(timeline);
  if (cached) {
    return cached;
  }
  const notes = [...timeline.notes].sort((a, b) => a.onsetBeat - b.onsetBeat || a.midi - b.midi);
  let maxDuration = 0;
  const notesByOccurrence = new Map<string, PerformedNote[]>();
  for (const note of notes) {
    maxDuration = Math.max(maxDuration, note.durationBeats);
    const list = notesByOccurrence.get(note.occurrenceId);
    if (list) {
      list.push(note);
    } else {
      notesByOccurrence.set(note.occurrenceId, [note]);
    }
  }
  const occurrences = [...timeline.occurrences].sort((a, b) => a.startBeat - b.startBeat);
  const index: TimelineIndex = { notes, maxDuration, occurrences, notesByOccurrence };
  indexCache.set(timeline, index);
  return index;
}

/** First index whose onset is >= beat. */
function lowerBound(notes: PerformedNote[], beat: number): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (notes[mid].onsetBeat < beat) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function notesInWindow(index: TimelineIndex, startBeat: number, endBeat: number, onsetFrom: number = -Infinity, onsetTo: number = Infinity): PerformedNote[] {
  const out: PerformedNote[] = [];
  const first = lowerBound(index.notes, Math.max(onsetFrom, startBeat - index.maxDuration));
  for (let i = first; i < index.notes.length; i += 1) {
    const note = index.notes[i];
    if (note.onsetBeat >= endBeat || note.onsetBeat >= onsetTo) {
      break;
    }
    if (note.onsetBeat < onsetFrom) {
      continue;
    }
    if (note.onsetBeat + note.durationBeats > startBeat) {
      out.push(note);
    }
  }
  return out;
}

/**
 * Notes that overlap the window (position − pastBeats, position + lookaheadBeats):
 * onset before the window end and release after the window start. Sorted by onset.
 */
export function visibleNotes(
  timeline: PerformanceTimeline | null,
  positionBeats: number,
  lookaheadBeats: number,
  pastBeats: number = 0
): PerformedNote[] {
  if (!timeline || timeline.notes.length === 0) {
    return [];
  }
  return notesInWindow(indexFor(timeline), positionBeats - Math.max(0, pastBeats), positionBeats + Math.max(0, lookaheadBeats));
}

export interface StageNote {
  note: PerformedNote;
  /** Onset to draw at; differs from note.onsetBeat for the wrapped copy of a loop. */
  onsetBeat: number;
  durationBeats: number;
  midi: number;
}

/**
 * Visible notes for a snapshot, including the looped-back continuation when the
 * look-ahead window crosses the loop end (so the next pass is visible in advance).
 */
export function stageNotes(
  timeline: PerformanceTimeline | null,
  snapshot: Pick<TransportSnapshot, "positionBeats" | "loop">,
  lookaheadBeats: number,
  pastBeats: number = 0
): StageNote[] {
  if (!timeline || timeline.notes.length === 0) {
    return [];
  }
  const index = indexFor(timeline);
  const pos = snapshot.positionBeats;
  const windowStart = pos - Math.max(0, pastBeats);
  const windowEnd = pos + Math.max(0, lookaheadBeats);
  const loop = snapshot.loop ?? null;
  const loopActive = loop !== null && loop.endBeat > loop.startBeat && pos < loop.endBeat;
  const out: StageNote[] = [];
  const primary = notesInWindow(index, windowStart, windowEnd, -Infinity, loopActive && loop ? loop.endBeat : Infinity);
  for (const note of primary) {
    out.push({ note, onsetBeat: note.onsetBeat, durationBeats: note.durationBeats, midi: note.midi });
  }
  if (loopActive && loop && windowEnd > loop.endBeat) {
    const length = loop.endBeat - loop.startBeat;
    for (let pass = 1; pass <= 16; pass += 1) {
      const passStart = loop.endBeat + (pass - 1) * length;
      if (passStart >= windowEnd) {
        break;
      }
      const shift = pass * length;
      // Notes of the next pass, expressed in this pass's beat numbers.
      const segEnd = Math.min(loop.endBeat, windowEnd - shift);
      for (const note of notesInWindow(index, loop.startBeat, segEnd, loop.startBeat, loop.endBeat)) {
        out.push({ note, onsetBeat: note.onsetBeat + shift, durationBeats: note.durationBeats, midi: note.midi });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Beat / bar grid
// ---------------------------------------------------------------------------

export interface GridLine {
  beat: number;
  y: number;
  kind: "bar" | "beat";
  /** 1-based bar number for bar lines (bars before 0 are count-in and get 0 or less). */
  bar: number;
}

export function gridLines(
  positionBeats: number,
  lookaheadBeats: number,
  pastBeats: number,
  barBeats: number,
  pixelsPerBeat: number,
  strikeY: number
): GridLine[] {
  const lines: GridLine[] = [];
  if (pixelsPerBeat <= 0) {
    return lines;
  }
  const start = Math.ceil(positionBeats - Math.max(0, pastBeats) - 1e-9);
  const end = Math.floor(positionBeats + Math.max(0, lookaheadBeats) + 1e-9);
  const bar = barBeats > 0 ? barBeats : 4;
  for (let beat = start; beat <= end && lines.length < 512; beat += 1) {
    const phase = ((beat % bar) + bar) % bar;
    const isBar = phase < 1e-6 || bar - phase < 1e-6;
    lines.push({
      beat,
      y: beatToY(beat, positionBeats, pixelsPerBeat, strikeY),
      kind: isBar ? "bar" : "beat",
      bar: Math.floor(beat / bar + 1e-9) + 1
    });
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Steps (current + next chords) for the static step view and current/next strip
// ---------------------------------------------------------------------------

/**
 * Index (into the timeline's occurrences sorted by start) of the occurrence sounding at
 * `positionBeats`; during gaps and the count-in, the next upcoming one; -1 after the end.
 */
export function occurrenceIndexAt(timeline: PerformanceTimeline | null, positionBeats: number): number {
  if (!timeline) {
    return -1;
  }
  const { occurrences } = indexFor(timeline);
  for (let i = 0; i < occurrences.length; i += 1) {
    const occ = occurrences[i];
    if (positionBeats < occ.startBeat + occ.durationBeats) {
      return i;
    }
  }
  return -1;
}

export interface StepInfo {
  index: number;
  occurrence: PerformanceOccurrence;
  notes: PerformedNote[];
  /** True when the position is inside this occurrence (false when it is upcoming). */
  sounding: boolean;
}

/** `count` steps starting at `index` (current first), notes filtered by part. */
export function stepsFrom(
  timeline: PerformanceTimeline | null,
  index: number,
  count: number,
  parts?: ReadonlySet<PartId>,
  positionBeats?: number
): StepInfo[] {
  if (!timeline || index < 0) {
    return [];
  }
  const idx = indexFor(timeline);
  const out: StepInfo[] = [];
  for (let i = index; i < idx.occurrences.length && out.length < Math.max(0, count); i += 1) {
    const occurrence = idx.occurrences[i];
    const notes = (idx.notesByOccurrence.get(occurrence.occurrenceId) ?? []).filter((n) => !parts || parts.has(n.part));
    const sounding =
      typeof positionBeats === "number" && positionBeats >= occurrence.startBeat && positionBeats < occurrence.startBeat + occurrence.durationBeats;
    out.push({ index: i, occurrence, notes: [...notes].sort((a, b) => a.midi - b.midi), sounding });
  }
  return out;
}

/** Notes of `part` sounding at a position (for piano highlights during playback). */
export function notesSoundingAt(timeline: PerformanceTimeline | null, positionBeats: number, parts?: ReadonlySet<PartId>): PerformedNote[] {
  if (!timeline) {
    return [];
  }
  return notesInWindow(indexFor(timeline), positionBeats, positionBeats + 1e-9).filter(
    (n) => n.onsetBeat <= positionBeats && (!parts || parts.has(n.part))
  );
}

/** Occurrences sorted by start beat (cached; the same order `occurrenceIndexAt` uses). */
export function sortedOccurrences(timeline: PerformanceTimeline): readonly PerformanceOccurrence[] {
  return indexFor(timeline).occurrences;
}
