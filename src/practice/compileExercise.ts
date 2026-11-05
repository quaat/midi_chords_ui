/**
 * Exercise compiler (plan E13/E16): `ExerciseSpec` (authored data) → `ExerciseDefinition`.
 *
 * 1. Material becomes a `MusicalSequence` with event IDs "ev-1", "ev-2", ...:
 *    - chordSequence: one chord event per symbol (default one bar each); a voicer realises each
 *      chord with the material's recipe and the `VoicingInstance` is stored on the event.
 *    - explicitNotes: one event per authored step whose learner notes are exactly the authored
 *      notes (degree/role/hand/finger kept). `notes: []` is a rest.
 *    - scaleRun: one event per realised pattern note (`realizePattern`), so repeated pitches and
 *      turnaround notes stay distinct targets.
 *    - singleNotes: one event per prompt with a single note.
 * 2. The sequence is compiled with `compileTimeline` (learner part from voicings/authored notes;
 *    a voicing's accompaniment bass becomes a separate "accompaniment" part).
 * 3. One `ExerciseStep` per occurrence with learner notes. Rests produce no step.
 *
 * Transposition (`transposeTo`): the interval from `spec.key.tonic` (or a scale run's tonic) to
 * the target is taken upward when it is at most a tritone, otherwise downward, so the material
 * stays in a similar register (C → F = up P4 (+5); C → B♭ = down M2 (−2)). Chord symbols move
 * with `transposeChord`, explicit notes by semitones (spelling re-derived from the transposed
 * chord), scale runs change tonic. Authored prompts are regenerated for transposed material,
 * since their note names would otherwise be wrong.
 */
import type { ExerciseSpec, ExplicitNotesStep } from "@/content/authoring";
import type {
  AccompanimentPatternId,
  ChordDefinition,
  ChordRole,
  DegreeLabel,
  ExerciseDefinition,
  ExerciseStep,
  Hand,
  Interval,
  KeyContext,
  MusicalSequence,
  PatternRecipe,
  PerformanceOccurrence,
  PerformedNote,
  SequenceEvent,
  SpelledNote,
  SpelledPitchClass,
  VoicedNote,
  VoicingInstance
} from "@/model/contracts";
import type { Direction } from "@/music";
import {
  PATTERN_RECIPES,
  chordTones,
  getScale,
  createRunRecipe,
  formatPitchClass,
  formatSpelledNote,
  intervalBetweenPitchClasses,
  invertInterval,
  realizePattern,
  semitonesOf,
  spelledEquals,
  transposeSpelled,
  transposeChord,
  transposeKey,
  tryChordFromSymbol
} from "@/music";
import { beatsPerBar } from "@/timeline/clock";
import { realizeVoicing } from "@/voicing";
import { compileTimelineWithDiagnostics } from "@/timeline/compile";
import type { FallbackVoicing } from "@/timeline/compile";
import { chordLabel, noteLabel, noteList, roleName, spellMidi, joinWords, pitchClassLabel } from "@/practice/text";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Realises a chord with a voicing recipe; null when the recipe cannot voice the chord. */
export type ExerciseVoicer = (chord: ChordDefinition, recipeId: string) => VoicingInstance | null;

export interface CompileExerciseOptions {
  /**
   * Voicing adapter. Default: the voicing engine (`realizeVoicing`, with the previous chord's
   * voicing as continuity context); `closeVoicer` is a dependency-free stand-in.
   */
  voicer?: ExerciseVoicer;
  /** Transfer key: transpose the material from `spec.key.tonic` to this tonic. */
  transposeTo?: SpelledPitchClass;
  /** Accompaniment pattern compiled into the timeline. Default "none" (voicing bass still sounds). */
  accompaniment?: AccompanimentPatternId;
}

/** Facts about how an exercise was compiled (kept for evidence/transfer decisions). */
export interface CompiledExerciseInfo {
  specId: string;
  /** Key as authored. */
  specKey?: KeyContext;
  /** Tonic the material was transposed to (undefined = not transposed). */
  transposedTo?: SpelledPitchClass;
  /** Signed semitone shift applied to explicit notes (0 = none). */
  semitones: number;
  /** True when compiled with `transposeTo` different from the authored key. */
  isTransfer: boolean;
  sequence: MusicalSequence;
  warnings: string[];
}

