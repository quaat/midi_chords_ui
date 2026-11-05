import { describe, expect, it } from "vitest";
import type { SongChart } from "@/model/contracts";
import { getArrangement, getChart, getArrangementsForChart } from "@/content";
import { addBar, chartCursor, chartFromChordText, compileArrangement, expandChart, setSpanSymbol, splitSpan, transposeChartToKey } from "@/charts";
import type { ChartExpansion, CompiledArrangement } from "@/charts";
import { localVoicer } from "@/charts/voicer";
import {
  UNDO_LIMIT,
  applyEdit,
  arrangementsForChart,
  blankChart,
  canRedo,
  canUndo,
  chordTextImportOptions,
  copyChart,
  createHistory,
  cursorLabel,
  expectedTasksSummary,
  gridRows,
  mergeChartLists,
  parseSectionChoice,
  pushChart,
  redo,
  sectionChoices,
  undo,
  withFreeId
} from "@/ui/songs/songsLogic";
import { consumeChartRequest, requestChart } from "@/ui/songs/songsRequests";

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

function compiled(chartId: string, arrangementId: string): CompiledArrangement {
  const arrangement = getArrangement(arrangementId);
  if (!arrangement) throw new Error(`missing arrangement ${arrangementId}`);
  const result = compileArrangement(chart(chartId), arrangement, { voicer: localVoicer });
  if (!result.ok) throw new Error(result.reason);
  return result;
}

describe("undo / redo over chart editor ops", () => {
  it("applies edits, undoes and redoes them", () => {
    const start = chart("evening-loop");
    let history = createHistory(start);
    const first = applyEdit(history, setSpanSymbol(history.present, "el-a1", "el-a1-s1", "Cmaj7"));
    expect(first.error).toBeNull();
    history = first.history;
    history = applyEdit(history, splitSpan(history.present, "el-a2", "el-a2-s1")).history;
    expect(history.present.version).toBe(start.version + 2);
    expect(canUndo(history)).toBe(true);
    history = undo(history);
    expect(history.present.sections[0].bars[1].spans.length).toBe(1);
    expect(history.present.sections[0].bars[0].spans[0].symbol).toBe("Cmaj7");
    expect(canRedo(history)).toBe(true);
    history = redo(history);
    expect(history.present.sections[0].bars[1].spans.length).toBe(2);
    history = undo(undo(history));
    expect(history.present).toBe(start);
    expect(canUndo(history)).toBe(false);
  });

  it("keeps the history on a failed edit and reports the diagnostic", () => {
    const history = createHistory(chart("evening-loop"));
    const result = applyEdit(history, setSpanSymbol(history.present, "el-a1", "el-a1-s1", "H#zz"));
    expect(result.error).toMatch(/not a supported chord symbol/);
    expect(result.history).toBe(history);
  });

  it("a new edit clears redo and the stack is capped", () => {
    let history = createHistory(chart("evening-loop"));
    for (let i = 0; i < UNDO_LIMIT + 10; i += 1) {
      history = applyEdit(history, addBar(history.present, "B")).history;
    }
    expect(history.past.length).toBe(UNDO_LIMIT);
    history = undo(history);
    history = pushChart(history, chart("dorian-drift"));
    expect(canRedo(history)).toBe(false);
  });
});

describe("expected tasks summary", () => {
  it("differs between simple, richer and chart-only for Evening Loop", () => {
    const simple = expectedTasksSummary(compiled("evening-loop", "evening-loop-simple").expectedTasks, getArrangement("evening-loop-simple")!);
    const richer = expectedTasksSummary(compiled("evening-loop", "evening-loop-richer").expectedTasks, getArrangement("evening-loop-richer")!);
    const free = expectedTasksSummary(compiled("evening-loop", "evening-loop-chart-only").expectedTasks, getArrangement("evening-loop-chart-only")!);
    // A A B A: 4 bars x 4 sections, bar 4 of A has two chords → 13 + 4 = 19 chords.
    expect(simple.chordCount).toBe(19);
    expect(simple.headline).toMatch(/^This arrangement asks for: 19 chords, the bass note of each in any octave, accompaniment plays sustained chords$/);
    expect(richer.headline).toMatch(/required roles root, 3 and 5/);
    expect(richer.headline).toMatch(/accompaniment plays bass and chord/);
    expect(free.headline).toMatch(/nothing scored/);
    expect(free.scoredCount).toBe(0);
    expect(simple.scoredCount).toBe(19);
    expect(new Set([simple.headline, richer.headline, free.headline]).size).toBe(3);
  });

  it("counts the Dorian Drift pickup as a rest", () => {
    const summary = expectedTasksSummary(compiled("dorian-drift", "dorian-drift-simple").expectedTasks, getArrangement("dorian-drift-simple")!);
    expect(summary.details.join(" ")).toMatch(/1 rest/);
  });
});

