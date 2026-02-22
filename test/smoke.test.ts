import { describe, expect, it } from "vitest";
import { parseChordSequence } from "@/parser/parseChordSequence";
import { resolveSequence } from "@/theory/renderSequence";
import { buildMidiFile } from "@/midi/buildMidiFile";
import type { SynthSettings } from "@/types";

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
  voiceLeading: true,
  maxSpread: 30,
  minNote: 24,
  maxNote: 96
};

describe("smoke", () => {
  it("parses, resolves, and generates MIDI bytes", () => {
    const parsed = parseChordSequence("Cmaj9\nDm11\nG7b9\nCmaj9", settings.defaultChordMeasures);
    expect(parsed.errors).toHaveLength(0);

    const resolved = resolveSequence(parsed, settings);
    expect(resolved.events.length).toBe(4);

    const midi = buildMidiFile(resolved, settings);
    expect(midi.bytes[0]).toBe(0x4d);
    expect(midi.bytes[1]).toBe(0x54);
    expect(midi.bytes[2]).toBe(0x68);
    expect(midi.bytes[3]).toBe(0x64);
  });
});
