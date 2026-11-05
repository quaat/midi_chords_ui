import { describe, expect, it } from "vitest";
import type { MusicalSequence, SequenceEvent } from "@/model/contracts";
import { chordFromSymbol } from "@/music/chords";
import { voiceSequence, voicingSummary, voicingToMidi } from "@/voicing/applyToSequence";

function chordEvent(id: string, index: number, symbol: string): SequenceEvent {
  return { id, index, kind: "chord", symbol, chord: chordFromSymbol(symbol), startBeat: index * 4, durationBeats: 4 };
}

function sequence(): MusicalSequence {
  const events: SequenceEvent[] = [
    chordEvent("e1", 0, "Dm9"),
    chordEvent("e2", 1, "G13"),
    { id: "e3", index: 2, kind: "rest", symbol: "NC", startBeat: 8, durationBeats: 4 },
    chordEvent("e4", 3, "C"),
    chordEvent("e5", 4, "Cmaj9")
  ];
  return { id: "seq", version: 7, tempo: { bpm: 90 }, timeSignature: { numerator: 4, denominator: 4 }, events, totalBeats: 20 };
}

describe("voiceSequence", () => {
  it("fills voicings, leaves rests alone, keeps the version and does not mutate the input", () => {
    const input = sequence();
    const before = JSON.stringify(input);
    const { sequence: output, issues } = voiceSequence(input, { defaultRecipeId: "rootless-a" });
    expect(JSON.stringify(input)).toBe(before);
    expect(output.version).toBe(7);
    expect(output.events[2].voicing).toBeUndefined();
    const first = output.events[0].voicing;
    expect(first ? voicingToMidi(first) : []).toEqual([53, 57, 60, 64]);
    const last = output.events[4].voicing;
    expect(last ? voicingToMidi(last) : []).toEqual([52, 55, 59, 62]);
    expect(issues.map((issue) => issue.eventId)).toEqual(["e4"]);
  });

  it("falls back to close-rp for a triad under shell-137 and reports the issue", () => {
    const { sequence: output, issues } = voiceSequence(sequence(), { defaultRecipeId: "shell-137" });
    const triad = output.events[3].voicing;
    expect(triad ? triad.recipeId : "").toBe("close-rp");
    expect(issues).toHaveLength(1);
    expect(issues[0].eventId).toBe("e4");
    expect(issues[0].reason).toMatch(/shell-137 requires a seventh.*Voiced with close-rp instead/);
    const shell = output.events[0].voicing;
    expect(shell ? shell.recipeId : "").toBe("shell-137");
  });

  it("applies per-event overrides", () => {
    const { sequence: output, issues } = voiceSequence(sequence(), { defaultRecipeId: "rootless-a", perEvent: { e4: "close-triads-rh" } });
    const triad = output.events[3].voicing;
    expect(triad ? triad.recipeId : "").toBe("close-triads-rh");
    expect(issues).toEqual([]);
  });

  it("reports constraint failures without inventing a voicing", () => {
    const { sequence: output, issues } = voiceSequence(sequence(), { defaultRecipeId: "rootless-a", constraints: { minMidi: 60, maxMidi: 62 } });
    expect(output.events[0].voicing).toBeUndefined();
    expect(issues.some((issue) => issue.eventId === "e1" && /pitch classes are never changed/.test(issue.reason))).toBe(true);
  });
});

describe("voicing helpers", () => {
  it("summarises a voicing for the UI and exports MIDI with optional bass", () => {
    const { sequence: output } = voiceSequence(sequence(), { defaultRecipeId: "rootless-a" });
    const voicing = output.events[0].voicing;
    expect(voicing ? voicingSummary(voicing) : "").toBe("Dm9 · Rootless A · F3 (b3) A3 (5) C4 (b7) E4 (9) · bass D2");
    expect(voicing ? voicingToMidi(voicing, { includeAccompanimentBass: true }) : []).toEqual([38, 53, 57, 60, 64]);
  });
});
