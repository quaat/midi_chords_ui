import { describe, expect, it } from "vitest";
import { sequenceFromParsedText } from "@/music/legacy";
import { compileTimeline } from "@/timeline/compile";
import { NOTATION_RELATIONSHIP_LABEL, notationEventsFromSequence, notationIndexOfEvent, notationSettings } from "@/ui/notation/notationAdapter";

describe("notation adapter", () => {
  const { sequence } = sequenceFromParsedText("C | 1\nNC | 0.5\nG7 | 1", { defaultChordMeasures: 1, tempoBpm: 120, timeSignature: { numerator: 4, denominator: 4 }, id: "s" });

  it("writes one block chord per event from the block timeline", () => {
    const block = compileTimeline(sequence, { arpeggiate: 0 });
    const events = notationEventsFromSequence(sequence, block);
    expect(events.map((e) => e.chordSymbol)).toEqual(["C", "NC", "G7"]);
    expect(events[0].isRest).toBe(false);
    expect(events[0].noteNumbers.length).toBeGreaterThanOrEqual(3);
    expect(events[1].isRest).toBe(true);
    expect(events[1].durationMeasures).toBe(0.5);
    expect(events[2].startTick).toBe(6 * 480);
    expect(events[2].startSeconds).toBeCloseTo(3, 6);
  });

  it("ignores arpeggio copies only when given a block timeline; without one events are rests", () => {
    const events = notationEventsFromSequence(sequence, null);
    expect(events.every((e) => e.isRest)).toBe(true);
  });

  it("settings follow the sequence; index lookup; label text", () => {
    const settings = notationSettings(sequence);
    expect(settings.tempoBpm).toBe(120);
    expect(settings.ticksPerBeat).toBe(480);
    expect(notationIndexOfEvent(sequence, "ev-3")).toBe(2);
    expect(notationIndexOfEvent(sequence, null)).toBeNull();
    expect(NOTATION_RELATIONSHIP_LABEL).toMatch(/harmonic reduction/);
  });
});
