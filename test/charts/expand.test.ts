import { describe, expect, it } from "vitest";
import type { SongChart } from "@/model/contracts";
import { getChart } from "@/content";
import { barLoopRegion, chartCursor, expandChart, sectionLoopRegion } from "@/charts/expand";
import type { ChartExpansion } from "@/charts/expand";
import { validateChart } from "@/charts/validate";

function chart(id: string): SongChart {
  const found = getChart(id);
  if (!found) throw new Error(`missing chart ${id}`);
  return found;
}

function expansionOf(c: SongChart): ChartExpansion {
  const result = expandChart(c);
  if (!result.ok) throw new Error(result.reason);
  return result;
}

function clone(c: SongChart): SongChart {
  return JSON.parse(JSON.stringify(c)) as SongChart;
}

describe("expandChart: evening-loop (A A B A)", () => {
  const expansion = expansionOf(chart("evening-loop"));

  it("produces 16 bars in A A B A order over 64 beats", () => {
    expect(expansion.bars).toHaveLength(16);
    expect(expansion.totalBeats).toBe(64);
    expect(expansion.sections.map((s) => s.sectionId)).toEqual(["A", "A", "B", "A"]);
    expect(expansion.bars.map((b) => b.startBeat)).toEqual([0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60]);
  });

  it("gives every span pass a distinct occurrence id", () => {
    const ids = expansion.occurrences.map((o) => o.occurrenceId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(5 * 3 + 4);
    expect(ids[0]).toBe("A#0:el-a1:el-a1-s1");
    expect(ids).toContain("A#3:el-a4:el-a4-s2");
  });

  it("counts passIndex per source span: 0, 1, (B 0), 2", () => {
    const a1 = expansion.occurrences.filter((o) => o.spanId === "el-a1-s1");
    expect(a1.map((o) => o.passIndex)).toEqual([0, 1, 2]);
    expect(a1.map((o) => o.orderIndex)).toEqual([0, 1, 3]);
    expect(a1.map((o) => o.startBeat)).toEqual([0, 16, 48]);
    const b1 = expansion.occurrences.filter((o) => o.spanId === "el-b1-s1");
    expect(b1.map((o) => o.passIndex)).toEqual([0]);
    const byOrder = expansion.sections.map((section) => {
      const first = expansion.occurrences.find((o) => o.orderIndex === section.orderIndex);
      return first ? first.passIndex : -1;
    });
    expect(byOrder).toEqual([0, 1, 0, 2]);
  });

  it("splits a multi-chord bar into spans at absolute beats", () => {
    const bar4 = expansion.bars[3];
    expect(bar4.occurrenceIds).toHaveLength(2);
    const spans = expansion.occurrences.filter((o) => o.barIndex === 3);
    expect(spans.map((o) => [o.symbol, o.startBeat, o.durationBeats])).toEqual([
      ["F", 12, 2],
      ["G", 14, 2]
    ]);
  });

  it("places the cursor on bars, beats and occurrences", () => {
    const start = chartCursor(expansion, 0);
    expect(start).toMatchObject({ state: "playing", barIndex: 0, beatInBar: 0, sectionId: "A", isPickup: false });
    expect(start.occurrence?.symbol).toBe("C");
    const mid = chartCursor(expansion, 14.5);
    expect(mid.barIndex).toBe(3);
    expect(mid.beatInBar).toBe(2.5);
    expect(mid.occurrence?.symbol).toBe("G");
    const bSection = chartCursor(expansion, 33);
    expect(bSection.sectionId).toBe("B");
    expect(bSection.orderIndex).toBe(2);
    expect(bSection.occurrence?.symbol).toBe("F");
    expect(chartCursor(expansion, -2)).toMatchObject({ state: "countIn", barIndex: -1, occurrence: null });
    expect(chartCursor(expansion, 64).state).toBe("ended");
  });

  it("computes section loop regions for a chosen performance", () => {
    expect(sectionLoopRegion(expansion, "B")).toMatchObject({ startBeat: 32, endBeat: 48, orderIndex: 2 });
    expect(sectionLoopRegion(expansion, "A")).toMatchObject({ startBeat: 0, endBeat: 16 });
    expect(sectionLoopRegion(expansion, "A", 3)).toMatchObject({ startBeat: 48, endBeat: 64 });
    expect(sectionLoopRegion(expansion, "A", 2)).toBeNull();
    expect(sectionLoopRegion(expansion, "Z")).toBeNull();
    expect(barLoopRegion(expansion, 3, 2)).toEqual({ startBeat: 12, endBeat: 20 });
  });
});

describe("expandChart: dorian-drift pickup", () => {
  const expansion = expansionOf(chart("dorian-drift"));

  it("puts the 2-beat pickup at beat 0 and starts A at beat 2", () => {
    expect(expansion.bars[0]).toMatchObject({ sectionId: "pickup", startBeat: 0, beats: 2, isPickup: true });
    expect(expansion.bars[1]).toMatchObject({ sectionId: "A", startBeat: 2, beats: 4, isPickup: false });
    expect(expansion.occurrences[0]).toMatchObject({ isRest: true, symbol: "NC", startBeat: 0, durationBeats: 2 });
    expect(expansion.occurrences[1]).toMatchObject({ symbol: "Dm7", startBeat: 2 });
    expect(expansion.totalBeats).toBe(2 + 8 * 4 * 2);
  });

  it("reports the pickup in the cursor and the second A pass", () => {
    expect(chartCursor(expansion, 1).isPickup).toBe(true);
    expect(chartCursor(expansion, 1).occurrence?.isRest).toBe(true);
    expect(chartCursor(expansion, 2).isPickup).toBe(false);
    expect(chartCursor(expansion, 2).barIndex).toBe(1);
    expect(sectionLoopRegion(expansion, "A", 2)).toMatchObject({ startBeat: 34, endBeat: 66 });
    const secondPass = expansion.occurrences.filter((o) => o.spanId === "dd-a1-s1");
    expect(secondPass.map((o) => o.passIndex)).toEqual([0, 1]);
  });
});

describe("expandChart: section repeats and diagnostics", () => {
  it("expands section.repeat inside one order entry with distinct ids", () => {
    const c = clone(chart("evening-loop"));
    c.sections[1].repeat = 2;
    c.performanceOrder = ["B"];
    const expansion = expansionOf(c);
    expect(expansion.bars).toHaveLength(8);
    const ids = expansion.occurrences.map((o) => o.occurrenceId);
    expect(new Set(ids).size).toBe(8);
    expect(ids[0]).toBe("B#0.0:el-b1:el-b1-s1");
    expect(ids[4]).toBe("B#0.1:el-b1:el-b1-s1");
    expect(expansion.occurrences[4].passIndex).toBe(1);
  });

  it("rejects an unknown section in the performance order and names it", () => {
    const c = clone(chart("evening-loop"));
    c.performanceOrder = ["A", "C"];
    const result = expandChart(c);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('"C"');
  });

  it("rejects an empty performance order", () => {
    const c = clone(chart("evening-loop"));
    c.performanceOrder = [];
    const result = expandChart(c);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("performance order is empty");
  });

  it("rejects a bar whose spans do not fill it and names the bar", () => {
    const c = clone(chart("evening-loop"));
    c.sections[0].bars[3].spans[1].durationBeats = 1;
    const result = expandChart(c);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("el-a4");
      expect(result.reason).toContain("3 of 4");
    }
  });

  it("rejects repeat counts above the supported limit", () => {
    const c = clone(chart("evening-loop"));
    c.sections[0].repeat = 12;
    const result = expandChart(c);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("repeat 12 is not supported");
  });

  it("rejects a bar longer than the meter", () => {
    const c = clone(chart("evening-loop"));
    c.sections[0].bars[0].beats = 8;
    c.sections[0].bars[0].spans[0].durationBeats = 8;
    const result = expandChart(c);
    expect(result.ok).toBe(false);
  });

  it("validateChart reports unsupported symbols without blocking expansion", () => {
    const c = clone(chart("evening-loop"));
    c.sections[0].bars[0].spans[0].symbol = "Hmaj7";
    const issues = validateChart(c);
    expect(issues.some((issue) => issue.code === "symbol" && issue.severity === "error" && issue.barId === "el-a1")).toBe(true);
    expect(expandChart(c).ok).toBe(true);
    expect(validateChart(chart("dorian-drift")).filter((issue) => issue.severity === "error")).toEqual([]);
  });
});
