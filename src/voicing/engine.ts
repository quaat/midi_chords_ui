/**
 * Voicing engine (plan §4, E06): realise an explicit recipe for a spelled chord.
 *
 * Pipeline
 * 1. Support check: the recipe must support the chord quality and the chord must contain the
 *    recipe's required roles; otherwise `{ ok: false }` with a reason naming an alternative.
 * 2. Tone selection: chord degrees are mapped to recipe slots by role. A written alteration
 *    (b9, #11, b5 ...) replaces the plain degree of the same role. Tones the recipe does not
 *    play are listed in `omitted` with a reason. Pitch classes are never changed.
 * 3. Candidate placement: each arrangement of the selected tones (a fixed bottom-to-top order,
 *    or every close-position rotation for "inversions allowed" recipes) is stacked with each
 *    next tone at the nearest pitch strictly above the previous one, and transposed by octaves
 *    through the available range: constraints.minMidi/maxMidi when given (they REPLACE the
 *    recipe's default register bound, so a caller may widen it, e.g. B3 for G/B over a 60..84
 *    triad register), otherwise the recipe register.
 * 4. Filters: maxSpan (recipe ∩ constraints), one-hand span ≤ 12 semitones (for "both", the
 *    hands split at the largest gap and each hand must fit), bass lock (lowest learner note),
 *    melody lock (top note). When nothing survives, the failure says which constraint failed.
 * 5. Ranking (deterministic): (1) total voice movement from constraints.previous, (2) distance
 *    of the candidate's mean pitch from the recipe register centre (see recipes.ts), (3) smaller
 *    span, (4) lower top note, (5) lexicographic MIDI list.
 *
 * Slash bass: recipes with an accompaniment bass hand the slash bass to the accompaniment; the
 * close-family accompanied recipes (close-triads-rh, close-sevenths-rh) also make a slash bass
 * that is one of their tones the lowest learner note (C/E -> E G C). "close-rp" makes a
 * chord-tone slash bass the lowest note and rejects a non-chord-tone slash bass; the
 * root-position recipes "open" and "shell-137" reject any slash bass other than the root.
 */
import type {
  ChordDefinition,
  ChordDegree,
  ChordRole,
  DegreeLabel,
  Hand,
  OmittedTone,
  SpelledNote,
  SpelledPitchClass,
  VoicedNote,
  VoicingConstraints,
  VoicingInstance,
  VoicingRecipe,
  VoicingResult
} from "@/model/contracts";
import { analyzeSlashBass, chordTones, coreDegrees, inversion } from "@/music/chords";
import { formatPitchClass, formatSpelledNote, LETTER_PITCH_CLASS, mod12, pitchClassOf } from "@/music/pitch";
import { matchVoices } from "@/voicing/matching";
import { VOICING_RECIPES, getRecipe, registerCentre } from "@/voicing/recipes";

/** Widest span (semitones) accepted for one hand. */
export const ONE_HAND_MAX_SPAN = 12;

/** Register for the optional accompaniment bass (C2..D3). */
export const ACCOMPANIMENT_BASS_RANGE: { low: number; high: number } = { low: 36, high: 50 };

/** Maximum number of alternatives returned next to the best voicing. */
export const MAX_ALTERNATIVES = 4;

// ---------------------------------------------------------------------------
// Tone planning
// ---------------------------------------------------------------------------

interface PlannedTone {
  label: DegreeLabel;
  role: ChordRole;
  pc: number;
  spelling: SpelledPitchClass;
  essential: boolean;
}

type Arrangement = { kind: "ordered" } | { kind: "rotations"; lowestPc?: number };

interface TonePlan {
  tones: PlannedTone[];
  arrangement: Arrangement;
  /** Specific omission reasons keyed by degree label (overrides the generic reason). */
  omissionReasons: Map<DegreeLabel, string>;
  notes: string[];
  /** Whether non-essential tones may be dropped to meet a note-count limit. */
  trimmable: boolean;
}

type PlanResult = { ok: true; plan: TonePlan } | { ok: false; reason: string };

export type RecipeSupport = { ok: true; recipe: VoicingRecipe } | { ok: false; reason: string; alternativeRecipeId?: string };

function degreeSpellings(chord: ChordDefinition): Map<DegreeLabel, SpelledPitchClass> {
  const map = new Map<DegreeLabel, SpelledPitchClass>();
  chordTones(chord, 4).forEach((tone) => {
    map.set(tone.degree.label, { letter: tone.spelled.letter, accidental: tone.spelled.accidental });
  });
  return map;
}

function degreePc(chord: ChordDefinition, degree: ChordDegree): number {
  return mod12(pitchClassOf(chord.root) + degree.semitones);
}

function toPlanned(chord: ChordDefinition, degree: ChordDegree, spellings: Map<DegreeLabel, SpelledPitchClass>): PlannedTone {
  const spelling = spellings.get(degree.label);
  const pc = degreePc(chord, degree);
  return {
    label: degree.label,
    role: degree.role,
    pc,
    spelling: spelling ? { letter: spelling.letter, accidental: spelling.accidental } : { letter: chord.root.letter, accidental: chord.root.accidental },
    essential: degree.essential
  };
}

