/**
 * Learn catalogue logic (plan E31): search/filter model, entry-route recommendation, concept
 * example → audition/piano mapping, policy labels and progress markers. React-free and tested.
 */
import type {
  AnswerPolicy,
  ChordDefinition,
  ChordRole,
  ConceptDefinition,
  ConceptExample,
  ContentStatus,
  Demand,
  PerformanceTimeline,
  ProgressEvidence,
  ScaleId,
  Strand
} from "@/model/contracts";
import { contentBundle, searchContent } from "@/content";
import type { ContentBundle, SearchFilters, SearchResult } from "@/content";
import { chordTones, slashBassNote, tryChordFromSymbol } from "@/music/chords";
import { formatSpelledNote, midiOf, noteFromMidi, pitchClassOf } from "@/music/pitch";
import { scaleNotes } from "@/music/scales";
import { modeComparison } from "@/scalelab/compare";
import type { AuditionNote } from "@/ui/runtime/runtimeHelpers";

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export const STRAND_LABELS: Record<Strand, string> = {
  keyboardReadingRhythm: "Keyboard, reading and rhythm",
  scalesModes: "Scales and modes",
  harmonyVoicing: "Harmony and voicing",
  technique: "Warm-ups and technique",
  listeningCreativity: "Listening and creativity",
  songsApplication: "Songs and application"
};

export const STRAND_ORDER: readonly Strand[] = ["keyboardReadingRhythm", "scalesModes", "harmonyVoicing", "technique", "listeningCreativity", "songsApplication"];

export const DEMAND_LABELS: Record<Demand, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced"
};

export const STATUS_LABELS: Record<ContentStatus, string> = {
  reviewed: "Reviewed",
  draft: "Draft",
  unavailable: "Unavailable",
  deferred: "Coming later"
};

export const KIND_LABELS: Record<string, string> = {
  concept: "Concept",
  path: "Path",
  exercise: "Exercise",
  chart: "Song",
  routine: "Routine",
  warmup: "Warm-up",
  arrangement: "Arrangement",
  melody: "Melody"
};

const ROLE_SHORT: Record<ChordRole, string> = {
  root: "root",
  third: "3",
  fifth: "5",
  sixth: "6",
  seventh: "7",
  ninth: "9",
  eleventh: "11",
  thirteenth: "13",
  suspension: "sus",
  added: "added"
};

