/**
 * Shared musical, session, timing, practice, and content contracts (plan §4 / E03).
 *
 * These are the stable types every module builds against. Core theory, timing, and
 * evaluation modules are deterministic TypeScript with no React dependency.
 *
 * Conventions
 * - Pitch: MIDI note numbers follow C4 = 60. Spelled notes carry letter + accidental so
 *   that enharmonic meaning is never lost (E♭ is not D♯ in a Cm chord).
 * - Time: authored musical time is measured in quarter-note *beats* from the start of a
 *   sequence/timeline (number, fractional allowed). Real-time scheduling derives seconds
 *   from beats via the tempo; the renderer reads the transport, never the reverse.
 * - Identity: sequence events, performed notes, and performance occurrences all carry
 *   stable string IDs so audio, visuals, export, and assessment refer to the same thing.
 * - Nothing here silently mutates pitch class to satisfy a constraint; engines return an
 *   explicit "no valid result" with a reason instead.
 */

// ---------------------------------------------------------------------------
// Spelled pitch and intervals
// ---------------------------------------------------------------------------

export type Letter = "C" | "D" | "E" | "F" | "G" | "A" | "B";

/** -2 = double flat, -1 = flat, 0 = natural, 1 = sharp, 2 = double sharp. */
export type Accidental = -2 | -1 | 0 | 1 | 2;

export interface SpelledPitchClass {
  letter: Letter;
  accidental: Accidental;
}

/** Scientific pitch notation; octave 4 contains middle C (MIDI 60). */
export interface SpelledNote extends SpelledPitchClass {
  octave: number;
}

export type IntervalQuality = "P" | "M" | "m" | "A" | "d" | "AA" | "dd";

/** Diatonic interval: number is 1-based (1 = unison, 3 = third, 9 = ninth, 13 = thirteenth). */
export interface Interval {
  number: number;
  quality: IntervalQuality;
}

/** Degree label as written in chord/scale teaching: "1", "b3", "3", "5", "#5", "b7", "7", "9", "b9", "#11", "13" ... */
export type DegreeLabel = string;

// ---------------------------------------------------------------------------
// Scales, modes, keys
// ---------------------------------------------------------------------------

export type ScaleId =
  | "major"
  | "naturalMinor"
  | "harmonicMinor"
  | "melodicMinor"
  | "ionian"
  | "dorian"
  | "phrygian"
  | "lydian"
  | "mixolydian"
  | "aeolian"
  | "locrian"
  | "majorPentatonic"
  | "minorPentatonic"
  | "blues"
  | "chromatic";

export interface ScaleDegree {
  label: DegreeLabel;
  interval: Interval;
  /** Semitones above the tonic, 0..11 for one octave. */
  semitones: number;
}

export interface ScaleDefinition {
  id: ScaleId;
  name: string;
  /** Tonic-relative spelled degrees in ascending order starting at "1". */
  degrees: ScaleDegree[];
  /** Degrees that distinguish this scale from its nearest comparison (e.g. Dorian: "6"). */
  characteristicDegrees?: DegreeLabel[];
  /** Relative relationship, e.g. dorian = major rotated from degree 2. Explanatory only. */
  relativeTo?: { scale: ScaleId; degree: number };
  description?: string;
}

export interface KeyContext {
  tonic: SpelledPitchClass;
  mode: ScaleId;
}

/** An ordered/rhythmic pattern over a scale, stored separately from the pitch collection. */
export interface PatternStep {
  /** 0-based index into the scale's degrees. */
  degreeIndex: number;
  /** Octave offset relative to the pattern's starting octave. */
  octaveOffset: number;
  /** Optional per-step duration override in beats. */
  durationBeats?: number;
}

