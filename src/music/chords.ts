/**
 * Spelled chord definitions and explorable chord operations (plan E04/E05).
 *
 * `chordFromSymbol` adapts the legacy parser (src/theory/chordParser.ts): every symbol the
 * legacy parser accepts is accepted here, and legacy error messages are rethrown unchanged.
 * The legacy semitone intervals are then upgraded to spelled `ChordDegree`s.
 *
 * Degree-label rules (semitones above the root -> label):
 *   0 "1" · 2 "2" (suspension when there is no third, otherwise added) · 3 "b3" · 4 "3"
 *   5 "4" (suspension when there is no third, otherwise added) · 6 "b5" · 7 "5" · 8 "#5"
 *   9 "6" (but "bb7" in a diminished seventh) · 10 "b7" · 11 "7" · 13 "b9" · 14 "9"
 *   15 "#9" · 17 "11" · 18 "#11" · 20 "b13" · 21 "13"
 * Tones in the quality's own definition keep its labels/roles; other tones are classified
 * as alterations (b5, #5, b9, #9, #11, b13), suspensions or added tones.
 *
 * Dominant/major 13 rule: the legacy parser stacks a natural 11 into "13" chords
 * (e.g. G13 -> 0 4 7 10 14 17 21). The spelled model omits that implied natural 11 for the
 * dom13 and maj13 qualities, because it clashes with the major third (conventional chord-
 * symbol practice: G13 = 1 3 5 b7 9 13). The omission is reported in
 * `analyzeChordSymbol(...).adjustments`. A written "add11" keeps it; minor 13 keeps its 11.
 *
 * Essential flags: root, third, seventh, sixth (of 6 chords) and suspensions are essential;
 * the fifth is essential only when altered (b5/#5) or in a power chord; the extension that
 * names the chord (9 in C9, 13 in C13) is essential while implied lower extensions are not;
 * written alterations and added tones are essential (removing them changes the symbol).
 */
import type { ChordDefinition, ChordDegree, ChordQualityId, ChordRole, DegreeLabel, Interval, SpelledNote, SpelledPitchClass } from "@/model/contracts";
import type { ChordDescription } from "@/types";
import { parseChordSymbol } from "@/theory/chordParser";
import { degreeNumber, parseDegreeLabelOrThrow, semitonesOf, transposePitchClass, transposeSpelled } from "@/music/intervals";
import type { Direction } from "@/music/intervals";
import { formatPitchClass, formatSpelledNote, midiOf, mod12, noteFromMidi, parsePitchClass, pitchClassOf, spellMidiWithLetter, spelledEquals } from "@/music/pitch";
import type { FormatOptions } from "@/music/pitch";

// ---------------------------------------------------------------------------
// Quality catalogue
// ---------------------------------------------------------------------------

export interface ChordQualityDefinition {
  id: ChordQualityId;
  name: string;
  /** Canonical symbol suffix (used by chordFromDefinition and as a formatting fallback). */
  suffix: string;
  labels: DegreeLabel[];
  /** The extension that names the chord (9 in a ninth chord), if any. */
  topExtension?: DegreeLabel;
}

