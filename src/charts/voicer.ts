/**
 * Voicers for arrangements and harmonisation.
 *
 * `engineVoicer` (the default) adapts src/voicing's realizeVoicing. Callers may inject any
 * `ArrangementVoicer`. `localVoicer` is a small local close-position implementation, which
 * covers the recipe ids the starter content uses by selecting chord roles and stacking them
 * in close position inside the requested register (choosing the inversion nearest to the
 * previous voicing). It never mutates pitch classes: if the roles or register cannot be
 * satisfied it returns null.
 */
import type { ChordDefinition, ChordDegree, ChordRole, Hand, SpelledNote, VoicedNote, VoicingConstraints, VoicingInstance } from "@/model/contracts";
import { chordTones } from "@/music/chords";
import { mod12, noteFromMidi, pitchClassOf, spellMidiWithLetter } from "@/music/pitch";
import { realizeVoicing } from "@/voicing";

export type ArrangementVoicer = (chord: ChordDefinition, recipeId: string, constraints: VoicingConstraints) => VoicingInstance | null;

interface RecipeRoles {
  /** Role slots in stacking order; each slot lists acceptable roles in preference order. */
  slots: { roles: ChordRole[]; optional: boolean }[];
  rootPositionOnly: boolean;
  accompanimentBass: boolean;
}

const ROOT = { roles: ["root"] as ChordRole[], optional: false };
const THIRD = { roles: ["third", "suspension"] as ChordRole[], optional: false };
const FIFTH = { roles: ["fifth"] as ChordRole[], optional: true };
const SEVENTH_REQUIRED = { roles: ["seventh", "sixth"] as ChordRole[], optional: false };
const SEVENTH_OPTIONAL = { roles: ["seventh", "sixth"] as ChordRole[], optional: true };
const NINTH = { roles: ["ninth"] as ChordRole[], optional: true };

const LOCAL_RECIPES: Readonly<Record<string, RecipeRoles>> = {
  "close-triads-rh": { slots: [ROOT, THIRD, { roles: ["fifth"], optional: false }], rootPositionOnly: false, accompanimentBass: false },
  "close-sevenths-rh": { slots: [ROOT, THIRD, FIFTH, SEVENTH_OPTIONAL], rootPositionOnly: false, accompanimentBass: false },
  "shell-137": { slots: [ROOT, THIRD, SEVENTH_REQUIRED], rootPositionOnly: true, accompanimentBass: false },
  "guide-tones-37": { slots: [THIRD, SEVENTH_REQUIRED], rootPositionOnly: false, accompanimentBass: true },
  "rootless-a": { slots: [THIRD, FIFTH, SEVENTH_REQUIRED, NINTH], rootPositionOnly: true, accompanimentBass: true },
  "close-rp": { slots: [ROOT, THIRD, FIFTH, SEVENTH_OPTIONAL], rootPositionOnly: true, accompanimentBass: false }
};

export const LOCAL_VOICER_RECIPE_IDS: readonly string[] = Object.keys(LOCAL_RECIPES);

/** Spell a MIDI note in the context of a chord (chord-tone letters first, then a default). */
export function spellInChord(midi: number, chord: ChordDefinition): { spelled: SpelledNote; degree?: ChordDegree } {
  const pc = mod12(midi);
  const tones = chordTones(chord, 4);
  for (const tone of tones) {
    if (mod12(tone.midi) === pc) {
      const spelled = spellMidiWithLetter(midi, tone.spelled.letter);
      if (spelled) {
        return { spelled, degree: tone.degree };
      }
    }
  }
  if (chord.bass && pitchClassOf(chord.bass) === pc) {
    const spelled = spellMidiWithLetter(midi, chord.bass.letter);
    if (spelled) {
      return { spelled };
    }
  }
  return { spelled: noteFromMidi(midi) };
}

/** Lowest MIDI note with pitch class `pc` inside [low, high], or null. */
export function lowestInRange(pc: number, low: number, high: number): number | null {
  for (let midi = Math.max(0, Math.ceil(low)); midi <= Math.min(127, Math.floor(high)); midi += 1) {
    if (mod12(midi) === mod12(pc)) {
      return midi;
    }
  }
  return null;
}

function pickDegrees(chord: ChordDefinition, recipe: RecipeRoles): { degrees: ChordDegree[]; missing: ChordRole[] } {
  const degrees: ChordDegree[] = [];
  const missing: ChordRole[] = [];
  recipe.slots.forEach((slot) => {
    let found: ChordDegree | undefined;
    for (const role of slot.roles) {
      found = chord.degrees.find((degree) => degree.role === role && !degrees.includes(degree));
      if (found) {
        break;
      }
    }
    if (found) {
      degrees.push(found);
    } else if (!slot.optional) {
      missing.push(slot.roles[0]);
    }
  });
  return { degrees, missing };
}

/** Stack pitch classes in close position starting at `firstMidi`. */
function stackClose(firstMidi: number, pcs: number[]): number[] {
  const out: number[] = [firstMidi];
  for (let index = 1; index < pcs.length; index += 1) {
    let next = out[index - 1] + 1;
    while (mod12(next) !== mod12(pcs[index])) {
      next += 1;
    }
    out.push(next);
  }
  return out;
}

function motion(a: number[], b: number[]): number {
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  const n = Math.min(sa.length, sb.length);
  let total = 0;
  for (let index = 0; index < n; index += 1) {
    total += Math.abs(sa[index] - sb[index]);
  }
  const centreA = sa.reduce((sum, value) => sum + value, 0) / Math.max(1, sa.length);
  const centreB = sb.reduce((sum, value) => sum + value, 0) / Math.max(1, sb.length);
  return total + Math.abs(centreA - centreB) * 0.01;
}