export type CompileExerciseResult =
  | { ok: true; exercise: ExerciseDefinition; info: CompiledExerciseInfo }
  | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// Compile info registry (lets evidence code ask "was this a transfer?" without new contract fields)
// ---------------------------------------------------------------------------

const COMPILE_INFO = new WeakMap<ExerciseDefinition, CompiledExerciseInfo>();

/** Compile facts for an exercise produced by `compileExercise` in this session (undefined otherwise). */
export function compiledExerciseInfo(exercise: ExerciseDefinition): CompiledExerciseInfo | undefined {
  return COMPILE_INFO.get(exercise);
}

// ---------------------------------------------------------------------------
// Default voicer (used until/unless the voicing engine is injected)
// ---------------------------------------------------------------------------

const RECIPE_FAMILY_LABELS: ReadonlyArray<[string, string]> = [
  ["rootless", "rootless"],
  ["shell", "shell"],
  ["guide-tone", "guide-tone"],
  ["guideTone", "guide-tone"],
  ["drop2", "drop-2"],
  ["quartal", "quartal"],
  ["open", "open"],
  ["close", "close-position"]
];

/** Learner-facing family name for a recipe id ("rootless-a" → "rootless"). */
export function recipeFamilyLabel(recipeId: string): string {
  for (const [prefix, label] of RECIPE_FAMILY_LABELS) {
    if (recipeId.startsWith(prefix)) {
      return label;
    }
  }
  return recipeId;
}

function hasSeventh(chord: ChordDefinition): boolean {
  return chord.degrees.some((degree) => degree.role === "seventh");
}

/** Recipe used for a chordSequence without an explicit recipe id. */
export function defaultRecipeIdFor(chord: ChordDefinition): string {
  return hasSeventh(chord) ? "close-sevenths-rh" : "close-triads-rh";
}

function rolesForRecipe(recipeId: string, chord: ChordDefinition): ChordRole[] | null {
  const present = chord.degrees.map((degree) => degree.role);
  const seventhOrSixth: ChordRole = present.includes("seventh") ? "seventh" : "sixth";
  if (recipeId.startsWith("shell")) {
    return ["root", "third", seventhOrSixth];
  }
  if (recipeId.startsWith("guide")) {
    return ["third", seventhOrSixth];
  }
  if (recipeId.startsWith("rootless")) {
    return present.filter((role) => role !== "root");
  }
  if (recipeId.startsWith("close-triads")) {
    return ["root", "third", "fifth", "suspension"];
  }
  return null;
}

/**
 * Simple deterministic realisation from `chordTones`: the chord tones (filtered by the recipe's
 * role family where obvious) stacked upward from the root in octave 4 (octave 3 for shells and
 * guide tones, which are left-hand shapes). It is a stand-in for the voicing engine, not a
 * reviewed voicing; inject `voicer` to use the real engine.
 */
export const closeVoicer: ExerciseVoicer = (chord: ChordDefinition, recipeId: string): VoicingInstance | null => {
  const wanted = rolesForRecipe(recipeId, chord);
  const lowFamily = recipeId.startsWith("shell") || recipeId.startsWith("guide");
  const octave = lowFamily ? 3 : 4;
  const hand: Hand = lowFamily ? "left" : "right";
  const tones = chordTones(chord, octave).filter((tone) => (wanted ? wanted.includes(tone.degree.role) : true));
  if (tones.length === 0) {
    return null;
  }
  const notes: VoicedNote[] = tones
    .slice()
    .sort((a, b) => a.midi - b.midi)
    .map((tone, index) => ({
      midi: tone.midi,
      spelled: tone.spelled,
      degree: tone.degree.label,
      role: tone.degree.role,
      hand,
      voiceId: `v${index + 1}`
    }));
  const omitted = chord.degrees
    .filter((degree) => !tones.some((tone) => tone.degree.label === degree.label))
    .map((degree) => ({ role: degree.role, degree: degree.label, reason: `Not part of the ${recipeFamilyLabel(recipeId)} shape.` }));
  return {
    id: `${chord.symbol}:${recipeId}:fallback`,
    chord,
    recipeId,
    notes,
    omitted,
    explanation: [`Stacked ${notes.map((note) => note.degree).join(" ")} upward from octave ${octave} (fallback voicer, not a reviewed voicing).`]
  };
};