export interface PatternRecipe {
  id: string;
  name: string;
  description?: string;
  steps: PatternStep[];
  /** Default duration of a step in beats when a step does not override it. */
  beatsPerStep: number;
  direction: "up" | "down" | "upDown";
  octaves: number;
  hand: Hand;
  /** Reviewed fingering keyed by `${tonicLetter}${accidental}:${scaleId}` — omitted means unreviewed. */
  reviewedFingerings?: Record<string, number[]>;
  reviewed: boolean;
}

// ---------------------------------------------------------------------------
// Chords
// ---------------------------------------------------------------------------

export type ChordQualityId =
  | "maj"
  | "min"
  | "dim"
  | "aug"
  | "sus2"
  | "sus4"
  | "power"
  | "maj6"
  | "min6"
  | "dom7"
  | "maj7"
  | "min7"
  | "minMaj7"
  | "dim7"
  | "halfDim7"
  | "dom9"
  | "maj9"
  | "min9"
  | "dom11"
  | "maj11"
  | "min11"
  | "dom13"
  | "maj13"
  | "min13";

export type ChordRole =
  | "root"
  | "third"
  | "fifth"
  | "sixth"
  | "seventh"
  | "ninth"
  | "eleventh"
  | "thirteenth"
  | "suspension"
  | "added";

export interface ChordDegree {
  label: DegreeLabel;
  interval: Interval;
  /** Semitones above the root (may exceed 12 for extensions). */
  semitones: number;
  role: ChordRole;
  /** Whether omitting this tone changes the chord's identity (third/seventh generally do). */
  essential: boolean;
}

export interface ChordDefinition {
  /** The symbol as written by the user/author (e.g. "Dm9", "G13", "C/E"). */
  symbol: string;
  root: SpelledPitchClass;
  quality: ChordQualityId;
  qualityLabel: string;
  /** All spelled chord tones from the root upward, including extensions/alterations/added tones. */
  degrees: ChordDegree[];
  /** Explicit slash bass when written. Absent means the root is the intended bass. */
  bass?: SpelledPitchClass;
  extensions: DegreeLabel[];
  alterations: DegreeLabel[];
  added: DegreeLabel[];
}

export type HarmonicFunction = "tonic" | "predominant" | "dominant" | "secondary" | "substitute" | "passing" | "other";
export type StyleId = "generic" | "classical" | "pop" | "blues" | "jazz";

export interface HarmonicContext {
  key?: KeyContext;
  romanNumeral?: string;
  function?: HarmonicFunction;
  style?: StyleId;
  /** Free-text assumption shown to the learner (e.g. "ii–V–I in C, jazz comping"). */
  assumption?: string;
}

// ---------------------------------------------------------------------------
// Voicings
// ---------------------------------------------------------------------------

export type Hand = "left" | "right" | "either" | "both";

export type VoicingFamilyId =
  | "close"
  | "open"
  | "shell"
  | "guideTone"
  | "rootless"
  | "drop2"
  | "quartal"
  | "upperStructure";

export interface VoicingRecipe {
  id: string;
  family: VoicingFamilyId;
  name: string;
  description: string;
  supportedQualities: ChordQualityId[];
  requiredRoles: ChordRole[];
  optionalRoles: ChordRole[];
  /** Roles this recipe deliberately leaves out (e.g. rootless omits root, shell omits fifth). */
  omittedRoles: ChordRole[];
  hand: Hand;
  noteCount: { min: number; max: number };
  /** Default register in MIDI numbers for the learner part. */
  register: { low: number; high: number };
  maxSpanSemitones?: number;
  /** Whether the recipe expects an accompaniment bass note (root) played by another part. */
  accompanimentBass: boolean;
  teachingNotes?: string;
  reviewed: boolean;
  /** Applicable style/tradition. Naming differs between traditions; be explicit. */
  context?: StyleId[];
}

