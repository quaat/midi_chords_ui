import { describe, expect, it } from "vitest";
import {
  compileTimeline,
  compileTimelineWithDiagnostics,
  notesAtBeat,
  occurrenceAtBeat,
  sliceTimeline,
  timelineLearnerNotes
} from "@/timeline/compile";
import type { SequenceEvent } from "@/model/contracts";
import { C_MAJOR_VOICING, chordEvent, makeSequence, restEvent } from "./fixtures";

describe("compileTimeline — block chords and identity", () => {
  it("compiles a fallback-voiced block chord with stable ids", () => {
    const timeline = compileTimeline(makeSequence([chordEvent("e1", 0, "C", 0, 4)]));
    const learner = timelineLearnerNotes(timeline);
    expect(learner.map((note) => note.midi)).toEqual([60, 64, 67]);
    expect(learner.every((note) => note.onsetBeat === 0 && note.durationBeats === 4)).toBe(true);
    expect(learner.map((note) => note.id)).toEqual(["e1#0:learner:0", "e1#0:learner:1", "e1#0:learner:2"]);
    expect(learner[0].occurrenceId).toBe("e1#0");
    expect(learner[0].eventId).toBe("e1");
    expect(timeline.sourceId).toBe("seq1");
    expect(timeline.sourceVersion).toBe(3);
    expect(timeline.totalBeats).toBe(4);
  });

  it("uses a VoicingInstance with degree/role/hand/spelling and emits its accompaniment bass", () => {
    const event: SequenceEvent = { ...chordEvent("e1", 0, "C", 0, 4), voicing: C_MAJOR_VOICING };
    const timeline = compileTimeline(makeSequence([event]));
    const learner = timelineLearnerNotes(timeline);
    expect(learner.map((note) => note.midi)).toEqual([64, 67, 72]);
    expect(learner.map((note) => note.degree)).toEqual(["3", "5", "1"]);
    expect(learner.map((note) => note.role)).toEqual(["third", "fifth", "root"]);
    expect(learner[0].spelled).toEqual({ letter: "E", accidental: 0, octave: 4 });
    expect(learner[0].hand).toBe("right");
    const accompaniment = timeline.notes.filter((note) => note.part === "accompaniment");
    expect(accompaniment).toHaveLength(1);
    expect(accompaniment[0].midi).toBe(36);
    expect(accompaniment[0].id).toBe("e1#0:accompaniment:0");
    // The accompaniment bass is never part of the learner answer.
    expect(learner.some((note) => note.midi === 36)).toBe(false);
  });

  it("produces unique note ids across parts and passes", () => {
    const timeline = compileTimeline(makeSequence([chordEvent("a", 0, "C", 0, 4), chordEvent("b", 1, "G7", 4, 4)]), {
      accompaniment: "bassAndChord",
      metronome: true,
      repeats: 2
    });
    const ids = timeline.notes.map((note) => note.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is deterministic (same input → identical notes)", () => {
    const sequence = makeSequence([chordEvent("a", 0, "Dm7", 0, 4), chordEvent("b", 1, "G7", 4, 4), chordEvent("c", 2, "Cmaj7", 8, 8)]);
    const first = compileTimeline(sequence, { arpeggiate: 2, accompaniment: "bassAndChord" });
    const second = compileTimeline(sequence, { arpeggiate: 2, accompaniment: "bassAndChord" });
    expect(first.notes).toEqual(second.notes);
  });

  it("voice-leads fallback chords using the previous chord's notes", () => {
    const seen: (number[] | undefined)[] = [];
    compileTimeline(makeSequence([chordEvent("a", 0, "C", 0, 4), chordEvent("b", 1, "F", 4, 4)]), {
      fallbackVoicer: (event, previous) => {
        seen.push(previous);
        return { midi: event.symbol === "C" ? [60, 64, 67] : [60, 65, 69] };
      }
    });
    expect(seen).toEqual([undefined, [60, 64, 67]]);
  });

  it("skips unparseable symbols with a warning", () => {
    const result = compileTimelineWithDiagnostics(makeSequence([chordEvent("a", 0, "H#q", 0, 4), chordEvent("b", 1, "C", 4, 4)]));
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("a");
    expect(result.timeline.occurrences).toHaveLength(2);
    expect(result.timeline.notes.every((note) => note.eventId === "b")).toBe(true);
  });
});

describe("compileTimeline — arpeggios", () => {
  it("staggers onsets inside the event", () => {
    const timeline = compileTimeline(makeSequence([chordEvent("e1", 0, "C", 0, 4), chordEvent("e2", 1, "F", 4, 4)]), { arpeggiate: 1 });
    const first = timeline.notes.filter((note) => note.eventId === "e1");
    expect(first.map((note) => note.onsetBeat)).toEqual([0, 4 / 3, 8 / 3]);
    first.forEach((note) => {
      expect(note.onsetBeat).toBeGreaterThanOrEqual(0);
      expect(note.onsetBeat + note.durationBeats).toBeLessThanOrEqual(4 + 1e-9);
      expect(note.durationBeats).toBeCloseTo((4 / 3) * 0.95, 9);
    });
    const second = timeline.notes.filter((note) => note.eventId === "e2");
    expect(second[0].onsetBeat).toBe(4);
  });

  it("expands over octaves with ascending pitches and shifted spelling", () => {
    const event: SequenceEvent = { ...chordEvent("e1", 0, "C", 0, 6), voicing: C_MAJOR_VOICING };
    const timeline = compileTimeline(makeSequence([event]), { arpeggiate: 2 });
    const learner = timelineLearnerNotes(timeline);
    expect(learner.map((note) => note.midi)).toEqual([64, 67, 72, 76, 79, 84]);
    expect(learner.map((note) => note.onsetBeat)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(learner[3].spelled).toEqual({ letter: "E", accidental: 0, octave: 5 });
    expect(learner[3].degree).toBe("3");
  });
});

describe("compileTimeline — repeats, rests, count-in", () => {
  it("creates distinct occurrence ids per pass", () => {
    const timeline = compileTimeline(makeSequence([chordEvent("e1", 0, "C", 0, 4), restEvent("r1", 1, 4, 4)]), { repeats: 3 });
    expect(timeline.occurrences.map((occ) => occ.occurrenceId)).toEqual(["e1#0", "r1#0", "e1#1", "r1#1", "e1#2", "r1#2"]);
    expect(timeline.occurrences.map((occ) => occ.startBeat)).toEqual([0, 4, 8, 12, 16, 20]);
    expect(timeline.occurrences.map((occ) => occ.passIndex)).toEqual([0, 0, 1, 1, 2, 2]);
    expect(timeline.totalBeats).toBe(24);
    const occurrenceIds = new Set(timeline.notes.map((note) => note.occurrenceId));
    expect([...occurrenceIds]).toEqual(["e1#0", "e1#1", "e1#2"]);
  });

  it("gives rests occurrences but no notes", () => {
    const timeline = compileTimeline(makeSequence([restEvent("r1", 0, 0, 4)]), { accompaniment: "sustained", metronome: false });
    expect(timeline.occurrences).toHaveLength(1);
    expect(timeline.occurrences[0].symbol).toBe("NC");
    expect(timeline.notes).toHaveLength(0);
  });

  it("records count-in without creating notes before beat 0", () => {
    const timeline = compileTimeline(makeSequence([chordEvent("e1", 0, "C", 0, 4)]), { countInBeats: 4, metronome: true });
    expect(timeline.countInBeats).toBe(4);
    expect(timeline.notes.every((note) => note.onsetBeat >= 0)).toBe(true);
  });
});

describe("compileTimeline — accompaniment and metronome", () => {
  it("bassAndChord in 4/4 puts bass on beats 1 and 3 and the chord on 2 and 4", () => {
    const timeline = compileTimeline(makeSequence([chordEvent("e1", 0, "C", 0, 4)]), { accompaniment: "bassAndChord" });
    const acc = timeline.notes.filter((note) => note.part === "accompaniment");
    const bass = acc.filter((note) => note.midi === 36);
    expect(bass.map((note) => note.onsetBeat)).toEqual([0, 2]);
    const chord = acc.filter((note) => note.midi !== 36);
    expect([...new Set(chord.map((note) => note.onsetBeat))]).toEqual([1, 3]);
    expect([...new Set(chord.map((note) => note.midi))].sort((a, b) => a - b)).toEqual([48, 52, 55]);
    expect(acc.every((note) => note.durationBeats === 1)).toBe(true);
  });

  it("bassAndChord uses the slash bass", () => {
    const timeline = compileTimeline(makeSequence([chordEvent("e1", 0, "C/E", 0, 4)]), { accompaniment: "bassAndChord" });
    const bass = timeline.notes.filter((note) => note.part === "accompaniment" && note.onsetBeat === 0);
    expect(bass.map((note) => note.midi)).toEqual([40]);
  });

  it("rootOnly holds the bass per bar; sustained holds bass + chord", () => {
    const rootOnly = compileTimeline(makeSequence([chordEvent("e1", 0, "G", 0, 8)]), { accompaniment: "rootOnly" });
    const bass = rootOnly.notes.filter((note) => note.part === "accompaniment");
    expect(bass.map((note) => [note.midi, note.onsetBeat, note.durationBeats])).toEqual([
      [43, 0, 4],
      [43, 4, 4]
    ]);
    const sustained = compileTimeline(makeSequence([chordEvent("e1", 0, "G", 0, 8)]), { accompaniment: "sustained" });
    const acc = sustained.notes.filter((note) => note.part === "accompaniment");
    expect(acc.map((note) => note.midi).sort((a, b) => a - b)).toEqual([43, 55, 59, 62]);
    expect(acc.every((note) => note.onsetBeat === 0 && note.durationBeats === 8)).toBe(true);
  });

  it("uses the voicing's accompaniment bass instead of a generated one", () => {
    const event: SequenceEvent = { ...chordEvent("e1", 0, "C", 0, 4), voicing: C_MAJOR_VOICING };
    const timeline = compileTimeline(makeSequence([event]), { accompaniment: "rootOnly" });
    const acc = timeline.notes.filter((note) => note.part === "accompaniment");
    expect(acc).toHaveLength(1);
    expect(acc[0].spelled).toEqual({ letter: "C", accidental: 0, octave: 2 });
  });

  it("compiles one metronome click per beat with an accented downbeat", () => {
    const timeline = compileTimeline(makeSequence([chordEvent("e1", 0, "C", 0, 8)], 120, 4), { metronome: true });
    const clicks = timeline.notes.filter((note) => note.part === "metronome");
    expect(clicks.map((note) => note.onsetBeat)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(clicks.map((note) => note.velocity)).toEqual([120, 80, 80, 80, 120, 80, 80, 80]);
    expect(clicks.every((note) => note.durationBeats > 0 && note.durationBeats <= 0.25)).toBe(true);
  });

  it("accents per 3/4 bar", () => {
    const timeline = compileTimeline(makeSequence([chordEvent("e1", 0, "C", 0, 6)], 90, 3), { metronome: true });
    const accents = timeline.notes.filter((note) => note.part === "metronome" && note.velocity === 120).map((note) => note.onsetBeat);
    expect(accents).toEqual([0, 3]);
  });
});

describe("timeline queries", () => {
  const timeline = compileTimeline(makeSequence([chordEvent("e1", 0, "C", 0, 4), chordEvent("e2", 1, "F", 4, 4)]), {
    accompaniment: "sustained"
  });

  it("notesAtBeat returns sounding notes, optionally per part", () => {
    expect(notesAtBeat(timeline, 2, "learner").map((note) => note.eventId)).toEqual(["e1", "e1", "e1"]);
    expect(notesAtBeat(timeline, 4, "learner").every((note) => note.eventId === "e2")).toBe(true);
    expect(notesAtBeat(timeline, 2).some((note) => note.part === "accompaniment")).toBe(true);
    expect(notesAtBeat(timeline, 9)).toEqual([]);
  });

  it("occurrenceAtBeat finds the covering occurrence", () => {
    expect(occurrenceAtBeat(timeline, 5)?.occurrenceId).toBe("e2#0");
    expect(occurrenceAtBeat(timeline, 8)).toBeNull();
  });

  it("sliceTimeline keeps onsets in range and can rebase", () => {
    const slice = sliceTimeline(timeline, 4, 8);
    expect(slice.notes.every((note) => note.eventId === "e2")).toBe(true);
    expect(slice.occurrences.map((occ) => occ.occurrenceId)).toEqual(["e2#0"]);
    const rebased = sliceTimeline(timeline, 4, 6, { rebase: true });
    expect(rebased.totalBeats).toBe(2);
    expect(rebased.notes.every((note) => note.onsetBeat === 0 && note.durationBeats === 2)).toBe(true);
  });
});
