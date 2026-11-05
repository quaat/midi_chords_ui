/**
 * Song-chart validation (plan E30): structural rules the chart model supports in v1.
 *
 * Supported notation
 * - Sections of bars; each bar is filled exactly by contiguous chord spans (no gaps, no
 *   overlaps). A bar is one full meter long unless `bar.beats` declares a shorter (pickup /
 *   partial) bar; `bar.beats` may never exceed the meter.
 * - `section.repeat` is a whole number 1..MAX_SECTION_REPEAT expanded explicitly.
 * - `performanceOrder` is a non-empty list of existing section ids.
 * - Rests are spans with `isRest: true` or the symbol "NC"/"N.C.".
 *
 * Anything else (endings, codas, D.S. markers, unbounded repeats) is unsupported and reported
 * rather than guessed.
 */
import type { SongChart } from "@/model/contracts";
import { tryChordFromSymbol } from "@/music/chords";

export const MAX_SECTION_REPEAT = 8;
export const SUPPORTED_DENOMINATORS: readonly number[] = [1, 2, 4, 8, 16];
const EPSILON = 1e-6;

export type ChartIssueCode =
  | "noSections"
  | "duplicateId"
  | "emptySection"
  | "emptyBar"
  | "barFill"
  | "barTooLong"
  | "badDuration"
  | "repeat"
  | "emptyOrder"
  | "unknownSection"
  | "meter"
  | "tempo"
  | "symbol"
  | "pickup";

export interface ChartIssue {
  severity: "error" | "warning";
  code: ChartIssueCode;
  message: string;
  sectionId?: string;
  barId?: string;
  spanId?: string;
}

/** Quarter-note beats in a full bar of the chart's meter. */
export function chartBeatsPerBar(chart: Pick<SongChart, "timeSignature">): number {
  return (chart.timeSignature.numerator * 4) / chart.timeSignature.denominator;
}

/** "NC", "N.C.", "nc" ... */
export function isRestSymbol(symbol: string): boolean {
  return /^N\.?C\.?$/i.test(symbol.trim());
}

function isWholeNumber(value: number): boolean {
  return Number.isFinite(value) && Math.floor(value) === value;
}

/** Validate a meter; returns a message or null. */
export function meterProblem(numerator: number, denominator: number): string | null {
  if (!isWholeNumber(numerator) || numerator < 1 || numerator > 32) {
    return `Time signature numerator must be a whole number 1..32 (got ${numerator}).`;
  }
  if (!SUPPORTED_DENOMINATORS.includes(denominator)) {
    return `Time signature denominator must be one of ${SUPPORTED_DENOMINATORS.join(", ")} (got ${denominator}).`;
  }
  return null;
}

/**
 * Check that spans fill a bar of `barLength` beats exactly. Returns a problem description or
 * null. Spans are checked in startBeat order.
 */
export function spanFillProblem(spans: { id: string; startBeat: number; durationBeats: number }[], barLength: number): string | null {
  if (spans.length === 0) {
    return "has no chord spans";
  }
  for (const span of spans) {
    if (!Number.isFinite(span.durationBeats) || span.durationBeats <= 0) {
      return `span "${span.id}" has a non-positive duration (${span.durationBeats})`;
    }
    if (!Number.isFinite(span.startBeat) || span.startBeat < -EPSILON) {
      return `span "${span.id}" starts at an invalid beat (${span.startBeat})`;
    }
  }
  const sorted = [...spans].sort((a, b) => a.startBeat - b.startBeat);
  let cursor = 0;
  for (const span of sorted) {
    if (span.startBeat > cursor + EPSILON) {
      return `has a gap between beat ${round(cursor)} and beat ${round(span.startBeat)} (before span "${span.id}")`;
    }
    if (span.startBeat < cursor - EPSILON) {
      return `span "${span.id}" overlaps the previous span (starts at beat ${round(span.startBeat)}, previous ends at ${round(cursor)})`;
    }
    cursor = span.startBeat + span.durationBeats;
  }
  if (cursor > barLength + EPSILON) {
    return `spans last ${round(cursor)} beats but the bar has ${round(barLength)}`;
  }
  if (cursor < barLength - EPSILON) {
    return `spans fill only ${round(cursor)} of ${round(barLength)} beats`;
  }
  return null;
}

export function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Collect every problem in a chart. Errors make the chart unplayable (expandChart refuses
 * it); warnings are advisory. Unparseable chord symbols are errors with code "symbol" but do
 * not stop expansion (the bar grid is still well defined).
 */
