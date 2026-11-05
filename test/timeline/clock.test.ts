import { describe, expect, it } from "vitest";
import { ClockMapping, TempoMap, beatsPerBar, beatsToSeconds, perfMsToAudioSeconds, secondsToBeats } from "@/timeline/clock";
import { countInNotes, buildMetronomeNotes } from "@/playback/metronome";

describe("clock conversions", () => {
  it("converts beats and seconds at a constant tempo", () => {
    expect(beatsToSeconds(4, 120)).toBe(2);
    expect(secondsToBeats(2, 120)).toBe(4);
    expect(secondsToBeats(beatsToSeconds(3.25, 87), 87)).toBeCloseTo(3.25, 9);
    expect(beatsPerBar(6, 8)).toBe(3);
  });

  it("TempoMap integrates piecewise tempos and inverts", () => {
    const map = new TempoMap([
      { beat: 0, bpm: 120 },
      { beat: 4, bpm: 60 }
    ]);
    expect(map.secondsAt(4)).toBe(2);
    expect(map.secondsAt(6)).toBe(4);
    expect(map.beatAt(4)).toBe(6);
    expect(map.secondsAt(-2)).toBe(-1);
    expect(map.bpmAt(5)).toBe(60);
  });

  it("ClockMapping relates the performance clock to beats", () => {
    const mapping = new ClockMapping(1000, 0, TempoMap.constant(120));
    expect(mapping.nowBeats(1000)).toBe(0);
    expect(mapping.nowBeats(2000)).toBe(2);
    expect(mapping.nowBeats(0)).toBe(-2);
    expect(mapping.beatToPerfMs(4)).toBe(3000);
    const slower = mapping.reanchor(2000, TempoMap.constant(60));
    expect(slower.nowBeats(2000)).toBe(2);
    expect(slower.nowBeats(3000)).toBe(3);
  });

  it("translates performance ms to the audio clock at call time", () => {
    expect(perfMsToAudioSeconds(1150, 1000, 10)).toBeCloseTo(10.15, 9);
    expect(perfMsToAudioSeconds(900, 1000, 10)).toBe(10);
  });
});

describe("metronome helpers", () => {
  it("countInNotes leads into the target with negative onsets", () => {
    const clicks = countInNotes(4, 120);
    expect(clicks.map((note) => note.onsetBeat)).toEqual([-4, -3, -2, -1]);
    expect(clicks.map((note) => note.velocity)).toEqual([120, 80, 80, 80]);
    expect(clicks.every((note) => note.part === "metronome")).toBe(true);
    const later = countInNotes(2, 120, { targetBeat: 8 });
    expect(later.map((note) => note.onsetBeat)).toEqual([6, 7]);
  });

  it("buildMetronomeNotes clicks on integer beats only", () => {
    const clicks = buildMetronomeNotes({ startBeat: 0.5, endBeat: 4, bpm: 100 });
    expect(clicks.map((note) => note.onsetBeat)).toEqual([1, 2, 3]);
  });
});