/** The degree for a role, preferring a written alteration (b9 over 9). */
function roleDegree(chord: ChordDefinition, role: ChordRole): ChordDegree | undefined {
  const matches = chord.degrees.filter((degree) => degree.role === role);
  const altered = matches.find((degree) => chord.alterations.includes(degree.label));
  return altered ?? matches[0];
}

function thirdLike(chord: ChordDefinition, allowSuspension: boolean): ChordDegree | undefined {
  const third = roleDegree(chord, "third");
  if (third || !allowSuspension) {
    return third;
  }
  return roleDegree(chord, "suspension");
}

function seventhOrSixth(chord: ChordDefinition): ChordDegree | undefined {
  return roleDegree(chord, "seventh") ?? roleDegree(chord, "sixth");
}

/** Close and open recipes let a suspension (2/4) stand in for the third; shells, guide tones and rootless do not. */
function allowsSuspension(recipe: VoicingRecipe): boolean {
  return recipe.family === "close" || recipe.family === "open";
}

/** Whether a chord contains what the recipe needs (no messages). */
function basicSupport(recipe: VoicingRecipe, chord: ChordDefinition): boolean {
  if (!recipe.supportedQualities.includes(chord.quality)) {
    return false;
  }
  return missingRole(recipe, chord) === null;
}

function missingRole(recipe: VoicingRecipe, chord: ChordDefinition): ChordRole | null {
  const allowSuspension = allowsSuspension(recipe);
  for (const role of recipe.requiredRoles) {
    if (role === "third") {
      if (!thirdLike(chord, allowSuspension)) {
        return role;
      }
    } else if (role === "seventh") {
      const found = recipe.family === "shell" ? seventhOrSixth(chord) : roleDegree(chord, "seventh");
      if (!found) {
        return role;
      }
    } else if (!roleDegree(chord, role)) {
      return role;
    }
  }
  return null;
}

function alternativeFor(recipe: VoicingRecipe, chord: ChordDefinition): string | undefined {
  const hasSeventh = seventhOrSixth(chord) !== undefined;
  const order = hasSeventh
    ? ["shell-137", "close-sevenths-rh", "close-rp", "open"]
    : ["close-triads-rh", "close-rp", "open"];
  for (const id of order) {
    if (id === recipe.id) {
      continue;
    }
    const candidate = getRecipe(id);
    if (candidate && basicSupport(candidate, chord)) {
      return id;
    }
  }
  return undefined;
}

/** Check recipe support for a chord, with a learner-facing reason and an alternative recipe. */
export function recipeSupport(chord: ChordDefinition, recipeId: string): RecipeSupport {
  const recipe = getRecipe(recipeId);
  if (!recipe) {
    return { ok: false, reason: `Unknown voicing recipe "${recipeId}".`, alternativeRecipeId: "close-rp" };
  }
  if (basicSupport(recipe, chord)) {
    return { ok: true, recipe };
  }
  const alternative = alternativeFor(recipe, chord);
  const tryText = alternative ? ` — try ${alternative}` : "";
  const missing = missingRole(recipe, chord);
  if (missing !== null) {
    let detail = "has none";
    if (missing === "third" && roleDegree(chord, "suspension")) {
      const suspension = roleDegree(chord, "suspension");
      detail = `has a suspended ${suspension ? suspension.label : "tone"} instead`;
    }
    const what = missing === "seventh" && recipe.family === "shell" ? "a seventh (or the sixth of a 6 chord)" : `a ${missing}`;
    return { ok: false, reason: `${recipe.id} requires ${what}; ${chord.symbol} ${detail}${tryText}.`, alternativeRecipeId: alternative };
  }
  return {
    ok: false,
    reason: `${recipe.id} does not support ${chord.qualityLabel} chords (${chord.symbol})${tryText}.`,
    alternativeRecipeId: alternative
  };
}

function dedupeByPc(tones: PlannedTone[]): PlannedTone[] {
  const seen = new Set<number>();
  const result: PlannedTone[] = [];
  tones.forEach((tone) => {
    if (!seen.has(tone.pc)) {
      seen.add(tone.pc);
      result.push(tone);
    }
  });
  return result;
}

function sortCloseFromRoot(chord: ChordDefinition, tones: PlannedTone[]): PlannedTone[] {
  const rootPc = pitchClassOf(chord.root);
  return [...tones].sort((a, b) => mod12(a.pc - rootPc) - mod12(b.pc - rootPc));
}

function rotateToPc(tones: PlannedTone[], pc: number): PlannedTone[] | null {
  const index = tones.findIndex((tone) => tone.pc === pc);
  if (index < 0) {
    return null;
  }
  return [...tones.slice(index), ...tones.slice(0, index)];
}

function slashBassPc(chord: ChordDefinition): number | null {
  if (!chord.bass) {
    return null;
  }
  const bassPc = pitchClassOf(chord.bass);
  return bassPc === pitchClassOf(chord.root) ? null : bassPc;
}

type RootlessGroup = "minor" | "major" | "dominant" | "halfDim";