export interface VoicingConstraints {
  minMidi?: number;
  maxMidi?: number;
  /** Fix the top note to this MIDI pitch (melody lock). */
  melodyMidi?: number;
  /** Fix the lowest learner note to this MIDI pitch (bass lock). */
  bassMidi?: number;
  maxSpanSemitones?: number;
  hand?: Hand;
  noteCount?: { min: number; max: number };
  /** Previous voicing for continuity ranking. */
  previous?: VoicingInstance;
}

export interface VoicedNote {
  midi: number;
  spelled: SpelledNote;
  degree: DegreeLabel;
  role: ChordRole;
  hand: Hand;
  /** Stable voice identity within a progression ("v1" = lowest .. "vN"). */
  voiceId: string;
  /** Reviewed fingering only; undefined means not provided. */
  finger?: number;
}

export interface OmittedTone {
  role: ChordRole;
  degree: DegreeLabel;
  reason: string;
}

export interface VoicingInstance {
  id: string;
  chord: ChordDefinition;
  recipeId: string;
  notes: VoicedNote[];
  omitted: OmittedTone[];
  /** Optional accompaniment bass (root/slash bass) that is NOT part of the learner's answer. */
  accompanimentBass?: VoicedNote;
  /** Short human explanations: which degrees were chosen and why. */
  explanation: string[];
}

export type VoicingResult =
  | { ok: true; voicing: VoicingInstance; alternatives: VoicingInstance[] }
  | { ok: false; reason: string; details?: string[] };

export interface VoiceMovement {
  voiceId: string;
  fromMidi: number;
  toMidi: number;
  semitones: number;
  kind: "common" | "step" | "leap";
  fromDegree?: DegreeLabel;
  toDegree?: DegreeLabel;
}

export interface TransitionExplanation {
  movements: VoiceMovement[];
  commonTones: number;
  totalMotionSemitones: number;
  summary: string;
}

// ---------------------------------------------------------------------------
// Musical sequence (authored) and performance timeline (performed)
// ---------------------------------------------------------------------------

export interface TimeSignatureSpec {
  numerator: number;
  denominator: number;
}

export interface TempoSpec {
  bpm: number;
}

export interface SequenceEvent {
  id: string;
  index: number;
  kind: "chord" | "rest";
  /** Symbol as written; "NC" for rests. */
  symbol: string;
  chord?: ChordDefinition;
  startBeat: number;
  durationBeats: number;
  /** Chosen voicing recipe for this event; undefined = sequence default. */
  voicingRecipeId?: string;
  /** Concrete chosen voicing when already realised. */
  voicing?: VoicingInstance;
  context?: HarmonicContext;
  /** Line in the source text when the event came from chord text. */
  sourceLine?: number;
}

export interface MusicalSequence {
  id: string;
  /** Bumped on every edit so running attempts can detect stale material. */
  version: number;
  title?: string;
  tempo: TempoSpec;
  timeSignature: TimeSignatureSpec;
  key?: KeyContext;
  events: SequenceEvent[];
  totalBeats: number;
  /** Sequence-wide default voicing recipe. */
  defaultVoicingRecipeId?: string;
}

export type PartId = "learner" | "accompaniment" | "demonstration" | "metronome";

export interface PerformedNote {
  id: string;
  /** The sequence event (or chart occurrence) this note realises. */
  eventId: string;
  /** Unique per performance pass of an event; repeats yield distinct occurrence IDs. */
  occurrenceId: string;
  part: PartId;
  midi: number;
  spelled?: SpelledNote;
  degree?: DegreeLabel;
  role?: ChordRole;
  hand?: Hand;
  onsetBeat: number;
  durationBeats: number;
  /** 1..127 */
  velocity: number;
  channel?: number;
  finger?: number;
}

export interface PerformanceOccurrence {
  occurrenceId: string;
  eventId: string;
  /** Zero-based pass when the event is repeated (loop/repeat expansion). */
  passIndex: number;
  startBeat: number;
  durationBeats: number;
  symbol: string;
  chord?: ChordDefinition;
  /** Chart bar index when the occurrence came from a song chart. */
  sourceBarIndex?: number;
  sectionId?: string;
}

