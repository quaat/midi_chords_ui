import { describe, expect, it } from "vitest";
import type { SongChart } from "@/model/contracts";
import { getChart } from "@/content";
import { transposeChart, transposeChartToKey } from "@/charts/transpose";

function chart(id: string): SongChart {
  const found = getChart(id);
  if (!found) throw new Error(`missing chart ${id}`);
  return found;
}

function symbols(c: SongChart): string[] {
  return c.sections.flatMap((section) => section.bars.flatMap((bar) => bar.spans.map((span) => span.symbol)));
}

describe("transposeChart", () => {
  it("re-spells evening-loop up a major second and moves the key", () => {
    const original = chart("evening-loop");
    const result = transposeChart(original, { number: 2, quality: "M" }, "up");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(symbols(result.chart)).toEqual(["D", "A/C#", "Bm", "G", "A", "G", "D/F#", "Em", "A"]);
    expect(result.chart.key).toEqual({ tonic: { letter: "D", accidental: 0 }, mode: "major" });
    expect(result.chart.version).toBe(original.version + 1);
    expect(result.chart.sections[0].bars[1].spans[0].romanNumeral).toBe("V6");
    // The source chart is untouched.
    expect(symbols(original)[0]).toBe("C");
  });

  it("keeps rests and spells flat keys with flats", () => {
    const dd = chart("dorian-drift");
    const result = transposeChart(dd, { number: 3, quality: "m" }, "up");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const all = symbols(result.chart);
    expect(all[0]).toBe("NC");
    expect(all[1]).toBe("Fm7");
    expect(all).toContain("Bb7");
    expect(result.chart.key?.tonic).toEqual({ letter: "F", accidental: 0 });
    expect(result.chart.sections[0].bars[0].spans[0].isRest).toBe(true);
  });

  it("transposes to a key by the shorter direction", () => {
    const result = transposeChartToKey(chart("evening-loop"), "Bb");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(symbols(result.chart).slice(0, 3)).toEqual(["Bb", "F/A", "Gm"]);
    const noKey: SongChart = { ...chart("evening-loop") };
    delete noKey.key;
    expect(transposeChartToKey(noKey, "D").ok).toBe(false);
    expect(transposeChartToKey(chart("evening-loop"), "H").ok).toBe(false);
  });
});
