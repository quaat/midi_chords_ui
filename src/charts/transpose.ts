/**
 * Chart transposition with spelling (plan E30): every symbol is re-spelled through the
 * spelled chord model (F up M2 = G, C/E up M2 = D/F#), rests and Roman numerals are kept,
 * the key moves with letter arithmetic, and the chart version is bumped.
 */
import type { ChartBar, ChartSection, ChordSpan, Interval, SongChart, SpelledPitchClass } from "@/model/contracts";
import { chordFromSymbol, transposeChord } from "@/music/chords";
import { intervalBetweenPitchClasses, invertInterval, semitonesOf } from "@/music/intervals";
import type { Direction } from "@/music/intervals";
import { formatPitchClass, parsePitchClass } from "@/music/pitch";
import { transposeKey } from "@/music/scales";
import { isRestSymbol } from "@/charts/validate";

export type TransposeChartResult = { ok: true; chart: SongChart } | { ok: false; reason: string };

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Transpose every chord span of a chart by an interval. */
export function transposeChart(chart: SongChart, interval: Interval, direction: Direction = "up"): TransposeChartResult {
  const sections: ChartSection[] = [];
  for (const section of chart.sections) {
    const bars: ChartBar[] = [];
    for (const bar of section.bars) {
      const spans: ChordSpan[] = [];
      for (const span of bar.spans) {
        if (span.isRest === true || isRestSymbol(span.symbol)) {
          spans.push({ ...span });
          continue;
        }
        let symbol: string;
        try {
          symbol = transposeChord(chordFromSymbol(span.symbol), interval, direction).symbol;
        } catch (error) {
          return {
            ok: false,
            reason: `Section "${section.label || section.id}", bar "${bar.id}": cannot transpose "${span.symbol}" (${describeError(error)}).`
          };
        }
        spans.push({ ...span, symbol });
      }
      bars.push({ ...bar, spans });
    }
    sections.push({ ...section, bars });
  }
  const result: SongChart = {
    ...chart,
    version: chart.version + 1,
    sections,
    performanceOrder: [...chart.performanceOrder],
    arrangementIds: [...chart.arrangementIds]
  };
  if (chart.key) {
    try {
      result.key = transposeKey(chart.key, interval, direction);
    } catch (error) {
      return { ok: false, reason: `Cannot transpose the key: ${describeError(error)}` };
    }
  }
  return { ok: true, chart: result };
}

/**
 * Transpose a chart so that its key tonic becomes `newTonic`, moving by the smaller distance
 * (up to a tritone up, otherwise down). Requires `chart.key`.
 */
export function transposeChartToKey(chart: SongChart, newTonic: SpelledPitchClass | string): TransposeChartResult {
  if (!chart.key) {
    return { ok: false, reason: `"${chart.title}" has no key, so there is no tonic to move; transpose by an interval instead.` };
  }
  const target = typeof newTonic === "string" ? parsePitchClass(newTonic) : newTonic;
  if (!target) {
    return { ok: false, reason: `"${String(newTonic)}" is not a note name.` };
  }
  const up = intervalBetweenPitchClasses(chart.key.tonic, target);
  if (!up) {
    return { ok: false, reason: `No spelled interval from ${formatPitchClass(chart.key.tonic)} to ${formatPitchClass(target)}.` };
  }
  const semitones = ((semitonesOf(up) % 12) + 12) % 12;
  if (semitones > 6) {
    const down = invertInterval(up);
    if (down) {
      return transposeChart(chart, down, "down");
    }
  }
  return transposeChart(chart, up, "up");
}