export interface PerformanceTimeline {
  id: string;
  sourceId: string;
  /** Version of the source material it was compiled from. */
  sourceVersion: number;
  tempo: TempoSpec;
  timeSignature: TimeSignatureSpec;
  notes: PerformedNote[];
  occurrences: PerformanceOccurrence[];
  totalBeats: number;
  arrangementId?: string;
  /** Beats of count-in before beat 0; notes never start before 0. */
  countInBeats?: number;
}

// ---------------------------------------------------------------------------
// Transport and clocks
// ---------------------------------------------------------------------------

export type TransportState = "stopped" | "countingIn" | "playing" | "paused";

/** Read-only snapshot consumed by renderers each frame. Renderers never schedule sound. */
export interface TransportSnapshot {
  state: TransportState;
  /** Current musical position in beats (negative during count-in). */
  positionBeats: number;
  positionSeconds: number;
  tempoBpm: number;
  totalBeats: number;
  loop?: { startBeat: number; endBeat: number } | null;
  /** Generation increments on every start/seek/stop; stale scheduled work must be ignored. */
  generation: number;
}

// ---------------------------------------------------------------------------
// Learner input
// ---------------------------------------------------------------------------

export type InputSource = "midi" | "computerKeyboard" | "touch" | "replay";

export type InputEventType = "noteOn" | "noteOff" | "sustain" | "sostenuto" | "soft" | "allNotesOff" | "connection";

export interface InputEvent {
  source: InputSource;
  type: InputEventType;
  /** High-resolution timestamp on the performance clock (ms). */
  timestampMs: number;
  portId?: string;
  portName?: string;
  channel?: number;
  midi?: number;
  /** 1..127 for noteOn; noteOn with velocity 0 is normalised to noteOff before dispatch. */
  velocity?: number;
  /** Pedal/controller value 0..127. */
  value?: number;
  connected?: boolean;
}

export interface HeldStateSnapshot {
  /** Physically pressed keys. */
  pressed: number[];
  /** Keys released but still sounding because sustain is down. */
  sustained: number[];
  sustainDown: boolean;
  sostenutoDown: boolean;
  softDown: boolean;
}

// ---------------------------------------------------------------------------
// Exercises, assessment policies, attempts
// ---------------------------------------------------------------------------

export type AnswerPolicy =
  | { kind: "exactVoicing"; allowExtraNotes?: boolean }
  | { kind: "roles"; requiredRoles: ChordRole[]; optionalRoles?: ChordRole[]; allowExtraNotes?: boolean; octaveFree?: boolean }
  | { kind: "pitchClass"; allowExtraNotes?: boolean }
  | { kind: "listen" }
  | { kind: "free" };

export type AssessmentContract = "reproduce" | "satisfyConstraints" | "exploreReflect";

export interface TimingPolicy {
  mode: "step" | "timed";
  /** Accept onsets within ±window of the target. */
  onsetWindowMs?: number;
  countInBeats?: number;
  /** Notes played within this window are treated as one chord attack. */
  assemblyWindowMs?: number;
  /** Whether durations/releases are graded (default false). */
  gradeDuration?: boolean;
  /** Whether pedal-held notes count as still-held answers (default false). */
  sustainCounts?: boolean;
}

export interface ExerciseStep {
  id: string;
  occurrenceId: string;
  prompt: string;
  /** Learner-part notes expected for this step (from the exercise timeline). */
  targets: PerformedNote[];
  chord?: ChordDefinition;
  policy: AnswerPolicy;
  /** Ordered from vaguest to most specific. */
  hints: string[];
}

