import { describe, expect, it } from "vitest";
import type { PerformanceTimeline } from "@/model/contracts";
import { chordFromSymbol } from "@/music/chords";
import { sequenceFromParsedText } from "@/music/legacy";
import { compileTimeline } from "@/timeline/compile";
import { chordPracticePayload, runPracticePayload } from "@/ui/runtime/practicePayload";
import {
  asDemonstration,
  buildAuditionTimeline,
  chordAuditionNotes,
  findCurrentAndNext,
  formatPositionLabel,
  inputSourceToPreference,
  isDemonstrationTimeline,
  labelModeFromPreference,
  labelModeToPreference,
  learnerNotesOf,
  reducedMotionFromPreference,
  runAuditionNotes,
  sameMidiSet,
  themeFromPreference
} from "@/ui/runtime/runtimeHelpers";

function timeline(): PerformanceTimeline {
  const { sequence } = sequenceFromParsedText("C | 1\nNC | 0.5\nG | 1", { defaultChordMeasures: 1, tempoBpm: 100, timeSignature: { numerator: 4, denominator: 4 }, id: "s" });
  return compileTimeline(sequence, { accompaniment: "sustained" });
}

describe("asDemonstration", () => {
  it("re-tags learner notes as demonstration and keeps other parts", () => {
    const source = timeline();
    const demo = asDemonstration(source);
    expect(demo.id).toBe(`${source.id}~demo`);
    expect(isDemonstrationTimeline(demo)).toBe(true);
    expect(isDemonstrationTimeline(source)).toBe(false);
    expect(demo.notes.some((n) => n.part === "learner")).toBe(false);
    const learnerCount = source.notes.filter((n) => n.part === "learner").length;
    expect(demo.notes.filter((n) => n.part === "demonstration").length).toBe(learnerCount);
    expect(demo.notes.filter((n) => n.part === "accompaniment").length).toBe(source.notes.filter((n) => n.part === "accompaniment").length);
    expect(source.notes.some((n) => n.part === "learner")).toBe(true);
    for (let i = 1; i < demo.notes.length; i += 1) {
      expect(demo.notes[i].onsetBeat).toBeGreaterThanOrEqual(demo.notes[i - 1].onsetBeat);
    }
  });
});

describe("formatPositionLabel", () => {
  it("formats bar.beat (1-based) and the count-in", () => {
    expect(formatPositionLabel(0)).toBe("1.1");
    expect(formatPositionLabel(5.5)).toBe("2.2");
    expect(formatPositionLabel(3, { numerator: 3, denominator: 4 })).toBe("2.1");
    expect(formatPositionLabel(-4)).toBe("Count-in 1");
    expect(formatPositionLabel(-1)).toBe("Count-in 4");
    expect(formatPositionLabel(Number.NaN)).toBe("1.1");
  });
});

describe("findCurrentAndNext", () => {
  it("returns the occurrence at the position and the following one", () => {
    const tl = timeline();
    const atStart = findCurrentAndNext(tl, 0);
    expect(atStart.current?.symbol).toBe("C");
    expect(atStart.next?.symbol).toBe("NC");
    expect(atStart.sounding).toBe(true);
    const inRest = findCurrentAndNext(tl, 4.5);
    expect(inRest.current?.symbol).toBe("NC");
    expect(inRest.next?.symbol).toBe("G");
    const last = findCurrentAndNext(tl, 7);
    expect(last.current?.symbol).toBe("G");
    expect(last.next).toBeNull();
  });

  it("treats the count-in as upcoming and the end as nothing", () => {
    const tl = timeline();
    const countIn = findCurrentAndNext(tl, -2);
    expect(countIn.index).toBe(0);
    expect(countIn.sounding).toBe(false);
    const end = findCurrentAndNext(tl, tl.totalBeats);
    expect(end.index).toBe(-1);
    expect(end.current).toBeNull();
    expect(findCurrentAndNext(null, 0).index).toBe(-1);
  });

  it("learnerNotesOf returns the occurrence's learner notes low to high", () => {
    const tl = timeline();
    const notes = learnerNotesOf(tl, "ev-1#0");
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((n) => n.part === "learner")).toBe(true);
    expect(notes.map((n) => n.midi)).toEqual([...notes.map((n) => n.midi)].sort((a, b) => a - b));
    expect(learnerNotesOf(tl, null)).toEqual([]);
  });
});

