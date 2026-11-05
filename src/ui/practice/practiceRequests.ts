/**
 * Practice request side-store and pure request helpers (B5a).
 *
 * The runtime's `PracticeRequest` (src/ui/runtime/practicePayload.ts) only carries
 * `{ timeline, steps?, exerciseId?, title, requestId }`. Practice needs more to run a fair
 * attempt: the full `ExerciseDefinition` (policy, timing, concepts, transfer keys), the mode
 * and assistance the caller asked for, chart/arrangement ids and the chart expansion for the
 * chart view, a loop region, and the routine item the request belongs to. Runtime files are not
 * edited, so those extras live here, keyed by `requestId`:
 *
 *   openWithExtras(runtime, payload, extras)   // calls runtime.navigate.openInPractice(payload)
 *   getRequestExtras(requestId)                // what Practice reads for the current request
 *
 * `openInPractice` notifies its store listeners synchronously, before it returns. Extras are
 * therefore registered as "pending" first and bound to the new request id on first lookup, so a
 * listener that reacts inside `openInPractice` already sees them.
 *
 * Learn/Songs should use the entry points in src/ui/practice/openExercise.ts instead of calling
 * these directly. `requestConcept(conceptId)` / `consumeConceptRequest()` hand a concept id from
 * Practice (review "Review the idea") to Learn.
 */
import type {
  AnswerPolicy,
  AssistanceLevel,
  ChordRole,
  ExerciseDefinition,
  ExerciseStep,
  Hand,
  MusicalSequence,
  PerformanceTimeline,
  PerformedNote,
  ScaleId,
  SpelledPitchClass
} from "@/model/contracts";
import type { ChartExpansion } from "@/charts/expand";
import type { WarmupSpec } from "@/content/authoring";
import { noteList } from "@/practice/text";
import type { PracticePayload, PracticeRequest } from "@/ui/runtime/practicePayload";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PracticeModeKind = "listen" | "step" | "timed" | "free";

export const PRACTICE_MODE_LABELS: Readonly<Record<PracticeModeKind, string>> = {
  listen: "Listen",
  step: "Step",
  timed: "Timed",
  free: "Free"
};

export const PRACTICE_MODE_DESCRIPTIONS: Readonly<Record<PracticeModeKind, string>> = {
  listen: "Hear it played; nothing is scored.",
  step: "Each step waits for your answer.",
  timed: "Play along with a count-in; pitch and timing are reported separately.",
  free: "Record and replay your own playing; nothing is scored."
};

export interface PracticeLoopRegion {
  startBeat: number;
  endBeat: number;
  label?: string;
  /** Occurrences the region was chosen for (e.g. a difficult transition). */
  occurrenceIds?: string[];
}

export interface PracticeRoutineRef {
  routineId: string;
  itemId: string;
}

export interface PracticeRunConfig {
  tonic: SpelledPitchClass | string;
  scaleId: ScaleId;
  patternId: string;
  startOctave: number;
  octaves: number;
  hand: Hand;
}

export type PracticeSourceKind = "exercise" | "arrangement" | "run" | "warmup" | "material" | "payload";

/** Everything Practice needs beyond the runtime's PracticeRequest. */
export interface PracticeRequestExtras {
  source: PracticeSourceKind;
  /** Compiled definition (policy, timing, concepts, transfer keys). */
  exercise?: ExerciseDefinition;
  /** Content id the exercise was compiled from (exercise spec or warm-up). */
  specId?: string;
  transposeTo?: SpelledPitchClass;
  mode?: PracticeModeKind;
  assistance?: AssistanceLevel;
  tempoBpm?: number;
  countInBeats?: number;
  /** Click during timed/free takes (default on). */
  metronome?: boolean;
  startHintLevel?: number;
  loopRegion?: PracticeLoopRegion | null;
  chartId?: string;
  arrangementId?: string;
  sectionId?: string;
  chartTitle?: string;
  chartExpansion?: ChartExpansion;
  /** Sequence for the notation view (harmonic reduction). */
  sequence?: MusicalSequence;
  warmup?: WarmupSpec;
  run?: PracticeRunConfig;
  routine?: PracticeRoutineRef;
  /** Short teaching notes / compile warnings shown with the exercise. */
  notes?: string[];
}

/** The part of the runtime the open* helpers need (a fake works in tests). */
export interface PracticeNavigator {
  navigate: { openInPractice: (payload: PracticePayload) => void };
  practiceRequestStore: { getState: () => { request: PracticeRequest | null } };
}