function rootlessGroup(chord: ChordDefinition): RootlessGroup | null {
  switch (chord.quality) {
    case "min7":
    case "min9":
    case "min11":
    case "min13":
      return "minor";
    case "maj7":
    case "maj9":
    case "maj13":
      return "major";
    case "dom7":
    case "dom9":
    case "dom13":
      return "dominant";
    case "halfDim7":
      return "halfDim";
    default:
      return null;
  }
}

type RootlessSlot = "third" | "fifth" | "seventh" | "root" | "ninthOrRoot" | "thirteenthOrFifth";

/** Bottom-to-top rootless shapes (see recipes.ts header for the A/B naming convention). */
const ROOTLESS_FORMS: Readonly<Record<"a" | "b", Readonly<Record<RootlessGroup, RootlessSlot[]>>>> = {
  a: {
    minor: ["third", "fifth", "seventh", "ninthOrRoot"],
    major: ["third", "fifth", "seventh", "ninthOrRoot"],
    dominant: ["seventh", "ninthOrRoot", "third", "thirteenthOrFifth"],
    halfDim: ["third", "fifth", "seventh", "root"]
  },
  b: {
    minor: ["seventh", "ninthOrRoot", "third", "fifth"],
    major: ["seventh", "ninthOrRoot", "third", "fifth"],
    dominant: ["third", "thirteenthOrFifth", "seventh", "ninthOrRoot"],
    halfDim: ["seventh", "root", "third", "fifth"]
  }
};

function planRootless(recipe: VoicingRecipe, chord: ChordDefinition, spellings: Map<DegreeLabel, SpelledPitchClass>): PlanResult {
  const group = rootlessGroup(chord);
  if (group === null) {
    return { ok: false, reason: `${recipe.id} has no curated shape for ${chord.qualityLabel} chords.` };
  }
  const form = recipe.id === "rootless-b" ? ROOTLESS_FORMS.b : ROOTLESS_FORMS.a;
  const omissionReasons = new Map<DegreeLabel, string>();
  const notes: string[] = [];
  const root = roleDegree(chord, "root");
  const tones: PlannedTone[] = [];
  for (const slot of form[group]) {
    let degree: ChordDegree | undefined;
    if (slot === "third") {
      degree = roleDegree(chord, "third");
    } else if (slot === "fifth") {
      degree = roleDegree(chord, "fifth");
    } else if (slot === "seventh") {
      degree = roleDegree(chord, "seventh");
    } else if (slot === "root") {
      degree = root;
      if (group === "halfDim") {
        notes.push(`Half-diminished: the root ${formatPitchClass(chord.root)} stays in the shape because the natural 9 clashes and an 11 is not written in ${chord.symbol}.`);
      }
    } else if (slot === "ninthOrRoot") {
      degree = roleDegree(chord, "ninth");
      if (!degree) {
        degree = root;
        notes.push(`${chord.symbol} has no written 9, so the root ${formatPitchClass(chord.root)} takes the ninth's place; write the 9 to hear the colour.`);
      }
    } else {
      degree = roleDegree(chord, "thirteenth");
      const fifth = roleDegree(chord, "fifth");
      if (degree && fifth) {
        omissionReasons.set(fifth.label, `the ${degree.label} takes the fifth's place in this dominant shape`);
      }
      if (!degree) {
        degree = fifth;
      }
    }
    if (!degree) {
      return { ok: false, reason: `${chord.symbol} has no ${slot} for the ${recipe.name} shape.` };
    }
    tones.push(toPlanned(chord, degree, spellings));
  }
  if (dedupeByPc(tones).length !== tones.length) {
    return { ok: false, reason: `${recipe.name} would double a pitch class in ${chord.symbol}.` };
  }
  return { ok: true, plan: { tones, arrangement: { kind: "ordered" }, omissionReasons, notes, trimmable: false } };
}

