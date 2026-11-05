/**
 * Intermediate authoring formats for repository-authored learning content (plan E16).
 *
 * Content here is data-only: chord symbols are plain strings, pitches are MIDI numbers,
 * and keys are SpelledPitchClass values. Later modules (music model, voicing, timeline,
 * practice) resolve and compile these specs into `ExerciseDefinition` and
 * `PerformanceTimeline` values; nothing in src/content depends on those modules.
 */
import type {
  AnswerPolicy,
  ArrangementDefinition,
  AssessmentContract,
  ChordRole,
  ConceptDefinition,
  ContentMeta,
  ContentStatus,
  DegreeLabel,
  Demand,
  Hand,
  InputSource,
  LearningPath,
  PracticeRoutine,
  ScaleId,
  SongChart,
  SpelledPitchClass,
  TimeSignatureSpec,
  TimingPolicy,
} from "@/model/contracts";

// ---------------------------------------------------------------------------
// Exercise material
// ---------------------------------------------------------------------------

/** One authored note inside an explicit-notes step. */
export interface AuthoredNote {
  midi: number;
  degree?: DegreeLabel;
  role?: ChordRole;
  hand?: Hand;
  /** Fingering is display-gated by review status; see AUTHORING.md. */
  finger?: number;
}

/**
 * One explicit-notes step. All notes in a step sound together (a chord attack).
 * `notes: []` denotes a rest of `durationBeats` (no learner target).
 */
export interface ExplicitNotesStep {
  prompt: string;
  notes: AuthoredNote[];
  /** Harmony the step is heard against; informational, resolved later. */
  chordSymbol?: string;
  durationBeats: number;
}

export interface ChordSequenceMaterial {
  kind: "chordSequence";
  /** One symbol per event, in order. */
  symbols: string[];
  /** One duration per symbol; omitted means one 4/4 bar (4 beats) each. */
  durationsBeats?: number[];
  /** Voicing recipe used to realise the symbols; see KNOWN_VOICING_RECIPE_IDS. */
  voicingRecipeId?: string;
}

export interface ExplicitNotesMaterial {
  kind: "explicitNotes";
  steps: ExplicitNotesStep[];
}

export interface ScaleRunMaterial {
  kind: "scaleRun";
  tonic: SpelledPitchClass;
  scale: ScaleId;
  /** Pattern recipe id; see KNOWN_PATTERN_IDS. */
  patternId: string;
  /** Scientific-pitch octave of the starting tonic (4 = middle-C octave). */
  startOctave: number;
  octaves: number;
  hand: Hand;
}

export interface SingleNotesMaterial {
  kind: "singleNotes";
  prompts: { label: string; midi: number }[];
}

export type ExerciseMaterial = ChordSequenceMaterial | ExplicitNotesMaterial | ScaleRunMaterial | SingleNotesMaterial;

// ---------------------------------------------------------------------------
// Exercise spec (compiled to ExerciseDefinition by the practice module)
// ---------------------------------------------------------------------------

export interface ExerciseSpec {
  id: string;
  version: number;
  title: string;
  objective: string;
  conceptIds: string[];
  /** Concept or exercise IDs that should be met first. */
  prerequisites: string[];
  contract: AssessmentContract;
  demand: Demand;
  status: ContentStatus;
  key?: { tonic: SpelledPitchClass; mode: ScaleId };
  tempoBpm: number;
  timeSignature: TimeSignatureSpec;
  timing: TimingPolicy;
  policy: AnswerPolicy;
  material: ExerciseMaterial;
  /** Ordered from vaguest to most specific (at least three rungs for shipped items). */
  hintLadder: string[];
  transferKeys?: SpelledPitchClass[];
  application?: { label: string; chartId?: string; conceptId?: string };
  /** Short teaching notes shown with the exercise (e.g. accompaniment bass context). */
  explanation?: string[];
  /** Melody fixture used by harmonisation exercises. */
  melodyId?: string;
  /** Exercise this one is a variant of (timed variant, transfer key ...). */
  variantOf?: string;
  /** Explicit input suitability; omitted = derived (see `supportedInputsFor`). */
  supportedInputs?: InputSource[];
  tags?: string[];
  author?: string;
  reviewer?: string;
}

// ---------------------------------------------------------------------------
// Warm-ups (technique) — guidance is authored, never measured
// ---------------------------------------------------------------------------

/** Observations that MIDI input can actually measure. */
export type MeasuredObservationKind = "timingSpread" | "velocityConsistency" | "releaseOverlap" | "handSynchrony";

export interface WarmupStep {
  notes: AuthoredNote[];
  durationBeats: number;
}

export interface WarmupSpec {
  id: string;
  version: number;
  title: string;
  objective: string;
  conceptIds: string[];
  demand: Demand;
  status: ContentStatus;
  tempoBpm: number;
  timeSignature: TimeSignatureSpec;
  hands: Hand;
  steps: WarmupStep[];
  /** Pianist review of pattern, hand span and fingering. False = show no fingering. */
  reviewed: boolean;
  /**
   * How notes are attributed to hands. MIDI does not report which hand played a note, so
   * attribution is an explicit task assumption (or omitted).
   */
  handAttribution: { kind: "none" } | { kind: "registerSplit"; splitMidi: number; note: string };
  /** Authored guidance (fingering, relaxation, posture). Not observed by MIDI. */
  guidance: { kind: "authoredGuidance"; text: string[] };
  /** What feedback may report after the warm-up. */
  measuredObservations: MeasuredObservationKind[];
  variations?: { label: string; guidance: string }[];
  transferKeys?: SpelledPitchClass[];
  author?: string;
  reviewer?: string;
}