/** Voicer backed by the voicing engine (no continuity context). */
export const engineVoicer: ExerciseVoicer = (chord: ChordDefinition, recipeId: string): VoicingInstance | null => {
  const result = realizeVoicing(chord, recipeId);
  return result.ok ? result.voicing : null;
};

/** Engine voicer that ranks each chord against the previous chord's voicing. */
function continuityVoicer(): ExerciseVoicer {
  let previous: VoicingInstance | undefined;
  return (chord: ChordDefinition, recipeId: string): VoicingInstance | null => {
    const result = realizeVoicing(chord, recipeId, previous ? { previous } : {});
    if (!result.ok) {
      return null;
    }
    previous = result.voicing;
    return result.voicing;
  };
}

/** Fallback when the requested recipe cannot voice a chord: engine close position, then `closeVoicer`. */
function fallbackVoicing(chord: ChordDefinition): VoicingInstance | null {
  const engine = realizeVoicing(chord, "close-rp");
  return engine.ok ? engine.voicing : closeVoicer(chord, "close");
}

// ---------------------------------------------------------------------------
// Transposition
// ---------------------------------------------------------------------------

interface Transposition {
  interval: Interval;
  direction: Direction;
  semitones: number;
}

/** Nearest transposition from `from` to `to`: up when ≤ 6 semitones, otherwise down. */
export function transpositionBetween(from: SpelledPitchClass, to: SpelledPitchClass): Transposition | null {
  const up = intervalBetweenPitchClasses(from, to);
  if (!up) {
    return null;
  }
  const semis = semitonesOf(up);
  if (semis > 6) {
    const down = invertInterval(up);
    if (down) {
      return { interval: down, direction: "down", semitones: semis - 12 };
    }
  }
  return { interval: up, direction: "up", semitones: semis };
}

function transposeChordSafe(chord: ChordDefinition, t: Transposition | null): ChordDefinition {
  if (!t || t.semitones === 0) {
    return chord;
  }
  return transposeChord(chord, t.interval, t.direction);
}

// ---------------------------------------------------------------------------
// Event seeds
// ---------------------------------------------------------------------------

interface NoteMeta {
  midi: number;
  spelled?: SpelledNote;
  degree?: DegreeLabel;
  role?: ChordRole;
  hand?: Hand;
  finger?: number;
}

interface EventSeed {
  symbol: string;
  durationBeats: number;
  rest: boolean;
  chord?: ChordDefinition;
  voicing?: VoicingInstance;
  voicingRecipeId?: string;
  /** Authored learner notes (explicit / scale / single-note material). */
  notes?: NoteMeta[];
  prompt: string;
}

type SeedResult = { ok: true; seeds: EventSeed[]; warnings: string[] } | { ok: false; reason: string };

const REST_SYMBOLS = ["nc", "n.c.", "n.c", "rest", "-"];

function isRestSymbol(symbol: string): boolean {
  return REST_SYMBOLS.includes(symbol.trim().toLowerCase());
}

/** Pattern ids accepted in content, mapped to `PATTERN_RECIPES` ids. */
const PATTERN_ALIASES: Readonly<Record<string, string>> = {
  "run-1oct": "run-one-octave",
  "seq-thirds": "thirds-one-octave"
};

function findPattern(patternId: string): PatternRecipe | undefined {
  const id = PATTERN_ALIASES[patternId] ?? patternId;
  return PATTERN_RECIPES.find((recipe) => recipe.id === id);
}

function spellPreference(key: KeyContext | undefined): "flat" | "sharp" | "smart" {
  if (!key) {
    return "smart";
  }
  if (key.tonic.accidental < 0 || (key.tonic.letter === "F" && key.tonic.accidental === 0)) {
    return "flat";
  }
  if (key.tonic.accidental > 0) {
    return "sharp";
  }
  return "smart";
}

