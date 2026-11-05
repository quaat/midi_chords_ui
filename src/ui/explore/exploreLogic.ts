/**
 * Pure Explore-mode logic (plan §3 Explore, E05, E27): chord inspection rows, degree labels
 * for the piano, inversion explanations, scale comparison views. No React, no voicing engine.
 */
import type { ChordDefinition, ChordRole, DegreeLabel, Hand, ScaleId, SpelledNote, VoicingInstance } from "@/model/contracts";
import type { ChordTone } from "@/music/chords";
import { analyzeSlashBass, chordTones, coreDegrees, describeDegree, INVERSION_NAMES, inversion, tryChordFromSymbol } from "@/music/chords";
import { degreeNumber } from "@/music/intervals";
import { formatPitchClass, formatSpelledNote } from "@/music/pitch";
import { compareScales, diatonicTriads, getScale, keyFromTonicAndMode, scaleNotes } from "@/music/scales";
import { prettyDegree } from "@/ui/piano/pianoLabels";

export type ExploreTab = "chord" | "scale";
export type ExplorePianoSource = "chord" | "voicing" | "scale" | "none";

export interface ExploreState {
  tab: ExploreTab;
  /** Text in the chord input (may be invalid while typing). */
  symbolInput: string;
  /** Last valid chord symbol. */
  symbol: string;
  inversion: number;
  tonic: string;
  scaleA: ScaleId;
  scaleB: ScaleId;
  voicingA: string | null;
  voicingB: string | null;
}

export const DEFAULT_EXPLORE_STATE: ExploreState = {
  tab: "chord",
  symbolInput: "C",
  symbol: "C",
  inversion: 0,
  tonic: "D",
  scaleA: "dorian",
  scaleB: "naturalMinor",
  voicingA: null,
  voicingB: null
};

export const QUICK_PICKS: readonly string[] = ["C", "Am", "F", "G7", "Dm7", "Cmaj7", "Fmaj7", "Bm7b5", "Cdim7", "Csus4", "C/E", "Dm9", "G13", "Cmaj9/E"];

export const TONIC_CHOICES: readonly string[] = ["C", "G", "D", "A", "E", "B", "F#", "C#", "F", "Bb", "Eb", "Ab", "Db", "Gb"];

export const ROLE_NAMES: Readonly<Record<ChordRole, string>> = {
  root: "root",
  third: "third",
  fifth: "fifth",
  sixth: "sixth",
  seventh: "seventh",
  ninth: "ninth",
  eleventh: "eleventh",
  thirteenth: "thirteenth",
  suspension: "suspension",
  added: "added tone"
};

/** A note the Explore stage asks the piano to show (target layer). */
export interface ExploreTarget {
  midi: number;
  role?: ChordRole;
  hand?: Hand;
  /** Spelled note name for the "note names" label mode ("E♭4" → shown as "E♭"). */
  noteName: string;
  /** Degree label for the degree label modes ("♭3", or "A ♭6" in scale comparisons). */
  degreeLabel?: string;
}

export type ChordInputResult = { ok: true; chord: ChordDefinition } | { ok: false; error: string };

export function parseChordInput(text: string): ChordInputResult {
  const trimmed = text.trim();
  if (trimmed === "") {
    return { ok: false, error: "Type a chord symbol such as C, Dm7 or G13." };
  }
  const result = tryChordFromSymbol(trimmed);
  return result.ok ? { ok: true, chord: result.chord } : { ok: false, error: result.error };
}

export function noteNameOf(tone: { spelled: SpelledNote }, withOctave: boolean = false): string {
  const name = formatSpelledNote(tone.spelled, { unicode: true });
  return withOctave ? name : name.replace(/-?\d+$/, "");
}

export interface DegreeRow {
  label: DegreeLabel;
  pretty: string;
  role: ChordRole;
  roleName: string;
  essential: boolean;
  noteName: string;
  midi: number;
  respelled: boolean;
}

/** One row per chord degree (root upward, root in `octave`). */
export function chordDegreeRows(chord: ChordDefinition, octave: number = 4): DegreeRow[] {
  return chordTones(chord, octave).map((tone: ChordTone) => ({
    label: tone.degree.label,
    pretty: prettyDegree(tone.degree.label),
    role: tone.degree.role,
    roleName: ROLE_NAMES[tone.degree.role],
    essential: tone.degree.essential,
    noteName: noteNameOf(tone),
    midi: tone.midi,
    respelled: tone.respelled
  }));
}

/** "Dm9 — D minor ninth: root D, 5 tones (essential: 1, b3, b7)." */
export function chordHeadline(chord: ChordDefinition): string {
  const essentials = chord.degrees.filter((degree) => degree.essential).map((degree) => prettyDegree(degree.label));
  const tones = chord.degrees.length;
  return `${chord.symbol} — ${formatPitchClass(chord.root, { unicode: true })} ${chord.qualityLabel}: ${tones} tone${tones === 1 ? "" : "s"}${essentials.length > 0 ? ` (essential: ${essentials.join(", ")})` : ""}.`;
}