// ---------------------------------------------------------------------------
// Harmonisation melodies (E29)
// ---------------------------------------------------------------------------

export interface MelodyNote {
  midi: number;
  startBeat: number;
  durationBeats: number;
  degree?: DegreeLabel;
}

export interface MelodySolution {
  id: string;
  label: string;
  /** One chord per harmonic-rhythm slot; every chord must be in the palette. */
  chords: string[];
  explanation: string[];
}

export interface MelodySpec {
  id: string;
  version: number;
  status: ContentStatus;
  title: string;
  key: { tonic: SpelledPitchClass; mode: ScaleId };
  timeSignature: TimeSignatureSpec;
  notes: MelodyNote[];
  harmonicRhythmBeats: number;
  palette: string[];
  solutions: MelodySolution[];
  assumptions: string[];
  conceptIds: string[];
  author?: string;
  reviewer?: string;
}

// ---------------------------------------------------------------------------
// Bundle
// ---------------------------------------------------------------------------

export interface ContentBundle {
  concepts: ConceptDefinition[];
  paths: LearningPath[];
  exerciseSpecs: ExerciseSpec[];
  charts: SongChart[];
  arrangements: ArrangementDefinition[];
  routines: PracticeRoutine[];
  warmups: WarmupSpec[];
  melodies: MelodySpec[];
}

export type ContentKind = "concept" | "path" | "exercise" | "chart" | "arrangement" | "routine" | "warmup" | "melody";

// ---------------------------------------------------------------------------
// IDs other modules must implement
// ---------------------------------------------------------------------------

/**
 * Voicing recipe IDs referenced by content. The voicing module must implement these
 * exact IDs. Semantics expected by the content:
 * - "close-triads-rh": right-hand close-position triad near C4; for a slash chord with no
 *   accompaniment bass, the slash bass is the lowest learner note (i.e. an inversion).
 * - "close-sevenths-rh": right-hand close-position four-note seventh chord near C4.
 * - "shell-137": root + 3rd + 7th (fifth omitted), roughly C3–C4, one hand.
 * - "guide-tones-37": 3rd + 7th only, smooth movement, roughly E3–C5; root comes from accompaniment.
 * - "rootless-a": four-note rootless voicing with 3 (or 7) at the bottom, colour tones 9/13,
 *   register roughly D3–F4; root comes from accompaniment bass.
 */
export const KNOWN_VOICING_RECIPE_IDS: string[] = [
  "close-triads-rh",
  "close-sevenths-rh",
  "shell-137",
  "guide-tones-37",
  "rootless-a",
];

/**
 * Scale pattern recipe IDs referenced by content (PatternRecipe.id).
 * - "run-one-octave": ascending then descending through the scale over `octaves`, tonic to tonic.
 * - "thirds-one-octave": ascending diatonic thirds (1-3, 2-4, 3-5 ...) up to the top tonic.
 */
export const KNOWN_PATTERN_IDS: string[] = ["run-one-octave", "thirds-one-octave"];

export const CONTENT_DRAFT_AUTHOR: string = "Studio content draft";

/** Default meta for unreviewed, repository-authored content. */
export function draftMeta(version: number = 1): ContentMeta {
  return { version, status: "draft", author: CONTENT_DRAFT_AUTHOR, license: "Original content for this repository" };
}

/** Default input suitability (simple, transparent heuristic documented in AUTHORING.md). */
export function supportedInputsFor(spec: ExerciseSpec): InputSource[] {
  if (spec.supportedInputs) return spec.supportedInputs;
  const all: InputSource[] = ["midi", "computerKeyboard", "touch"];
  if (spec.policy.kind === "listen") return all;
  const maxSimultaneous = maxSimultaneousNotes(spec.material);
  // Timed chord attacks on a computer keyboard or touch screen are unreliable (key rollover,
  // multi-touch limits), so timed chord work is MIDI-only by default.
  if (spec.timing.mode === "timed" && maxSimultaneous >= 3) return ["midi"];
  return all;
}

/** Largest number of notes that sound together in the material (chords: estimated). */
export function maxSimultaneousNotes(material: ExerciseMaterial): number {
  switch (material.kind) {
    case "singleNotes":
    case "scaleRun":
      return 1;
    case "explicitNotes": {
      let max = 0;
      for (const step of material.steps) max = Math.max(max, step.notes.length);
      return max;
    }
    case "chordSequence":
      return material.voicingRecipeId === "guide-tones-37" ? 2 : 3;
  }
}

// Spelled pitch-class shorthands for authored content.
export type PcName = "C" | "D" | "E" | "F" | "G" | "A" | "B" | "Bb" | "Eb";
export const PC: Record<PcName, SpelledPitchClass> = {
  C: { letter: "C", accidental: 0 },
  D: { letter: "D", accidental: 0 },
  E: { letter: "E", accidental: 0 },
  F: { letter: "F", accidental: 0 },
  G: { letter: "G", accidental: 0 },
  A: { letter: "A", accidental: 0 },
  B: { letter: "B", accidental: 0 },
  Bb: { letter: "B", accidental: -1 },
  Eb: { letter: "E", accidental: -1 },
};

export const FOUR_FOUR: TimeSignatureSpec = { numerator: 4, denominator: 4 };