function chordSequenceSeeds(spec: ExerciseSpec, t: Transposition | null, voicer: ExerciseVoicer, barBeats: number): SeedResult {
  if (spec.material.kind !== "chordSequence") {
    return { ok: false, reason: "internal: not a chord sequence" };
  }
  const material = spec.material;
  const warnings: string[] = [];
  const seeds: EventSeed[] = [];
  for (let index = 0; index < material.symbols.length; index += 1) {
    const symbol = material.symbols[index];
    const given = material.durationsBeats ? material.durationsBeats[index] : undefined;
    const durationBeats = given !== undefined && given > 0 ? given : barBeats;
    if (isRestSymbol(symbol)) {
      seeds.push({ symbol: "NC", durationBeats, rest: true, prompt: "Rest" });
      continue;
    }
    const parsed = tryChordFromSymbol(symbol);
    if (!parsed.ok) {
      return { ok: false, reason: `Chord ${index + 1} ("${symbol}") cannot be read: ${parsed.error}` };
    }
    let chord: ChordDefinition;
    try {
      chord = transposeChordSafe(parsed.chord, t);
    } catch (error) {
      return { ok: false, reason: `Chord ${index + 1} ("${symbol}") cannot be transposed: ${error instanceof Error ? error.message : String(error)}` };
    }
    const recipeId = material.voicingRecipeId ?? defaultRecipeIdFor(chord);
    let voicing = voicer(chord, recipeId);
    if (!voicing) {
      warnings.push(`${chord.symbol}: recipe "${recipeId}" could not voice the chord; close position was used instead.`);
      voicing = fallbackVoicing(chord);
    }
    if (!voicing || voicing.notes.length === 0) {
      return { ok: false, reason: `${chord.symbol} could not be voiced with "${recipeId}".` };
    }
    const label = chordLabel(chord);
    const prompt = material.voicingRecipeId ? `Play ${label} as a ${recipeFamilyLabel(material.voicingRecipeId)} voicing` : `Play ${label}`;
    seeds.push({ symbol: chord.symbol, durationBeats, rest: false, chord, voicing, voicingRecipeId: voicing.recipeId, prompt });
  }
  return { ok: true, seeds, warnings };
}

function explicitSeeds(steps: ExplicitNotesStep[], t: Transposition | null, preference: "flat" | "sharp" | "smart"): SeedResult {
  const seeds: EventSeed[] = [];
  const warnings: string[] = [];
  const shift = t ? t.semitones : 0;
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const durationBeats = step.durationBeats > 0 ? step.durationBeats : 1;
    if (step.notes.length === 0) {
      seeds.push({ symbol: "NC", durationBeats, rest: true, prompt: step.prompt });
      continue;
    }
    let chord: ChordDefinition | undefined;
    if (step.chordSymbol && !isRestSymbol(step.chordSymbol)) {
      const parsed = tryChordFromSymbol(step.chordSymbol);
      if (parsed.ok) {
        try {
          chord = transposeChordSafe(parsed.chord, t);
        } catch (error) {
          return { ok: false, reason: `Step ${index + 1} ("${step.chordSymbol}") cannot be transposed: ${error instanceof Error ? error.message : String(error)}` };
        }
      } else {
        warnings.push(`Step ${index + 1}: chord symbol "${step.chordSymbol}" cannot be read (${parsed.error}); notes are used as authored.`);
      }
    }
    const notes: NoteMeta[] = [];
    for (const authored of step.notes) {
      const midi = authored.midi + shift;
      if (!Number.isInteger(midi) || midi < 0 || midi > 127) {
        return { ok: false, reason: `Step ${index + 1}: MIDI ${midi} is outside 0..127.` };
      }
      const meta: NoteMeta = { midi, spelled: spellMidi(midi, chord, preference) };
      if (authored.degree !== undefined) meta.degree = authored.degree;
      if (authored.role !== undefined) meta.role = authored.role;
      if (authored.hand !== undefined) meta.hand = authored.hand;
      // Fingering is only kept for the authored key; transposition never reuses it.
      if (authored.finger !== undefined && shift === 0) meta.finger = authored.finger;
      notes.push(meta);
    }
    const names = noteList(notes, chord);
    const prompt = shift === 0 ? step.prompt : chord ? `${chordLabel(chord)}: ${names}` : `Play ${names}`;
    const seed: EventSeed = { symbol: chord ? chord.symbol : names, durationBeats, rest: false, notes, prompt };
    if (chord) {
      seed.chord = chord;
    }
    seeds.push(seed);
  }
  return { ok: true, seeds, warnings };
}