/**
 * Piano labels for chord degrees: chord tones get their degree ("♭3"); an ambiguous pitch lists
 * every reading ("♯5/♭13"); a slash bass that is not a chord tone and other non-chord tones get
 * their distance from the root in parentheses ("(2)") so they never read as chord members.
 */
export function degreeLabelMap(chord: ChordDefinition, midis: readonly number[]): Map<number, string> {
  const map = new Map<number, string>();
  midis.forEach((midi) => {
    if (map.has(midi)) {
      return;
    }
    const description = describeDegree(chord, midi);
    if (description.status === "chordTone") {
      const labels = Array.from(new Set(description.matches.map((match) => prettyDegree(match.degree.label))));
      map.set(midi, labels.join("/"));
    } else {
      map.set(midi, `(${prettyDegree(description.relativeLabel)})`);
    }
  });
  return map;
}

/** What a slash bass means for this chord, in one sentence ("" when there is none). */
export function slashBassText(chord: ChordDefinition): string {
  const analysis = analyzeSlashBass(chord);
  if (analysis.kind === "none" || !chord.bass) {
    return "";
  }
  const bassName = formatPitchClass(chord.bass, { unicode: true });
  if (analysis.kind === "chordTone") {
    const role = ROLE_NAMES[analysis.degree.role];
    const inv = analysis.inversion !== null ? INVERSION_NAMES[analysis.inversion] : null;
    const enharmonic = analysis.enharmonicOnly ? " (spelled differently from the chord tone)" : "";
    return `Slash bass ${bassName} is the ${role} (${prettyDegree(analysis.degree.label)})${enharmonic}${inv ? `, so the chord sounds in ${inv}` : ""}.`;
  }
  return `Slash bass ${bassName} is not a chord tone: it sits ${prettyDegree(analysis.relativeLabel)} above the root and is added below the chord.`;
}

export interface InversionOption {
  n: number;
  name: string;
  available: boolean;
  reason?: string;
}

/** Root, 1st, 2nd and 3rd inversion buttons with availability (a triad has no 3rd inversion). */
export function inversionOptions(chord: ChordDefinition): InversionOption[] {
  const core = coreDegrees(chord);
  return [0, 1, 2, 3].map((n) => {
    const name = INVERSION_NAMES[n] ?? `inversion ${n}`;
    if (n < core.length) {
      return { n, name, available: true };
    }
    return { n, name, available: false, reason: `${chord.symbol} has ${core.length} core members, so there is no ${name}.` };
  });
}

/** Explanation lines for inversion `n` (shown under the inversion buttons). */
export function inversionExplanation(chord: ChordDefinition, n: number): string[] {
  const result = inversion(chord, n, 4);
  if (!result.ok) {
    return [result.reason];
  }
  const core = coreDegrees(chord);
  const lines = [result.explanation];
  const rootName = formatPitchClass(chord.root, { unicode: true });
  if (result.inversion === 0) {
    lines.push(`Nothing moved: the root ${rootName} is the lowest note.`);
  } else {
    const moved = core.slice(0, result.inversion).map((degree) => `${ROLE_NAMES[degree.role]} (${prettyDegree(degree.label)})`);
    lines.push(
      `The ${moved.join(" and ")} moved up an octave, so the ${ROLE_NAMES[result.bassDegree.role]} (${prettyDegree(result.bassDegree.label)}) is lowest. It is still ${chord.symbol} with root ${rootName}.`
    );
  }
  const slash = slashBassText(chord);
  if (slash !== "") {
    lines.push(`${slash} An inversion rearranges the chord tones; the written slash bass is played separately below them.`);
  }
  return lines;
}

export interface InversionView {
  ok: boolean;
  name: string;
  targets: ExploreTarget[];
  explanation: string[];
}

/** Close-position notes of inversion `n`; the octave drops when the top would go above C6. */
export function inversionView(chord: ChordDefinition, n: number): InversionView {
  let result = inversion(chord, n, 4);
  if (result.ok && result.notes.length > 0 && result.notes[result.notes.length - 1].midi > 84) {
    result = inversion(chord, n, 3);
  }
  if (!result.ok) {
    return { ok: false, name: INVERSION_NAMES[n] ?? `inversion ${n}`, targets: [], explanation: [result.reason] };
  }
  const targets: ExploreTarget[] = result.notes.map((tone) => ({
    midi: tone.midi,
    role: tone.degree.role,
    noteName: noteNameOf(tone),
    degreeLabel: prettyDegree(tone.degree.label)
  }));
  return { ok: true, name: result.name, targets, explanation: inversionExplanation(chord, n) };
}

