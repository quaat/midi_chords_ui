import { describe, expect, it } from "vitest";
import { buildMidiFile } from "@/midi/buildMidiFile";
import { buildArpeggiatedNotes } from "@/playback/arpeggiation";
import type { RenderSequenceResult, SynthSettings } from "@/types";

const baseSettings: SynthSettings = {
  tempoBpm: 120,
  timeSignature: { numerator: 4, denominator: 4 },
  defaultChordMeasures: 1,
  ticksPerBeat: 480,
  midiChannel: 1,
  velocity: 96,
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

function readVarLen(bytes: Uint8Array, start: number): { value: number; next: number } {
  let value = 0;
  let index = start;
  let byte = 0;
  do {
    byte = bytes[index];
    value = (value << 7) | (byte & 0x7f);
    index += 1;
  } while (byte & 0x80);
  return { value, next: index };
}

function noteOnTicks(bytes: Uint8Array): number[] {
  let index = 14;
  if (bytes[index] !== 0x4d || bytes[index + 1] !== 0x54 || bytes[index + 2] !== 0x72 || bytes[index + 3] !== 0x6b) {
    throw new Error("Invalid MIDI track header.");
  }

  const trackLength = (bytes[index + 4] << 24) | (bytes[index + 5] << 16) | (bytes[index + 6] << 8) | bytes[index + 7];
  index += 8;

  const end = index + trackLength;
  let tick = 0;
  const ticks: number[] = [];

  while (index < end) {
    const delta = readVarLen(bytes, index);
    tick += delta.value;
    index = delta.next;

    const status = bytes[index];
    index += 1;

    if (status === 0xff) {
      index += 1; // meta type
      const metaLength = readVarLen(bytes, index);
      index = metaLength.next + metaLength.value;
      continue;
    }

    const command = status & 0xf0;
    if (command === 0xc0 || command === 0xd0) {
      index += 1;
      continue;
    }

    const note = bytes[index];
    const velocity = bytes[index + 1];
    index += 2;
    if (command === 0x90 && velocity > 0 && note >= 0) {
      ticks.push(tick);
    }
  }

  return ticks;
}

describe("arpeggiation", () => {
  it("creates staggered notes across selected octaves", () => {
    const notes = buildArpeggiatedNotes([60, 64, 67], 1.2, 2);

    expect(notes.map((n) => n.note)).toEqual([60, 64, 67, 72, 76, 79]);
    expect(notes[0]?.startOffset).toBe(0);
    expect(notes[5]?.startOffset).toBeCloseTo(1, 2);
  });

  it("exports staggered note-on ticks when arpeggiation is enabled", () => {
    const sequence: RenderSequenceResult = {
      totalTicks: 480,
      totalSeconds: 1,
      events: [
        {
          index: 0,
          line: 1,
          chordSymbol: "C",
          isRest: false,
          noteNumbers: [60, 64, 67],
          noteNames: ["C4", "E4", "G4"],
          startTick: 0,
          durationTicks: 480,
          startSeconds: 0,
          durationSeconds: 1,
          durationMeasures: 1
        }
      ]
    };

    const blockMidi = buildMidiFile(sequence, { ...baseSettings, arpeggiateOctaves: 0 });
    const arpeggioMidi = buildMidiFile(sequence, { ...baseSettings, arpeggiateOctaves: 1 });

    expect(noteOnTicks(blockMidi.bytes).slice(0, 3)).toEqual([0, 0, 0]);
    expect(noteOnTicks(arpeggioMidi.bytes).slice(0, 3)).toEqual([0, 160, 320]);
  });
});