export const CHORD_QUALITIES: Readonly<Record<ChordQualityId, ChordQualityDefinition>> = {
  maj: { id: "maj", name: "Major", suffix: "", labels: ["1", "3", "5"] },
  min: { id: "min", name: "Minor", suffix: "m", labels: ["1", "b3", "5"] },
  dim: { id: "dim", name: "Diminished", suffix: "dim", labels: ["1", "b3", "b5"] },
  aug: { id: "aug", name: "Augmented", suffix: "aug", labels: ["1", "3", "#5"] },
  sus2: { id: "sus2", name: "Suspended 2", suffix: "sus2", labels: ["1", "2", "5"] },
  sus4: { id: "sus4", name: "Suspended 4", suffix: "sus4", labels: ["1", "4", "5"] },
  power: { id: "power", name: "Power", suffix: "5", labels: ["1", "5"] },
  maj6: { id: "maj6", name: "Major 6", suffix: "6", labels: ["1", "3", "5", "6"] },
  min6: { id: "min6", name: "Minor 6", suffix: "m6", labels: ["1", "b3", "5", "6"] },
  dom7: { id: "dom7", name: "Dominant 7", suffix: "7", labels: ["1", "3", "5", "b7"] },
  maj7: { id: "maj7", name: "Major 7", suffix: "maj7", labels: ["1", "3", "5", "7"] },
  min7: { id: "min7", name: "Minor 7", suffix: "m7", labels: ["1", "b3", "5", "b7"] },
  minMaj7: { id: "minMaj7", name: "Minor Major 7", suffix: "m(maj7)", labels: ["1", "b3", "5", "7"] },
  dim7: { id: "dim7", name: "Diminished 7", suffix: "dim7", labels: ["1", "b3", "b5", "bb7"] },
  halfDim7: { id: "halfDim7", name: "Half-diminished", suffix: "m7b5", labels: ["1", "b3", "b5", "b7"] },
  dom9: { id: "dom9", name: "Dominant 9", suffix: "9", labels: ["1", "3", "5", "b7", "9"], topExtension: "9" },
  maj9: { id: "maj9", name: "Major 9", suffix: "maj9", labels: ["1", "3", "5", "7", "9"], topExtension: "9" },
  min9: { id: "min9", name: "Minor 9", suffix: "m9", labels: ["1", "b3", "5", "b7", "9"], topExtension: "9" },
  dom11: { id: "dom11", name: "Dominant 11", suffix: "11", labels: ["1", "3", "5", "b7", "9", "11"], topExtension: "11" },
  maj11: { id: "maj11", name: "Major 11", suffix: "maj11", labels: ["1", "3", "5", "7", "9", "11"], topExtension: "11" },
  min11: { id: "min11", name: "Minor 11", suffix: "m11", labels: ["1", "b3", "5", "b7", "9", "11"], topExtension: "11" },
  dom13: { id: "dom13", name: "Dominant 13", suffix: "13", labels: ["1", "3", "5", "b7", "9", "13"], topExtension: "13" },
  maj13: { id: "maj13", name: "Major 13", suffix: "maj13", labels: ["1", "3", "5", "7", "9", "13"], topExtension: "13" },
  min13: { id: "min13", name: "Minor 13", suffix: "m13", labels: ["1", "b3", "5", "b7", "9", "11", "13"], topExtension: "13" }
};

/** Legacy qualityLabel -> ChordQualityId. "Root" (symbol "C1") has no exact id; see analyzeChordSymbol. */
const LEGACY_LABEL_TO_QUALITY: Readonly<Record<string, ChordQualityId>> = {
  Major: "maj",
  Root: "power",
  Minor: "min",
  "Minor Major 7": "minMaj7",
  Diminished: "dim",
  Augmented: "aug",
  "Suspended 2": "sus2",
  "Suspended 4": "sus4",
  "Dominant 7": "dom7",
  "Major 7": "maj7",
  "Minor 7": "min7",
  "Diminished 7": "dim7",
  "Half-diminished": "halfDim7",
  "Major 6": "maj6",
  "Minor 6": "min6",
  "Dominant 9": "dom9",
  "Dominant 11": "dom11",
  "Dominant 13": "dom13",
  "Major 9": "maj9",
  "Major 11": "maj11",
  "Major 13": "maj13",
  "Minor 9": "min9",
  "Minor 11": "min11",
  "Minor 13": "min13"
};

/** Default label for a semitone distance above the root (see module header). */
const SEMITONE_LABELS: Readonly<Record<number, DegreeLabel>> = {
  0: "1",
  1: "b9",
  2: "2",
  3: "b3",
  4: "3",
  5: "4",
  6: "b5",
  7: "5",
  8: "#5",
  9: "6",
  10: "b7",
  11: "7",
  12: "8",
  13: "b9",
  14: "9",
  15: "#9",
  16: "3",
  17: "11",
  18: "#11",
  19: "5",
  20: "b13",
  21: "13",
  22: "b7",
  23: "7"
};

const ALTERED_SEMITONES: ReadonlySet<number> = new Set<number>([6, 8, 13, 15, 18, 20]);

/** Simple labels relative to a root for non-chord tones (inspector use). */
const RELATIVE_LABELS: readonly DegreeLabel[] = ["1", "b2", "2", "b3", "3", "4", "#4", "5", "b6", "6", "b7", "7"];

type DegreeSource = "quality" | "alteration" | "suspension" | "added";

