import { describe, expect, it } from "vitest";
import { parseChordSequence } from "@/parser/parseChordSequence";
import { injectChordPathways, pathwayEventsToText } from "@/theory/pathways";
import { resolveSequence } from "@/theory/renderSequence";
import type { ChordPathwayMode, SynthSettings } from "@/types";

const settings: SynthSettings = {
  tempoBpm: 110,
  timeSignature: { numerator: 4, denominator: 4 },
  defaultChordMeasures: 1,
  ticksPerBeat: 480,
  midiChannel: 1,
  velocity: 90,
  program: 1,
  baseOctave: 4,
  bassOctave: 2,
  voicingMode: "close",
  arpeggiateOctaves: 0,
  voiceLeading: true,
  maxSpread: 30,
  minNote: 24,
  maxNote: 96
};

function expandPathways(input: string, mode: ChordPathwayMode, turnaroundChord?: string) {
  const parsed = parseChordSequence(input, 1);
  expect(parsed.errors).toHaveLength(0);
  return injectChordPathways(parsed.events, {
    mode,
    turnaroundChord,
    turnaroundDurationMeasures: 1
  });
}

describe("injectChordPathways", () => {
  it("secondary dominant expands C -> Am -> F -> Dm correctly", () => {
    const result = expandPathways("C | 1\nAm | 1\nF | 1\nDm | 1", "secondaryDominant");
    expect(result.events.map((event) => event.chordSymbol)).toEqual(["C", "E7", "Am", "C7", "F", "A7", "Dm"]);
  });

  it("secondary dominant first inversion uses third in bass", () => {
    const result = expandPathways("C | 1\nAm | 1\nF | 1\nDm | 1", "secondaryDominantFirstInversion");
    expect(result.events.map((event) => event.chordSymbol)).toEqual(["C", "E7/G#", "Am", "C7/E", "F", "A7/C#", "Dm"]);
  });

  it("secondary dominant second inversion uses fifth in bass", () => {
    const result = expandPathways("C | 1\nAm | 1\nF | 1\nDm | 1", "secondaryDominantSecondInversion");
    expect(result.events.map((event) => event.chordSymbol)).toEqual(["C", "E7/B", "Am", "C7/G", "F", "A7/E", "Dm"]);
  });

  it("tritone substitutions use dominant chords a tritone away", () => {
    const result = expandPathways("C | 1\nAm | 1\nF | 1\nDm | 1", "tritoneSubstitution");
    expect(result.events.map((event) => event.chordSymbol)).toEqual(["C", "Bb7", "Am", "Gb7", "F", "Eb7", "Dm"]);
  });

  it("secondary ii-V uses half diminished ii for minor targets", () => {
    const result = expandPathways("C | 1\nAm | 1", "secondaryTwoFive");
    expect(result.events.map((event) => event.chordSymbol)).toEqual(["C", "Bm7b5", "E7", "Am"]);
  });

  it("secondary ii-V uses minor seven ii for major targets", () => {
    const result = expandPathways("C | 1\nAm | 1\nF | 1\nDm | 1", "secondaryTwoFive");
    expect(result.events.map((event) => event.chordSymbol)).toEqual(["C", "Bm7b5", "E7", "Am", "Gm7", "C7", "F", "Em7", "A7", "Dm"]);
  });

  it("secondary ii-V with tritone substitution keeps ii and swaps dominant", () => {
    const result = expandPathways("C | 1\nAm | 1\nF | 1\nDm | 1", "secondaryTwoFiveTritoneSub");
    expect(result.events.map((event) => event.chordSymbol)).toEqual([
      "C",
      "Bm7b5",
      "Bb7",
      "Am",
      "Gm7",
      "Gb7",
      "F",
      "Em7",
      "Eb7",
      "Dm"
    ]);
  });

  it("turnaround is appended unchanged when provided", () => {
    const result = expandPathways("C | 1\nAm | 1", "secondaryDominant", "G13sus4");
    expect(result.events.at(-1)?.chordSymbol).toBe("G13sus4");
  });

  it("generated output remains parseable by existing parser", () => {
    const result = expandPathways("C | 1\nAm | 1\nF | 1\nDm | 1", "secondaryTwoFiveTritoneSub");
    const text = pathwayEventsToText(result);
    const reparsed = parseChordSequence(text, 1);
    expect(reparsed.errors).toHaveLength(0);
  });

  it("generated output resolves through existing render pipeline", () => {
    const result = expandPathways("C | 1\nAm | 1\nF | 1\nDm | 1", "secondaryTwoFive");
    const text = pathwayEventsToText(result);
    const reparsed = parseChordSequence(text, settings.defaultChordMeasures);
    expect(reparsed.errors).toHaveLength(0);
    const resolved = resolveSequence(reparsed, settings);
    expect(resolved.events.length).toBeGreaterThan(0);
  });

  it("duration splitting is correct for one inserted chord", () => {
    const result = expandPathways("C | 1\nAm | 1", "secondaryDominant");
    expect(result.events[0].durationMeasures).toBe(0.5);
    expect(result.events[1].durationMeasures).toBe(0.5);
    expect(result.events[2].durationMeasures).toBe(1);
  });

  it("duration splitting is correct for two inserted chords", () => {
    const result = expandPathways("C | 1\nAm | 1", "secondaryTwoFive");
    expect(result.events[0].durationMeasures).toBeCloseTo(0.333333, 6);
    expect(result.events[1].durationMeasures).toBeCloseTo(0.333333, 6);
    expect(result.events[2].durationMeasures).toBeCloseTo(0.333333, 6);
    expect(result.events[3].durationMeasures).toBe(1);
  });

  it("rests and unsupported targets are skipped without throwing", () => {
    const result = expandPathways("C | 1\nNC | 1\nAm | 1\nGsus4 | 1\nF | 1", "secondaryDominant");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.events.map((event) => event.chordSymbol)).toEqual(["C", "NC", "Am", "Gsus4", "C7", "F"]);
  });

  it("tritone substitutions prefer flat spellings in golden examples", () => {
    const result = expandPathways("C | 1\nAm | 1\nF | 1\nDm | 1", "tritoneSubstitution");
    expect(result.events.filter((event) => ["Bb7", "Gb7", "Eb7"].includes(event.chordSymbol)).map((event) => event.chordSymbol)).toEqual(
      ["Bb7", "Gb7", "Eb7"]
    );
  });
});
