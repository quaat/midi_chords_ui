import { describe, expect, it } from "vitest";
import { parseChordSymbol } from "@/theory/chordParser";
import { buildVoicing } from "@/theory/voicing";

const baseSettings = {
  baseOctave: 4,
  bassOctave: 2,
  voicingMode: "close" as const,
  maxSpread: 36,
  minNote: 24,
  maxNote: 96,
  voiceLeading: false
};

function avgDistance(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) {
    return 0;
  }
  return a.reduce((sum, note) => sum + Math.min(...b.map((p) => Math.abs(note - p))), 0) / a.length;
}

describe("buildVoicing", () => {
  it("produces audibly different modes", () => {
    const chord = parseChordSymbol("Cmaj9");
    const close = buildVoicing(chord, { ...baseSettings, voicingMode: "close" }).notes;
    const open = buildVoicing(chord, { ...baseSettings, voicingMode: "open" }).notes;
    const spread = buildVoicing(chord, { ...baseSettings, voicingMode: "spread" }).notes;

    expect(close).not.toEqual(open);
    expect(open).not.toEqual(spread);
  });

  it("voice leading reduces jump compared with no voice leading", () => {
    const c = parseChordSymbol("Cmaj9");
    const ab = parseChordSymbol("Abmaj9");

    const cVoicing = buildVoicing(c, { ...baseSettings, voicingMode: "close", voiceLeading: false }).notes;
    const jumpRaw = buildVoicing(ab, { ...baseSettings, voicingMode: "close", voiceLeading: false }).notes;
    const jumpLed = buildVoicing(ab, { ...baseSettings, voicingMode: "close", voiceLeading: true }, cVoicing).notes;

    expect(avgDistance(jumpLed, cVoicing)).toBeLessThanOrEqual(avgDistance(jumpRaw, cVoicing));
  });
});