function buildPlan(recipe: VoicingRecipe, chord: ChordDefinition): PlanResult {
  const spellings = degreeSpellings(chord);
  const planned = (degree: ChordDegree | undefined): PlannedTone | null => (degree ? toPlanned(chord, degree, spellings) : null);
  const compact = (list: Array<PlannedTone | null>): PlannedTone[] => list.filter((tone): tone is PlannedTone => tone !== null);
  const omissionReasons = new Map<DegreeLabel, string>();
  const notes: string[] = [];
  const bassPc = slashBassPc(chord);
  const bassName = chord.bass ? formatPitchClass(chord.bass) : "";

  switch (recipe.id) {
    case "close-rp": {
      let tones = sortCloseFromRoot(chord, dedupeByPc(chord.degrees.map((degree) => toPlanned(chord, degree, spellings))));
      if (bassPc !== null) {
        const rotated = rotateToPc(tones, bassPc);
        if (!rotated) {
          return { ok: false, reason: `The slash bass ${bassName} is not a tone of ${chord.symbol}; close-rp cannot place it — try close-triads-rh or another recipe with an accompaniment bass.` };
        }
        tones = rotated;
        notes.push(`Slash bass: ${bassName} is the lowest note.`);
      }
      return { ok: true, plan: { tones, arrangement: { kind: "ordered" }, omissionReasons, notes, trimmable: true } };
    }
    case "close-triads-rh":
    case "close-sevenths-rh": {
      const core = compact([planned(roleDegree(chord, "root")), planned(thirdLike(chord, true)), planned(roleDegree(chord, "fifth"))]);
      if (recipe.id === "close-sevenths-rh") {
        const seventh = planned(roleDegree(chord, "seventh"));
        if (seventh) {
          core.push(seventh);
        }
        chord.degrees.forEach((degree) => {
          if (degree.role === "ninth" || degree.role === "eleventh" || degree.role === "thirteenth") {
            if (degree.essential) {
              core.push(toPlanned(chord, degree, spellings));
            } else {
              omissionReasons.set(degree.label, `implied extension; ${recipe.id} adds only the named extension and written alterations`);
            }
          }
        });
      }
      const tones = sortCloseFromRoot(chord, dedupeByPc(core));
      let lowestPc: number | undefined;
      if (bassPc !== null) {
        if (tones.some((tone) => tone.pc === bassPc)) {
          lowestPc = bassPc;
          notes.push(`Slash bass: ${bassName} is the lowest learner note (and the accompaniment bass).`);
        } else {
          notes.push(`Slash bass ${bassName} is not a chord tone; it is left to the accompaniment.`);
        }
      }
      return { ok: true, plan: { tones, arrangement: { kind: "rotations", lowestPc }, omissionReasons, notes, trimmable: false } };
    }
    case "open": {
      if (bassPc !== null) {
        return { ok: false, reason: `open is a root-position spread; ${chord.symbol} asks for ${bassName} in the bass — try close-rp, which honours the slash bass.` };
      }
      const tones = compact([planned(roleDegree(chord, "root")), planned(roleDegree(chord, "fifth")), planned(thirdLike(chord, true)), planned(seventhOrSixth(chord))]);
      return { ok: true, plan: { tones: dedupeByPc(tones), arrangement: { kind: "ordered" }, omissionReasons, notes, trimmable: true } };
    }
    case "shell-137":
    case "shell-137-rh": {
      if (recipe.id === "shell-137" && bassPc !== null) {
        return { ok: false, reason: `shell-137 is a root-position shape; ${chord.symbol} asks for ${bassName} in the bass — try shell-137-rh over the accompaniment bass, or close-rp.` };
      }
      const seventh = seventhOrSixth(chord);
      if (seventh && seventh.role === "sixth") {
        notes.push(`In a 6 chord the sixth (${seventh.label}) takes the seventh's place.`);
      }
      const tones = compact([planned(roleDegree(chord, "root")), planned(roleDegree(chord, "third")), planned(seventh)]);
      const arrangement: Arrangement = recipe.id === "shell-137" ? { kind: "ordered" } : { kind: "rotations" };
      return { ok: true, plan: { tones: dedupeByPc(tones), arrangement, omissionReasons, notes, trimmable: false } };
    }
    case "guide-tones-37": {
      const tones = compact([planned(roleDegree(chord, "third")), planned(roleDegree(chord, "seventh"))]);
      return { ok: true, plan: { tones: sortCloseFromRoot(chord, tones), arrangement: { kind: "rotations" }, omissionReasons, notes, trimmable: false } };
    }
    case "rootless-a":
    case "rootless-b":
      return planRootless(recipe, chord, spellings);
    default:
      return { ok: false, reason: `Recipe "${recipe.id}" has no tone plan in this engine.` };
  }
}

function genericOmissionReason(recipe: VoicingRecipe, degree: ChordDegree): string {
  const extension = degree.role === "ninth" || degree.role === "eleventh" || degree.role === "thirteenth";
  switch (recipe.family) {
    case "rootless":
      if (degree.role === "root") {
        return "rootless recipe leaves the root to the bass";
      }
      return `${recipe.name} has four voices; the ${degree.label} does not fit the shape`;
    case "shell":
      if (degree.role === "fifth") {
        return "shell omits the fifth";
      }
      if (extension) {
        return `the shell plays only root, third and seventh; the ${degree.label} is left for the other hand or the melody`;
      }
      break;
    case "guideTone":
      if (degree.role === "root") {
        return "guide tones leave the root to the bass";
      }
      if (degree.role === "fifth") {
        return "guide tones omit the fifth";
      }
      return `guide tones are the third and seventh only; the ${degree.label} is left out`;
    case "open":
      if (extension || degree.role === "added") {
        return `open position spreads the core chord; the ${degree.label} is left out`;
      }
      break;
    default:
      break;
  }
  if (degree.role === "root" && recipe.accompanimentBass) {
    return "the accompaniment plays the root";
  }
  return `${recipe.name} does not use the ${degree.role} (${degree.label})`;
}

