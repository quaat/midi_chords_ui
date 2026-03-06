import type { ChordPathwayOptions, InjectChordPathwaysResult, ParsedLineEvent } from "@/types";
import { parseChordSymbol } from "@/theory/chordParser";
import { pcToNoteName } from "@/theory/notes";

type ChordFamily = "major" | "minor";

function normalizePc(pc: number): number {
  return ((pc % 12) + 12) % 12;
}

function roundMeasures(value: number, precision: number): number {
  const clampedPrecision = Number.isInteger(precision) ? Math.max(0, Math.min(9, precision)) : 6;
  const scale = 10 ** clampedPrecision;
  const rounded = Math.round(value * scale) / scale;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function formatDuration(value: number, precision: number): string {
  const rounded = roundMeasures(value, precision);
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(precision).replace(/\.?0+$/, "");
}

function isRestSymbol(chordSymbol: string): boolean {
  return /^N\.?C\.?$/i.test(chordSymbol.trim());
}

function detectChordFamily(intervals: number[]): ChordFamily | undefined {
  const hasMinorThird = intervals.some((interval) => normalizePc(interval) === 3);
  const hasMajorThird = intervals.some((interval) => normalizePc(interval) === 4);

  if (hasMajorThird && !hasMinorThird) {
    return "major";
  }

  if (hasMinorThird && !hasMajorThird) {
    return "minor";
  }

  return undefined;
}

function buildSecondaryDominant(rootPc: number, bassPc?: number): string {
  const root = pcToNoteName(rootPc, "sharp");
  if (bassPc === undefined) {
    return `${root}7`;
  }

  return `${root}7/${pcToNoteName(bassPc, "sharp")}`;
}

function buildTritoneDominant(rootPc: number): string {
  return `${pcToNoteName(rootPc, "flat")}7`;
}

function buildSecondaryTwoChord(rootPc: number, useHalfDiminished: boolean): string {
  const suffix = useHalfDiminished ? "m7b5" : "m7";
  return `${pcToNoteName(rootPc, "smart")}${suffix}`;
}

function shouldUseHalfDiminishedSecondaryTwo(targetRootPc: number, family: ChordFamily, tonalCenterPc?: number): boolean {
  if (family !== "minor") {
    return false;
  }

  if (tonalCenterPc === undefined) {
    return true;
  }

  // In a clear major-center context, temporary ii of diatonic ii is commonly rendered as m7.
  const targetDegreeFromCenter = normalizePc(targetRootPc - tonalCenterPc);
  if (targetDegreeFromCenter === 2) {
    return false;
  }

  return true;
}

function buildPathwayChords(
  targetChordSymbol: string,
  mode: ChordPathwayOptions["mode"],
  tonalCenterPc?: number
): { chords: string[]; warning?: string } {
  let chord;
  try {
    chord = parseChordSymbol(targetChordSymbol);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unsupported chord symbol";
    return {
      chords: [],
      warning: `Target "${targetChordSymbol}" is unsupported (${message}); pair skipped.`
    };
  }

  const family = detectChordFamily(chord.intervals);
  if (!family) {
    return {
      chords: [],
      warning: `Target "${targetChordSymbol}" has ambiguous third content; pair skipped.`
    };
  }

  const dominantRootPc = normalizePc(chord.rootPc + 7);
  const tritoneDominantRootPc = normalizePc(dominantRootPc + 6);
  const secondaryTwoRootPc = normalizePc(chord.rootPc + 2);

  switch (mode) {
    case "secondaryDominant":
      return { chords: [buildSecondaryDominant(dominantRootPc)] };
    case "secondaryDominantFirstInversion":
      return {
        chords: [buildSecondaryDominant(dominantRootPc, normalizePc(dominantRootPc + 4))]
      };
    case "secondaryDominantSecondInversion":
      return {
        chords: [buildSecondaryDominant(dominantRootPc, normalizePc(dominantRootPc + 7))]
      };
    case "tritoneSubstitution":
      return { chords: [buildTritoneDominant(tritoneDominantRootPc)] };
    case "secondaryTwoFive":
      {
        const useHalfDiminished = shouldUseHalfDiminishedSecondaryTwo(chord.rootPc, family, tonalCenterPc);
        return {
          chords: [buildSecondaryTwoChord(secondaryTwoRootPc, useHalfDiminished), buildSecondaryDominant(dominantRootPc)]
        };
      }
    case "secondaryTwoFiveTritoneSub":
      {
        const useHalfDiminished = shouldUseHalfDiminishedSecondaryTwo(chord.rootPc, family, tonalCenterPc);
        return {
          chords: [buildSecondaryTwoChord(secondaryTwoRootPc, useHalfDiminished), buildTritoneDominant(tritoneDominantRootPc)]
        };
      }
    default:
      return { chords: [] };
  }
}

function cloneEvent(event: ParsedLineEvent): ParsedLineEvent {
  return {
    line: event.line,
    raw: event.raw,
    chordSymbol: event.chordSymbol,
    durationMeasures: event.durationMeasures,
    isRest: event.isRest
  };
}

function buildGeneratedEvent(chordSymbol: string, durationMeasures: number, line: number): ParsedLineEvent {
  return {
    line,
    raw: `${chordSymbol} | ${durationMeasures}`,
    chordSymbol,
    durationMeasures,
    isRest: isRestSymbol(chordSymbol)
  };
}

export function injectChordPathways(events: ParsedLineEvent[], options: ChordPathwayOptions): InjectChordPathwaysResult {
  const precision = options.decimalPrecision ?? 6;
  const generated: ParsedLineEvent[] = [];
  const warnings: string[] = [];
  const firstPlayableEvent = events.find((event) => !event.isRest);
  let tonalCenterPc: number | undefined;

  if (firstPlayableEvent) {
    try {
      tonalCenterPc = parseChordSymbol(firstPlayableEvent.chordSymbol).rootPc;
    } catch {
      tonalCenterPc = undefined;
    }
  }

  if (events.length === 0) {
    const turnaroundSymbol = options.turnaroundChord?.trim();
    if (turnaroundSymbol) {
      generated.push(
        buildGeneratedEvent(turnaroundSymbol, options.turnaroundDurationMeasures ?? 1, 1)
      );
      return { events: generated, warnings, appendedTurnaroundSymbol: turnaroundSymbol };
    }
    return { events: generated, warnings };
  }

  for (let index = 0; index < events.length; index += 1) {
    const current = events[index];
    const target = events[index + 1];

    if (!target) {
      generated.push(cloneEvent(current));
      continue;
    }

    if (current.isRest || target.isRest) {
      generated.push(cloneEvent(current));
      continue;
    }

    const pathway = buildPathwayChords(target.chordSymbol, options.mode, tonalCenterPc);
    if (pathway.warning) {
      warnings.push(`Line ${target.line}: ${pathway.warning}`);
      generated.push(cloneEvent(current));
      continue;
    }

    if (pathway.chords.length === 0) {
      generated.push(cloneEvent(current));
      continue;
    }

    const splitMeasures = roundMeasures(current.durationMeasures / (pathway.chords.length + 1), precision);
    generated.push({
      ...cloneEvent(current),
      raw: `${current.chordSymbol} | ${formatDuration(splitMeasures, precision)}`,
      durationMeasures: splitMeasures
    });

    pathway.chords.forEach((symbol) => {
      generated.push(buildGeneratedEvent(symbol, splitMeasures, current.line));
    });
  }

  const turnaroundSymbol = options.turnaroundChord?.trim();
  if (!turnaroundSymbol) {
    return { events: generated, warnings };
  }

  const baseDuration = options.turnaroundDurationMeasures ?? events.at(-1)?.durationMeasures ?? 1;
  generated.push(buildGeneratedEvent(turnaroundSymbol, baseDuration, events.at(-1)?.line ?? 1));
  return { events: generated, warnings, appendedTurnaroundSymbol: turnaroundSymbol };
}

export function pathwayEventsToText(result: InjectChordPathwaysResult, decimalPrecision = 6): string {
  return result.events
    .map((event, index) => {
      const isTurnaroundLine =
        result.appendedTurnaroundSymbol !== undefined &&
        index === result.events.length - 1 &&
        event.chordSymbol === result.appendedTurnaroundSymbol;

      if (isTurnaroundLine) {
        return event.chordSymbol;
      }

      return `${event.chordSymbol} | ${formatDuration(event.durationMeasures, decimalPrecision)}`;
    })
    .join("\n");
}