// ---------------------------------------------------------------------------
// Side-store keyed by requestId
// ---------------------------------------------------------------------------

const MAX_KEPT = 24;
const extrasById = new Map<number, PracticeRequestExtras>();
let pending: PracticeRequestExtras | null = null;

function trim(): void {
  while (extrasById.size > MAX_KEPT) {
    const oldest = extrasById.keys().next();
    if (oldest.done) {
      return;
    }
    extrasById.delete(oldest.value);
  }
}

export function setRequestExtras(requestId: number, extras: PracticeRequestExtras): void {
  extrasById.delete(requestId);
  extrasById.set(requestId, extras);
  trim();
}

/** Extras for a request (binds pending extras to it while an open is in progress). */
export function getRequestExtras(requestId: number): PracticeRequestExtras | null {
  const found = extrasById.get(requestId);
  if (found) {
    return found;
  }
  if (pending) {
    const bound = pending;
    setRequestExtras(requestId, bound);
    return bound;
  }
  return null;
}

/** Read and forget. */
export function consumeRequestExtras(requestId: number): PracticeRequestExtras | null {
  const found = getRequestExtras(requestId);
  extrasById.delete(requestId);
  return found;
}

export function clearRequestExtras(): void {
  extrasById.clear();
  pending = null;
}

/**
 * Open a payload in Practice with extras. Returns the new request id (null when the runtime
 * did not create a request).
 */
export function openWithExtras(runtime: PracticeNavigator, payload: PracticePayload, extras: PracticeRequestExtras): number | null {
  pending = extras;
  try {
    runtime.navigate.openInPractice(payload);
    const request = runtime.practiceRequestStore.getState().request;
    if (!request) {
      return null;
    }
    getRequestExtras(request.requestId);
    return request.requestId;
  } finally {
    pending = null;
  }
}

// ---------------------------------------------------------------------------
// Concept hand-off to Learn
// ---------------------------------------------------------------------------

let conceptRequest: { conceptId: string; requestedAt: number } | null = null;

/** Ask Learn to show a concept (call before `runtime.navigate.openEntry("learn")`). */
export function requestConcept(conceptId: string): void {
  conceptRequest = { conceptId, requestedAt: Date.now() };
}

/** Learn calls this on mount: the requested concept id (once), or null. */
export function consumeConceptRequest(): string | null {
  const found = conceptRequest;
  conceptRequest = null;
  return found ? found.conceptId : null;
}

export function peekConceptRequest(): string | null {
  return conceptRequest ? conceptRequest.conceptId : null;
}

// ---------------------------------------------------------------------------
// Steps from a timeline / material
// ---------------------------------------------------------------------------

const ROLE_ORDER: ChordRole[] = ["root", "third", "fifth", "sixth", "seventh", "ninth", "eleventh", "thirteenth", "suspension", "added"];

function uniqueRoles(notes: readonly PerformedNote[]): ChordRole[] {
  const set = new Set<ChordRole>();
  notes.forEach((note) => {
    if (note.role !== undefined) {
      set.add(note.role);
    }
  });
  return ROLE_ORDER.filter((role) => set.has(role));
}

/**
 * One step per occurrence that has learner notes. Steps whose notes carry chord roles use a
 * "roles" policy (the learner may choose register/inversion); otherwise pitch classes.
 */
export function stepsFromTimeline(timeline: PerformanceTimeline): ExerciseStep[] {
  const byOccurrence = new Map<string, PerformedNote[]>();
  timeline.notes.forEach((note) => {
    if (note.part !== "learner") {
      return;
    }
    const list = byOccurrence.get(note.occurrenceId);
    if (list) {
      list.push(note);
    } else {
      byOccurrence.set(note.occurrenceId, [note]);
    }
  });
  const occurrences = [...timeline.occurrences].sort((a, b) => a.startBeat - b.startBeat);
  const steps: ExerciseStep[] = [];
  occurrences.forEach((occurrence) => {
    const notes = byOccurrence.get(occurrence.occurrenceId);
    if (!notes || notes.length === 0) {
      return;
    }
    const targets = [...notes].sort((a, b) => a.midi - b.midi || a.onsetBeat - b.onsetBeat);
    const roles = uniqueRoles(targets);
    const policy: AnswerPolicy = roles.length > 0 ? { kind: "roles", requiredRoles: roles, octaveFree: true } : { kind: "pitchClass" };
    const names = noteList(targets, occurrence.chord);
    const step: ExerciseStep = {
      id: `step-${steps.length + 1}`,
      occurrenceId: occurrence.occurrenceId,
      prompt: `Play ${occurrence.symbol}${names ? `: ${names}` : ""}.`,
      targets,
      policy,
      hints: [
        `Chord: ${occurrence.symbol}.`,
        roles.length > 0 ? `Include the ${roles.join(", ")}; any octave or inversion is fine.` : "Any octave is fine.",
        `Notes as written: ${names}.`
      ]
    };
    if (occurrence.chord) {
      step.chord = occurrence.chord;
    }
    steps.push(step);
  });
  return steps;
}

