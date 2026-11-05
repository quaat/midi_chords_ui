import { describe, expect, it } from "vitest";
import type { SongChart } from "@/model/contracts";
import { ChartStore, chartKey, validateChartShape } from "@/persistence/charts";
import { createMemoryAdapter } from "@/persistence/storage";
import { makeChart } from "./helpers";

describe("validateChartShape", () => {
  it("accepts a well-formed chart", () => {
    expect(validateChartShape(makeChart())).toEqual([]);
  });

  it("rejects performanceOrder entries that reference missing sections", () => {
    const issues = validateChartShape(makeChart({ performanceOrder: ["A", "C"] }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/unknown section "C"/);
    expect(validateChartShape(makeChart({ performanceOrder: [] })).length).toBeGreaterThan(0);
  });

  it("rejects spans that overflow or overlap the bar and duplicate ids", () => {
    const chart = makeChart();
    chart.sections[0].bars[1].spans[1] = { id: "s3", symbol: "C7", startBeat: 1, durationBeats: 4 };
    chart.sections[1].id = "A";
    const issues = validateChartShape(chart);
    expect(issues.some((issue) => /ends after the bar/.test(issue))).toBe(true);
    expect(issues.some((issue) => /overlaps/.test(issue))).toBe(true);
    expect(issues.some((issue) => /more than one section/.test(issue))).toBe(true);
  });

  it("respects a shorter pickup bar and 6/8 meter", () => {
    const chart = makeChart({ timeSignature: { numerator: 6, denominator: 8 } });
    chart.sections[0].bars[0] = { id: "b1", beats: 1, spans: [{ id: "s1", symbol: "C7", startBeat: 0, durationBeats: 1 }] };
    chart.sections[0].bars[1].spans = [{ id: "s2", symbol: "F7", startBeat: 0, durationBeats: 3 }];
    chart.sections[1].bars[0].spans = [{ id: "s4", symbol: "G7", startBeat: 0, durationBeats: 4 }];
    const issues = validateChartShape(chart);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/sections\[1\]\.bars\[0\]\.spans\[0\] ends after the bar/);
  });
});

describe("ChartStore", () => {
  it("save/list/get/remove round trip", () => {
    const adapter = createMemoryAdapter();
    const store = new ChartStore(adapter);
    expect(store.save(makeChart()).ok).toBe(true);
    expect(store.save(makeChart({ id: "chart-2", title: "Another" })).ok).toBe(true);
    const listed = store.list();
    expect(listed.ok && listed.value.map((entry) => entry.id)).toEqual(["chart-2", "chart-1"]);
    const got = store.get("chart-1");
    expect(got.ok && got.value).toEqual(makeChart());
    expect(store.remove("chart-1").ok).toBe(true);
    expect(adapter.get(chartKey("chart-1"))).toBeNull();
  });

  it("refuses to save an invalid chart", () => {
    const store = new ChartStore(createMemoryAdapter());
    const result = store.save(makeChart({ performanceOrder: ["Z"] }));
    expect(!result.ok && result.error.code).toBe("invalid");
  });

  it("export/import round trip marks imports as personal", () => {
    const store = new ChartStore(createMemoryAdapter());
    const json = store.exportChartJson(makeChart());
    const imported = store.importChartJson(json);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.value.provenance.origin).toBe("userImport");
    expect(imported.value.provenance.note).toMatch(/declared origin "original"/);
    const unchanged = store.importChartJson(json, { markAsUserImport: false });
    expect(unchanged.ok && unchanged.value).toEqual(makeChart());
  });

  it("accepts a bare chart object as a legacy file", () => {
    const store = new ChartStore(createMemoryAdapter());
    const imported = store.importChartJson(JSON.stringify(makeChart()));
    expect(imported.ok && imported.value.id).toBe("chart-1");
  });

  it("rejects corrupt, newer, and invalid chart files", () => {
    const store = new ChartStore(createMemoryAdapter());
    const corrupt = store.importChartJson("[");
    expect(!corrupt.ok && corrupt.error.code).toBe("corrupt");
    const future = store.importChartJson(JSON.stringify({ schemaVersion: 3, kind: "songChart", chart: makeChart() }));
    expect(!future.ok && future.error.code).toBe("unsupportedVersion");
    const badOrder: SongChart = makeChart({ performanceOrder: ["A", "missing"] });
    const invalid = store.importChartJson(store.exportChartJson(badOrder));
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.error.code).toBe("invalid");
      expect(invalid.error.details.join(" ")).toMatch(/missing/);
    }
  });
});
