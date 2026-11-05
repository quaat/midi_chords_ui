import { describe, expect, it } from "vitest";
import {
  clampRangeToWhiteKeys,
  countWhiteKeys,
  createKeyLayout,
  defaultRangeForWidth,
  isBlackKey,
  KeyLayout,
  PIANO_HIGH,
  PIANO_LOW,
  rangeAroundNotes,
  resizeRange,
  shiftRangeByOctaves
} from "@/ui/piano/geometry";

describe("isBlackKey", () => {
  it("classifies pitch classes", () => {
    expect([60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71].map(isBlackKey)).toEqual([
      false, true, false, true, false, false, true, false, true, false, true, false
    ]);
    expect(isBlackKey(-11)).toBe(true); // C#-2 equivalent pitch class
  });
});

describe("KeyLayout", () => {
  const layout = createKeyLayout({ low: 48, high: 72 }, 1500, 150);

  it("divides the width evenly between white keys", () => {
    expect(layout.whiteCount).toBe(15);
    expect(layout.whiteWidth).toBeCloseTo(100, 9);
    layout.whiteKeys.forEach((key, i) => {
      expect(key.x).toBeCloseTo(i * 100, 9);
      expect(key.width).toBeCloseTo(100, 9);
      expect(key.height).toBe(150);
    });
    const last = layout.whiteKeys[layout.whiteKeys.length - 1];
    expect(last.x + last.width).toBeCloseTo(1500, 9);
  });

  it("sizes black keys at ~0.6 width and ~62% height", () => {
    expect(layout.blackKeys).toHaveLength(10);
    for (const key of layout.blackKeys) {
      expect(key.width).toBeCloseTo(60, 9);
      expect(key.height).toBeCloseTo(93, 9);
      expect(key.y).toBe(0);
    }
  });

  it("places each black key between its white neighbours with realistic offsets", () => {
    for (const key of layout.blackKeys) {
      const below = layout.keyRect(key.midi - 1)!;
      const above = layout.keyRect(key.midi + 1)!;
      expect(below.black).toBe(false);
      expect(above.black).toBe(false);
      const center = key.x + key.width / 2;
      expect(center).toBeGreaterThan(below.x);
      expect(center).toBeLessThan(above.x + above.width);
      // Straddles the boundary between the two white keys.
      expect(key.x).toBeLessThan(above.x);
      expect(key.x + key.width).toBeGreaterThan(above.x);
    }
    const boundary = (midi: number): number => layout.keyRect(midi + 1)!.x;
    const center = (midi: number): number => {
      const r = layout.keyRect(midi)!;
      return r.x + r.width / 2;
    };
    // C# leans left, D# leans right; F# left, G# centred, A# right.
    expect(center(61)).toBeLessThan(boundary(61));
    expect(center(63)).toBeGreaterThan(boundary(63));
    expect(center(66)).toBeLessThan(boundary(66));
    expect(center(68)).toBeCloseTo(boundary(68), 9);
    expect(center(70)).toBeGreaterThan(boundary(70));
  });

  it("midiAtPoint prefers black keys where they overlap", () => {
    const cs = layout.keyRect(61)!;
    const c = layout.keyRect(60)!;
    const midX = cs.x + cs.width / 2;
    expect(layout.midiAtPoint(midX, 10)).toBe(61);
    // Same x below the black key is the white key underneath.
    const whiteUnder = midX < layout.keyRect(62)!.x ? 60 : 62;
    expect(layout.midiAtPoint(midX, layout.blackHeight + 5)).toBe(whiteUnder);
    // Left part of C above the black-key height but left of C# is still C.
    expect(layout.midiAtPoint(c.x + 5, 10)).toBe(60);
    expect(layout.midiAtPoint(-1, 10)).toBeNull();
    expect(layout.midiAtPoint(10, 151)).toBeNull();
    expect(layout.midiAtPoint(1500, 149)).toBe(72);
  });

  it("every key point maps back to the key", () => {
    for (const key of layout.keys) {
      const x = key.x + key.width / 2;
      const y = key.black ? key.height / 2 : layout.height - 5;
      expect(layout.midiAtPoint(x, y)).toBe(key.midi);
    }
  });

  it("laneX matches keyRect horizontally for white and black keys", () => {
    for (const key of layout.keys) {
      const lane = layout.laneX(key.midi)!;
      expect(lane.x).toBeCloseTo(key.x, 9);
      expect(lane.width).toBeCloseTo(key.width, 9);
      expect(lane.centerX).toBeCloseTo(key.x + key.width / 2, 9);
      expect(lane.black).toBe(key.black);
    }
    expect(layout.laneX(47)).toBeNull();
    expect(layout.laneX(73)).toBeNull();
  });

  it("is DPR independent: scaling width scales every rect proportionally", () => {
    const doubled = new KeyLayout({ low: 48, high: 72 }, 3000, 300);
    layout.keys.forEach((key) => {
      const other = doubled.keyRect(key.midi)!;
      expect(other.x).toBeCloseTo(key.x * 2, 9);
      expect(other.width).toBeCloseTo(key.width * 2, 9);
    });
  });

  it("lists octave labels for C keys", () => {
    expect(layout.octaveLabels().map((l) => l.label)).toEqual(["C3", "C4", "C5"]);
  });

  it("extends black-key edges of the requested range to white keys", () => {
    const l = createKeyLayout({ low: 49, high: 70 }, 700);
    expect(l.low).toBe(48);
    expect(l.high).toBe(71);
  });
});