/** "Practise the current progression": the material's timeline with one step per chord. */
export function materialPracticePayload(timeline: PerformanceTimeline, title?: string): PracticePayload {
  return {
    timeline,
    steps: stepsFromTimeline(timeline),
    exerciseId: `material:${timeline.sourceId}`,
    title: title && title.trim() !== "" ? `Practise: ${title}` : "Practise the current progression"
  };
}

/** An ExerciseDefinition for a request that came without one (Explore payloads, material). */
export function exerciseFromPayload(payload: PracticePayload): ExerciseDefinition {
  const timeline = payload.timeline;
  const steps = payload.steps && payload.steps.length > 0 ? payload.steps : stepsFromTimeline(timeline);
  const policy: AnswerPolicy = steps.length > 0 ? steps[0].policy : { kind: "exactVoicing" };
  const beatsPerBar = Math.max(1, Math.round((timeline.timeSignature.numerator * 4) / Math.max(1, timeline.timeSignature.denominator)));
  return {
    id: payload.exerciseId ?? timeline.id,
    version: timeline.sourceVersion,
    title: payload.title,
    objective: "",
    conceptIds: [],
    prerequisites: [],
    contract: policy.kind === "free" ? "exploreReflect" : policy.kind === "roles" ? "satisfyConstraints" : "reproduce",
    timeline,
    steps,
    policy,
    timing: { mode: "step", onsetWindowMs: 120, countInBeats: timeline.countInBeats ?? beatsPerBar, assemblyWindowMs: 80 },
    demand: "beginner",
    status: "draft"
  };
}

// ---------------------------------------------------------------------------
// Modes, regions
// ---------------------------------------------------------------------------

function hasTargets(exercise: ExerciseDefinition): boolean {
  return exercise.steps.some((step) => step.targets.length > 0);
}

/** Modes allowed by the exercise's policy/contract. Listen is always possible. */
export function allowedModes(exercise: ExerciseDefinition): PracticeModeKind[] {
  if (exercise.policy.kind === "listen") {
    return ["listen"];
  }
  if (exercise.policy.kind === "free" || exercise.contract === "exploreReflect" || !hasTargets(exercise)) {
    return ["listen", "free"];
  }
  return ["listen", "step", "timed", "free"];
}

/** The requested mode when allowed; otherwise the exercise's natural first mode. */
export function defaultMode(exercise: ExerciseDefinition, requested?: PracticeModeKind): PracticeModeKind {
  const allowed = allowedModes(exercise);
  if (requested && allowed.includes(requested)) {
    return requested;
  }
  if (allowed.length === 1) {
    return allowed[0];
  }
  if (!allowed.includes("step")) {
    return "free";
  }
  return exercise.timing.mode === "timed" ? "timed" : "step";
}

const EPSILON = 1e-6;

/** Steps whose occurrence starts inside the region (the timeline is kept for playback). */
export function exerciseForRegion(exercise: ExerciseDefinition, region: PracticeLoopRegion | null): ExerciseDefinition {
  if (!region) {
    return exercise;
  }
  const starts = new Map<string, number>();
  exercise.timeline.occurrences.forEach((occurrence) => starts.set(occurrence.occurrenceId, occurrence.startBeat));
  const ids = region.occurrenceIds && region.occurrenceIds.length > 0 ? new Set(region.occurrenceIds) : null;
  const steps = exercise.steps.filter((step) => {
    if (ids) {
      return ids.has(step.occurrenceId);
    }
    const start = starts.get(step.occurrenceId);
    return start !== undefined && start >= region.startBeat - EPSILON && start < region.endBeat - EPSILON;
  });
  if (steps.length === 0 || steps.length === exercise.steps.length) {
    return exercise;
  }
  return { ...exercise, steps };
}
