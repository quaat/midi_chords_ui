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

  it("supports augmented plus-sign notation", () => {
    const augTriad = parseChordSymbol("C+");
    expect(augTriad.intervals).toEqual(expect.arrayContaining([0, 4, 8]));
    expect(augTriad.intervals).not.toContain(7);

    const domSharp5 = parseChordSymbol("C7+5");
    expect(domSharp5.intervals).toEqual(expect.arrayContaining([0, 4, 8, 10]));
    expect(domSharp5.intervals).not.toContain(7);

    const maj7Sharp5 = parseChordSymbol("Gmaj7+");
    expect(maj7Sharp5.intervals).toEqual(expect.arrayContaining([0, 4, 8, 11]));
    expect(maj7Sharp5.intervals).not.toContain(7);
  });

  it("supports dominant suspended chords", () => {
    const chord = parseChordSymbol("F7sus4");

    expect(chord.rootName).toBe("F");
    expect(chord.intervals).toEqual([0, 5, 7, 10]);
    expect(chord.intervals).not.toContain(4);
  });
});
