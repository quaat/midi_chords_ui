import { describe, expect, it } from "vitest";
import { parseChordSymbol } from "@/theory/chordParser";

describe("parseChordSymbol", () => {
  it("supports altered dominant extensions", () => {
    const chord = parseChordSymbol("G7b9");
    expect(chord.rootName).toBe("G");
    expect(chord.intervals).toContain(10);
    expect(chord.intervals).toContain(13);
    expect(chord.intervals).not.toContain(14);
  });

  it("supports slash bass", () => {
    const chord = parseChordSymbol("Cmaj9/E");
    expect(chord.bassName).toBe("E");
    expect(chord.intervals).toContain(14);
  });

  it("supports minor extensions", () => {
    const chord = parseChordSymbol("Dm11");
    expect(chord.intervals).toEqual(expect.arrayContaining([0, 3, 7, 10, 14, 17]));
  });
});
