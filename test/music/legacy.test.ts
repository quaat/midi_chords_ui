import { describe, expect, it } from "vitest";
import { beatsPerBar, sequenceFromParsedText, sequenceToText } from "@/music/legacy";
import { transposeChord } from "@/music/chords";

const SETTINGS = { defaultChordMeasures: 1, tempoBpm: 100, timeSignature: { numerator: 4, denominator: 4 } };

describe("sequenceFromParsedText", () => {
  it("builds a MusicalSequence with stable ids and beat timing", () => {
    const text = "# ii-V-I\nDm9 | 1\nG13 | 0.5\nNC | 0.5\n\nCmaj9 | 2";
    const { sequence, errors } = sequenceFromParsedText(text, SETTINGS);
    expect(errors).toEqual([]);
    expect(sequence.events.map((e) => e.id)).toEqual(["ev-1", "ev-2", "ev-3", "ev-4"]);
    expect(sequence.events.map((e) => e.startBeat)).toEqual([0, 4, 6, 8]);
    expect(sequence.events.map((e) => e.durationBeats)).toEqual([4, 2, 2, 8]);
    expect(sequence.events[2].kind).toBe("rest");
    expect(sequence.events[2].symbol).toBe("NC");
    expect(sequence.events[2].chord).toBeUndefined();
    expect(sequence.events[0].chord?.degrees.map((d) => d.label)).toEqual(["1", "b3", "5", "b7", "9"]);
    expect(sequence.events[3].sourceLine).toBe(6);
    expect(sequence.totalBeats).toBe(16);
    expect(sequence.key).toBeUndefined();
    expect(sequence.tempo.bpm).toBe(100);
  });

  it("passes legacy parse errors through with line numbers", () => {
    const { sequence, errors } = sequenceFromParsedText("C\nHm7\nG | 0", SETTINGS);
    expect(sequence.events).toHaveLength(1);
    expect(errors.map((e) => e.line)).toEqual([2, 3]);
    expect(errors[0].message).toBe('Invalid chord symbol "Hm7".');
    expect(errors[1].message).toBe("Duration measures must be a positive number.");
  });

  it("uses quarter-note beats per bar", () => {
    expect(beatsPerBar({ numerator: 3, denominator: 4 })).toBe(3);
    expect(beatsPerBar({ numerator: 6, denominator: 8 })).toBe(3);
    const { sequence } = sequenceFromParsedText("C | 2", { ...SETTINGS, timeSignature: { numerator: 6, denominator: 8 } });
    expect(sequence.events[0].durationBeats).toBe(6);
  });
});

describe("sequenceToText", () => {
  it("round-trips representable sequences without losses", () => {
    const text = "Dm9 | 1\nG13 | 0.5\nNC | 0.5\nDb/F | 1.25";
    const { sequence } = sequenceFromParsedText(text, SETTINGS);
    const exported = sequenceToText(sequence);
    expect(exported.text).toBe(text);
    expect(exported.lost).toEqual([]);
    const again = sequenceFromParsedText(exported.text, SETTINGS).sequence;
    expect(again.events.map((e) => [e.symbol, e.startBeat, e.durationBeats])).toEqual(sequence.events.map((e) => [e.symbol, e.startBeat, e.durationBeats]));
  });

  it("discloses what chord text cannot represent", () => {
    const { sequence } = sequenceFromParsedText("C\nG7", SETTINGS);
    sequence.key = { tonic: { letter: "C", accidental: 0 }, mode: "major" };
    sequence.events[1].voicingRecipeId = "shell-37";
    sequence.events[1].context = { romanNumeral: "V7" };
    const exported = sequenceToText(sequence);
    expect(exported.text).toBe("C | 1\nG7 | 1");
    expect(exported.lost.some((l) => l.includes("Key context (C major)"))).toBe(true);
    expect(exported.lost.some((l) => l.includes("ev-2") && l.includes("shell-37"))).toBe(true);
    expect(exported.lost.some((l) => l.includes("harmonic context"))).toBe(true);
  });

  it("flags symbols the legacy parser cannot re-read and timing gaps", () => {
    const { sequence } = sequenceFromParsedText("D#7 | 1\nC | 1", SETTINGS);
    const first = sequence.events[0];
    if (first.chord) {
      const moved = transposeChord(first.chord, { number: 1, quality: "A" });
      first.chord = moved;
      first.symbol = moved.symbol;
    }
    sequence.events[1].startBeat = 6;
    const exported = sequenceToText(sequence);
    expect(exported.text).toBe("D##7 | 1\nC | 1");
    expect(exported.lost.some((l) => l.includes('cannot read "D##7"'))).toBe(true);
    expect(exported.lost.some((l) => l.includes("back-to-back"))).toBe(true);
  });
});
