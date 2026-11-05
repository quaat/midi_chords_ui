import { describe, expect, it } from "vitest";
import type { SongChart } from "@/model/contracts";
import { getChart } from "@/content";
import {
  addBar,
  addSection,
  chartFromChordText,
  chartFromJson,
  chartToChordText,
  chartToJson,
  mergeSpans,
  removeBar,
  removeSection,
  renameSection,
  setKey,
  setMeter,
  setPerformanceOrder,
  setSpanSymbol,
  setSpans,
  setTempo,
  splitSpan,
  validateChart
} from "@/charts/editor";
import type { ChartEditResult } from "@/charts/editor";
import { expandChart } from "@/charts/expand";
import { parseChartJson } from "@/persistence/charts";

function chart(id: string): SongChart {
  const found = getChart(id);
  if (!found) throw new Error(`missing chart ${id}`);
  return found;
}

function edited(result: ChartEditResult): SongChart {
  if (!result.ok) throw new Error(result.reason);
  return result.chart;
}

const el = chart("evening-loop");

describe("chart editing operations", () => {
  it("bump the version and never mutate the input", () => {
    const before = JSON.stringify(el);
    const renamed = edited(renameSection(el, "B", "Bridge"));
    expect(renamed.version).toBe(el.version + 1);
    expect(renamed.sections[1].label).toBe("Bridge");
    expect(JSON.stringify(el)).toBe(before);
  });

  it("add and remove sections, keeping the order valid", () => {
    const added = edited(addSection(el, "Outro", { barCount: 2 }));
    expect(added.sections).toHaveLength(3);
    expect(added.performanceOrder).toEqual(["A", "A", "B", "A", "Outro"]);
    expect(added.sections[2].bars).toHaveLength(2);
    expect(expandChart(added).ok).toBe(true);
    const removed = edited(removeSection(added, "B"));
    expect(removed.performanceOrder).toEqual(["A", "A", "A", "Outro"]);
    expect(removed.version).toBe(added.version + 1);
    expect(removeSection(edited(setPerformanceOrder(el, ["B"])), "B").ok).toBe(false);
    expect(addSection(el, "x", { id: "A" }).ok).toBe(false);
  });

  it("set the performance order only to existing sections", () => {
    expect(edited(setPerformanceOrder(el, ["B", "A"])).performanceOrder).toEqual(["B", "A"]);
    const bad = setPerformanceOrder(el, ["A", "Q"]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toContain('"Q"');
    expect(setPerformanceOrder(el, []).ok).toBe(false);
  });

  it("add and remove bars", () => {
    const more = edited(addBar(el, "A", "el-a1"));
    expect(more.sections[0].bars).toHaveLength(5);
    expect(more.sections[0].bars[1].spans[0].isRest).toBe(true);
    const fewer = edited(removeBar(more, more.sections[0].bars[1].id));
    expect(fewer.sections[0].bars.map((b) => b.id)).toEqual(el.sections[0].bars.map((b) => b.id));
    expect(addBar(el, "A", "nope").ok).toBe(false);
  });

  it("setSpans validates that spans fill the bar and symbols parse", () => {
    const ok = edited(
      setSpans(el, "el-a1", [
        { id: "x1", symbol: "C", startBeat: 0, durationBeats: 3 },
        { id: "x2", symbol: "C7", startBeat: 3, durationBeats: 1 }
      ])
    );
    expect(ok.sections[0].bars[0].spans.map((s) => s.symbol)).toEqual(["C", "C7"]);
    const gap = setSpans(el, "el-a1", [{ id: "x1", symbol: "C", startBeat: 0, durationBeats: 3 }]);
    expect(gap.ok).toBe(false);
    if (!gap.ok) expect(gap.reason).toContain("3 of 4");
    expect(setSpans(el, "el-a1", [{ id: "x1", symbol: "Q#", startBeat: 0, durationBeats: 4 }]).ok).toBe(false);
    expect(setSpans(el, "el-a1", [{ id: "el-a2-s1", symbol: "C", startBeat: 0, durationBeats: 4 }]).ok).toBe(false);
  });

  it("split and merge spans", () => {
    const split = edited(splitSpan(el, "el-a1", "el-a1-s1"));
    const spans = split.sections[0].bars[0].spans;
    expect(spans.map((s) => [s.symbol, s.startBeat, s.durationBeats])).toEqual([
      ["C", 0, 2],
      ["C", 2, 2]
    ]);
    expect(new Set(spans.map((s) => s.id)).size).toBe(2);
    const merged = edited(mergeSpans(split, "el-a1", "el-a1-s1"));
    expect(merged.sections[0].bars[0].spans).toHaveLength(1);
    expect(merged.sections[0].bars[0].spans[0].durationBeats).toBe(4);
    expect(merged.version).toBe(el.version + 2);
    expect(mergeSpans(el, "el-a1", "el-a1-s1").ok).toBe(false);
  });

  it("setSpanSymbol validates chords, accepts NC rests and clears the numeral", () => {
    const changed = edited(setSpanSymbol(el, "el-a3", "el-a3-s1", "Am7"));
    expect(changed.sections[0].bars[2].spans[0].symbol).toBe("Am7");
    expect(changed.sections[0].bars[2].spans[0].romanNumeral).toBeUndefined();
    const rest = edited(setSpanSymbol(el, "el-a3", "el-a3-s1", "N.C."));
    expect(rest.sections[0].bars[2].spans[0]).toMatchObject({ symbol: "NC", isRest: true });
    const bad = setSpanSymbol(el, "el-a3", "el-a3-s1", "Xyz");
    expect(bad.ok).toBe(false);
  });

  it("setMeter stretches single-span bars and refuses split bars that no longer fit", () => {
    const blocked = setMeter(el, { numerator: 3, denominator: 4 });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toContain("el-a4");
    const three = edited(setMeter(edited(setSpans(el, "el-a4", [{ id: "el-a4-s1", symbol: "F", startBeat: 0, durationBeats: 4 }])), { numerator: 3, denominator: 4 }));
    expect(three.sections[0].bars[0].spans[0].durationBeats).toBe(3);
    const expansion = expandChart(three);
    expect(expansion.ok).toBe(true);
    if (expansion.ok) expect(expansion.totalBeats).toBe(48);
    expect(setMeter(el, { numerator: 4, denominator: 3 }).ok).toBe(false);
  });

  it("setTempo and setKey", () => {
    expect(edited(setTempo(el, 100)).tempo.bpm).toBe(100);
    expect(setTempo(el, 0).ok).toBe(false);
    const keyed = edited(setKey(el, { tonic: { letter: "A", accidental: 0 }, mode: "naturalMinor" }));
    expect(keyed.key?.mode).toBe("naturalMinor");
    expect(edited(setKey(el, undefined)).key).toBeUndefined();
  });

  it("validateChart is clean for the starter charts", () => {
    expect(validateChart(el)).toEqual([]);
  });
});

describe("chord text import/export", () => {
  const settings = { title: "Plain", timeSignature: { numerator: 4, denominator: 4 }, tempo: 90, defaultMeasures: 1 };

  it("round-trips a plain progression", () => {
    const text = "C | 1\nAm | 1\nF | 0.5\nG | 0.5\nC | 1";
    const imported = chartFromChordText(text, settings);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const bars = imported.chart.sections[0].bars;
    expect(bars).toHaveLength(4);
    expect(bars[2].spans.map((s) => [s.symbol, s.startBeat, s.durationBeats])).toEqual([
      ["F", 0, 2],
      ["G", 2, 2]
    ]);
    expect(imported.chart.provenance.origin).toBe("userImport");
    const exported = chartToChordText(imported.chart);
    expect(exported.text).toBe(text);
    expect(exported.lost.some((line) => line.includes("Sections"))).toBe(false);
  });

  it("turns multi-measure lines into bars and explains it", () => {
    const imported = chartFromChordText("C | 2\nNC | 1", settings);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.chart.sections[0].bars).toHaveLength(3);
    expect(imported.chart.sections[0].bars[2].spans[0].isRest).toBe(true);
    expect(imported.notes[0]).toContain("2 bars");
  });

  it("refuses chords that cross a bar line or leave the last bar incomplete", () => {
    const crossing = chartFromChordText("C | 0.75\nG | 0.5", settings);
    expect(crossing.ok).toBe(false);
    if (!crossing.ok) expect(crossing.reason).toContain("bar line");
    const longFraction = chartFromChordText("C | 1.5\nG | 0.5", settings);
    expect(longFraction.ok).toBe(false);
    const partial = chartFromChordText("C | 1\nG | 0.5", settings);
    expect(partial.ok).toBe(false);
    if (!partial.ok) expect(partial.reason).toContain("incomplete");
    const parseError = chartFromChordText("C | 1\nG | x", settings);
    expect(parseError.ok).toBe(false);
    if (!parseError.ok) expect(parseError.reason).toContain("Line 2");
  });

  it("lists what chord text loses for a structured chart", () => {
    const exported = chartToChordText(chart("dorian-drift"));
    expect(exported.text.split("\n")[0]).toBe("NC | 0.5");
    expect(exported.text.split("\n")).toHaveLength(1 + 9 * 2);
    expect(exported.lost.some((line) => line.includes("Sections"))).toBe(true);
    expect(exported.lost.some((line) => line.includes("Pickup"))).toBe(true);
    expect(exported.lost.some((line) => line.includes("Key"))).toBe(true);
    expect(exported.lost.some((line) => line.includes("Roman"))).toBe(true);
  });
});

