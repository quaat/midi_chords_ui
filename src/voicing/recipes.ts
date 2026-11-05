/**
 * Explicit, teachable voicing recipes (plan §4 "Voicings that can be taught and explained", E06).
 *
 * Every recipe declares its supported qualities, the roles it requires/allows/omits, hand,
 * note count, default register and whether an accompaniment part supplies the bass. The
 * engine (src/voicing/engine.ts) realises recipes; it never invents pitch classes.
 *
 * Register centres: ranking prefers candidates whose mean pitch is closest to the recipe's
 * register centre. The centre is the midpoint of `register` unless `REGISTER_CENTRES`
 * overrides it (see `registerCentre`). Overrides: "close-triads-rh" = 64 (E4) so a beginner's
 * C triad defaults to C4–E4–G4 instead of G4–C5–E5; "open" = 57 so the left hand of a spread
 * chord starts around C3 rather than C4. The rootless fixture of plan §7 (Dm9 F3 A3 C4 E4,
 * G13 F3 A3 B3 E4, Cmaj9 E3 G3 B3 D4) holds with the plain midpoint (62) of 52..72, because each
 * rootless shape has exactly one placement inside that register.
 *
 * Rootless A/B naming (important — traditions differ): this catalogue follows the
 * progression-based convention used in e.g. Mark Levine's teaching, where an "A" ii–V–I puts
 * the THIRD at the bottom of the ii and I chords and the SEVENTH at the bottom of the
 * dominant (Dm9 F-A-C-E, G13 F-A-B-E, Cmaj9 E-G-B-D), so the hand barely moves. The "B"
 * forms invert that (Dm9 C-E-F-A, G13 B-E-F-A, Cmaj9 B-D-E-G). Other teachers call every
 * third-on-the-bottom shape "A" regardless of chord quality; under that naming the dominant
 * shapes here would swap letters. Learner-facing text should show the actual degrees.
 *
 * No recipe here has been reviewed by a pianist yet (`reviewed: false`).
 */
import type { ChordQualityId, VoicingRecipe } from "@/model/contracts";

const TRIAD_QUALITIES: ChordQualityId[] = ["maj", "min", "dim", "aug", "sus2", "sus4"];

const SEVENTH_QUALITIES: ChordQualityId[] = ["dom7", "maj7", "min7", "minMaj7", "dim7", "halfDim7"];

const EXTENDED_QUALITIES: ChordQualityId[] = ["dom9", "maj9", "min9", "dom11", "maj11", "min11", "dom13", "maj13", "min13"];

const SIXTH_QUALITIES: ChordQualityId[] = ["maj6", "min6"];

/** Qualities with a usable root-third-seventh (or sixth) shell. */
const SHELL_QUALITIES: ChordQualityId[] = [...SEVENTH_QUALITIES, ...SIXTH_QUALITIES, ...EXTENDED_QUALITIES];

/** Qualities with a curated rootless shape (see module header and engine ROOTLESS_FORMS). */
const ROOTLESS_QUALITIES: ChordQualityId[] = ["min7", "min9", "min11", "min13", "dom7", "dom9", "dom13", "maj7", "maj9", "maj13", "halfDim7"];

const ALL_BUT_POWER: ChordQualityId[] = [...TRIAD_QUALITIES, ...SIXTH_QUALITIES, ...SEVENTH_QUALITIES, ...EXTENDED_QUALITIES];

