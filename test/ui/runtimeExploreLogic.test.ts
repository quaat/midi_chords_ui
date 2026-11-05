import { describe, expect, it } from "vitest";
import { chordFromSymbol } from "@/music/chords";
import {
  chordDegreeRows,
  degreeLabelMap,
  diatonicTriadRows,
  inversionExplanation,
  inversionOptions,
  inversionView,
  parseChordInput,
  scaleComparisonView,
  slashBassText
} from "@/ui/explore/exploreLogic";

describe("exploreLogic", () => {
  it("validates chord input", () => {
    expect(parseChordInput(" Dm9 ").ok).toBe(true);
    const bad = parseChordInput("");
    expect(bad.ok).toBe(false);
  });

  it("degree label map for a chord (with non-chord tones in parentheses)", () => {
    const chord = chordFromSymbol("Cm7");
    const map = degreeLabelMap(chord, [60, 63, 67, 70, 62, 72]);
    expect(map.get(60)).toBe("1");
    expect(map.get(63)).toBe("♭3");
    expect(map.get(67)).toBe("5");
    expect(map.get(70)).toBe("♭7");
    expect(map.get(72)).toBe("1");
    expect(map.get(62)).toBe("(2)");
  });

  it("chord degree rows carry roles, essential flags and spelling", () => {
    const rows = chordDegreeRows(chordFromSymbol("Cm7"));
    expect(rows.map((r) => r.noteName)).toEqual(["C", "E♭", "G", "B♭"]);
    expect(rows.find((r) => r.role === "third")?.essential).toBe(true);
    expect(rows.map((r) => r.roleName)).toEqual(["root", "third", "fifth", "seventh"]);
  });

  it("inversion options and explanation strings", () => {
    const triad = chordFromSymbol("C");
    const options = inversionOptions(triad);
    expect(options.map((o) => o.available)).toEqual([true, true, true, false]);
    expect(options[3].reason).toMatch(/no third inversion/);
    const first = inversionExplanation(triad, 1);
    expect(first[0]).toBe("C in first inversion: the third (3) E4 is the lowest note.");
    expect(first[1]).toBe("The root (1) moved up an octave, so the third (3) is lowest. It is still C with root C.");
    expect(inversionExplanation(triad, 0)[1]).toBe("Nothing moved: the root C is the lowest note.");
    const view = inversionView(triad, 2);
    expect(view.ok).toBe(true);
    expect(view.targets.map((t) => t.midi)).toEqual([67, 72, 76]);
    expect(inversionView(triad, 3).ok).toBe(false);
  });

  it("explains slash basses", () => {
    expect(slashBassText(chordFromSymbol("C/E"))).toMatch(/third.*first inversion/);
    expect(slashBassText(chordFromSymbol("C"))).toBe("");
    expect(slashBassText(chordFromSymbol("C/D"))).toMatch(/not a chord tone/);
  });

  it("compares D dorian with D natural minor on the 6th", () => {
    const view = scaleComparisonView("D", "dorian", "naturalMinor");
    expect(view.ok).toBe(true);
    expect(view.differing).toEqual([6]);
    expect(view.rowsA.find((r) => r.differs)?.noteName).toBe("B");
    expect(view.rowsB.find((r) => r.differs)?.noteName).toBe("B♭");
    expect(view.targets.map((t) => t.degreeLabel)).toEqual(["B ♭6", "A 6"]);
  });

  it("diatonic triads, and a clear reason for scales without them", () => {
    const rows = diatonicTriadRows("C", "major");
    expect(rows.ok).toBe(true);
    expect(rows.rows.map((r) => r.numeral)).toEqual(["I", "ii", "iii", "IV", "V", "vi", "vii°"]);
    const pent = diatonicTriadRows("C", "majorPentatonic");
    expect(pent.ok).toBe(false);
    expect(pent.reason).toBeTruthy();
  });
});
