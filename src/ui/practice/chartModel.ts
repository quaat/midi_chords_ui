/**
 * Bar-based chord chart view model (practice view "chart"). From a chart expansion when the
 * request came from a song chart (section labels, pickup bars), otherwise from the timeline's
 * occurrences grouped into bars. Pure.
 */
import type { PerformanceTimeline } from "@/model/contracts";
import type { ChartExpansion } from "@/charts/expand";

export interface ChartCellView {
  occurrenceId: string | null;
  symbol: string;
  /** Beat of the cell inside its bar. */
  beatInBar: number;
  beats: number;
  /** A chord held over from the previous bar (no new symbol). */
  continuation: boolean;
}

export interface ChartBarView {
  index: number;
  startBeat: number;
  beats: number;
  /** Section label shown at the first bar of each section pass. */
  sectionLabel: string | null;
  isPickup: boolean;
  cells: ChartCellView[];
}

const EPSILON = 1e-6;

export function beatsPerBarOf(timeline: PerformanceTimeline): number {
  const ts = timeline.timeSignature;
  return Math.max(1, (ts.numerator * 4) / Math.max(1, ts.denominator));
}

export function chartBarsFromExpansion(expansion: ChartExpansion): ChartBarView[] {
  const byId = new Map(expansion.occurrences.map((occurrence) => [occurrence.occurrenceId, occurrence]));
  let previousKey = "";
  return expansion.bars.map((bar) => {
    const key = `${bar.sectionId}|${bar.orderIndex}|${bar.repeatIndex}`;
    const sectionLabel = key !== previousKey ? bar.sectionLabel : null;
    previousKey = key;
    const cells: ChartCellView[] = [];
    bar.occurrenceIds.forEach((id) => {
      const occurrence = byId.get(id);
      if (!occurrence) {
        return;
      }
      cells.push({
        occurrenceId: id,
        symbol: occurrence.isRest ? "N.C." : occurrence.symbol,
        beatInBar: occurrence.beatInBar,
        beats: occurrence.durationBeats,
        continuation: false
      });
    });
    return { index: bar.barIndex, startBeat: bar.startBeat, beats: bar.beats, sectionLabel, isPickup: bar.isPickup, cells };
  });
}

export function chartBarsFromTimeline(timeline: PerformanceTimeline): ChartBarView[] {
  const perBar = beatsPerBarOf(timeline);
  const total = Math.max(timeline.totalBeats, 0);
  const barCount = Math.max(1, Math.ceil(total / perBar - EPSILON));
  const bars: ChartBarView[] = [];
  for (let i = 0; i < barCount; i += 1) {
    bars.push({ index: i, startBeat: i * perBar, beats: perBar, sectionLabel: null, isPickup: false, cells: [] });
  }
  const occurrences = [...timeline.occurrences].sort((a, b) => a.startBeat - b.startBeat);
  occurrences.forEach((occurrence) => {
    const first = Math.max(0, Math.floor(occurrence.startBeat / perBar + EPSILON));
    const end = occurrence.startBeat + occurrence.durationBeats;
    const lastBar = Math.max(first, Math.ceil(end / perBar - EPSILON) - 1);
    for (let index = first; index <= lastBar && index < bars.length; index += 1) {
      const bar = bars[index];
      const startInBar = Math.max(occurrence.startBeat, bar.startBeat) - bar.startBeat;
      const endInBar = Math.min(end, bar.startBeat + perBar) - bar.startBeat;
      bar.cells.push({
        occurrenceId: occurrence.occurrenceId,
        symbol: occurrence.symbol === "NC" ? "N.C." : occurrence.symbol,
        beatInBar: Math.round(startInBar * 1000) / 1000,
        beats: Math.max(0, Math.round((endInBar - startInBar) * 1000) / 1000),
        continuation: index !== first
      });
    }
  });
  return bars;
}

/** Index into `bars` of the bar containing `beat` (-1 before the first bar / during count-in). */
export function barIndexAt(bars: readonly ChartBarView[], beat: number): number {
  if (bars.length === 0 || beat < bars[0].startBeat - EPSILON) {
    return -1;
  }
  for (let i = bars.length - 1; i >= 0; i -= 1) {
    if (beat >= bars[i].startBeat - EPSILON) {
      return beat < bars[i].startBeat + bars[i].beats - EPSILON ? i : i === bars.length - 1 ? -1 : i;
    }
  }
  return -1;
}
