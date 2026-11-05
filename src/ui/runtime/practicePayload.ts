/**
 * Payloads handed to Practice (`navigate.openInPractice`). Pure builders for the Explore actions
 * "Send to Practice" (one chord, exact voicing) and "Send run to Practice" (one step per note).
 */
import type {
  ChordDefinition,
  ChordRole,
  DegreeLabel,
  ExerciseStep,
  Hand,
  PerformanceOccurrence,
  PerformanceTimeline,
  PerformedNote,
  SpelledNote
} from "@/model/contracts";
import { formatSpelledNote } from "@/music/pitch";

export interface PracticePayload {
  timeline: PerformanceTimeline;
  steps?: ExerciseStep[];
  exerciseId?: string;
  title: string;
}

/** What Practice receives: the payload plus a request id that changes on every request. */
export interface PracticeRequest extends PracticePayload {
  requestId: number;
  requestedAt: number;
}

export interface PayloadNote {
  midi: number;
  spelled?: SpelledNote;
  degree?: DegreeLabel;
  role?: ChordRole;
  hand?: Hand;
  finger?: number;
}

export interface ChordPayloadOptions {
  title?: string;
  /** Used in ids and the prompt (e.g. "rootless-a"). */
  recipeId?: string;
  recipeName?: string;
  tempoBpm?: number;
  durationBeats?: number;
  /** Accompaniment notes (e.g. a voicing's accompaniment bass) — not part of the answer. */
  accompaniment?: PayloadNote[];
}

function slug(text: string): string {
  return text.replace(/[^A-Za-z0-9#]+/g, "-").replace(/^-+|-+$/g, "") || "x";
}

function performed(note: PayloadNote, id: string, eventId: string, occurrenceId: string, part: PerformedNote["part"], onsetBeat: number, durationBeats: number): PerformedNote {
  const out: PerformedNote = { id, eventId, occurrenceId, part, midi: note.midi, onsetBeat, durationBeats, velocity: 90 };
  if (note.spelled) out.spelled = note.spelled;
  if (note.degree !== undefined) out.degree = note.degree;
  if (note.role !== undefined) out.role = note.role;
  if (note.hand !== undefined) out.hand = note.hand;
  if (note.finger !== undefined) out.finger = note.finger;
  return out;
}

function noteText(note: PayloadNote): string {
  return note.spelled ? formatSpelledNote(note.spelled) : String(note.midi);
}

/** One chord as a one-step exercise with an exact-voicing answer policy. */
export function chordPracticePayload(chord: ChordDefinition, notes: readonly PayloadNote[], options: ChordPayloadOptions = {}): PracticePayload {
  const duration = options.durationBeats ?? 4;
  const key = `${slug(chord.symbol)}${options.recipeId ? `-${slug(options.recipeId)}` : ""}`;
  const timelineId = `explore:${key}`;
  const eventId = `explore-${key}`;
  const occurrenceId = `${eventId}#0`;
  const sorted = [...notes].sort((a, b) => a.midi - b.midi);
  const learner = sorted.map((note, index) => performed(note, `${eventId}:l${index}`, eventId, occurrenceId, "learner", 0, duration));
  const accompaniment = (options.accompaniment ?? []).map((note, index) => performed(note, `${eventId}:a${index}`, eventId, occurrenceId, "accompaniment", 0, duration));
  const occurrence: PerformanceOccurrence = { occurrenceId, eventId, passIndex: 0, startBeat: 0, durationBeats: duration, symbol: chord.symbol, chord };
  const timeline: PerformanceTimeline = {
    id: timelineId,
    sourceId: timelineId,
    sourceVersion: 1,
    tempo: { bpm: options.tempoBpm ?? 80 },
    timeSignature: { numerator: 4, denominator: 4 },
    notes: [...learner, ...accompaniment],
    occurrences: [occurrence],
    totalBeats: duration
  };
  const label = options.recipeName ? `${chord.symbol} (${options.recipeName})` : chord.symbol;
  const roles = sorted.filter((note) => note.role !== undefined).map((note) => `${note.role} ${note.degree ?? ""}`.trim());
  const step: ExerciseStep = {
    id: `${eventId}:step`,
    occurrenceId,
    prompt: `Play ${label}: ${sorted.map(noteText).join(" ")}.`,
    targets: learner,
    chord,
    policy: { kind: "exactVoicing" },
    hints: [
      `Find the root ${noteText(sorted.find((note) => note.role === "root") ?? sorted[0] ?? { midi: 60 })} first.`,
      roles.length > 0 ? `This voicing plays: ${roles.join(", ")}.` : `Play ${sorted.length} notes.`,
      `Exact notes from low to high: ${sorted.map(noteText).join(" ")}.`
    ]
  };
  return { timeline, steps: [step], title: options.title ?? `Play ${label}` };
}

export interface RunPayloadOptions {
  title?: string;
  tempoBpm?: number;
  beatsPerNote?: number;
  hand?: Hand;
}

/** A scale run: one PerformedNote and one ExerciseStep per note (step mode friendly). */
export function runPracticePayload(id: string, notes: readonly PayloadNote[], options: RunPayloadOptions = {}): PracticePayload {
  const beats = options.beatsPerNote ?? 1;
  const timelineId = `explore:${slug(id)}`;
  const occurrences: PerformanceOccurrence[] = [];
  const learner: PerformedNote[] = [];
  const steps: ExerciseStep[] = [];
  notes.forEach((note, index) => {
    const eventId = `${slug(id)}-${index + 1}`;
    const occurrenceId = `${eventId}#0`;
    const start = index * beats;
    const withHand: PayloadNote = options.hand && note.hand === undefined ? { ...note, hand: options.hand } : note;
    const target = performed(withHand, `${eventId}:n`, eventId, occurrenceId, "learner", start, beats);
    learner.push(target);
    occurrences.push({ occurrenceId, eventId, passIndex: 0, startBeat: start, durationBeats: beats, symbol: noteText(note) });
    steps.push({
      id: `${eventId}:step`,
      occurrenceId,
      prompt: `Play ${noteText(note)}${note.degree ? ` (degree ${note.degree})` : ""}.`,
      targets: [target],
      policy: { kind: "exactVoicing" },
      hints: [note.degree ? `This is scale degree ${note.degree}.` : "Follow the highlighted key.", `Play ${noteText(note)}.`]
    });
  });
  const timeline: PerformanceTimeline = {
    id: timelineId,
    sourceId: timelineId,
    sourceVersion: 1,
    tempo: { bpm: options.tempoBpm ?? 72 },
    timeSignature: { numerator: 4, denominator: 4 },
    notes: learner,
    occurrences,
    totalBeats: notes.length * beats
  };
  return { timeline, steps, title: options.title ?? `Run: ${id}` };
}
