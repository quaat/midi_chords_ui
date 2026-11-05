import { describe, expect, it } from "vitest";
import type { PerformanceTimeline, PerformedNote, TransportSnapshot } from "@/model/contracts";
import { createKeyLayout } from "@/ui/piano/geometry";
import { formatBarBeat, toBarBeat } from "@/ui/stage/positionFormat";
import {
  beatsPerBar,
  gridLines,
  noteScreenRect,
  notesSoundingAt,
  occurrenceIndexAt,
  pixelsPerBeatFor,
  stageNotes,
  stepsFrom,
  visibleNotes
} from "@/ui/stage/stageMath";
import { toStaticSteps } from "@/ui/stage/staticSteps";

function note(id: string, midi: number, onsetBeat: number, durationBeats: number, part: PerformedNote["part"] = "learner", occurrenceId = "o1"): PerformedNote {
  return { id, eventId: "e", occurrenceId, part, midi, onsetBeat, durationBeats, velocity: 80 };
}

function timeline(notes: PerformedNote[]): PerformanceTimeline {
  return {
    id: "t",
    sourceId: "s",
    sourceVersion: 1,
    tempo: { bpm: 120 },
    timeSignature: { numerator: 4, denominator: 4 },
    notes,
    occurrences: [
      { occurrenceId: "o2", eventId: "e2", passIndex: 0, startBeat: 4, durationBeats: 4, symbol: "F" },
      { occurrenceId: "o1", eventId: "e1", passIndex: 0, startBeat: 0, durationBeats: 4, symbol: "C" },
      { occurrenceId: "o3", eventId: "e3", passIndex: 0, startBeat: 10, durationBeats: 2, symbol: "G" }
    ],
    totalBeats: 12
  };
}

function snap(positionBeats: number, loop: TransportSnapshot["loop"] = null): TransportSnapshot {
  return { state: "playing", positionBeats, positionSeconds: positionBeats / 2, tempoBpm: 120, totalBeats: 12, loop, generation: 1 };
}

const layout = createKeyLayout({ low: 48, high: 72 }, 1500, 150);

describe("noteScreenRect", () => {
  const stageHeight = 400;
  const ppb = pixelsPerBeatFor(stageHeight, 4);

  it("uses lookahead to derive pixels per beat", () => {
    expect(ppb).toBe(100);
    expect(pixelsPerBeatFor(400, 0)).toBe(0);
  });

  it("reaches the strike line exactly at the onset", () => {
    const n = note("a", 60, 2, 1);
    const atOnset = noteScreenRect(n, snap(2), layout, ppb, stageHeight)!;
    expect(atOnset.y + atOnset.height).toBeCloseTo(stageHeight, 9);
    const before = noteScreenRect(n, snap(1), layout, ppb, stageHeight)!;
    expect(before.y + before.height).toBeCloseTo(stageHeight - 100, 9);
    const custom = noteScreenRect(n, snap(2), layout, ppb, stageHeight, { strikeY: 380 })!;
    expect(custom.y + custom.height).toBeCloseTo(380, 9);
  });

  it("maps duration to height", () => {
    const r = noteScreenRect(note("a", 60, 0, 1.5), snap(0), layout, ppb, stageHeight)!;
    expect(r.height).toBeCloseTo(150, 9);
    expect(r.y).toBeCloseTo(250, 9);
  });

  it("aligns with the key lane, including black keys, and honours scale/inset", () => {
    const white = noteScreenRect(note("w", 60, 0, 1), snap(0), layout, ppb, stageHeight)!;
    const key = layout.keyRect(60)!;
    expect(white.x).toBeCloseTo(key.x, 9);
    expect(white.width).toBeCloseTo(key.width, 9);
    const black = noteScreenRect(note("b", 61, 0, 1), snap(0), layout, ppb, stageHeight, { scaleX: 0.5, insetPx: 2 })!;
    const bkey = layout.keyRect(61)!;
    expect(black.black).toBe(true);
    expect(black.x).toBeCloseTo(bkey.x * 0.5 + 2, 9);
    expect(black.width).toBeCloseTo(bkey.width * 0.5 - 4, 9);
  });

  it("clips notes outside the visible range", () => {
    expect(noteScreenRect(note("x", 30, 0, 1), snap(0), layout, ppb, stageHeight)).toBeNull();
  });

  it("is a pure function of the snapshot (pause/seek safe)", () => {
    const n = note("a", 64, 3, 2);
    const first = noteScreenRect(n, snap(1.25), layout, ppb, stageHeight);
    noteScreenRect(n, snap(7), layout, ppb, stageHeight);
    expect(noteScreenRect(n, snap(1.25), layout, ppb, stageHeight)).toEqual(first);
  });
});