export const VOICING_RECIPES: VoicingRecipe[] = [
  {
    id: "close-rp",
    family: "close",
    name: "Close position, root position",
    description: "Every chord tone once, root lowest, all other tones packed within the octave above it.",
    supportedQualities: ALL_BUT_POWER,
    requiredRoles: ["root", "third"],
    optionalRoles: ["fifth", "sixth", "seventh", "ninth", "eleventh", "thirteenth", "suspension", "added"],
    omittedRoles: [],
    hand: "right",
    noteCount: { min: 3, max: 7 },
    register: { low: 55, high: 84 },
    maxSpanSemitones: 12,
    accompanimentBass: false,
    teachingNotes:
      "Root position means the root is the lowest note; close position means no chord tone could fit between neighbouring voices. With extensions the tones become a cluster inside one octave. An explicit slash bass is honoured as the lowest note. A suspension (2 or 4) stands in for the third in sus chords.",
    reviewed: false,
    context: ["generic", "classical", "pop"]
  },
  {
    id: "close-triads-rh",
    family: "close",
    name: "Close triads (right hand)",
    description: "Three-note close triads in the right hand, any inversion, over an accompaniment root.",
    supportedQualities: TRIAD_QUALITIES,
    requiredRoles: ["root", "third", "fifth"],
    optionalRoles: [],
    omittedRoles: [],
    hand: "right",
    noteCount: { min: 3, max: 3 },
    register: { low: 60, high: 84 },
    maxSpanSemitones: 12,
    accompanimentBass: true,
    teachingNotes:
      "Inversions are chosen for smooth movement between chords. When the symbol has a slash bass that is a triad tone (C/E), that tone is the lowest learner note (E–G–C) and the accompaniment also plays it. A suspension stands in for the third in sus chords.",
    reviewed: false,
    context: ["generic", "pop", "classical"]
  },
  {
    id: "close-sevenths-rh",
    family: "close",
    name: "Close sevenths (right hand)",
    description: "Root, third, fifth and seventh (plus the named extension) in close position, any inversion, over an accompaniment root.",
    supportedQualities: [...SEVENTH_QUALITIES, ...EXTENDED_QUALITIES],
    requiredRoles: ["root", "third", "fifth", "seventh"],
    optionalRoles: ["ninth", "eleventh", "thirteenth"],
    omittedRoles: [],
    hand: "right",
    noteCount: { min: 4, max: 6 },
    register: { low: 55, high: 84 },
    maxSpanSemitones: 12,
    accompanimentBass: true,
    teachingNotes:
      "Only the extension that names the chord (9 in Cm9, 13 in G13) and written alterations of 9/11/13 are added; implied lower extensions are left out and listed. A slash bass that is a chord tone becomes the lowest learner note.",
    reviewed: false,
    context: ["generic", "pop", "jazz"]
  },
  {
    id: "open",
    family: "open",
    name: "Open position",
    description: "Root, fifth, then third (and seventh or sixth) spread over more than an octave, split between the hands.",
    supportedQualities: ALL_BUT_POWER,
    requiredRoles: ["root", "third"],
    optionalRoles: ["fifth", "seventh", "sixth"],
    omittedRoles: ["ninth", "eleventh", "thirteenth", "added"],
    hand: "both",
    noteCount: { min: 3, max: 4 },
    register: { low: 40, high: 84 },
    accompanimentBass: false,
    teachingNotes:
      "Open position spreads the core chord (1–5–3–7) so the third sits above the fifth. Extensions are left out and listed. The hands split at the largest gap; each hand must stay within an octave.",
    reviewed: false,
    context: ["generic", "classical", "pop"]
  },
  {
    id: "shell-137",
    family: "shell",
    name: "Shell 1–3–7 (left hand)",
    description: "Three-note left-hand shell: root, third and seventh (sixth in 6 chords); the fifth and extensions are left out.",
    supportedQualities: SHELL_QUALITIES,
    requiredRoles: ["root", "third", "seventh"],
    optionalRoles: ["sixth"],
    omittedRoles: ["fifth", "ninth", "eleventh", "thirteenth"],
    hand: "left",
    noteCount: { min: 3, max: 3 },
    register: { low: 43, high: 67 },
    maxSpanSemitones: 12,
    accompanimentBass: false,
    teachingNotes:
      "The third and seventh define the chord's quality; the fifth adds little and is omitted. In 6 chords the sixth takes the seventh's place. Only the 1–3–7 shape is offered: the 1–7–3 (tenth) shape exceeds the one-hand octave limit used here. Root position only — a slash bass other than the root is rejected.",
    reviewed: false,
    context: ["jazz"]
  },
  {
    id: "shell-137-rh",
    family: "shell",
    name: "Shell 1–3–7 (right hand)",
    description: "Root, third and seventh in the right hand, any inversion, over an accompaniment bass.",
    supportedQualities: SHELL_QUALITIES,
    requiredRoles: ["root", "third", "seventh"],
    optionalRoles: ["sixth"],
    omittedRoles: ["fifth", "ninth", "eleventh", "thirteenth"],
    hand: "right",
    noteCount: { min: 3, max: 3 },
    register: { low: 55, high: 79 },
    maxSpanSemitones: 12,
    accompanimentBass: true,
    teachingNotes: "Same tones as the left-hand shell; because the accompaniment plays the bass, the right hand may invert the shape for smoother movement.",
    reviewed: false,
    context: ["jazz"]
  },
  {
    id: "guide-tones-37",
    family: "guideTone",
    name: "Guide tones 3–7",
    description: "Two notes only: the third and the seventh, which carry the harmony's movement.",
    supportedQualities: [...SEVENTH_QUALITIES, ...EXTENDED_QUALITIES],
    requiredRoles: ["third", "seventh"],
    optionalRoles: [],
    omittedRoles: ["root", "fifth", "ninth", "eleventh", "thirteenth"],
    hand: "either",
    noteCount: { min: 2, max: 2 },
    register: { low: 52, high: 72 },
    maxSpanSemitones: 12,
    accompanimentBass: true,
    teachingNotes: "In a ii–V–I the seventh of one chord often becomes the third of the next by a half step while the other guide tone stays: listen for the line.",
    reviewed: false,
    context: ["jazz"]
  },
  {
    id: "rootless-a",
    family: "rootless",
    name: "Rootless A",
    description: "Four-note rootless colour voicing, A form: third at the bottom of minor/major chords, seventh at the bottom of dominants.",
    supportedQualities: ROOTLESS_QUALITIES,
    requiredRoles: ["third", "seventh"],
    optionalRoles: ["fifth", "ninth", "thirteenth"],
    omittedRoles: ["root"],
    hand: "left",
    noteCount: { min: 4, max: 4 },
    register: { low: 52, high: 72 },
    maxSpanSemitones: 12,
    accompanimentBass: true,
    teachingNotes:
      "A/B naming varies between teaching traditions. Here (progression-based convention, as in Levine): minor and major A = 3–5–7–9 (Dm9 F A C E, Cmaj9 E G B D); dominant A = b7–9–3–13 (G13 F A B E), using the 5 when there is no 13. Half-diminished keeps the root on top (b3–b5–b7–1) because the natural 9 clashes and an 11 is not in the written symbol. A seventh chord written without a 9 gets its root on top in the ninth's place — write the 9 to hear the colour. The bass (root) belongs to the accompaniment.",
    reviewed: false,
    context: ["jazz"]
  },
  {
    id: "rootless-b",
    family: "rootless",
    name: "Rootless B",
    description: "Four-note rootless colour voicing, B form: seventh at the bottom of minor/major chords, third at the bottom of dominants.",
    supportedQualities: ROOTLESS_QUALITIES,
    requiredRoles: ["third", "seventh"],
    optionalRoles: ["fifth", "ninth", "thirteenth"],
    omittedRoles: ["root"],
    hand: "left",
    noteCount: { min: 4, max: 4 },
    register: { low: 52, high: 72 },
    maxSpanSemitones: 12,
    accompanimentBass: true,
    teachingNotes:
      "A/B naming varies between teaching traditions. Here: minor and major B = 7–9–3–5 (Dm9 C E F A, Cmaj9 B D E G); dominant B = 3–13–b7–9 (G13 B E F A). Half-diminished: b7–1–b3–b5. See rootless-a for the fallbacks.",
    reviewed: false,
    context: ["jazz"]
  }
];

/** Older/alternative IDs accepted by getRecipe. */
export const RECIPE_ALIASES: Readonly<Record<string, string>> = {
  "guide-tones": "guide-tones-37"
};

/** Explicit register centres (MIDI) where the register midpoint is not the intended default. */
export const REGISTER_CENTRES: Readonly<Record<string, number>> = {
  "close-triads-rh": 64,
  open: 57
};

export function resolveRecipeId(id: string): string {
  return RECIPE_ALIASES[id] ?? id;
}

export function getRecipe(id: string): VoicingRecipe | undefined {
  const resolved = resolveRecipeId(id);
  return VOICING_RECIPES.find((recipe) => recipe.id === resolved);
}

export function registerCentre(recipe: VoicingRecipe): number {
  const override = REGISTER_CENTRES[recipe.id];
  return override !== undefined ? override : (recipe.register.low + recipe.register.high) / 2;
}

export function recipeIds(): string[] {
  return VOICING_RECIPES.map((recipe) => recipe.id);
}
