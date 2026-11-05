/**
 * Chart expansion (plan E30, §4 "Learning and assessment"): turn a SongChart's sections,
 * repeats and explicit performance order into a flat list of performance occurrences.
 *
 * Occurrence identity
 * - One ChartOccurrence per chord-span pass. IDs are
 *   `<sectionId>#<orderIndex>:<barId>:<spanId>`; when a section's `repeat` is > 1 the repeat
 *   pass is added to the order part: `<sectionId>#<orderIndex>.<repeatIndex>:<barId>:<spanId>`.
 * - `passIndex` counts how many times this source span has already been performed, so
 *   evening-loop's A spans get 0, 1, (B: 0), 2 over the order A A B A.
 * - Beats are absolute quarter-note beats from the start of the chart (a pickup bar starts
 *   at beat 0; the first full bar follows it).
 *
 * Unsupported notation is rejected with a diagnostic naming the section/bar (see validate.ts).
 */
import type { SongChart } from "@/model/contracts";
import { MAX_SECTION_REPEAT, chartBeatsPerBar, chartErrors, isRestSymbol } from "@/charts/validate";

const EPSILON = 1e-6;

export interface ChartOccurrence {
  occurrenceId: string;
  startBeat: number;
  durationBeats: number;
  symbol: string;
  isRest: boolean;
  sectionId: string;
  /** Performance bar index (0-based over the expanded order). */
  barIndex: number;
  sourceBarId: string;
  spanId: string;
  /** How many times this source span has been performed before this occurrence. */
  passIndex: number;
  /** Index into chart.performanceOrder. */
  orderIndex: number;
  /** Repeat pass within one order entry (section.repeat). */
  repeatIndex: number;
  /** Beat of the span inside its bar. */
  beatInBar: number;
  romanNumeral?: string;
}

export interface ExpandedBar {
  barIndex: number;
  sourceBarId: string;
  sectionId: string;
  sectionLabel: string;
  orderIndex: number;
  repeatIndex: number;
  startBeat: number;
  beats: number;
  /** Shorter than the meter (declared with bar.beats). */
  isPickup: boolean;
  occurrenceIds: string[];
}

export interface ExpandedSection {
  sectionId: string;
  label: string;
  orderIndex: number;
  startBeat: number;
  endBeat: number;
  firstBarIndex: number;
  barCount: number;
}

export interface ChartExpansion {
  ok: true;
  chartId: string;
  chartVersion: number;
  beatsPerBar: number;
  occurrences: ChartOccurrence[];
  bars: ExpandedBar[];
  sections: ExpandedSection[];
  totalBeats: number;
}

export type ExpandChartResult = ChartExpansion | { ok: false; reason: string; details: string[] };