describe("audition timelines", () => {
  it("builds a demonstration-only timeline", () => {
    const tl = buildAuditionTimeline(chordAuditionNotes([64, 60, 67, 60], 2), 90, "a1");
    expect(tl.notes.map((n) => n.midi)).toEqual([60, 64, 67]);
    expect(tl.notes.every((n) => n.part === "demonstration")).toBe(true);
    expect(tl.totalBeats).toBe(2);
    const run = buildAuditionTimeline(runAuditionNotes([60, 62, 64], 0.5), 90);
    expect(run.notes.map((n) => n.onsetBeat)).toEqual([0, 0.5, 1]);
    expect(run.totalBeats).toBeCloseTo(1.475, 6);
  });

  it("drops invalid notes", () => {
    const tl = buildAuditionTimeline([{ midi: 200, onsetBeat: 0, durationBeats: 1 }, { midi: 60, onsetBeat: 0, durationBeats: 0 }], 90);
    expect(tl.notes).toEqual([]);
  });
});

describe("preference mapping", () => {
  it("maps label modes both ways", () => {
    expect(labelModeFromPreference("degrees")).toBe("chordDegrees");
    expect(labelModeFromPreference("roles")).toBe("chordDegrees");
    expect(labelModeFromPreference("none")).toBe("none");
    expect(labelModeToPreference("scaleDegrees")).toBe("degrees");
    expect(labelModeToPreference("fingers")).toBe("noteNames");
  });

  it("resolves system theme/motion and listen-only input", () => {
    expect(themeFromPreference("system", true)).toBe("dark");
    expect(themeFromPreference("light", true)).toBe("light");
    expect(reducedMotionFromPreference("system", true)).toBe(true);
    expect(reducedMotionFromPreference("noPreference", true)).toBe(false);
    expect(inputSourceToPreference("none")).toBe("auto");
    expect(sameMidiSet([60, 64, 67], [67, 60, 64, 64])).toBe(true);
    expect(sameMidiSet([60], [61])).toBe(false);
  });
});

describe("practice payloads", () => {
  it("a chord becomes a one-step exact-voicing exercise", () => {
    const chord = chordFromSymbol("Dm7");
    const payload = chordPracticePayload(chord, [
      { midi: 62, role: "root", degree: "1" },
      { midi: 65, role: "third", degree: "b3" },
      { midi: 69, role: "fifth", degree: "5" },
      { midi: 72, role: "seventh", degree: "b7" }
    ]);
    expect(payload.steps?.length).toBe(1);
    const step = payload.steps ? payload.steps[0] : null;
    expect(step?.policy.kind).toBe("exactVoicing");
    expect(step?.targets.map((n) => n.midi)).toEqual([62, 65, 69, 72]);
    expect(step?.occurrenceId).toBe(payload.timeline.occurrences[0].occurrenceId);
    expect(payload.timeline.notes.every((n) => n.part === "learner")).toBe(true);
  });

  it("a run becomes one step per note", () => {
    const payload = runPracticePayload("D-dorian", [{ midi: 62 }, { midi: 64 }, { midi: 65 }], { beatsPerNote: 1 });
    expect(payload.steps?.length).toBe(3);
    expect(payload.timeline.occurrences.map((o) => o.startBeat)).toEqual([0, 1, 2]);
    expect(payload.steps?.map((s) => s.targets.length)).toEqual([1, 1, 1]);
  });
});