/** "root, 3 and 5" */
export function roleList(roles: readonly ChordRole[]): string {
  const names = roles.map((role: ChordRole) => ROLE_SHORT[role] ?? role);
  if (names.length === 0) return "none";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Short label of an answer policy, as shown on exercise and arrangement cards. */
export function policyLabel(policy: AnswerPolicy): string {
  switch (policy.kind) {
    case "exactVoicing":
      return "Exact notes";
    case "roles":
      return "Required chord roles, your voicing";
    case "pitchClass":
      return "Right notes, any octave";
    case "listen":
      return "Listen only — not scored";
    case "free":
      return "Chart only — not scored";
  }
}

/** One sentence explaining what the policy checks. */
export function policyExplanation(policy: AnswerPolicy): string {
  switch (policy.kind) {
    case "exactVoicing":
      return `The exact keys shown are checked${policy.allowExtraNotes ? "; extra notes are tolerated" : ""}.`;
    case "roles": {
      const optional = policy.optionalRoles && policy.optionalRoles.length > 0 ? ` Optional: ${roleList(policy.optionalRoles)}.` : "";
      return `Your chord must contain ${roleList(policy.requiredRoles)}${policy.octaveFree ? " in any octave or inversion" : ""}; how you voice it is up to you.${optional}`;
    }
    case "pitchClass":
      return "The right note names are checked in any octave.";
    case "listen":
      return "Listen and compare; nothing is played or scored.";
    case "free":
      return "Play freely from the chord symbols; nothing is scored and silence is never a missed note.";
  }
}

// ---------------------------------------------------------------------------
// Catalogue search and filters
// ---------------------------------------------------------------------------

export type InputFilter = "any" | "none" | "computerKeyboard" | "midi";

export const INPUT_FILTER_LABELS: Record<InputFilter, string> = {
  any: "Any input",
  none: "No keyboard (read and listen)",
  computerKeyboard: "Computer keyboard",
  midi: "MIDI keyboard"
};

export interface LearnFilters {
  query: string;
  demand: Demand | "all";
  strand: Strand | "all";
  input: InputFilter;
  /** Include draft (not yet pianist-reviewed) items, flagged with a badge. */
  showDrafts: boolean;
}

export const DEFAULT_LEARN_FILTERS: LearnFilters = { query: "", demand: "all", strand: "all", input: "any", showDrafts: true };

export interface CatalogueGroup {
  key: string;
  label: string;
  items: SearchResult[];
}

export interface CatalogueView {
  groups: CatalogueGroup[];
  /** Unavailable/deferred items: shown only in a collapsed "Coming later" list, never as lessons. */
  comingLater: SearchResult[];
  total: number;
  /** Draft items hidden because `showDrafts` is off. */
  hiddenDrafts: number;
}

const LISTED_KINDS: SearchFilters["kinds"] = ["concept", "path", "exercise", "chart", "routine", "warmup"];

function baseFilters(filters: LearnFilters): SearchFilters {
  const out: SearchFilters = { kinds: LISTED_KINDS };
  if (filters.demand !== "all") out.demand = filters.demand;
  if (filters.strand !== "all") out.strand = filters.strand;
  if (filters.input !== "any") out.inputAvailable = filters.input;
  return out;
}

function groupKey(result: SearchResult): string {
  if (result.kind === "path") return "paths";
  if (result.kind === "routine") return "routines";
  return result.strand ?? "other";
}

function groupLabel(key: string): string {
  if (key === "paths") return "Learning paths";
  if (key === "routines") return "Practice routines";
  if (key === "other") return "Other";
  return STRAND_LABELS[key as Strand] ?? key;
}

const GROUP_ORDER: readonly string[] = ["paths", ...STRAND_ORDER, "routines", "other"];

/** Search + filter the catalogue and group the results by strand. */
export function buildCatalogue(filters: LearnFilters, bundle: ContentBundle = contentBundle): CatalogueView {
  const base = baseFilters(filters);
  const statuses: ContentStatus[] = filters.showDrafts ? ["reviewed", "draft"] : ["reviewed"];
  const results = searchContent(filters.query, { ...base, status: statuses }, bundle);
  const hiddenDrafts = filters.showDrafts ? 0 : searchContent(filters.query, { ...base, status: "draft" }, bundle).length;
  const later = searchContent(filters.query, { ...base, status: ["unavailable", "deferred"] }, bundle);
  const byKey = new Map<string, SearchResult[]>();
  results.forEach((result: SearchResult) => {
    const key = groupKey(result);
    const list = byKey.get(key) ?? [];
    list.push(result);
    byKey.set(key, list);
  });
  const groups: CatalogueGroup[] = [];
  GROUP_ORDER.forEach((key: string) => {
    const items = byKey.get(key);
    if (items && items.length > 0) groups.push({ key, label: groupLabel(key), items });
  });
  return { groups, comingLater: later, total: results.length, hiddenDrafts };
}

// ---------------------------------------------------------------------------
// Entry routes and the self-selection flow
// ---------------------------------------------------------------------------

export type EntryRouteId = "starting" | "connectTheory" | "voicings";

export interface EntryRoute {
  id: EntryRouteId;
  pathId: string;
  title: string;
  blurb: string;
  demand: Demand;
}

export const ENTRY_ROUTES: readonly EntryRoute[] = [
  {
    id: "starting",
    pathId: "path-foundations",
    title: "I'm starting out",
    blurb: "Find notes, build triads, keep a pulse and play your first song.",
    demand: "beginner"
  },
  {
    id: "connectTheory",
    pathId: "path-harmony-scales",
    title: "I play and want to connect theory",
    blurb: "Modes, scale patterns, diatonic harmony and choosing chords for a melody.",
    demand: "intermediate"
  },
  {
    id: "voicings",
    pathId: "path-voicing-sampler",
    title: "I want better voicings",
    blurb: "Guide tones, rootless colour voicings, transfer to other keys.",
    demand: "advanced"
  }
];

export function routeById(id: EntryRouteId): EntryRoute {
  const found = ENTRY_ROUTES.find((route: EntryRoute) => route.id === id);
  return found ?? ENTRY_ROUTES[0];
}

export type SelfAnswer = "yes" | "no" | "unsure";

export interface SelfAssessment {
  findNotes: SelfAnswer | null;
  readSymbols: SelfAnswer | null;
  playTwoFiveOne: SelfAnswer | null;
}

export const EMPTY_SELF_ASSESSMENT: SelfAssessment = { findNotes: null, readSymbols: null, playTwoFiveOne: null };

export const SELF_QUESTIONS: readonly { key: keyof SelfAssessment; question: string }[] = [
  { key: "findNotes", question: "Can you find any note (say F or B♭) on the keyboard without counting keys?" },
  { key: "readSymbols", question: "Can you read chord symbols such as Am, G/B or Dm7 and play them?" },
  { key: "playTwoFiveOne", question: "Can you play a ii–V–I (such as Dm7–G7–Cmaj7) with sevenths?" }
];

export interface RouteRecommendation {
  routeId: EntryRouteId;
  pathId: string;
  /** Why this route is suggested, in plain words. */
  reasons: string[];
}

export const RECOMMENDATION_CAVEAT = "A suggestion from three answers, not a test of your ability — pick any route, and skip units you already know.";

/**
 * Recommend an entry route from the three self-selection answers. Questions are read in
 * order; the first answer that is not "yes" decides. Returns null while that answer is
 * still missing.
 */
export function recommendRoute(answers: SelfAssessment): RouteRecommendation | null {
  const findNotes = answers.findNotes;
  if (findNotes === null) return null;
  if (findNotes !== "yes") {
    return {
      routeId: "starting",
      pathId: routeById("starting").pathId,
      reasons: [
        findNotes === "no"
          ? "You said you can't find notes without counting yet; Foundations starts with the layout of the keyboard."
          : "You weren't sure about finding notes, so Foundations starts with keyboard geography — skip ahead once it feels easy."
      ]
    };
  }
  const readSymbols = answers.readSymbols;
  if (readSymbols === null) return null;
  if (readSymbols !== "yes") {
    return {
      routeId: "starting",
      pathId: routeById("starting").pathId,
      reasons: [
        "You can find notes, which covers the first Foundations units.",
        readSymbols === "no"
          ? "You said you can't read chord symbols yet; Foundations builds triads, inversions and slash chords before the harmony route."
          : "You weren't sure about chord symbols; the triad, inversion and slash-chord units in Foundations cover them."
      ]
    };
  }
  const twoFiveOne = answers.playTwoFiveOne;
  if (twoFiveOne === null) return null;
  if (twoFiveOne !== "yes") {
    return {
      routeId: "connectTheory",
      pathId: routeById("connectTheory").pathId,
      reasons: [
        "You can find notes and read chord symbols.",
        twoFiveOne === "no"
          ? "You haven't played a ii–V–I with sevenths yet; Harmony and scales builds sevenths and shell voicings on the way to it."
          : "You weren't sure about ii–V–I with sevenths; Harmony and scales covers sevenths and shells, along with modes and harmonisation."
      ]
    };
  }
  return {
    routeId: "voicings",
    pathId: routeById("voicings").pathId,
    reasons: [
      "You can find notes, read chord symbols and already play a ii–V–I.",
      "The voicing sampler starts from guide tones and adds rootless colour voicings and transfer to other keys."
    ]
  };
}

// ---------------------------------------------------------------------------
// Examples → audition notes and piano targets
// ---------------------------------------------------------------------------

/** Compatible with Explore's target shape (`runtime.setExploreTargets`). */
export interface LearnTarget {
  midi: number;
  noteName: string;
  degreeLabel?: string;
}

export interface ChordExampleNotes {
  symbol: string;
  midi: number[];
  labels: string[];
  chord: ChordDefinition | null;
}

export interface AuditionVariant {
  label: string;
  notes: AuditionNote[];
}

export interface ExamplePlan {
  /** What "Hear" plays. */
  notes: AuditionNote[];
  /** Extra listening options (A, B, A then B) for comparisons. */
  variants: AuditionVariant[];
  /** What "Show on piano" highlights. */
  targets: LearnTarget[];
  chord: ChordDefinition | null;
  caption: string;
  /** Per-chord notes for progression/chord examples (for chord-by-chord buttons). */
  chords: ChordExampleNotes[];
  /** Comparison text (scale comparisons). */
  summary: string | null;
  /** Problems (unparseable symbols ...). */
  problems: string[];
}

export const BEATS_PER_CHORD = 4;

/** "E♭" (no octave) — the label shown on piano keys in note-name mode. */
export function noteNameOf(midi: number): string {
  return formatSpelledNote(noteFromMidi(midi), { unicode: true }).replace(/-?\d+$/, "");
}

/** All PerformedNotes of a timeline except metronome clicks, as audition notes. */
export function timelineToAuditionNotes(timeline: PerformanceTimeline | null | undefined): AuditionNote[] {
  if (!timeline) return [];
  return timeline.notes
    .filter((note) => note.part !== "metronome")
    .map((note) => ({ midi: note.midi, onsetBeat: note.onsetBeat, durationBeats: note.durationBeats, velocity: note.velocity }));
}

/** Close-position chord tones near middle C (slash bass below), labelled with chord degrees. */
export function chordNotesForSymbol(symbol: string): ChordExampleNotes | null {
  const parsed = tryChordFromSymbol(symbol);
  if (!parsed.ok) return null;
  const chord = parsed.chord;
  const rootMidi4 = midiOf({ letter: chord.root.letter, accidental: chord.root.accidental, octave: 4 });
  const octave = rootMidi4 >= 67 ? 3 : 4;
  const tones = chordTones(chord, octave);
  const midi: number[] = [];
  const labels: string[] = [];
  const bass = slashBassNote(chord, octave);
  if (bass) {
    const bassMidi = midiOf(bass);
    const bassPc = ((bassMidi % 12) + 12) % 12;
    const degree = chord.degrees.find((d) => (pitchClassOf(chord.root) + d.semitones) % 12 === bassPc);
    midi.push(bassMidi);
    labels.push(degree ? degree.label : "bass");
  }
  tones.forEach((tone) => {
    midi.push(tone.midi);
    labels.push(tone.degree.label);
  });
  return { symbol, midi, labels, chord };
}

function groupedChords(example: ConceptExample): { chords: ChordExampleNotes[]; problems: string[] } {
  const symbols = example.symbols ?? [];
  const problems: string[] = [];
  const chords: ChordExampleNotes[] = [];
  const explicit = example.midi ?? [];
  const perChord = symbols.length > 0 && explicit.length > 0 && explicit.length % symbols.length === 0 ? explicit.length / symbols.length : 0;
  const labelsMatch = example.labels !== undefined && example.labels.length === explicit.length;
  symbols.forEach((symbol: string, index: number) => {
    const parsed = tryChordFromSymbol(symbol);
    const chord = parsed.ok ? parsed.chord : null;
    if (perChord > 0) {
      const midi = explicit.slice(index * perChord, (index + 1) * perChord);
      const labels = labelsMatch && example.labels ? example.labels.slice(index * perChord, (index + 1) * perChord) : midi.map(() => "");
      chords.push({ symbol, midi, labels, chord });
      return;
    }
    if (symbols.length === 1 && explicit.length > 0) {
      chords.push({ symbol, midi: [...explicit], labels: labelsMatch && example.labels ? [...example.labels] : explicit.map(() => ""), chord });
      return;
    }
    const built = chordNotesForSymbol(symbol);
    if (built) chords.push(built);
    else problems.push(`"${symbol}" cannot be read as a chord symbol.`);
  });
  return { chords, problems };
}

function chordsToAudition(chords: ChordExampleNotes[], startBeat: number = 0, beatsPerChord: number = BEATS_PER_CHORD): AuditionNote[] {
  const notes: AuditionNote[] = [];
  chords.forEach((entry: ChordExampleNotes, index: number) => {
    entry.midi.forEach((midi: number) => notes.push({ midi, onsetBeat: startBeat + index * beatsPerChord, durationBeats: beatsPerChord * 0.95 }));
  });
  return notes;
}

function runToAudition(midi: readonly number[], beatsPerNote: number, startBeat: number = 0): AuditionNote[] {
  return midi.map((value: number, index: number) => ({ midi: value, onsetBeat: startBeat + index * beatsPerNote, durationBeats: beatsPerNote * 0.95 }));
}

function chordTargets(entry: ChordExampleNotes | undefined): LearnTarget[] {
  if (!entry) return [];
  return entry.midi.map((midi: number, index: number) => {
    const target: LearnTarget = { midi, noteName: noteNameOf(midi) };
    const label = entry.labels[index];
    if (label) target.degreeLabel = label;
    return target;
  });
}

function uniqueTargets(midi: readonly number[], labels: readonly string[] | undefined): LearnTarget[] {
  const seen = new Set<number>();
  const out: LearnTarget[] = [];
  midi.forEach((value: number, index: number) => {
    if (seen.has(value)) return;
    seen.add(value);
    const target: LearnTarget = { midi: value, noteName: noteNameOf(value) };
    const label = labels && labels.length === midi.length ? labels[index] : undefined;
    if (label) target.degreeLabel = label;
    out.push(target);
  });
  return out;
}

function scaleMidi(example: ConceptExample): { midi: number[]; labels: string[] } {
  if (example.midi && example.midi.length > 0) {
    return { midi: [...example.midi], labels: example.labels && example.labels.length === example.midi.length ? [...example.labels] : [] };
  }
  if (example.scale) {
    try {
      const notes = scaleNotes(example.scale.tonic, example.scale.scale, 4, 1);
      return { midi: notes.map((n) => n.midi), labels: notes.map((n) => n.degreeLabel) };
    } catch {
      return { midi: [], labels: [] };
    }
  }
  return { midi: [], labels: [] };
}

function octaveOfExample(example: ConceptExample): number {
  const first = example.midi && example.midi.length > 0 ? example.midi[0] : 60;
  return Math.floor(first / 12) - 1;
}

function emptyPlan(caption: string): ExamplePlan {
  return { notes: [], variants: [], targets: [], chord: null, caption, chords: [], summary: null, problems: [] };
}

/**
 * Map a concept example to what "Hear" plays and what "Show on piano" highlights.
 * - chord → block chord (explicit MIDI or close position);
 * - progression → one bar per chord;
 * - scale → one octave run;
 * - melody → one note per beat;
 * - comparison → for scales, `modeComparison` (A, B, A then B; the changed degrees are
 *   highlighted); for chords/progressions, the compared example then this one.
 */
export function examplePlan(example: ConceptExample, siblings: readonly ConceptExample[] = []): ExamplePlan {
  const plan = emptyPlan(example.label);
  switch (example.kind) {
    case "chord":
    case "progression": {
      const grouped = groupedChords(example);
      plan.chords = grouped.chords;
      plan.problems = grouped.problems;
      if (example.kind === "chord" || grouped.chords.length === 1) {
        const only = grouped.chords[0];
        plan.notes = only ? only.midi.map((midi: number) => ({ midi, onsetBeat: 0, durationBeats: 2 })) : [];
      } else {
        plan.notes = chordsToAudition(grouped.chords);
      }
      plan.targets = chordTargets(grouped.chords[0]);
      plan.chord = grouped.chords[0] ? grouped.chords[0].chord : null;
      if (example.kind === "progression" && grouped.chords.length > 1) plan.caption = `${example.label} — first chord ${grouped.chords[0].symbol}`;
      return plan;
    }
    case "scale": {
      const run = scaleMidi(example);
      plan.notes = runToAudition(run.midi, 0.5);
      plan.targets = uniqueTargets(run.midi, run.labels);
      return plan;
    }
    case "melody": {
      const midi = example.midi ?? [];
      plan.notes = runToAudition(midi, 1);
      plan.targets = uniqueTargets(midi, example.labels);
      return plan;
    }
    case "comparison":
      return comparisonPlan(example, siblings, plan);
    default:
      return plan;
  }
}

function comparisonPlan(example: ConceptExample, siblings: readonly ConceptExample[], plan: ExamplePlan): ExamplePlan {
  const other = example.compareWith ? siblings.find((candidate: ConceptExample) => candidate.id === example.compareWith) : undefined;
  if (example.scale && other && other.scale && example.scale.tonic.letter === other.scale.tonic.letter && example.scale.tonic.accidental === other.scale.tonic.accidental) {
    const a: ScaleId = other.scale.scale;
    const b: ScaleId = example.scale.scale;
    try {
      const cmp = modeComparison(example.scale.tonic, a, b, octaveOfExample(example));
      const nameA = cmp.scales[0].displayName;
      const nameB = cmp.scales[1].displayName;
      plan.variants = [
        { label: nameA, notes: timelineToAuditionNotes(cmp.timelines.a) },
        { label: nameB, notes: timelineToAuditionNotes(cmp.timelines.b) },
        { label: `${nameA} then ${nameB}`, notes: timelineToAuditionNotes(cmp.timelines.aThenB) }
      ];
      plan.notes = plan.variants[2].notes;
      plan.summary = cmp.summary;
      plan.targets = cmp.characteristicDegreeMidi.map((midi: number) => {
        const fromA = cmp.scales[0].notes.find((note) => note.midi === midi);
        const fromB = cmp.scales[1].notes.find((note) => note.midi === midi);
        const source = fromB ?? fromA;
        const target: LearnTarget = { midi, noteName: source ? source.pitchName : noteNameOf(midi) };
        if (source) target.degreeLabel = source.label;
        return target;
      });
      plan.caption = `${nameA} vs ${nameB}: the degree that changes`;
      return plan;
    } catch (error) {
      plan.problems.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (example.symbols && example.symbols.length > 0) {
    const mine = groupedChords(example);
    const theirs = other && other.symbols && other.symbols.length > 0 ? groupedChords(other) : null;
    plan.chords = mine.chords;
    plan.problems.push(...mine.problems);
    const single = mine.chords.length === 1 && (!theirs || theirs.chords.length === 1);
    const beats = single ? 2 : BEATS_PER_CHORD;
    const mineNotes = chordsToAudition(mine.chords, 0, beats);
    if (theirs && other) {
      const theirNotes = chordsToAudition(theirs.chords, 0, beats);
      const offset = theirs.chords.length * beats + 1;
      plan.variants = [
        { label: other.label, notes: theirNotes },
        { label: example.label, notes: mineNotes },
        { label: `${other.label} then ${example.label}`, notes: [...theirNotes, ...chordsToAudition(mine.chords, offset, beats)] }
      ];
      plan.notes = plan.variants[2].notes;
    } else {
      plan.notes = mineNotes;
    }
    plan.targets = chordTargets(mine.chords[0]);
    plan.chord = mine.chords[0] ? mine.chords[0].chord : null;
    return plan;
  }
  const run = scaleMidi(example);
  plan.notes = runToAudition(run.midi, example.scale ? 0.5 : 1);
  plan.targets = uniqueTargets(run.midi, run.labels);
  return plan;
}

// ---------------------------------------------------------------------------
// Progress markers
// ---------------------------------------------------------------------------

export type UnitKind = "concept" | "exercise" | "chart" | "routine";

export type MarkerState = "none" | "read" | "listened" | "assisted" | "independent" | "transfer";

export interface UnitMarker {
  state: MarkerState;
  done: boolean;
  label: string;
}

const MARKER_RANK: Record<MarkerState, number> = { none: 0, read: 1, listened: 2, assisted: 3, independent: 4, transfer: 5 };

const MARKER_LABELS: Record<MarkerState, string> = {
  none: "Not started",
  read: "Read",
  listened: "Listened",
  assisted: "Played with help",
  independent: "Played independently",
  transfer: "Transferred to another key"
};

function matchesUnit(evidence: ProgressEvidence, kind: UnitKind, id: string): boolean {
  switch (kind) {
    case "concept":
      return evidence.conceptId === id;
    case "exercise":
      return evidence.exerciseId === id;
    case "chart":
      return evidence.chartId === id;
    case "routine":
      return evidence.routineId === id;
  }
}

/**
 * Highest evidence for a path unit. Reading a concept, assisted play, independent play and
 * transfer stay distinct labels (plan E31) rather than one "done" percentage.
 */
export function unitMarker(evidence: readonly ProgressEvidence[], kind: UnitKind, id: string): UnitMarker {
  let best: MarkerState = "none";
  evidence.forEach((entry: ProgressEvidence) => {
    if (!matchesUnit(entry, kind, id)) return;
    const state = entry.kind as MarkerState;
    if (MARKER_RANK[state] !== undefined && MARKER_RANK[state] > MARKER_RANK[best]) best = state;
  });
  return { state: best, done: best !== "none", label: MARKER_LABELS[best] };
}

/** "Read" evidence for opening a concept page. */
export function readEvidence(conceptId: string, now: Date = new Date()): ProgressEvidence {
  return { kind: "read", conceptId, at: now.toISOString() };
}

// ---------------------------------------------------------------------------
// Small helpers for pages
// ---------------------------------------------------------------------------

/** Concepts in prerequisite/related lists that exist (unknown ids are dropped). */
export function knownConcepts(ids: readonly string[], bundle: ContentBundle = contentBundle): ConceptDefinition[] {
  const out: ConceptDefinition[] = [];
  ids.forEach((id: string) => {
    const found = bundle.concepts.find((concept: ConceptDefinition) => concept.id === id);
    if (found) out.push(found);
  });
  return out;
}

/** Whether a status is hidden from lessons (only listed under "Coming later"). */
export function isComingLater(status: ContentStatus): boolean {
  return status === "unavailable" || status === "deferred";
}

export const HARMONISATION_CONCEPTS: readonly string[] = ["harmonising-scale", "harmonising-melody"];