export function validateChart(chart: SongChart): ChartIssue[] {
  const issues: ChartIssue[] = [];
  const meter = meterProblem(chart.timeSignature.numerator, chart.timeSignature.denominator);
  if (meter) {
    issues.push({ severity: "error", code: "meter", message: meter });
  }
  if (!Number.isFinite(chart.tempo.bpm) || chart.tempo.bpm <= 0) {
    issues.push({ severity: "error", code: "tempo", message: `Tempo must be a positive number of BPM (got ${chart.tempo.bpm}).` });
  }
  const fullBar = meter ? 4 : chartBeatsPerBar(chart);

  if (chart.sections.length === 0) {
    issues.push({ severity: "error", code: "noSections", message: "The chart has no sections." });
  }
  const sectionIds = new Set<string>();
  const barIds = new Set<string>();
  const spanIds = new Set<string>();
  chart.sections.forEach((section) => {
    if (sectionIds.has(section.id)) {
      issues.push({ severity: "error", code: "duplicateId", sectionId: section.id, message: `Section id "${section.id}" is used more than once.` });
    }
    sectionIds.add(section.id);
    const label = `Section "${section.label || section.id}"`;
    if (section.repeat !== undefined) {
      if (!isWholeNumber(section.repeat) || section.repeat < 1) {
        issues.push({ severity: "error", code: "repeat", sectionId: section.id, message: `${label}: repeat must be a whole number of at least 1 (got ${section.repeat}).` });
      } else if (section.repeat > MAX_SECTION_REPEAT) {
        issues.push({
          severity: "error",
          code: "repeat",
          sectionId: section.id,
          message: `${label}: repeat ${section.repeat} is not supported (at most ${MAX_SECTION_REPEAT}); write the performance order explicitly instead.`
        });
      }
    }
    if (section.bars.length === 0) {
      issues.push({ severity: "error", code: "emptySection", sectionId: section.id, message: `${label} has no bars.` });
    }
    section.bars.forEach((bar, barPosition) => {
      const barLabel = `${label}, bar ${barPosition + 1} ("${bar.id}")`;
      if (barIds.has(bar.id)) {
        issues.push({ severity: "error", code: "duplicateId", sectionId: section.id, barId: bar.id, message: `${barLabel}: bar id is used more than once.` });
      }
      barIds.add(bar.id);
      let barLength = fullBar;
      if (bar.beats !== undefined) {
        if (!Number.isFinite(bar.beats) || bar.beats <= 0) {
          issues.push({ severity: "error", code: "badDuration", sectionId: section.id, barId: bar.id, message: `${barLabel}: beats must be a positive number (got ${bar.beats}).` });
        } else if (bar.beats > fullBar + EPSILON) {
          issues.push({
            severity: "error",
            code: "barTooLong",
            sectionId: section.id,
            barId: bar.id,
            message: `${barLabel}: ${bar.beats} beats is longer than one ${chart.timeSignature.numerator}/${chart.timeSignature.denominator} bar (${fullBar}); split it into bars.`
          });
        } else {
          barLength = bar.beats;
        }
      }
      if (bar.spans.length === 0) {
        issues.push({ severity: "error", code: "emptyBar", sectionId: section.id, barId: bar.id, message: `${barLabel} has no chord spans.` });
      } else {
        const fill = spanFillProblem(bar.spans, barLength);
        if (fill) {
          issues.push({ severity: "error", code: "barFill", sectionId: section.id, barId: bar.id, message: `${barLabel} ${fill}.` });
        }
      }
      bar.spans.forEach((span) => {
        if (spanIds.has(span.id)) {
          issues.push({ severity: "error", code: "duplicateId", sectionId: section.id, barId: bar.id, spanId: span.id, message: `${barLabel}: span id "${span.id}" is used more than once.` });
        }
        spanIds.add(span.id);
        const rest = span.isRest === true || isRestSymbol(span.symbol);
        if (!rest) {
          const parsed = tryChordFromSymbol(span.symbol);
          if (!parsed.ok) {
            issues.push({
              severity: "error",
              code: "symbol",
              sectionId: section.id,
              barId: bar.id,
              spanId: span.id,
              message: `${barLabel}: chord symbol "${span.symbol}" is not supported (${parsed.error}).`
            });
          }
        }
      });
    });
  });

  if (chart.performanceOrder.length === 0) {
    issues.push({ severity: "error", code: "emptyOrder", message: "The performance order is empty; list the sections in the order they are played." });
  }
  chart.performanceOrder.forEach((sectionId, orderIndex) => {
    if (!sectionIds.has(sectionId)) {
      issues.push({
        severity: "error",
        code: "unknownSection",
        sectionId,
        message: `Performance order entry ${orderIndex + 1} refers to section "${sectionId}", which is not in the chart.`
      });
    }
  });

  // Advisory: short bars anywhere but the very first performed bar are unusual.
  let performedBars = 0;
  chart.performanceOrder.forEach((sectionId) => {
    const section = chart.sections.find((candidate) => candidate.id === sectionId);
    if (!section) {
      return;
    }
    const repeat = section.repeat !== undefined && isWholeNumber(section.repeat) && section.repeat >= 1 ? Math.min(section.repeat, MAX_SECTION_REPEAT) : 1;
    for (let pass = 0; pass < repeat; pass += 1) {
      section.bars.forEach((bar) => {
        if (performedBars > 0 && bar.beats !== undefined && bar.beats < fullBar - EPSILON && pass === 0) {
          issues.push({
            severity: "warning",
            code: "pickup",
            sectionId: section.id,
            barId: bar.id,
            message: `Bar "${bar.id}" in section "${section.label || section.id}" is shorter than the meter (${bar.beats} of ${fullBar} beats) but is not the first bar played.`
          });
        }
        performedBars += 1;
      });
    }
  });
  if (chart.pickupBeats !== undefined && chart.pickupBeats > 0) {
    const first = chart.sections.find((section) => section.id === chart.performanceOrder[0]);
    const firstBar = first ? first.bars[0] : undefined;
    if (!firstBar || firstBar.beats === undefined || Math.abs(firstBar.beats - chart.pickupBeats) > EPSILON) {
      issues.push({
        severity: "warning",
        code: "pickup",
        message: `The chart declares a ${chart.pickupBeats}-beat pickup, but the first bar played is not a ${chart.pickupBeats}-beat bar.`
      });
    }
  }
  return issues;
}

export function chartErrors(chart: SongChart): ChartIssue[] {
  return validateChart(chart).filter((issue) => issue.severity === "error");
}