function trimToCount(plan: TonePlan, max: number, chord: ChordDefinition): TonePlan {
  if (!plan.trimmable || plan.tones.length <= max) {
    return plan;
  }
  const tones = [...plan.tones];
  const reasons = new Map<DegreeLabel, string>(plan.omissionReasons);
  // Drop non-essential tones: the plain fifth first, then implied extensions from the top.
  const order = [...tones]
    .filter((tone) => !tone.essential && tone.role !== "root")
    .sort((a, b) => {
      const rank = (tone: PlannedTone): number => (tone.role === "fifth" ? 0 : 1);
      if (rank(a) !== rank(b)) {
        return rank(a) - rank(b);
      }
      const da = chord.degrees.find((degree) => degree.label === a.label);
      const db = chord.degrees.find((degree) => degree.label === b.label);
      return (db ? db.semitones : 0) - (da ? da.semitones : 0);
    });
  for (const tone of order) {
    if (tones.length <= max) {
      break;
    }
    const index = tones.indexOf(tone);
    if (index >= 0) {
      tones.splice(index, 1);
      reasons.set(tone.label, `dropped to meet the note-count limit of ${max}`);
    }
  }
  return { ...plan, tones, omissionReasons: reasons };
}

// ---------------------------------------------------------------------------
// Candidate generation
// ---------------------------------------------------------------------------

interface Candidate {
  midis: number[];
  tones: PlannedTone[];
}

function arrangementsOf(plan: TonePlan): PlannedTone[][] {
  if (plan.arrangement.kind === "ordered") {
    return [plan.tones];
  }
  const lowestPc = plan.arrangement.lowestPc;
  const result: PlannedTone[][] = [];
  for (let i = 0; i < plan.tones.length; i += 1) {
    const rotation = [...plan.tones.slice(i), ...plan.tones.slice(0, i)];
    if (lowestPc === undefined || rotation[0].pc === lowestPc) {
      result.push(rotation);
    }
  }
  return result;
}

function stackOffsets(tones: PlannedTone[]): number[] {
  const offsets: number[] = [];
  tones.forEach((tone, index) => {
    if (index === 0) {
      offsets.push(0);
      return;
    }
    const step = mod12(tone.pc - tones[index - 1].pc - 1) + 1;
    offsets.push(offsets[index - 1] + step);
  });
  return offsets;
}

function placements(arrangement: PlannedTone[], low: number, high: number): Candidate[] {
  const offsets = stackOffsets(arrangement);
  const width = offsets[offsets.length - 1];
  const result: Candidate[] = [];
  const firstPc = arrangement[0].pc;
  let base = low + mod12(firstPc - low);
  for (; base + width <= high; base += 12) {
    result.push({ midis: offsets.map((offset) => base + offset), tones: arrangement });
  }
  return result;
}

function spellAt(spelling: SpelledPitchClass, midi: number): SpelledNote {
  const octave = Math.round((midi - LETTER_PITCH_CLASS[spelling.letter] - spelling.accidental) / 12) - 1;
  return { letter: spelling.letter, accidental: spelling.accidental, octave };
}

function isOneHand(hand: Hand): boolean {
  return hand === "left" || hand === "right" || hand === "either";
}