describe("visibleNotes", () => {
  const tl = timeline([note("a", 60, 0, 1), note("b", 62, 1, 4), note("c", 64, 5, 1), note("d", 65, 9, 0.5), note("e", 67, 3, 1)]);

  it("returns notes overlapping the window sorted by onset", () => {
    expect(visibleNotes(tl, 2, 4).map((n) => n.id)).toEqual(["b", "e", "c"]);
  });

  it("keeps notes still sounding and drops finished ones", () => {
    expect(visibleNotes(tl, 4.5, 1).map((n) => n.id)).toEqual(["b", "c"]);
    expect(visibleNotes(tl, 4.5, 1, 1).map((n) => n.id)).toEqual(["b", "e", "c"]);
  });

  it("handles count-in positions and empty input", () => {
    expect(visibleNotes(tl, -2, 2.5).map((n) => n.id)).toEqual(["a"]);
    expect(visibleNotes(null, 0, 4)).toEqual([]);
    expect(visibleNotes(tl, 100, 4)).toEqual([]);
  });
});

describe("stageNotes with a loop", () => {
  const tl = timeline([note("a", 60, 0, 1), note("b", 62, 2, 1), note("c", 64, 4, 1)]);

  it("shows the next pass from the loop start when the window crosses the loop end", () => {
    const items = stageNotes(tl, snap(2.5, { startBeat: 0, endBeat: 4 }), 3);
    const summary = items.map((i) => `${i.note.id}@${i.onsetBeat}`);
    // "c" lies after the loop end and is not played; "a" returns at beat 4.
    expect(summary).toEqual(["b@2", "a@4"]);
  });

  it("matches visibleNotes without a loop", () => {
    expect(stageNotes(tl, snap(1), 4).map((i) => i.note.id)).toEqual(visibleNotes(tl, 1, 4).map((n) => n.id));
  });
});

describe("grid and steps", () => {
  it("computes bar and beat lines", () => {
    expect(beatsPerBar({ numerator: 6, denominator: 8 })).toBe(3);
    const lines = gridLines(3.5, 4, 0, 4, 100, 400);
    expect(lines.map((l) => l.beat)).toEqual([4, 5, 6, 7]);
    expect(lines[0]).toEqual({ beat: 4, y: 350, kind: "bar", bar: 2 });
    expect(lines[1].kind).toBe("beat");
  });

  it("finds the current occurrence (sorted), including gaps and count-in", () => {
    const tl = timeline([note("a", 60, 0, 4, "learner", "o1"), note("b", 65, 4, 4, "learner", "o2"), note("c", 43, 4, 1, "accompaniment", "o2")]);
    expect(occurrenceIndexAt(tl, -2)).toBe(0);
    expect(occurrenceIndexAt(tl, 5)).toBe(1);
    expect(occurrenceIndexAt(tl, 9)).toBe(2);
    expect(occurrenceIndexAt(tl, 12)).toBe(-1);
    const steps = stepsFrom(tl, 1, 5, new Set(["learner"]), 5);
    expect(steps.map((s) => s.occurrence.symbol)).toEqual(["F", "G"]);
    expect(steps[0].notes.map((n) => n.id)).toEqual(["b"]);
    expect(steps[0].sounding).toBe(true);
    expect(steps[1].sounding).toBe(false);
    expect(notesSoundingAt(tl, 4.5).map((n) => n.id).sort()).toEqual(["b", "c"]);
    const statics = toStaticSteps(steps, tl.timeSignature);
    expect(statics[0]).toMatchObject({ id: "o2", symbol: "F", positionLabel: "Bar 2 · Beat 1" });
    expect(statics[0].notes[0].name).toBe("F4");
  });

  it("formats bar/beat positions", () => {
    expect(formatBarBeat(0)).toBe("Bar 1 · Beat 1");
    expect(formatBarBeat(5.5)).toBe("Bar 2 · Beat 2");
    expect(formatBarBeat(-4)).toBe("Count-in 1");
    expect(formatBarBeat(-0.5)).toBe("Count-in 4");
    expect(toBarBeat(7, { numerator: 3, denominator: 4 })).toEqual({ bar: 3, beat: 2, countIn: false });
  });
});