function scaleRunSeeds(spec: ExerciseSpec, t: Transposition | null): SeedResult {
  if (spec.material.kind !== "scaleRun") {
    return { ok: false, reason: "internal: not a scale run" };
  }
  const material = spec.material;
  let recipe = findPattern(material.patternId);
  if (!recipe) {
    return { ok: false, reason: `Unknown pattern "${material.patternId}".` };
  }
  const degreeCount = getScale(material.scale).degrees.length;
  const isRun = recipe.id === "run-one-octave";
  const maxDegreeIndex = Math.max(...recipe.steps.map((step) => step.degreeIndex));
  if (isRun && (material.octaves !== recipe.octaves || degreeCount !== 7)) {
    // The run recipe is defined for seven-note scales; rebuild it for this scale size/range
    // (unreviewed, so no fingering is carried over).
    recipe = createRunRecipe({
      id: `run-${degreeCount}-degrees-${material.octaves}-octave`,
      name: recipe.name,
      degreeCount,
      octaves: material.octaves,
      beatsPerStep: recipe.beatsPerStep,
      direction: recipe.direction,
      hand: recipe.hand
    });
  } else if (maxDegreeIndex >= degreeCount) {
    return { ok: false, reason: `Pattern "${recipe.name}" needs ${maxDegreeIndex + 1} scale degrees; ${getScale(material.scale).name} has ${degreeCount}.` };
  } else if (material.octaves !== recipe.octaves) {
    return { ok: false, reason: `Pattern "${recipe.name}" covers ${recipe.octaves} octave(s); ${material.octaves} were requested.` };
  }
  let tonic: SpelledPitchClass = material.tonic;
  let startOctave = material.startOctave;
  if (t && t.semitones !== 0) {
    const moved = transposeTonic(material.tonic, material.startOctave, t);
    if (!moved) {
      return { ok: false, reason: `${formatPitchClass(material.tonic)} cannot be transposed by ${t.semitones} semitones.` };
    }
    tonic = moved.tonic;
    startOctave = moved.octave;
  }
  const realized = realizePattern(recipe, tonic, material.scale, startOctave, { hand: material.hand });
  if (!realized.ok) {
    return { ok: false, reason: realized.reason };
  }
  const seeds: EventSeed[] = realized.notes.map((note) => {
    const meta: NoteMeta = { midi: note.midi, spelled: note.spelled, degree: note.degreeLabel, hand: material.hand };
    if (note.finger !== undefined) {
      meta.finger = note.finger;
    }
    const name = formatSpelledNote(note.spelled, { unicode: true });
    return { symbol: formatSpelledNote(note.spelled), durationBeats: note.durationBeats, rest: false, notes: [meta], prompt: `Play ${name} (degree ${note.degreeLabel})` };
  });
  return { ok: true, seeds, warnings: [] };
}

/** Move a tonic (and its octave) by a transposition, keeping letter spelling. */
function transposeTonic(tonic: SpelledPitchClass, octave: number, t: Transposition): { tonic: SpelledPitchClass; octave: number } | null {
  try {
    const moved = transposeSpelled({ letter: tonic.letter, accidental: tonic.accidental, octave }, t.interval, t.direction);
    return { tonic: { letter: moved.letter, accidental: moved.accidental }, octave: moved.octave };
  } catch {
    return null;
  }
}