/** Piano targets for a realised voicing (learner notes + optional accompaniment bass). */
export function targetsFromVoicing(voicing: VoicingInstance, includeBass: boolean = true): ExploreTarget[] {
  const targets: ExploreTarget[] = voicing.notes.map((note) => ({
    midi: note.midi,
    role: note.role,
    hand: note.hand,
    noteName: noteNameOf(note),
    degreeLabel: prettyDegree(note.degree)
  }));
  if (includeBass && voicing.accompanimentBass) {
    const bass = voicing.accompanimentBass;
    targets.push({ midi: bass.midi, role: bass.role, hand: "left", noteName: noteNameOf(bass), degreeLabel: `bass ${prettyDegree(bass.degree)}` });
  }
  return targets.sort((a, b) => a.midi - b.midi);
}

// ---------------------------------------------------------------------------
// Scales
// ---------------------------------------------------------------------------

export interface ScaleRow {
  label: DegreeLabel;
  pretty: string;
  noteName: string;
  midi: number;
  degreeNumber: number;
  differs: boolean;
}

export interface ScaleComparisonView {
  ok: boolean;
  error?: string;
  nameA: string;
  nameB: string;
  summary: string;
  rowsA: ScaleRow[];
  rowsB: ScaleRow[];
  /** Differing degree numbers (1..7). */
  differing: number[];
  /** Piano targets for the differing degrees of both scales, labelled "A ♭6" / "B 6". */
  targets: ExploreTarget[];
}

function scaleRows(tonic: string, scaleId: ScaleId, octave: number, differing: Set<number>): ScaleRow[] {
  return scaleNotes(tonic, scaleId, octave, 1, { includeTop: false }).map((note) => {
    const number = degreeNumber(note.degreeLabel) ?? 0;
    return {
      label: note.degreeLabel,
      pretty: prettyDegree(note.degreeLabel),
      noteName: noteNameOf(note),
      midi: note.midi,
      degreeNumber: number,
      differs: differing.has(number)
    };
  });
}

export function scaleDisplayName(tonic: string, scaleId: ScaleId): string {
  return `${tonic.replace("#", "♯").replace(/^([A-G])b/, "$1♭")} ${getScale(scaleId).name.toLowerCase()}`;
}

/** Two scales over the same tonic with their differing degrees marked (compareScales). */
export function scaleComparisonView(tonic: string, a: ScaleId, b: ScaleId, octave: number = 4): ScaleComparisonView {
  try {
    const comparison = compareScales(tonic, a, b);
    const differing = new Set(comparison.differences.map((difference) => difference.degreeNumber));
    const rowsA = scaleRows(tonic, a, octave, differing);
    const rowsB = scaleRows(tonic, b, octave, differing);
    const labels = new Map<number, ExploreTarget>();
    const add = (row: ScaleRow, tag: string): void => {
      const existing = labels.get(row.midi);
      const text = `${tag} ${row.pretty}`;
      if (existing) {
        existing.degreeLabel = existing.degreeLabel ? `${existing.degreeLabel} / ${text}` : text;
      } else {
        labels.set(row.midi, { midi: row.midi, noteName: row.noteName, degreeLabel: text });
      }
    };
    rowsA.filter((row) => row.differs).forEach((row) => add(row, "A"));
    rowsB.filter((row) => row.differs).forEach((row) => add(row, "B"));
    return {
      ok: true,
      nameA: scaleDisplayName(tonic, a),
      nameB: scaleDisplayName(tonic, b),
      summary: comparison.summary,
      rowsA,
      rowsB,
      differing: Array.from(differing).sort((x, y) => x - y),
      targets: Array.from(labels.values()).sort((x, y) => x.midi - y.midi)
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "These scales cannot be compared.",
      nameA: a,
      nameB: b,
      summary: "",
      rowsA: [],
      rowsB: [],
      differing: [],
      targets: []
    };
  }
}

/** One-octave ascending run including the top tonic (for "Hear" and "Send run to Practice"). */
export interface RunNote {
  midi: number;
  noteName: string;
  spelled: SpelledNote;
  degree: DegreeLabel;
}

export function scaleRunNotes(tonic: string, scaleId: ScaleId, octave: number = 4): RunNote[] {
  return scaleNotes(tonic, scaleId, octave, 1).map((note) => ({
    midi: note.midi,
    noteName: noteNameOf(note, true),
    spelled: note.spelled,
    degree: note.degreeLabel
  }));
}

export interface TriadRow {
  degree: number;
  numeral: string;
  symbol: string;
  chord: ChordDefinition;
}

export function diatonicTriadRows(tonic: string, scaleId: ScaleId): { ok: boolean; rows: TriadRow[]; reason?: string } {
  try {
    const rows = diatonicTriads(keyFromTonicAndMode(tonic, scaleId)).map((entry) => ({
      degree: entry.degree,
      numeral: entry.romanNumeral,
      symbol: entry.chord.symbol,
      chord: entry.chord
    }));
    return { ok: true, rows };
  } catch (error) {
    return { ok: false, rows: [], reason: error instanceof Error ? error.message : "No diatonic triads for this scale." };
  }
}
