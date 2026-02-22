import type { ParsedLineEvent, ParsedSequence } from "@/types";
import { parseChordSymbol } from "@/theory/chordParser";

function parseLine(line: string, lineNumber: number, defaultChordMeasures: number): ParsedLineEvent {
  const parts = line.split("|");
  if (parts.length > 2) {
    throw new Error("Only one duration separator '|' is allowed.");
  }

  const chordSymbol = parts[0].trim();
  if (!chordSymbol) {
    throw new Error("Missing chord symbol before '|'.");
  }

  const isRest = /^N\.?C\.?$/i.test(chordSymbol);

  let durationMeasures = defaultChordMeasures;
  if (parts.length === 2) {
    const durationText = parts[1].trim();
    if (!durationText) {
      throw new Error("Duration value is empty after '|'.");
    }
    durationMeasures = Number.parseFloat(durationText);
    if (!Number.isFinite(durationMeasures) || durationMeasures <= 0) {
      throw new Error("Duration measures must be a positive number.");
    }
  }

  if (!isRest) {
    parseChordSymbol(chordSymbol);
  }

  return {
    line: lineNumber,
    raw: line,
    chordSymbol,
    durationMeasures,
    isRest
  };
}

export function parseChordSequence(text: string, defaultChordMeasures: number): ParsedSequence {
  const lines = text.split(/\r?\n/);
  const events: ParsedLineEvent[] = [];
  const errors: ParsedSequence["errors"] = [];

  lines.forEach((rawLine, idx) => {
    const lineNumber = idx + 1;
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      return;
    }

    try {
      events.push(parseLine(rawLine, lineNumber, defaultChordMeasures));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown parse error.";
      errors.push({
        line: lineNumber,
        column: 1,
        message,
        rawLine
      });
    }
  });

  return { events, errors };
}