export interface ExerciseDefinition {
  id: string;
  version: number;
  title: string;
  objective: string;
  conceptIds: string[];
  prerequisites: string[];
  contract: AssessmentContract;
  timeline: PerformanceTimeline;
  steps: ExerciseStep[];
  policy: AnswerPolicy;
  timing: TimingPolicy;
  key?: KeyContext;
  /** Supported transposition targets for transfer tasks. */
  transferKeys?: SpelledPitchClass[];
  application?: { label: string; chartId?: string; conceptId?: string };
  demand: Demand;
  status: ContentStatus;
}

export interface PitchObservation {
  stepId: string;
  occurrenceId: string;
  expectedMidi: number[];
  playedMidi: number[];
  missingMidi: number[];
  extraMidi: number[];
  missingRoles: ChordRole[];
  correct: boolean;
  attempts: number;
  hintLevelUsed: number;
}

export interface TimingObservation {
  targetNoteId: string;
  occurrenceId: string;
  expectedOnsetMs: number;
  actualOnsetMs?: number;
  deltaMs?: number;
  verdict: "early" | "onTime" | "late" | "missed";
}

export type AttemptMode = "listen" | "assisted" | "step" | "timed" | "free";
export type AssistanceLevel = "full" | "reduced" | "none";

export interface NextAction {
  kind: "retrySlower" | "loopTransition" | "reduceHints" | "transpose" | "reviewConcept" | "continue";
  label: string;
  payload?: Record<string, unknown>;
}

export interface AttemptResult {
  id: string;
  exerciseId: string;
  exerciseVersion: number;
  scoringVersion: string;
  chartId?: string;
  arrangementId?: string;
  startedAt: string;
  completedAt?: string;
  mode: AttemptMode;
  inputSource: InputSource;
  assistance: AssistanceLevel;
  hintLevel: number;
  policy: AnswerPolicy;
  key?: KeyContext;
  tempoBpm?: number;
  latencyOffsetMs?: number;
  pitch: PitchObservation[];
  timing: TimingObservation[];
  /** Free text from the learner; never mixed into measured results. */
  selfAssessment?: string;
  summary: {
    stepsCompleted: number;
    stepsTotal: number;
    pitchCorrectRatio?: number;
    onsetsWithinWindowRatio?: number;
    difficultOccurrenceIds: string[];
  };
  nextAction?: NextAction;
}

// ---------------------------------------------------------------------------
// Content: concepts, paths, charts, arrangements, routines
// ---------------------------------------------------------------------------

export type Demand = "beginner" | "intermediate" | "advanced";
export type ContentStatus = "reviewed" | "draft" | "unavailable" | "deferred";
export type Strand = "keyboardReadingRhythm" | "scalesModes" | "harmonyVoicing" | "technique" | "listeningCreativity" | "songsApplication";

export interface ContentMeta {
  version: number;
  status: ContentStatus;
  author?: string;
  reviewer?: string;
  sources?: { title: string; url?: string }[];
  license?: string;
}

export interface ConceptExample {
  id: string;
  label: string;
  kind: "chord" | "scale" | "progression" | "comparison" | "melody";
  /** Chord symbols (one per event) or a single chord for "chord"; durations default to 1 bar. */
  symbols?: string[];
  /** Explicit MIDI notes for a scale/melody example. */
  midi?: number[];
  scale?: { tonic: SpelledPitchClass; scale: ScaleId };
  labels?: DegreeLabel[];
  /** For comparisons: the example this one is heard against (same tonic). */
  compareWith?: string;
  description?: string;
}

export interface ConceptDefinition {
  id: string;
  title: string;
  summary: string;
  /** Short explanation paragraphs. */
  explanation: string[];
  strand: Strand;
  demand: Demand[];
  tags: string[];
  prerequisites: string[];
  examples: ConceptExample[];
  exerciseIds: string[];
  applications: { label: string; chartId?: string; exerciseId?: string; conceptId?: string }[];
  related: string[];
  glossary?: { term: string; definition: string }[];
  furtherReading?: { title: string; url: string }[];
  meta: ContentMeta;
}