function roundBeat(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

/** Expand a chart following its performance order. */
export function expandChart(chart: SongChart): ExpandChartResult {
  const structural = chartErrors(chart).filter((issue) => issue.code !== "symbol");
  if (structural.length > 0) {
    const details = structural.map((issue) => issue.message);
    const more = details.length > 1 ? ` (${details.length - 1} more problem${details.length > 2 ? "s" : ""})` : "";
    return { ok: false, reason: `Cannot play "${chart.title}": ${details[0]}${more}`, details };
  }
  const fullBar = chartBeatsPerBar(chart);
  const occurrences: ChartOccurrence[] = [];
  const bars: ExpandedBar[] = [];
  const sections: ExpandedSection[] = [];
  const passCounts = new Map<string, number>();
  let beat = 0;

  chart.performanceOrder.forEach((sectionId, orderIndex) => {
    const section = chart.sections.find((candidate) => candidate.id === sectionId);
    if (!section) {
      // Unreachable: validated above.
      return;
    }
    const repeat = Math.min(MAX_SECTION_REPEAT, section.repeat ?? 1);
    const sectionStart = beat;
    const firstBarIndex = bars.length;
    for (let repeatIndex = 0; repeatIndex < repeat; repeatIndex += 1) {
      const orderPart = repeat > 1 ? `${orderIndex}.${repeatIndex}` : `${orderIndex}`;
      section.bars.forEach((bar) => {
        const barLength = bar.beats ?? fullBar;
        const barIndex = bars.length;
        const expandedBar: ExpandedBar = {
          barIndex,
          sourceBarId: bar.id,
          sectionId: section.id,
          sectionLabel: section.label,
          orderIndex,
          repeatIndex,
          startBeat: roundBeat(beat),
          beats: barLength,
          isPickup: barLength < fullBar - EPSILON,
          occurrenceIds: []
        };
        const spans = [...bar.spans].sort((a, b) => a.startBeat - b.startBeat);
        spans.forEach((span) => {
          const passKey = `${bar.id}\u0000${span.id}`;
          const passIndex = passCounts.get(passKey) ?? 0;
          passCounts.set(passKey, passIndex + 1);
          const occurrence: ChartOccurrence = {
            occurrenceId: `${section.id}#${orderPart}:${bar.id}:${span.id}`,
            startBeat: roundBeat(beat + span.startBeat),
            durationBeats: span.durationBeats,
            symbol: span.symbol,
            isRest: span.isRest === true || isRestSymbol(span.symbol),
            sectionId: section.id,
            barIndex,
            sourceBarId: bar.id,
            spanId: span.id,
            passIndex,
            orderIndex,
            repeatIndex,
            beatInBar: span.startBeat
          };
          if (span.romanNumeral !== undefined) {
            occurrence.romanNumeral = span.romanNumeral;
          }
          occurrences.push(occurrence);
          expandedBar.occurrenceIds.push(occurrence.occurrenceId);
        });
        bars.push(expandedBar);
        beat += barLength;
      });
    }
    sections.push({
      sectionId: section.id,
      label: section.label,
      orderIndex,
      startBeat: roundBeat(sectionStart),
      endBeat: roundBeat(beat),
      firstBarIndex,
      barCount: bars.length - firstBarIndex
    });
  });

  return {
    ok: true,
    chartId: chart.id,
    chartVersion: chart.version,
    beatsPerBar: fullBar,
    occurrences,
    bars,
    sections,
    totalBeats: roundBeat(beat)
  };
}

export interface ChartCursor {
  state: "countIn" | "playing" | "ended";
  /** Performance bar index; -1 during the count-in. */
  barIndex: number;
  /** Beats into the current bar (negative during the count-in: beats until the downbeat). */
  beatInBar: number;
  occurrence: ChartOccurrence | null;
  sectionId: string | null;
  orderIndex: number;
  isPickup: boolean;
}

/** Bar/beat/occurrence at a transport position (beats; negative = count-in). */
export function chartCursor(expansion: ChartExpansion, positionBeats: number): ChartCursor {
  if (positionBeats < -EPSILON) {
    return { state: "countIn", barIndex: -1, beatInBar: positionBeats, occurrence: null, sectionId: null, orderIndex: -1, isPickup: false };
  }
  const lastBar = expansion.bars[expansion.bars.length - 1];
  if (!lastBar || positionBeats >= expansion.totalBeats - EPSILON) {
    return {
      state: "ended",
      barIndex: lastBar ? lastBar.barIndex : -1,
      beatInBar: lastBar ? lastBar.beats : 0,
      occurrence: null,
      sectionId: lastBar ? lastBar.sectionId : null,
      orderIndex: lastBar ? lastBar.orderIndex : -1,
      isPickup: lastBar ? lastBar.isPickup : false
    };
  }
  let bar = expansion.bars[0];
  for (const candidate of expansion.bars) {
    if (candidate.startBeat <= positionBeats + EPSILON) {
      bar = candidate;
    } else {
      break;
    }
  }
  let occurrence: ChartOccurrence | null = null;
  for (const id of bar.occurrenceIds) {
    const found = expansion.occurrences.find((candidate) => candidate.occurrenceId === id);
    if (found && found.startBeat <= positionBeats + EPSILON && positionBeats < found.startBeat + found.durationBeats - EPSILON) {
      occurrence = found;
      break;
    }
  }
  return {
    state: "playing",
    barIndex: bar.barIndex,
    beatInBar: roundBeat(Math.max(0, positionBeats - bar.startBeat)),
    occurrence,
    sectionId: bar.sectionId,
    orderIndex: bar.orderIndex,
    isPickup: bar.isPickup
  };
}

export interface LoopRegion {
  startBeat: number;
  endBeat: number;
  sectionId: string;
  orderIndex: number;
}

/**
 * Loop region of one performance of a section. Without `orderIndex` the first performance
 * is used. Null when the section is not performed (or `orderIndex` names another section).
 */
export function sectionLoopRegion(expansion: ChartExpansion, sectionId: string, orderIndex?: number): LoopRegion | null {
  const found = expansion.sections.find(
    (section) => section.sectionId === sectionId && (orderIndex === undefined || section.orderIndex === orderIndex)
  );
  if (!found) {
    return null;
  }
  return { startBeat: found.startBeat, endBeat: found.endBeat, sectionId: found.sectionId, orderIndex: found.orderIndex };
}

/** Loop region of a single performance bar (for practising a transition). */
export function barLoopRegion(expansion: ChartExpansion, barIndex: number, barCount: number = 1): { startBeat: number; endBeat: number } | null {
  const first = expansion.bars[barIndex];
  if (!first || barCount < 1) {
    return null;
  }
  const last = expansion.bars[Math.min(expansion.bars.length - 1, barIndex + barCount - 1)];
  return { startBeat: first.startBeat, endBeat: roundBeat(last.startBeat + last.beats) };
}