interface LabelledTone {
  label: DegreeLabel;
  source: DegreeSource;
}

function roleForNumber(number: number): ChordRole {
  switch (number) {
    case 1:
    case 8:
      return "root";
    case 3:
    case 10:
      return "third";
    case 5:
    case 12:
      return "fifth";
    case 6:
      return "sixth";
    case 7:
    case 14:
      return "seventh";
    case 9:
      return "ninth";
    case 11:
      return "eleventh";
    case 13:
      return "thirteenth";
    default:
      return "added";
  }
}

function isAlteredLabel(label: DegreeLabel): boolean {
  return /^(b|#)/.test(label);
}

function buildDegree(tone: LabelledTone, quality: ChordQualityDefinition): ChordDegree {
  const interval = parseDegreeLabelOrThrow(tone.label);
  const number = interval.number;
  let role: ChordRole;
  let essential: boolean;
  if (tone.source === "suspension") {
    role = "suspension";
    essential = true;
  } else if (tone.source === "added") {
    role = "added";
    essential = true;
  } else if (tone.source === "alteration") {
    role = roleForNumber(number);
    essential = true;
  } else {
    // Part of the quality's own definition.
    if ((number === 2 || number === 4) && (quality.id === "sus2" || quality.id === "sus4")) {
      role = "suspension";
    } else {
      role = roleForNumber(number);
    }
    if (role === "fifth") {
      essential = isAlteredLabel(tone.label) || quality.id === "power";
    } else if (role === "ninth" || role === "eleventh" || role === "thirteenth") {
      essential = quality.topExtension === tone.label;
    } else {
      essential = true;
    }
  }
  return { label: tone.label, interval, semitones: semitonesOf(interval), role, essential };
}

interface BuildParams {
  symbol: string;
  root: SpelledPitchClass;
  bass?: SpelledPitchClass;
  quality: ChordQualityId;
  qualityLabel: string;
  tones: LabelledTone[];
}

function assembleChord(params: BuildParams): ChordDefinition {
  const quality = CHORD_QUALITIES[params.quality];
  const degrees = params.tones.map((tone) => buildDegree(tone, quality)).sort((a, b) => a.semitones - b.semitones);
  const extensions: DegreeLabel[] = [];
  const alterations: DegreeLabel[] = [];
  const added: DegreeLabel[] = [];
  params.tones.forEach((tone) => {
    if (tone.source === "alteration") {
      alterations.push(tone.label);
    } else if (tone.source === "added") {
      added.push(tone.label);
    } else if (tone.source === "quality") {
      const number = degreeNumber(tone.label);
      if ((number === 9 || number === 11 || number === 13) && !isAlteredLabel(tone.label)) {
        extensions.push(tone.label);
      }
    }
  });
  const bySemitone = (a: DegreeLabel, b: DegreeLabel): number => semitonesOf(parseDegreeLabelOrThrow(a)) - semitonesOf(parseDegreeLabelOrThrow(b));
  const chord: ChordDefinition = {
    symbol: params.symbol,
    root: { letter: params.root.letter, accidental: params.root.accidental },
    quality: params.quality,
    qualityLabel: params.qualityLabel,
    degrees,
    extensions: extensions.sort(bySemitone),
    alterations: alterations.sort(bySemitone),
    added: added.sort(bySemitone)
  };
  if (params.bass) {
    chord.bass = { letter: params.bass.letter, accidental: params.bass.accidental };
  }
  return chord;
}

// ---------------------------------------------------------------------------
// Symbol parsing (legacy adapter)
// ---------------------------------------------------------------------------

export interface ChordSymbolAnalysis {
  chord: ChordDefinition;
  /** Raw legacy parser output the chord was built from. */
  legacy: ChordDescription;
  /** Human-readable notes where the spelled model deliberately differs from legacy semitones. */
  adjustments: string[];
}

export type ChordParseResult = { ok: true; chord: ChordDefinition } | { ok: false; error: string };

function qualityFromLegacy(legacy: ChordDescription, set: Set<number>): { quality: ChordQualityId; qualityLabel: string; note?: string } {
  const mapped = LEGACY_LABEL_TO_QUALITY[legacy.qualityLabel];
  if (!mapped) {
    // Defensive: the legacy parser only emits the labels above.
    throw new Error(`Unsupported legacy chord quality "${legacy.qualityLabel}" in "${legacy.symbol}".`);
  }
  const hasThird = set.has(3) || set.has(4);
  if (mapped === "maj") {
    if (set.has(4) && set.has(8) && !set.has(7)) {
      return { quality: "aug", qualityLabel: CHORD_QUALITIES.aug.name };
    }
    if (!hasThird && set.has(2) && !set.has(5) && set.has(7)) {
      return { quality: "sus2", qualityLabel: CHORD_QUALITIES.sus2.name };
    }
    if (!hasThird && set.has(5) && !set.has(2) && set.has(7)) {
      return { quality: "sus4", qualityLabel: CHORD_QUALITIES.sus4.name };
    }
  }
  if (mapped === "min" && set.has(3) && set.has(6) && !set.has(7)) {
    return { quality: "dim", qualityLabel: CHORD_QUALITIES.dim.name };
  }
  if (mapped === "power") {
    return {
      quality: "power",
      qualityLabel: legacy.qualityLabel,
      note: `"${legacy.symbol}" is a root-only symbol; it has no ChordQualityId and is modelled as quality "power" containing only the root.`
    };
  }
  return { quality: mapped, qualityLabel: legacy.qualityLabel };
}

function legacySuffix(symbol: string): string {
  const match = symbol.match(/^[A-Ga-g][#b]?([^/]*)/);
  return match ? match[1] : "";
}

/**
 * Parse a chord symbol through the legacy parser and upgrade it to a spelled definition.
 * Throws the legacy parser's Error (same message) for unsupported symbols.
 */
export function analyzeChordSymbol(symbol: string): ChordSymbolAnalysis {
  const legacy = parseChordSymbol(symbol);
  const adjustments: string[] = [];
  const set = new Set<number>(legacy.intervals);
  const { quality, qualityLabel, note } = qualityFromLegacy(legacy, set);
  if (note) {
    adjustments.push(note);
  }
  if ((quality === "dom13" || quality === "maj13") && set.has(17) && !/add11/.test(legacySuffix(legacy.symbol))) {
    set.delete(17);
    adjustments.push(`Natural 11 omitted from "${legacy.symbol}": in a ${CHORD_QUALITIES[quality].name} chord it clashes with the major third (the legacy parser includes it).`);
  }

  const definition = CHORD_QUALITIES[quality];
  const baseBySemitone = new Map<number, DegreeLabel>();
  definition.labels.forEach((label) => {
    baseBySemitone.set(semitonesOf(parseDegreeLabelOrThrow(label)), label);
  });
  const hasThird = set.has(3) || set.has(4);
  const tones: LabelledTone[] = [];
  [...set].sort((a, b) => a - b).forEach((semitones) => {
    const baseLabel = baseBySemitone.get(semitones);
    if (baseLabel !== undefined) {
      tones.push({ label: baseLabel, source: "quality" });
      return;
    }
    const label = SEMITONE_LABELS[semitones] ?? RELATIVE_LABELS[mod12(semitones)];
    if (ALTERED_SEMITONES.has(semitones)) {
      tones.push({ label, source: "alteration" });
    } else if ((semitones === 2 || semitones === 5) && !hasThird) {
      tones.push({ label, source: "suspension" });
    } else {
      tones.push({ label, source: "added" });
    }
  });

  const root = parsePitchClass(legacy.rootName);
  if (!root) {
    throw new Error(`Invalid root note in "${symbol}".`);
  }
  let bass: SpelledPitchClass | undefined;
  if (legacy.bassName !== undefined) {
    const parsedBass = parsePitchClass(legacy.bassName);
    if (!parsedBass) {
      throw new Error(`Invalid slash bass note in "${symbol}".`);
    }
    bass = parsedBass;
  }

  const chord = assembleChord({ symbol: legacy.symbol, root, bass, quality, qualityLabel, tones });
  return { chord, legacy, adjustments };
}

/** Parse a chord symbol into a spelled ChordDefinition. Throws legacy parser errors unchanged. */
export function chordFromSymbol(symbol: string): ChordDefinition {
  return analyzeChordSymbol(symbol).chord;
}

/** Non-throwing variant of chordFromSymbol. */
export function tryChordFromSymbol(symbol: string): ChordParseResult {
  try {
    return { ok: true, chord: chordFromSymbol(symbol) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ---------------------------------------------------------------------------
// Programmatic construction
// ---------------------------------------------------------------------------

export interface ChordDefinitionOptions {
  /** Explicit slash bass. */
  bass?: SpelledPitchClass;
  /** Replace the third with a 2 or 4 (e.g. dom7 + "4" = 7sus4). */
  suspension?: "2" | "4";
  /** Altered tones, e.g. ["b5"], ["#5"], ["b9", "#11"]. Replace the natural degree of the same number. */
  alterations?: DegreeLabel[];
  /** Added tones, e.g. ["9"] for add9, ["6"]. */
  added?: DegreeLabel[];
  /** Degrees to leave out of the definition (e.g. ["5"]). */
  omit?: DegreeLabel[];
  /** Override the generated symbol text. */
  symbol?: string;
}

function canonicalSuffix(quality: ChordQualityId, options: ChordDefinitionOptions): string {
  let suffix = CHORD_QUALITIES[quality].suffix;
  if (options.suspension) {
    suffix += `sus${options.suspension}`;
  }
  (options.alterations ?? []).forEach((label) => {
    suffix += label;
  });
  (options.added ?? []).forEach((label) => {
    suffix += `add${label}`;
  });
  (options.omit ?? []).forEach((label) => {
    suffix += `(omit${label})`;
  });
  return suffix;
}

/**
 * Build a chord from a root and quality without going through text.
 * Throws an Error for invalid degree labels or alterations that do not alter anything.
 */
export function chordFromDefinition(root: SpelledPitchClass, quality: ChordQualityId, options: ChordDefinitionOptions = {}): ChordDefinition {
  const definition = CHORD_QUALITIES[quality];
  let tones: LabelledTone[] = definition.labels.map((label) => ({ label, source: "quality" as DegreeSource }));

  if (options.suspension) {
    tones = tones.filter((tone) => degreeNumber(tone.label) !== 3);
    tones.push({ label: options.suspension, source: "suspension" });
  }
  (options.alterations ?? []).forEach((label) => {
    const parsed = parseDegreeLabelOrThrow(label);
    if (!isAlteredLabel(label) || ![5, 9, 11, 13].includes(parsed.number)) {
      throw new Error(`"${label}" is not a supported alteration; use b5, #5, b9, #9, #11 or b13.`);
    }
    const existing = tones.find((tone) => tone.label === label);
    if (existing) {
      return;
    }
    tones = tones.filter((tone) => degreeNumber(tone.label) !== parsed.number);
    tones.push({ label, source: "alteration" });
  });
  (options.added ?? []).forEach((label) => {
    parseDegreeLabelOrThrow(label);
    if (!tones.some((tone) => tone.label === label)) {
      tones.push({ label, source: "added" });
    }
  });
  (options.omit ?? []).forEach((label) => {
    parseDegreeLabelOrThrow(label);
    tones = tones.filter((tone) => tone.label !== label);
  });

  const chordWithoutSymbol = assembleChord({
    symbol: "",
    root,
    bass: options.bass,
    quality,
    qualityLabel: definition.name,
    tones
  });
  const suffix = canonicalSuffix(quality, options);
  chordWithoutSymbol.symbol = options.symbol ?? `${formatPitchClass(root)}${suffix}${options.bass ? `/${formatPitchClass(options.bass)}` : ""}`;
  return chordWithoutSymbol;
}

/** Rebuild a chord with another quality, keeping root, bass, alterations and added tones. */
export function changeQuality(chord: ChordDefinition, quality: ChordQualityId): ChordDefinition {
  return chordFromDefinition(chord.root, quality, {
    bass: chord.bass,
    alterations: chord.alterations,
    added: chord.added
  });
}

export function getDegree(chord: ChordDefinition, label: DegreeLabel): ChordDegree | undefined {
  return chord.degrees.find((degree) => degree.label === label);
}

export function degreesWithRole(chord: ChordDefinition, role: ChordRole): ChordDegree[] {
  return chord.degrees.filter((degree) => degree.role === role);
}

// ---------------------------------------------------------------------------
// Formatting and transposition
// ---------------------------------------------------------------------------

/**
 * The suffix as written in the chord's symbol (between root and slash bass), or the
 * canonical suffix when the symbol does not start with the chord's root.
 */
export function chordSuffix(chord: ChordDefinition): string {
  let body = chord.symbol.trim();
  if (chord.bass) {
    const slash = body.lastIndexOf("/");
    if (slash >= 0) {
      body = body.slice(0, slash);
    }
  }
  for (let length = Math.min(4, body.length); length >= 1; length -= 1) {
    const candidate = parsePitchClass(body.slice(0, length));
    if (candidate && spelledEquals(candidate, chord.root)) {
      return body.slice(length);
    }
  }
  return canonicalSuffix(chord.quality, { alterations: chord.alterations, added: chord.added });
}

/** Symbol text for a chord: root + written suffix + optional slash bass. */
export function formatChordSymbol(chord: ChordDefinition, options: FormatOptions = {}): string {
  const bass = chord.bass ? `/${formatPitchClass(chord.bass, options)}` : "";
  return `${formatPitchClass(chord.root, options)}${chordSuffix(chord)}${bass}`;
}

/**
 * Transpose a chord by an interval, preserving spelling and degree roles
 * (Dm9 up M2 = Em9; Db/F up P4 = Gb/Bb). Throws a RangeError when a root or bass
 * would need more than a double accidental.
 */
export function transposeChord(chord: ChordDefinition, value: Interval, direction: Direction = "up"): ChordDefinition {
  const suffix = chordSuffix(chord);
  const root = transposePitchClass(chord.root, value, direction);
  const result: ChordDefinition = {
    symbol: "",
    root,
    quality: chord.quality,
    qualityLabel: chord.qualityLabel,
    degrees: chord.degrees.map((degree) => ({ ...degree, interval: { ...degree.interval } })),
    extensions: [...chord.extensions],
    alterations: [...chord.alterations],
    added: [...chord.added]
  };
  if (chord.bass) {
    result.bass = transposePitchClass(chord.bass, value, direction);
  }
  result.symbol = `${formatPitchClass(root)}${suffix}${result.bass ? `/${formatPitchClass(result.bass)}` : ""}`;
  return result;
}

// ---------------------------------------------------------------------------
// Chord tones, inversions, inspection
// ---------------------------------------------------------------------------

export interface ChordTone {
  degree: ChordDegree;
  spelled: SpelledNote;
  midi: number;
  /**
   * True when the theoretical spelling needs more than a double accidental and an
   * enharmonic default spelling was substituted (pitch is still exact).
   */
  respelled: boolean;
}

function toneForDegree(rootNote: SpelledNote, degree: ChordDegree): ChordTone {
  const midi = midiOf(rootNote) + degree.semitones;
  try {
    const spelled = transposeSpelled(rootNote, degree.interval, "up");
    return { degree, spelled, midi, respelled: false };
  } catch (error) {
    if (error instanceof RangeError) {
      return { degree, spelled: noteFromMidi(midi), midi, respelled: true };
    }
    throw error;
  }
}

/**
 * Spelled chord tones from the root upward in the given octave (root in `octave`,
 * extensions above). The slash bass is not included; see `slashBassNote`.
 */
export function chordTones(chord: ChordDefinition, octave: number): ChordTone[] {
  const rootNote: SpelledNote = { letter: chord.root.letter, accidental: chord.root.accidental, octave };
  return chord.degrees.map((degree) => toneForDegree(rootNote, degree));
}

/** The written slash bass as a spelled note placed below the chord root in `octave`. */
export function slashBassNote(chord: ChordDefinition, octave: number): SpelledNote | undefined {
  if (!chord.bass) {
    return undefined;
  }
  const rootMidi = midiOf({ letter: chord.root.letter, accidental: chord.root.accidental, octave });
  let note: SpelledNote = { letter: chord.bass.letter, accidental: chord.bass.accidental, octave };
  while (midiOf(note) >= rootMidi) {
    note = { ...note, octave: note.octave - 1 };
  }
  while (midiOf(note) + 12 < rootMidi) {
    note = { ...note, octave: note.octave + 1 };
  }
  return note;
}

export const INVERSION_NAMES: readonly string[] = ["root position", "first inversion", "second inversion", "third inversion"];

const CORE_ROLE_ORDER: ReadonlyArray<ReadonlyArray<ChordRole>> = [["root"], ["third", "suspension"], ["fifth"], ["seventh", "sixth"]];

/**
 * Core chord members in stacking order: root, third (or suspension), fifth, seventh (or the
 * sixth of a 6 chord). Inversions are defined over these members; extensions, alterations
 * of 9/11/13, and added tones sit above them.
 */
export function coreDegrees(chord: ChordDefinition): ChordDegree[] {
  const result: ChordDegree[] = [];
  CORE_ROLE_ORDER.forEach((roles) => {
    const found = chord.degrees.find((degree) => roles.includes(degree.role) && degree.semitones < 12);
    if (found) {
      result.push(found);
    }
  });
  return result;
}

export interface ChordInversion {
  ok: true;
  /** 0 = root position, 1 = first inversion (third in bass), 2 = second (fifth), 3 = third (seventh). */
  inversion: number;
  name: string;
  /** The chord degree that is lowest. */
  bassDegree: ChordDegree;
  /** Close-position ordering from the lowest note up. */
  ordering: ChordDegree[];
  /** Spelled notes in that ordering, lowest note in the requested octave. */
  notes: ChordTone[];
  explanation: string;
}

export type InversionResult = ChordInversion | { ok: false; reason: string };

function placeAbove(previousMidi: number | null, tone: ChordTone, octave: number): ChordTone {
  let note: SpelledNote = { letter: tone.spelled.letter, accidental: tone.spelled.accidental, octave };
  if (previousMidi === null) {
    return { degree: tone.degree, spelled: note, midi: midiOf(note), respelled: tone.respelled };
  }
  while (midiOf(note) <= previousMidi) {
    note = { ...note, octave: note.octave + 1 };
  }
  while (midiOf(note) - 12 > previousMidi) {
    note = { ...note, octave: note.octave - 1 };
  }
  return { degree: tone.degree, spelled: note, midi: midiOf(note), respelled: tone.respelled };
}

/**
 * Inversion `n` of a chord, defined by which chord degree is lowest — not by octave
 * rearrangement. The remaining core members follow in close position, then any
 * extensions/added tones. Spacing and register are voicing concerns (E06), not inversions.
 * Returns { ok: false } when the chord has no member for that inversion (e.g. third
 * inversion of a triad).
 */
export function inversion(chord: ChordDefinition, n: number, octave: number = 4): InversionResult {
  const core = coreDegrees(chord);
  if (!Number.isInteger(n) || n < 0) {
    return { ok: false, reason: `Inversion must be a non-negative integer (got ${n}).` };
  }
  if (n >= core.length) {
    return {
      ok: false,
      reason: `${chord.symbol} has ${core.length} core members (${core.map((d) => d.label).join(", ")}), so it has no ${INVERSION_NAMES[n] ?? `inversion ${n}`}.`
    };
  }
  const upper = chord.degrees.filter((degree) => !core.includes(degree));
  const ordering = [...core.slice(n), ...core.slice(0, n), ...upper];
  const tones = chordTones(chord, octave);
  const toneByDegree = new Map<ChordDegree, ChordTone>();
  tones.forEach((tone) => toneByDegree.set(tone.degree, tone));
  const notes: ChordTone[] = [];
  let previous: number | null = null;
  ordering.forEach((degree) => {
    const tone = toneByDegree.get(degree);
    if (!tone) {
      return;
    }
    const placed = placeAbove(previous, tone, octave);
    notes.push(placed);
    previous = placed.midi;
  });
  const bassDegree = ordering[0];
  const name = INVERSION_NAMES[n] ?? `inversion ${n}`;
  const bassName = notes.length > 0 ? formatSpelledNote(notes[0].spelled) : "";
  return {
    ok: true,
    inversion: n,
    name,
    bassDegree,
    ordering,
    notes,
    explanation: `${chord.symbol} in ${name}: the ${bassDegree.role} (${bassDegree.label}) ${bassName} is the lowest note.`
  };
}

export type SlashBassAnalysis =
  | { kind: "none" }
  | { kind: "chordTone"; degree: ChordDegree; inversion: number | null; enharmonicOnly: boolean }
  | { kind: "nonChordTone"; relativeLabel: DegreeLabel };

/**
 * Relate an explicit slash bass to the chord: which degree it is (and hence which inversion),
 * or that it is a non-chord tone. `enharmonicOnly` flags a bass that matches a chord tone by
 * pitch but is spelled differently (e.g. C/Fb).
 */
export function analyzeSlashBass(chord: ChordDefinition): SlashBassAnalysis {
  if (!chord.bass) {
    return { kind: "none" };
  }
  const tones = chordTones(chord, 4);
  const core = coreDegrees(chord);
  const bass = chord.bass;
  const exact = tones.find((tone) => spelledEquals(tone.spelled, bass));
  const enharmonic = exact ? undefined : tones.find((tone) => pitchClassOf(tone.spelled) === pitchClassOf(bass));
  const match = exact ?? enharmonic;
  if (match) {
    const index = core.indexOf(match.degree);
    return { kind: "chordTone", degree: match.degree, inversion: index >= 0 ? index : null, enharmonicOnly: !exact };
  }
  return { kind: "nonChordTone", relativeLabel: RELATIVE_LABELS[mod12(pitchClassOf(bass) - pitchClassOf(chord.root))] };
}

export interface DegreeMatch {
  degree: ChordDegree;
  /** The played MIDI pitch spelled as this chord degree. */
  spelled: SpelledNote;
}

export interface DegreeDescription {
  midi: number;
  pitchClass: number;
  status: "chordTone" | "slashBass" | "nonChordTone";
  /** Every chord degree sharing this pitch class (more than one = ambiguous). */
  matches: DegreeMatch[];
  ambiguous: boolean;
  /** Whether the pitch class equals the chord's bass (slash bass, else root). */
  isBass: boolean;
  /** Simple label relative to the root, for non-chord tones ("b2", "#4" ...). */
  relativeLabel: DegreeLabel;
  explanation: string;
}

/**
 * Describe what a played MIDI pitch is within a chord (for inspectors). MIDI carries no
 * spelling, so the pitch is matched by pitch class and re-spelled per matching degree.
 * When several degrees share the pitch class (e.g. #5 and b13) all are returned and
 * `ambiguous` is true.
 */
export function describeDegree(chord: ChordDefinition, midi: number): DegreeDescription {
  const pc = mod12(midi);
  const tones = chordTones(chord, 4);
  const matches: DegreeMatch[] = [];
  tones.forEach((tone) => {
    if (mod12(tone.midi) === pc) {
      const spelled = spellMidiWithLetter(midi, tone.spelled.letter) ?? noteFromMidi(midi);
      matches.push({ degree: tone.degree, spelled });
    }
  });
  const bassPc = chord.bass ? pitchClassOf(chord.bass) : pitchClassOf(chord.root);
  const isBass = bassPc === pc;
  const relativeLabel = RELATIVE_LABELS[mod12(pc - pitchClassOf(chord.root))];
  let status: DegreeDescription["status"];
  let explanation: string;
  if (matches.length > 0) {
    status = "chordTone";
    const parts = matches.map((match) => `${formatSpelledNote(match.spelled)} as the ${match.degree.role} (${match.degree.label})`);
    explanation = `${parts.join(" or ")} of ${chord.symbol}${isBass && chord.bass ? ", also the slash bass" : ""}.`;
    if (matches.length > 1) {
      explanation += " The pitch is ambiguous; context decides which degree is meant.";
    }
  } else if (isBass && chord.bass) {
    status = "slashBass";
    const bassNote = spellMidiWithLetter(midi, chord.bass.letter) ?? noteFromMidi(midi);
    explanation = `${formatSpelledNote(bassNote)} is the slash bass of ${chord.symbol} (not a chord tone).`;
  } else {
    status = "nonChordTone";
    explanation = `${formatSpelledNote(noteFromMidi(midi))} is not in ${chord.symbol} (${relativeLabel} above the root).`;
  }
  return { midi, pitchClass: pc, status, matches, ambiguous: matches.length > 1, isBass, relativeLabel, explanation };
}

/** Pitch classes (0..11) of a chord, root first, de-duplicated. */
export function chordPitchClasses(chord: ChordDefinition): number[] {
  const root = pitchClassOf(chord.root);
  const result: number[] = [];
  chord.degrees.forEach((degree) => {
    const pc = mod12(root + degree.semitones);
    if (!result.includes(pc)) {
      result.push(pc);
    }
  });
  return result;
}

