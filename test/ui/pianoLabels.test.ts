import { describe, expect, it } from "vitest";
import { buildLabels, midiToNoteName, prettyDegree, scaleDegreeLabels, spelledToName } from "@/ui/piano/pianoLabels";

describe("pianoLabels", () => {
  it("names notes with a sharp/flat preference", () => {
    expect(midiToNoteName(61)).toBe("C♯");
    expect(midiToNoteName(61, { preference: "flat" })).toBe("D♭");
    expect(midiToNoteName(70, { preference: "flat", withOctave: true, unicode: false })).toBe("Bb4");
    expect(midiToNoteName(60, { withOctave: true })).toBe("C4");
    expect(midiToNoteName(59, { withOctave: true })).toBe("B3");
  });

  it("honours spelled notes", () => {
    expect(spelledToName({ letter: "E", accidental: -1 })).toBe("E♭");
    expect(spelledToName({ letter: "B", accidental: -1, octave: 3 }, { withOctave: true })).toBe("B♭3");
    expect(spelledToName({ letter: "F", accidental: 2 })).toBe("F𝄪");
  });

  it("formats degrees", () => {
    expect(prettyDegree("b7")).toBe("♭7");
    expect(prettyDegree("#11")).toBe("♯11");
    expect(scaleDegreeLabels([62, 63, 74], 62).get(63)).toBe("♭2");
  });

  it("builds labels per mode without inventing missing data", () => {
    const notes = [
      { midi: 63, spelled: { letter: "E" as const, accidental: -1 as const, octave: 4 }, degree: "b3", finger: 2 },
      { midi: 67, degree: "5" }
    ];
    expect(Array.from(buildLabels("noteNames", notes).entries())).toEqual([[63, "E♭"], [67, "G"]]);
    expect(buildLabels("chordDegrees", notes).get(63)).toBe("♭3");
    expect(Array.from(buildLabels("fingers", notes).keys())).toEqual([63]);
    expect(buildLabels("scaleDegrees", notes).size).toBe(0);
    expect(buildLabels("scaleDegrees", notes, { tonicPc: 0 }).get(67)).toBe("5");
    expect(buildLabels("none", notes).size).toBe(0);
  });
});
