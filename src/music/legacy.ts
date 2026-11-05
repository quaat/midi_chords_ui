/**
 * Adapters between the legacy chord-text format (`Symbol | measures`, one event per line)
 * and the shared MusicalSequence model (plan E04, persistence/compatibility).
 *
 * - Beats are quarter-note beats: one bar = numerator * 4 / denominator beats
 *   (4/4 -> 4, 3/4 -> 3, 6/8 -> 3).
 * - Parse errors from src/parser/parseChordSequence.ts are passed through unchanged
 *   (line, column, message, rawLine); valid lines still become events.
 * - Text export discloses what it cannot represent in `lost`.
 */
import type { MusicalSequence, SequenceEvent, TimeSignatureSpec } from "@/model/contracts";
import type { ParseError } from "@/types";
import { parseChordSequence } from "@/parser/parseChordSequence";
import { parseChordSymbol } from "@/theory/chordParser";
import { tryChordFromSymbol } from "@/music/chords";
import { formatKey } from "@/music/scales";

export interface LegacySequenceSettings {
  defaultChordMeasures: number;
  tempoBpm: number;
  timeSignature: TimeSignatureSpec;
  /** Sequence id (default "seq-legacy"). */
  id?: string;
  title?: string;
}

export interface LegacyImportResult {
  sequence: MusicalSequence;
  errors: ParseError[];
}

export interface TextExportResult {
  text: string;
  /** Everything in the sequence that the chord-text format cannot carry. */
  lost: string[];
}

const BEAT_EPSILON = 1e-6;

/** Quarter-note beats per bar for a time signature. */
export function beatsPerBar(timeSignature: TimeSignatureSpec): number {
  return (timeSignature.numerator * 4) / timeSignature.denominator;
}

function roundBeats(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

/** Parse legacy chord text into a MusicalSequence (ids "ev-1", "ev-2", ...; key undefined). */
export function sequenceFromParsedText(text: string, settings: LegacySequenceSettings): LegacyImportResult {
  const parsed = parseChordSequence(text, settings.defaultChordMeasures);
  const barBeats = beatsPerBar(settings.timeSignature);
  const events: SequenceEvent[] = [];
  const errors: ParseError[] = [...parsed.errors];
  let beat = 0;
  parsed.events.forEach((line) => {
    const durationBeats = roundBeats(line.durationMeasures * barBeats);
    const index = events.length;
    const base: SequenceEvent = {
      id: `ev-${index + 1}`,
      index,
      kind: line.isRest ? "rest" : "chord",
      symbol: line.isRest ? "NC" : line.chordSymbol,
      startBeat: roundBeats(beat),
      durationBeats,
      sourceLine: line.line
    };
    if (!line.isRest) {
      const result = tryChordFromSymbol(line.chordSymbol);
      if (result.ok) {
        base.chord = result.chord;
      } else {
        // The legacy parser already accepted the line, so this indicates an adapter bug; surface it.
        errors.push({ line: line.line, column: 1, message: result.error, rawLine: line.raw });
      }
    }
    events.push(base);
    beat += durationBeats;
  });
  const sequence: MusicalSequence = {
    id: settings.id ?? "seq-legacy",
    version: 1,
    tempo: { bpm: settings.tempoBpm },
    timeSignature: { numerator: settings.timeSignature.numerator, denominator: settings.timeSignature.denominator },
    events,
    totalBeats: roundBeats(beat)
  };
  if (settings.title !== undefined) {
    sequence.title = settings.title;
  }
  return { sequence, errors };
}

function formatMeasures(value: number): string {
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(rounded);
}

function legacyParses(symbol: string): boolean {
  try {
    parseChordSymbol(symbol);
    return true;
  } catch {
    return false;
  }
}

/**
 * Export a sequence as legacy chord text (`Symbol | measures` per line).
 * Tempo and time signature are app settings in the legacy format and are not written.
 */
export function sequenceToText(sequence: MusicalSequence): TextExportResult {
  const barBeats = beatsPerBar(sequence.timeSignature);
  const lines: string[] = [];
  const lost: string[] = [];
  if (sequence.title !== undefined) {
    lost.push(`Title "${sequence.title}" is not stored in chord text.`);
  }
  if (sequence.key) {
    lost.push(`Key context (${formatKey(sequence.key)}) is not stored in chord text.`);
  }
  if (sequence.defaultVoicingRecipeId !== undefined) {
    lost.push(`Default voicing recipe "${sequence.defaultVoicingRecipeId}" is not stored in chord text.`);
  }
  const ordered = [...sequence.events].sort((a, b) => a.startBeat - b.startBeat || a.index - b.index);
  let expectedStart = 0;
  ordered.forEach((event) => {
    const label = `Event ${event.id} (${event.symbol})`;
    if (Math.abs(event.startBeat - expectedStart) > BEAT_EPSILON) {
      lost.push(`${label} starts at beat ${event.startBeat}, but chord text plays events back-to-back (expected beat ${roundBeats(expectedStart)}).`);
    }
    expectedStart = event.startBeat + event.durationBeats;
    if (event.voicingRecipeId !== undefined) {
      lost.push(`${label}: voicing recipe "${event.voicingRecipeId}" is not stored in chord text.`);
    }
    if (event.voicing) {
      lost.push(`${label}: the chosen voicing (${event.voicing.notes.length} notes) is not stored in chord text.`);
    }
    if (event.context) {
      lost.push(`${label}: harmonic context (key/roman numeral/function) is not stored in chord text.`);
    }
    const symbol = event.kind === "rest" ? "NC" : event.symbol;
    if (event.kind === "chord" && !legacyParses(symbol)) {
      lost.push(`${label}: the legacy chord parser cannot read "${symbol}"; re-importing this text will report an error.`);
    }
    lines.push(`${symbol} | ${formatMeasures(event.durationBeats / barBeats)}`);
  });
  return { text: lines.join("\n"), lost };
}