function singleNoteSeeds(spec: ExerciseSpec, t: Transposition | null, preference: "flat" | "sharp" | "smart"): SeedResult {
  if (spec.material.kind !== "singleNotes") {
    return { ok: false, reason: "internal: not single notes" };
  }
  const shift = t ? t.semitones : 0;
  const seeds: EventSeed[] = [];
  for (let index = 0; index < spec.material.prompts.length; index += 1) {
    const prompt = spec.material.prompts[index];
    const midi = prompt.midi + shift;
    if (!Number.isInteger(midi) || midi < 0 || midi > 127) {
      return { ok: false, reason: `Prompt ${index + 1}: MIDI ${midi} is outside 0..127.` };
    }
    const spelled = spellMidi(midi, undefined, preference);
    const name = formatSpelledNote(spelled, { unicode: true });
    seeds.push({
      symbol: formatSpelledNote(spelled),
      durationBeats: 1,
      rest: false,
      notes: [{ midi, spelled }],
      prompt: shift === 0 ? prompt.label : `Play ${name}`
    });
  }
  return { ok: true, seeds, warnings: [] };
}

// ---------------------------------------------------------------------------
// Hints
// ---------------------------------------------------------------------------

function fillPlaceholders(text: string, symbol: string, names: string): string {
  return text.split("{symbol}").join(symbol).split("{chord}").join(symbol).split("{notes}").join(names);
}