describe("chart JSON", () => {
  it("round-trips through the versioned envelope shared with persistence", () => {
    const json = chartToJson(el);
    const parsed = JSON.parse(json) as { schemaVersion: number; kind: string };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.kind).toBe("songChart");
    const back = chartFromJson(json);
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.chart).toEqual(el);
    const viaPersistence = parseChartJson(json, { markAsUserImport: false });
    expect(viaPersistence.ok).toBe(true);
  });

  it("rejects a wrong kind, newer schema, bad shape, and unfilled bars", () => {
    const wrongKind = chartFromJson(JSON.stringify({ schemaVersion: 1, kind: "project", chart: el }));
    expect(wrongKind.ok).toBe(false);
    if (!wrongKind.ok) expect(wrongKind.reason).toContain("not a song chart");
    expect(chartFromJson(JSON.stringify({ schemaVersion: 9, kind: "songChart", chart: el })).ok).toBe(false);
    expect(chartFromJson("{not json").ok).toBe(false);
    expect(chartFromJson(JSON.stringify({ schemaVersion: 1, kind: "songChart", chart: { id: "x" } })).ok).toBe(false);
    const broken = JSON.parse(JSON.stringify(el)) as SongChart;
    broken.sections[0].bars[0].spans[0].durationBeats = 2;
    const unfilled = chartFromJson(chartToJson(broken));
    expect(unfilled.ok).toBe(false);
    if (!unfilled.ok) expect(unfilled.reason).toContain("el-a1");
  });
});