describe("range helpers", () => {
  it("clampRangeToWhiteKeys widens black edges and orders bounds", () => {
    expect(clampRangeToWhiteKeys(61, 70)).toEqual({ low: 60, high: 71 });
    expect(clampRangeToWhiteKeys(72, 60)).toEqual({ low: 60, high: 72 });
    expect(clampRangeToWhiteKeys(-5, 200)).toEqual({ low: 0, high: 127 });
  });

  it("defaultRangeForWidth shrinks on narrow widths but keeps an octave", () => {
    const wide = defaultRangeForWidth(2000);
    const medium = defaultRangeForWidth(800);
    const narrow = defaultRangeForWidth(320);
    const tiny = defaultRangeForWidth(50);
    expect(wide).toEqual({ low: PIANO_LOW, high: PIANO_HIGH });
    expect(countWhiteKeys(medium.low, medium.high)).toBe(36);
    expect(countWhiteKeys(narrow.low, narrow.high)).toBe(14);
    expect(countWhiteKeys(tiny.low, tiny.high)).toBe(8);
    for (const r of [medium, narrow, tiny]) {
      expect(isBlackKey(r.low)).toBe(false);
      expect(isBlackKey(r.high)).toBe(false);
      expect(r.low).toBeLessThanOrEqual(60);
      expect(r.high).toBeGreaterThanOrEqual(60);
    }
    expect(defaultRangeForWidth(800, 40)).toEqual(defaultRangeForWidth(400, 20));
  });

  it("rangeAroundNotes covers notes with a minimum number of white keys", () => {
    const r = rangeAroundNotes([61, 64, 68], 8);
    expect(r.low).toBeLessThanOrEqual(60);
    expect(r.high).toBeGreaterThanOrEqual(69);
    expect(countWhiteKeys(r.low, r.high)).toBe(8);
    expect(isBlackKey(r.low)).toBe(false);
    expect(isBlackKey(r.high)).toBe(false);
    const wideSpread = rangeAroundNotes([36, 84], 8);
    expect(wideSpread).toEqual({ low: 36, high: 84 });
    const bottom = rangeAroundNotes([21, 23], 10);
    expect(bottom.low).toBe(21);
    expect(countWhiteKeys(bottom.low, bottom.high)).toBe(10);
    expect(countWhiteKeys(rangeAroundNotes([], 15).low, rangeAroundNotes([], 15).high)).toBe(15);
  });

  it("shifts by octaves within the piano and resizes", () => {
    expect(shiftRangeByOctaves({ low: 48, high: 72 }, 1)).toEqual({ low: 60, high: 84 });
    expect(shiftRangeByOctaves({ low: 24, high: 48 }, -1)).toEqual({ low: 24, high: 48 });
    expect(shiftRangeByOctaves({ low: 21, high: PIANO_HIGH }, 1)).toEqual({ low: 21, high: PIANO_HIGH });
    const wider = resizeRange({ low: 48, high: 72 }, 1);
    expect(wider).toEqual({ low: 47, high: 74 });
    const narrower = resizeRange({ low: 48, high: 72 }, -1);
    expect(narrower).toEqual({ low: 50, high: 71 });
    expect(resizeRange({ low: 60, high: 72 }, -1)).toEqual({ low: 60, high: 72 });
  });
});