describe("chart list and copies", () => {
  it("merges content and user charts with badges", () => {
    const items = mergeChartLists(
      [chart("evening-loop"), chart("dorian-drift")],
      [
        { id: "my-song", title: "My song", version: 2, origin: "userImport" },
        { id: "broken", title: "broken", version: 0, origin: "unknown", problem: "corrupt" }
      ]
    );
    expect(items.map((i) => i.id)).toEqual(["evening-loop", "dorian-drift", "my-song", "broken"]);
    expect(items[0].badges).toContain("original");
    expect(items[0].canDelete).toBe(false);
    expect(items[2].badges).toEqual(["local import"]);
    expect(items[2].canDelete).toBe(true);
    expect(items[3].badges).toEqual(["cannot open"]);
  });

  it("copies keep the arrangements, get a free id and note provenance", () => {
    const copy = copyChart(chart("evening-loop"), ["evening-loop", "evening-loop-mine"]);
    expect(copy.id).toBe("evening-loop-mine-2");
    expect(copy.provenance.note).toMatch(/Local copy of “Evening Loop”/);
    const arrangements = arrangementsForChart(copy);
    expect(arrangements.map((a) => a.id)).toEqual(getArrangementsForChart("evening-loop").map((a) => a.id));
    expect(arrangements.every((a) => a.chartId === copy.id)).toBe(true);
    const result = compileArrangement(copy, arrangements[0], { voicer: localVoicer });
    expect(result.ok).toBe(true);
  });

  it("offers generic arrangements for a user chart and they compile", () => {
    const blank = blankChart("Night song", ["my-night-song"]);
    expect(blank.id).toBe("my-night-song-2");
    const text = chartFromChordText("Am | 1\nF | 1\nC | 1\nG | 1", chordTextImportOptions("Night song", []));
    expect(text.ok).toBe(true);
    if (!text.ok) return;
    expect(text.chart.id).toBe("my-night-song");
    expect(text.chart.provenance.origin).toBe("userImport");
    const arrangements = arrangementsForChart(text.chart);
    expect(arrangements.map((a) => a.policy.kind)).toEqual(["pitchClass", "roles", "free"]);
    arrangements.forEach((arrangement) => {
      expect(compileArrangement(text.chart, arrangement, { voicer: localVoicer }).ok).toBe(true);
    });
  });

  it("renames imported charts whose id is taken", () => {
    expect(withFreeId(chart("evening-loop"), ["evening-loop"]).id).toBe("evening-loop-2");
  });

  it("a transposed working copy keeps the content arrangements", () => {
    const moved = transposeChartToKey(chart("evening-loop"), "D");
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.chart.sections[0].bars[1].spans[0].symbol).toBe("A/C#");
    expect(arrangementsForChart(moved.chart).length).toBe(3);
  });
});

describe("grid rows and the cursor label", () => {
  it("shows repeated sections as separate passes", () => {
    const rows = gridRows(expansionOf(chart("evening-loop")));
    expect(rows.map((r) => `${r.label}${r.pass}`)).toEqual(["A1", "A2", "B1", "A3"]);
    expect(rows[1].bars[0].startBeat).toBe(16);
  });

  it("labels the pickup, passes, count-in and end", () => {
    const expansion = expansionOf(chart("dorian-drift"));
    expect(cursorLabel(chartCursor(expansion, -2), expansion)).toBe("Count-in · 2 beats to go");
    expect(cursorLabel(chartCursor(expansion, 1), expansion)).toBe("Pickup (bar 1) · beat 2 · Pickup · rest");
    // pickup (2 beats) + 8 bars of A = 34 beats → bar 10 is the first bar of A pass 2.
    expect(cursorLabel(chartCursor(expansion, 34), expansion)).toBe("Bar 10 · beat 1 · A pass 2 · Dm7");
    expect(cursorLabel(chartCursor(expansion, 1000), expansion)).toBe("End");
  });

  it("lists every section performance as a loop choice", () => {
    const choices = sectionChoices(expansionOf(chart("evening-loop")));
    expect(choices.map((c) => c.label)).toEqual(["A · bars 1–4", "A (pass 2) · bars 5–8", "B · bars 9–12", "A (pass 3) · bars 13–16"]);
    expect(parseSectionChoice(choices[2].value)).toEqual({ sectionId: "B", orderIndex: 2 });
    expect(parseSectionChoice("nonsense")).toBeNull();
  });
});

describe("songs requests", () => {
  it("hands one request to the Songs view", () => {
    requestChart("dorian-drift", { sectionId: "A" });
    const request = consumeChartRequest();
    expect(request?.chartId).toBe("dorian-drift");
    expect(request?.sectionId).toBe("A");
    expect(consumeChartRequest()).toBeNull();
  });
});