/** Index of the first note of the upper hand when splitting at the largest gap. */
function splitIndex(midis: number[]): number {
  let bestIndex = 1;
  let bestGap = -1;
  for (let i = 1; i < midis.length; i += 1) {
    const gap = midis[i] - midis[i - 1];
    if (gap > bestGap) {
      bestGap = gap;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function handsFit(midis: number[], hand: Hand): boolean {
  if (isOneHand(hand)) {
    return midis[midis.length - 1] - midis[0] <= ONE_HAND_MAX_SPAN;
  }
  if (midis.length < 2) {
    return true;
  }
  const split = splitIndex(midis);
  const lower = midis.slice(0, split);
  const upper = midis.slice(split);
  return lower[lower.length - 1] - lower[0] <= ONE_HAND_MAX_SPAN && upper[upper.length - 1] - upper[0] <= ONE_HAND_MAX_SPAN;
}

interface RankKey {
  motion: number;
  centre: number;
  span: number;
  top: number;
  midis: number[];
}

function rankKey(candidate: Candidate, centre: number, previous: number[] | null): RankKey {
  const midis = candidate.midis;
  const mean = midis.reduce((sum, midi) => sum + midi, 0) / midis.length;
  return {
    motion: previous && previous.length > 0 ? matchVoices(previous, midis).cost : 0,
    centre: Math.abs(mean - centre),
    span: midis[midis.length - 1] - midis[0],
    top: midis[midis.length - 1],
    midis
  };
}

const EPSILON = 1e-9;

function compareKeys(a: RankKey, b: RankKey): number {
  if (a.motion !== b.motion) {
    return a.motion - b.motion;
  }
  if (Math.abs(a.centre - b.centre) > EPSILON) {
    return a.centre - b.centre;
  }
  if (a.span !== b.span) {
    return a.span - b.span;
  }
  if (a.top !== b.top) {
    return a.top - b.top;
  }
  const length = Math.min(a.midis.length, b.midis.length);
  for (let i = 0; i < length; i += 1) {
    if (a.midis[i] !== b.midis[i]) {
      return a.midis[i] - b.midis[i];
    }
  }
  return a.midis.length - b.midis.length;
}

// ---------------------------------------------------------------------------
// Instance building
// ---------------------------------------------------------------------------

function lowerFirst(text: string): string {
  return text.length > 0 ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

function noteList(notes: VoicedNote[]): string {
  return notes.map((note) => formatSpelledNote(note.spelled)).join(" ");
}

/** The root (or slash bass) placed in the accompaniment register, for recipes that expect it. */
export function accompanimentBassNote(chord: ChordDefinition): VoicedNote {
  const spelling: SpelledPitchClass = chord.bass ?? chord.root;
  const pc = pitchClassOf(spelling);
  const midi = ACCOMPANIMENT_BASS_RANGE.low + mod12(pc - ACCOMPANIMENT_BASS_RANGE.low);
  let degree: DegreeLabel = "1";
  let role: ChordRole = "root";
  if (chord.bass && pc !== pitchClassOf(chord.root)) {
    const analysis = analyzeSlashBass(chord);
    if (analysis.kind === "chordTone") {
      degree = analysis.degree.label;
      role = analysis.degree.role;
    } else if (analysis.kind === "nonChordTone") {
      degree = analysis.relativeLabel;
      role = "added";
    }
  }
  return {
    midi,
    spelled: spellAt({ letter: spelling.letter, accidental: spelling.accidental }, midi),
    degree,
    role,
    hand: "left",
    voiceId: "bass"
  };
}

function buildOmitted(recipe: VoicingRecipe, chord: ChordDefinition, plan: TonePlan): OmittedTone[] {
  const played = new Set<DegreeLabel>(plan.tones.map((tone) => tone.label));
  const playedPcs = new Set<number>(plan.tones.map((tone) => tone.pc));
  const result: OmittedTone[] = [];
  chord.degrees.forEach((degree) => {
    if (played.has(degree.label)) {
      return;
    }
    let reason = plan.omissionReasons.get(degree.label) ?? genericOmissionReason(recipe, degree);
    if (playedPcs.has(degreePc(chord, degree))) {
      reason = `same pitch class as another played tone; ${reason}`;
    }
    result.push({ role: degree.role, degree: degree.label, reason });
  });
  return result;
}

function buildInstance(
  recipe: VoicingRecipe,
  chord: ChordDefinition,
  plan: TonePlan,
  candidate: Candidate,
  hand: Hand,
  omitted: OmittedTone[]
): VoicingInstance {
  const split = hand === "both" ? splitIndex(candidate.midis) : candidate.midis.length;
  const notes: VoicedNote[] = candidate.midis.map((midi, index) => {
    const tone = candidate.tones[index];
    let noteHand: Hand = hand;
    if (hand === "both") {
      noteHand = index < split ? "left" : "right";
    }
    return {
      midi,
      spelled: spellAt(tone.spelling, midi),
      degree: tone.label,
      role: tone.role,
      hand: noteHand,
      voiceId: `v${index + 1}`
    };
  });
  const explanation: string[] = [];
  const parts = notes.map((note) => `${formatPitchClass(note.spelled)} (${note.degree})`).join(", ");
  let headline = `${chord.symbol} ${lowerFirst(recipe.name)}: ${parts}`;
  const instance: VoicingInstance = {
    id: `${recipe.id}:${chord.symbol}:${candidate.midis.join(".")}`,
    chord,
    recipeId: recipe.id,
    notes,
    omitted,
    explanation
  };
  if (recipe.accompanimentBass) {
    const bass = accompanimentBassNote(chord);
    instance.accompanimentBass = bass;
    const rootPlayed = notes.some((note) => note.role === "root");
    const bassName = formatPitchClass(bass.spelled);
    if (chord.bass && pitchClassOf(chord.bass) !== pitchClassOf(chord.root)) {
      headline += `; slash bass ${bassName} in the accompaniment`;
    } else if (!rootPlayed) {
      headline += `; root ${bassName} left to accompaniment`;
    } else {
      headline += `; accompaniment doubles the root ${bassName}`;
    }
  }
  explanation.push(headline);
  plan.notes.forEach((note) => explanation.push(note));
  omitted.forEach((tone) => explanation.push(`${tone.degree} omitted: ${tone.reason}.`));
  if (hand === "both") {
    const left = notes.filter((note) => note.hand === "left");
    const right = notes.filter((note) => note.hand === "right");
    explanation.push(`Left hand: ${noteList(left)}; right hand: ${noteList(right)} (split at the largest gap).`);
  }
  return instance;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function intersectCount(a: { min: number; max: number }, b: { min: number; max: number } | undefined): { min: number; max: number } {
  if (!b) {
    return { min: a.min, max: a.max };
  }
  return { min: Math.max(a.min, b.min), max: Math.min(a.max, b.max) };
}

function midiName(midi: number, tones: PlannedTone[]): string {
  const tone = tones.find((item) => item.pc === mod12(midi));
  if (tone) {
    return formatSpelledNote(spellAt(tone.spelling, midi));
  }
  return `MIDI ${midi}`;
}

function lockCheck(
  kind: "melody" | "bass",
  midi: number,
  recipe: VoicingRecipe,
  chord: ChordDefinition,
  plan: TonePlan,
  low: number,
  high: number
): string | null {
  const pc = mod12(midi);
  const chordDegree = chord.degrees.find((degree) => degreePc(chord, degree) === pc);
  if (!plan.tones.some((tone) => tone.pc === pc)) {
    if (!chordDegree) {
      return `The ${kind} note MIDI ${midi} is not a chord tone of ${chord.symbol}; the voicing will not change a pitch class to fit it.`;
    }
    return `The ${kind} note MIDI ${midi} is the ${chordDegree.label} of ${chord.symbol}, which ${recipe.id} does not play.`;
  }
  if (midi < low || midi > high) {
    return `The ${kind} note ${midiName(midi, plan.tones)} lies outside the available range ${low}..${high} for ${recipe.id}.`;
  }
  return null;
}

/**
 * Realise a recipe for a chord. Returns the best candidate and up to MAX_ALTERNATIVES others,
 * or `{ ok: false, reason }` — never a pitch-class-altered voicing.
 */
export function realizeVoicing(chord: ChordDefinition, recipeId: string, constraints: VoicingConstraints = {}): VoicingResult {
  const support = recipeSupport(chord, recipeId);
  if (!support.ok) {
    return { ok: false, reason: support.reason };
  }
  const recipe = support.recipe;
  const planned = buildPlan(recipe, chord);
  if (!planned.ok) {
    return { ok: false, reason: planned.reason };
  }
  const count = intersectCount(recipe.noteCount, constraints.noteCount);
  if (count.min > count.max) {
    return { ok: false, reason: `The note-count constraint ${constraints.noteCount ? `${constraints.noteCount.min}..${constraints.noteCount.max}` : ""} does not overlap ${recipe.id}'s ${recipe.noteCount.min}..${recipe.noteCount.max}.` };
  }
  const plan = trimToCount(planned.plan, count.max, chord);
  if (plan.tones.length < count.min || plan.tones.length > count.max) {
    return {
      ok: false,
      reason: `${recipe.id} gives ${plan.tones.length} notes for ${chord.symbol}, outside the allowed ${count.min}..${count.max}; notes are not silently removed or added.`
    };
  }

  // Explicit minMidi/maxMidi replace the recipe's DEFAULT register bound (they may widen or
  // narrow it); an unspecified bound falls back to the recipe register.
  const low = constraints.minMidi ?? recipe.register.low;
  const high = constraints.maxMidi ?? recipe.register.high;
  if (low > high) {
    return {
      ok: false,
      reason: `The available range ${low}..${high} is empty (requested ${constraints.minMidi ?? "-"}..${constraints.maxMidi ?? "-"}, ${recipe.id} default register ${recipe.register.low}..${recipe.register.high}).`
    };
  }
  if (constraints.melodyMidi !== undefined) {
    const problem = lockCheck("melody", constraints.melodyMidi, recipe, chord, plan, low, high);
    if (problem) {
      return { ok: false, reason: problem };
    }
  }
  if (constraints.bassMidi !== undefined) {
    const problem = lockCheck("bass", constraints.bassMidi, recipe, chord, plan, low, high);
    if (problem) {
      return { ok: false, reason: problem };
    }
  }

  const hand: Hand = constraints.hand ?? recipe.hand;
  const spanLimits: number[] = [];
  if (recipe.maxSpanSemitones !== undefined) {
    spanLimits.push(recipe.maxSpanSemitones);
  }
  if (constraints.maxSpanSemitones !== undefined) {
    spanLimits.push(constraints.maxSpanSemitones);
  }
  const maxSpan = spanLimits.length > 0 ? Math.min(...spanLimits) : Number.POSITIVE_INFINITY;

  const generated: Candidate[] = [];
  arrangementsOf(plan).forEach((arrangement) => {
    placements(arrangement, low, high).forEach((candidate) => generated.push(candidate));
  });
  if (generated.length === 0) {
    const widths = arrangementsOf(plan).map((arrangement) => {
      const offsets = stackOffsets(arrangement);
      return offsets[offsets.length - 1];
    });
    return {
      ok: false,
      reason: `No ${recipe.id} shape for ${chord.symbol} fits within MIDI ${low}..${high} (the shape needs at least ${Math.min(...widths)} semitones); pitch classes are never changed to fit.`
    };
  }
  const rejected = { span: 0, hand: 0, bass: 0, melody: 0 };
  const valid = generated.filter((candidate) => {
    const midis = candidate.midis;
    const span = midis[midis.length - 1] - midis[0];
    if (span > maxSpan) {
      rejected.span += 1;
      return false;
    }
    if (!handsFit(midis, hand)) {
      rejected.hand += 1;
      return false;
    }
    if (constraints.bassMidi !== undefined && midis[0] !== constraints.bassMidi) {
      rejected.bass += 1;
      return false;
    }
    if (constraints.melodyMidi !== undefined && midis[midis.length - 1] !== constraints.melodyMidi) {
      rejected.melody += 1;
      return false;
    }
    return true;
  });
  if (valid.length === 0) {
    const details = [
      `${generated.length} placement(s) considered in MIDI ${low}..${high}`,
      `${rejected.span} too wide for max span ${maxSpan}`,
      `${rejected.hand} beyond the ${ONE_HAND_MAX_SPAN}-semitone one-hand span`,
      `${rejected.bass} with another lowest note`,
      `${rejected.melody} with another top note`
    ];
    let reason: string;
    if (constraints.melodyMidi !== undefined && rejected.melody > 0) {
      reason = `No ${recipe.id} shape for ${chord.symbol} puts ${midiName(constraints.melodyMidi, plan.tones)} on top within MIDI ${low}..${high}.`;
    } else if (constraints.bassMidi !== undefined && rejected.bass > 0) {
      reason = `No ${recipe.id} shape for ${chord.symbol} has ${midiName(constraints.bassMidi, plan.tones)} as its lowest note within MIDI ${low}..${high}.`;
    } else if (rejected.hand > 0) {
      reason = isOneHand(hand)
        ? `Every ${recipe.id} shape for ${chord.symbol} spans more than ${ONE_HAND_MAX_SPAN} semitones, too wide for one hand (${hand}).`
        : `Every ${recipe.id} shape for ${chord.symbol} leaves a hand spanning more than ${ONE_HAND_MAX_SPAN} semitones.`;
    } else {
      reason = `Every ${recipe.id} shape for ${chord.symbol} is wider than the ${maxSpan}-semitone span limit.`;
    }
    return { ok: false, reason, details };
  }

  const centre = registerCentre(recipe);
  const previous = constraints.previous ? constraints.previous.notes.map((note) => note.midi).sort((a, b) => a - b) : null;
  const ranked = valid
    .map((candidate) => ({ candidate, key: rankKey(candidate, centre, previous) }))
    .sort((a, b) => compareKeys(a.key, b.key));
  const omitted = buildOmitted(recipe, chord, plan);
  const instances = ranked.slice(0, MAX_ALTERNATIVES + 1).map((entry) => buildInstance(recipe, chord, plan, entry.candidate, hand, omitted.map((tone) => ({ ...tone }))));
  const best = instances[0];
  const bestKey = ranked[0].key;
  if (previous) {
    best.explanation.push(`Chosen for the smallest movement from the previous voicing (${bestKey.motion} semitone${bestKey.motion === 1 ? "" : "s"} in total).`);
  } else {
    best.explanation.push(`Chosen as the placement closest to the ${recipe.id} register centre (MIDI ${centre}).`);
  }
  instances.slice(1).forEach((instance, index) => {
    const key = ranked[index + 1].key;
    instance.explanation.push(
      previous
        ? `Alternative ${index + 1}: ${key.motion} semitones of movement from the previous voicing.`
        : `Alternative ${index + 1}: mean pitch ${key.centre.toFixed(1)} semitones from the register centre.`
    );
  });
  return { ok: true, voicing: best, alternatives: instances.slice(1) };
}

export interface RecipeRealization {
  recipeId: string;
  recipe: VoicingRecipe;
  result: VoicingResult;
}

/** Every catalogue recipe realised for one chord (inspectors filter on `result.ok`). */
export function realizeAll(chord: ChordDefinition, constraints: VoicingConstraints = {}): RecipeRealization[] {
  return VOICING_RECIPES.map((recipe) => ({ recipeId: recipe.id, recipe, result: realizeVoicing(chord, recipe.id, constraints) }));
}

/**
 * Adapter around src/music `inversion()`: inversion `n` in close position with the lowest note
 * in `octave`, as a VoicingInstance with recipeId "close-rp" (right hand, every chord tone).
 * Returns `{ ok: false }` when the chord has no such inversion.
 */
export function inversionVoicing(chord: ChordDefinition, inversionIndex: number, octave: number = 4): VoicingResult {
  const result = inversion(chord, inversionIndex, octave);
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }
  const notes: VoicedNote[] = result.notes.map((tone, index) => ({
    midi: tone.midi,
    spelled: { letter: tone.spelled.letter, accidental: tone.spelled.accidental, octave: tone.spelled.octave },
    degree: tone.degree.label,
    role: tone.degree.role,
    hand: "right",
    voiceId: `v${index + 1}`
  }));
  const explanation: string[] = [result.explanation];
  const core = coreDegrees(chord);
  if (result.inversion === 0) {
    explanation.push(`Root position: nothing moved; the root ${formatPitchClass(chord.root)} is the lowest note.`);
  } else {
    const moved = core.slice(0, result.inversion).map((degree) => `${degree.role} (${degree.label})`);
    explanation.push(
      `The ${moved.join(" and ")} moved up an octave, so the ${result.bassDegree.role} (${result.bassDegree.label}) is now lowest; the chord is still ${chord.symbol} with root ${formatPitchClass(chord.root)}.`
    );
  }
  const voicing: VoicingInstance = {
    id: `close-rp:${chord.symbol}:inv${result.inversion}:${notes.map((note) => note.midi).join(".")}`,
    chord,
    recipeId: "close-rp",
    notes,
    omitted: [],
    explanation
  };
  return { ok: true, voicing, alternatives: [] };
}
