import { describe, expect, it } from "vitest";
import { resolveCursorMeasureNumber } from "@/ui/components/SheetMusicView";

describe("resolveCursorMeasureNumber", () => {
  it("uses explicit one-based measure numbers without shifting", () => {
    expect(resolveCursorMeasureNumber({ MeasureNumber: 1 })).toBe(1);
    expect(resolveCursorMeasureNumber({ measureNumber: 2 })).toBe(2);
  });

  it("normalizes zero-based explicit measure numbers", () => {
    expect(resolveCursorMeasureNumber({ MeasureNumberInSystem: 0 })).toBe(1);
  });

  it("falls back to measureListIndex as zero-based", () => {
    expect(resolveCursorMeasureNumber({ measureListIndex: 0 })).toBe(1);
    expect(resolveCursorMeasureNumber({ measureListIndex: 4 })).toBe(5);
  });

  it("prefers explicit measure number fields over list index", () => {
    expect(resolveCursorMeasureNumber({ MeasureNumber: 3, measureListIndex: 0 })).toBe(3);
  });

  it("returns null when no measure data is available", () => {
    expect(resolveCursorMeasureNumber(undefined)).toBeNull();
    expect(resolveCursorMeasureNumber({})).toBeNull();
  });
});