interface Placement {
  midi: number[];
  degrees: ChordDegree[];
  inversion: number;
}

function placements(chord: ChordDefinition, degrees: ChordDegree[], low: number, high: number, rootPositionOnly: boolean): Placement[] {
  const rootPc = pitchClassOf(chord.root);
  const result: Placement[] = [];
  const rotations = rootPositionOnly ? 1 : degrees.length;
  for (let inversion = 0; inversion < rotations; inversion += 1) {
    const order = [...degrees.slice(inversion), ...degrees.slice(0, inversion)];
    const pcs = order.map((degree) => mod12(rootPc + degree.semitones));
    for (let first = Math.max(0, low); first <= Math.min(127, high); first += 1) {
      if (mod12(first) !== pcs[0]) {
        continue;
      }
      const midi = stackClose(first, pcs);
      if (midi[midi.length - 1] <= high) {
        result.push({ midi, degrees: order, inversion });
      }
    }
  }
  return result;
}

function voicedNotes(chord: ChordDefinition, placement: Placement, hand: Hand): VoicedNote[] {
  const pairs = placement.midi.map((midi, index) => ({ midi, degree: placement.degrees[index] }));
  pairs.sort((a, b) => a.midi - b.midi);
  return pairs.map((pair, index) => {
    const spelled = spellInChord(pair.midi, chord).spelled;
    return { midi: pair.midi, spelled, degree: pair.degree.label, role: pair.degree.role, hand, voiceId: `v${index + 1}` };
  });
}

export interface CloseVoicingOptions {
  low: number;
  high: number;
  hand?: Hand;
  previousMidi?: number[];
}

/**
 * Close-position voicing of a recipe's roles inside [low, high]; null when the chord lacks a
 * required role or no placement fits the register.
 */
export function localCloseVoicing(chord: ChordDefinition, recipeId: string, options: CloseVoicingOptions): VoicingInstance | null {
  const recipe = LOCAL_RECIPES[recipeId];
  if (!recipe) {
    return null;
  }
  const picked = pickDegrees(chord, recipe);
  if (picked.missing.length > 0 || picked.degrees.length === 0) {
    return null;
  }
  const candidates = placements(chord, picked.degrees, options.low, options.high, recipe.rootPositionOnly);
  if (candidates.length === 0) {
    return null;
  }
  let best = candidates[0];
  const previous = options.previousMidi;
  if (previous && previous.length > 0) {
    let bestScore = Number.POSITIVE_INFINITY;
    candidates.forEach((candidate) => {
      const score = motion(candidate.midi, previous);
      if (score < bestScore - 1e-9) {
        bestScore = score;
        best = candidate;
      }
    });
  }
  const hand: Hand = options.hand ?? "right";
  const notes = voicedNotes(chord, best, hand);
  const used = new Set<ChordDegree>(best.degrees);
  const omitted = chord.degrees
    .filter((degree) => !used.has(degree))
    .map((degree) => ({ role: degree.role, degree: degree.label, reason: `The ${recipeId} recipe does not use the ${degree.label}.` }));
  const instance: VoicingInstance = {
    id: `${recipeId}:${chord.symbol}:${notes.map((note) => note.midi).join("-")}`,
    chord,
    recipeId,
    notes,
    omitted,
    explanation: [
      `${chord.symbol} in close position (${best.inversion === 0 ? "root position" : `inversion ${best.inversion}`}) using ${best.degrees.map((degree) => degree.label).join(", ")}.`,
      previous && previous.length > 0 ? "Chosen for the smallest movement from the previous chord." : "Placed as low as the register allows."
    ]
  };
  if (recipe.accompanimentBass) {
    const rootPc = pitchClassOf(chord.bass ?? chord.root);
    const bassMidi = lowestInRange(rootPc, 36, 47);
    if (bassMidi !== null) {
      const spelled = spellInChord(bassMidi, chord);
      const bass: VoicedNote = { midi: bassMidi, spelled: spelled.spelled, degree: spelled.degree ? spelled.degree.label : "1", role: "root", hand: "left", voiceId: "bass" };
      instance.accompanimentBass = bass;
    }
  }
  return instance;
}

/** Default ArrangementVoicer built on localCloseVoicing. */
export const localVoicer: ArrangementVoicer = (chord: ChordDefinition, recipeId: string, constraints: VoicingConstraints): VoicingInstance | null => {
  const options: CloseVoicingOptions = {
    low: constraints.minMidi ?? 48,
    high: constraints.maxMidi ?? 84
  };
  if (constraints.hand !== undefined) {
    options.hand = constraints.hand;
  }
  if (constraints.previous) {
    options.previousMidi = constraints.previous.notes.map((note) => note.midi);
  }
  return localCloseVoicing(chord, recipeId, options);
};

export interface VoicerOutcome {
  voicing: VoicingInstance | null;
  reason?: string;
}

/** realizeVoicing with its failure reason kept. */
export function engineVoice(chord: ChordDefinition, recipeId: string, constraints: VoicingConstraints): VoicerOutcome {
  const result = realizeVoicing(chord, recipeId, constraints);
  if (result.ok) {
    return { voicing: result.voicing };
  }
  return { voicing: null, reason: result.reason };
}

/** Default ArrangementVoicer: src/voicing's realizeVoicing (null on failure). */
export const engineVoicer: ArrangementVoicer = (chord: ChordDefinition, recipeId: string, constraints: VoicingConstraints): VoicingInstance | null =>
  engineVoice(chord, recipeId, constraints).voicing;