function buildHints(spec: ExerciseSpec, targets: PerformedNote[], chord: ChordDefinition | undefined, symbol: string): string[] {
  const names = noteList(targets, chord);
  const label = chord ? chordLabel(chord) : symbol;
  const hints: string[] = spec.hintLadder.map((rung) => fillPlaceholders(rung, label, names));
  const policy = spec.policy;
  if (policy.kind === "roles" && chord) {
    const parts: string[] = [];
    policy.requiredRoles.forEach((role) => {
      const target = targets.find((note) => note.role === role);
      const degree = chord.degrees.find((d) => d.role === role);
      if (target) {
        parts.push(`its ${roleName(role)} (${pitchClassLabel(target.midi, chord, target.spelled)})`);
      } else if (degree) {
        const tone = chordTones(chord, 4).find((t) => t.degree.label === degree.label);
        if (tone) {
          parts.push(`its ${roleName(role)} (${formatPitchClass(tone.spelled, { unicode: true })})`);
        }
      }
    });
    if (parts.length > 0) {
      const rung = `${label} needs ${joinWords(parts)}.`;
      if (!hints.includes(rung)) {
        hints.push(rung);
      }
    }
  }
  const final = policy.kind === "roles" && policy.octaveFree !== false ? `Play ${names} (any octave works for the required roles)` : `Play ${names}`;
  if (!hints.includes(final)) {
    hints.push(final);
  }
  return hints;
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

function applyMeta(note: PerformedNote, meta: NoteMeta): PerformedNote {
  const out: PerformedNote = { ...note };
  if (meta.spelled) out.spelled = meta.spelled;
  if (meta.degree !== undefined) out.degree = meta.degree;
  if (meta.role !== undefined) out.role = meta.role;
  if (meta.hand !== undefined) out.hand = meta.hand;
  if (meta.finger !== undefined) out.finger = meta.finger;
  return out;
}

function buildSeeds(spec: ExerciseSpec, t: Transposition | null, voicer: ExerciseVoicer, key: KeyContext | undefined): SeedResult {
  const barBeats = beatsPerBar(spec.timeSignature.numerator, spec.timeSignature.denominator);
  const preference = spellPreference(key);
  switch (spec.material.kind) {
    case "chordSequence":
      return chordSequenceSeeds(spec, t, voicer, barBeats);
    case "explicitNotes":
      return explicitSeeds(spec.material.steps, t, preference);
    case "scaleRun":
      return scaleRunSeeds(spec, t);
    case "singleNotes":
      return singleNoteSeeds(spec, t, preference);
    default:
      return { ok: false, reason: "Unknown material kind." };
  }
}

/**
 * Reference tonic for transposing material without `spec.key`: a scale run's tonic, the first
 * chord's root, the first explicit step's chord root (else its lowest note), or the first
 * single-note prompt.
 */
export function impliedTonic(spec: ExerciseSpec): SpelledPitchClass | undefined {
  const material = spec.material;
  const fromMidi = (midi: number): SpelledPitchClass => {
    const note = spellMidi(midi);
    return { letter: note.letter, accidental: note.accidental };
  };
  switch (material.kind) {
    case "scaleRun":
      return material.tonic;
    case "chordSequence": {
      for (const symbol of material.symbols) {
        if (isRestSymbol(symbol)) continue;
        const parsed = tryChordFromSymbol(symbol);
        return parsed.ok ? parsed.chord.root : undefined;
      }
      return undefined;
    }
    case "explicitNotes": {
      for (const step of material.steps) {
        if (step.notes.length === 0) continue;
        if (step.chordSymbol) {
          const parsed = tryChordFromSymbol(step.chordSymbol);
          if (parsed.ok) return parsed.chord.root;
        }
        return fromMidi(Math.min(...step.notes.map((note) => note.midi)));
      }
      return undefined;
    }
    case "singleNotes":
      return material.prompts.length > 0 ? fromMidi(material.prompts[0].midi) : undefined;
    default:
      return undefined;
  }
}

export function compileExercise(spec: ExerciseSpec, options: CompileExerciseOptions = {}): CompileExerciseResult {
  const voicer = options.voicer ?? continuityVoicer();

  // Transposition
  let transposition: Transposition | null = null;
  let transposedTo: SpelledPitchClass | undefined;
  let key: KeyContext | undefined = spec.key ? { tonic: spec.key.tonic, mode: spec.key.mode } : undefined;
  if (options.transposeTo) {
    const reference = spec.key ? spec.key.tonic : impliedTonic(spec);
    if (!reference) {
      return { ok: false, reason: `"${spec.title}" has no key, so it cannot be transposed to ${formatPitchClass(options.transposeTo)}.` };
    }
    if (!spelledEquals(reference, options.transposeTo)) {
      transposition = transpositionBetween(reference, options.transposeTo);
      if (!transposition) {
        return { ok: false, reason: `No interval spells ${formatPitchClass(reference)} → ${formatPitchClass(options.transposeTo)}.` };
      }
      transposedTo = options.transposeTo;
      if (key) {
        try {
          key = transposeKey(key, transposition.interval, transposition.direction);
        } catch (error) {
          return { ok: false, reason: error instanceof Error ? error.message : String(error) };
        }
      }
    }
  }

  const seedResult = buildSeeds(spec, transposition, voicer, key);
  if (!seedResult.ok) {
    return { ok: false, reason: seedResult.reason };
  }
  const seeds = seedResult.seeds;
  if (seeds.length === 0 || seeds.every((seed) => seed.rest)) {
    return { ok: false, reason: `"${spec.title}" has no notes to play.` };
  }

  // Sequence
  const events: SequenceEvent[] = [];
  const authoredNotes = new Map<string, NoteMeta[]>();
  let beat = 0;
  seeds.forEach((seed, index) => {
    const id = `ev-${index + 1}`;
    const event: SequenceEvent = {
      id,
      index,
      kind: seed.rest ? "rest" : "chord",
      symbol: seed.rest ? "NC" : seed.symbol,
      startBeat: beat,
      durationBeats: seed.durationBeats
    };
    if (seed.chord) event.chord = seed.chord;
    if (seed.voicing) event.voicing = seed.voicing;
    if (seed.voicingRecipeId) event.voicingRecipeId = seed.voicingRecipeId;
    if (seed.notes) authoredNotes.set(id, seed.notes);
    events.push(event);
    beat += seed.durationBeats;
  });
  const suffix = transposedTo ? `~${formatPitchClass(transposedTo)}` : "";
  const sequence: MusicalSequence = {
    id: `${spec.id}${suffix}`,
    version: spec.version,
    title: spec.title,
    tempo: { bpm: spec.tempoBpm },
    timeSignature: { numerator: spec.timeSignature.numerator, denominator: spec.timeSignature.denominator },
    events,
    totalBeats: beat
  };
  if (key) sequence.key = key;

  const compiled = compileTimelineWithDiagnostics(sequence, {
    includeVoicingBass: true,
    accompaniment: options.accompaniment ?? "none",
    countInBeats: spec.timing.countInBeats ?? 0,
    tempoBpm: spec.tempoBpm,
    timelineId: `${spec.id}@${spec.version}${suffix}`,
    fallbackVoicer: (event: SequenceEvent): FallbackVoicing | null => {
      const notes = authoredNotes.get(event.id);
      return notes ? { midi: notes.map((note) => note.midi) } : null;
    }
  });
  const warnings = [...seedResult.warnings, ...compiled.warnings];

  // Restore authored metadata (degree/role/hand/finger/spelling) on fallback-voiced notes.
  const used = new Map<string, boolean[]>();
  const notes: PerformedNote[] = compiled.timeline.notes.map((note) => {
    const metas = note.part === "learner" ? authoredNotes.get(note.eventId) : undefined;
    if (!metas) {
      return note;
    }
    const flags = used.get(note.occurrenceId) ?? metas.map(() => false);
    used.set(note.occurrenceId, flags);
    const index = metas.findIndex((meta, i) => !flags[i] && meta.midi === note.midi);
    if (index < 0) {
      return note;
    }
    flags[index] = true;
    return applyMeta(note, metas[index]);
  });
  const timeline = { ...compiled.timeline, notes };

  // Steps
  const steps: ExerciseStep[] = [];
  const seedByEvent = new Map<string, EventSeed>();
  events.forEach((event, index) => seedByEvent.set(event.id, seeds[index]));
  timeline.occurrences.forEach((occurrence: PerformanceOccurrence) => {
    const targets = notes.filter((note) => note.part === "learner" && note.occurrenceId === occurrence.occurrenceId);
    if (targets.length === 0) {
      return;
    }
    const seed = seedByEvent.get(occurrence.eventId);
    const chord = occurrence.chord;
    const step: ExerciseStep = {
      id: `step-${steps.length + 1}`,
      occurrenceId: occurrence.occurrenceId,
      prompt: seed ? seed.prompt : `Play ${noteList(targets, chord)}`,
      targets,
      policy: spec.policy,
      hints: buildHints(spec, targets, chord, seed ? seed.symbol : occurrence.symbol)
    };
    if (chord) step.chord = chord;
    steps.push(step);
  });
  if (steps.length === 0) {
    return { ok: false, reason: `"${spec.title}" produced no playable steps.${warnings.length > 0 ? ` ${warnings.join(" ")}` : ""}` };
  }

  const exercise: ExerciseDefinition = {
    id: spec.id,
    version: spec.version,
    title: spec.title,
    objective: spec.objective,
    conceptIds: [...spec.conceptIds],
    prerequisites: [...spec.prerequisites],
    contract: spec.contract,
    timeline,
    steps,
    policy: spec.policy,
    timing: { ...spec.timing },
    demand: spec.demand,
    status: spec.status
  };
  if (key) exercise.key = key;
  if (spec.transferKeys) exercise.transferKeys = spec.transferKeys.map((pc) => ({ letter: pc.letter, accidental: pc.accidental }));
  if (spec.application) exercise.application = { ...spec.application };

  const info: CompiledExerciseInfo = {
    specId: spec.id,
    semitones: transposition ? transposition.semitones : 0,
    isTransfer: transposedTo !== undefined,
    sequence,
    warnings
  };
  if (spec.key) info.specKey = { tonic: spec.key.tonic, mode: spec.key.mode };
  if (transposedTo) info.transposedTo = transposedTo;
  COMPILE_INFO.set(exercise, info);
  return { ok: true, exercise, info };
}

/** Learner-facing names of a step's targets ("F3 A3 C4 E4"). */
export function stepNoteNames(step: ExerciseStep): string {
  return noteList(step.targets, step.chord);
}

/** Learner-facing name of one target. */
export function targetLabel(note: PerformedNote, chord?: ChordDefinition): string {
  return noteLabel(note.midi, chord, note.spelled);
}