export interface LearningPath {
  id: string;
  title: string;
  description: string;
  entry: Demand;
  /** Ordered units: concept pages and exercises. */
  units: { kind: "concept" | "exercise" | "chart" | "routine"; id: string }[];
  meta: ContentMeta;
}

export interface ChordSpan {
  id: string;
  symbol: string;
  /** Beats within the bar (0-based) and duration in beats. */
  startBeat: number;
  durationBeats: number;
  isRest?: boolean;
  romanNumeral?: string;
}

export interface ChartBar {
  id: string;
  spans: ChordSpan[];
  /** Pickup bars may be shorter than the meter. */
  beats?: number;
}

export interface ChartSection {
  id: string;
  label: string;
  bars: ChartBar[];
  /** How many times the section is written to play (v1 expands repeats explicitly). */
  repeat?: number;
}

export interface SongChart {
  id: string;
  version: number;
  title: string;
  composer?: string;
  key?: KeyContext;
  timeSignature: TimeSignatureSpec;
  tempo: TempoSpec;
  sections: ChartSection[];
  /** Explicit performance order of section IDs (e.g. ["A","A","B","A"]). */
  performanceOrder: string[];
  pickupBeats?: number;
  provenance: { origin: "original" | "userImport" | "cleared"; author?: string; note?: string };
  arrangementIds: string[];
  meta: ContentMeta;
}

export type AccompanimentPatternId = "sustained" | "bassAndChord" | "rootOnly" | "none";

export interface ArrangementDefinition {
  id: string;
  chartId: string;
  name: string;
  description: string;
  demand: Demand;
  /** What the learner plays. */
  learnerPart: {
    kind: "roots" | "blockTriads" | "voicingRecipe" | "explicit" | "chartOnly";
    voicingRecipeId?: string;
    hand?: Hand;
    register?: { low: number; high: number };
    /** For "explicit" arrangements: authored notes keyed by span id. */
    explicitNotes?: Record<string, { midi: number; degree?: DegreeLabel; role?: ChordRole; hand?: Hand; finger?: number }[]>;
  };
  accompaniment: { pattern: AccompanimentPatternId; register?: { low: number; high: number } };
  /** Default assessment for play-along; "free" means chart-only, unscored. */
  policy: AnswerPolicy;
  meta: ContentMeta;
}

export interface RoutineItem {
  id: string;
  kind: "exercise" | "chart" | "concept" | "warmup";
  refId: string;
  settings: {
    key?: SpelledPitchClass;
    tempoBpm?: number;
    hand?: Hand;
    range?: { low: number; high: number };
    repeats?: number;
    assistance?: AssistanceLevel;
    sectionId?: string;
    durationTargetSec?: number;
  };
}

export interface PracticeRoutine {
  id: string;
  version: number;
  title: string;
  description?: string;
  items: RoutineItem[];
  meta: ContentMeta;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export const PROJECT_SCHEMA_VERSION = 1;
export const PROGRESS_SCHEMA_VERSION = 1;

export interface ProjectFile {
  schemaVersion: number;
  kind: "project";
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  sequence: MusicalSequence;
  /** Original chord text when the project was authored as text. */
  sourceText?: string;
  settings?: Record<string, unknown>;
}

export interface ProgressEvidence {
  kind: "read" | "listened" | "assisted" | "independent" | "transfer";
  conceptId?: string;
  exerciseId?: string;
  chartId?: string;
  routineId?: string;
  attemptId?: string;
  key?: KeyContext;
  tempoBpm?: number;
  hand?: Hand;
  policy?: AnswerPolicy["kind"];
  assistance?: AssistanceLevel;
  at: string;
}

export interface ProgressFile {
  schemaVersion: number;
  kind: "progress";
  attempts: AttemptResult[];
  evidence: ProgressEvidence[];
  routineState: Record<string, { itemIndex: number; updatedAt: string; completedItemIds: string[] }>;
  goals: string[];
  updatedAt: string;
}
