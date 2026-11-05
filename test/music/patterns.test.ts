import { describe, expect, it } from "vitest";
import { createRunRecipe, fingeringKey, ONE_OCTAVE_RUN, patternOrder, realizePattern, reviewedFingering, THIRDS_PATTERN } from "@/music/patterns";
import { formatSpelledNote } from "@/music/pitch";
import { transposeKey, keyFromTonicAndMode } from "@/music/scales";

describe("pattern order", () => {
  it("does not duplicate the turnaround note in upDown", () => {
    expect(patternOrder(3, "up")).toEqual([0, 1, 2]);
    expect(patternOrder(3, "down")).toEqual([2, 1, 0]);
    expect(patternOrder(3, "upDown")).toEqual([0, 1, 2, 1, 0]);
  });
});

describe("realizePattern", () => {
  it("realises a C major run as explicit occurrences with reviewed fingering", () => {
    const result = realizePattern(ONE_OCTAVE_RUN, "C", "major", 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notes).toHaveLength(15);
    expect(result.notes.map((n) => n.midi)).toEqual([60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60]);
    expect(result.notes.map((n) => n.finger)).toEqual([1, 2, 3, 1, 2, 3, 4, 5, 4, 3, 2, 1, 3, 2, 1]);
    expect(result.fingering).toEqual({ status: "reviewed", key: "C:major" });
    // Repeated pitches are distinct occurrences.
    const ids = result.notes.map((n) => n.id);
    expect(new Set(ids).size).toBe(15);
    const bOccurrences = result.notes.filter((n) => n.midi === 71);
    expect(bOccurrences.map((n) => n.stepIndex)).toEqual([6, 8]);
    expect(result.notes[8].startBeat).toBe(8);
    expect(result.totalBeats).toBe(15);
  });

  it("keeps spelling after transposition and omits unreviewed fingering", () => {
    const key = transposeKey(keyFromTonicAndMode("C", "major"), { number: 4, quality: "P" });
    const result = realizePattern(ONE_OCTAVE_RUN, key.tonic, key.mode, 4, { direction: "up" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notes.map((n) => formatSpelledNote(n.spelled))).toEqual(["F4", "G4", "A4", "Bb4", "C5", "D5", "E5", "F5"]);
    expect(result.notes.every((n) => n.finger === undefined)).toBe(true);
    expect(result.fingering.status).toBe("unreviewed");
    expect(reviewedFingering(ONE_OCTAVE_RUN, { letter: "F", accidental: 0 }, "major")).toBeUndefined();
    // Same pitch collection under another scale id is not silently treated as reviewed.
    expect(reviewedFingering(ONE_OCTAVE_RUN, { letter: "C", accidental: 0 }, "ionian")).toBeUndefined();
    expect(reviewedFingering(ONE_OCTAVE_RUN, { letter: "C", accidental: 0 }, "major", "left")).toBeUndefined();
    expect(fingeringKey({ letter: "F", accidental: 1 }, "dorian")).toBe("F#:dorian");
  });

  it("realises the thirds pattern and its mirror", () => {
    const result = realizePattern(THIRDS_PATTERN, "C", "major", 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const labels = result.notes.map((n) => formatSpelledNote(n.spelled));
    expect(labels.slice(0, 6)).toEqual(["C4", "E4", "D4", "F4", "E4", "G4"]);
    expect(labels[14]).toBe("C5");
    expect(labels.slice(15, 19)).toEqual(["D5", "B4", "C5", "A4"]);
    expect(labels[labels.length - 1]).toBe("C4");
    expect(result.notes).toHaveLength(29);
    expect(result.notes[1].durationBeats).toBe(0.5);
    expect(result.fingering.status).toBe("unreviewed");
    expect(THIRDS_PATTERN.reviewed).toBe(false);
  });

  it("returns an explicit error instead of clamping out-of-range notes", () => {
    const result = realizePattern(ONE_OCTAVE_RUN, "C", "major", 4, { range: { low: 48, high: 70 } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/outside the range/);
    expect(result.details.length).toBeGreaterThan(0);
    expect(result.suggestedStartOctaves).toEqual([3]);
    const tooSmall = realizePattern(ONE_OCTAVE_RUN, "C", "major", 4, { range: { low: 60, high: 66 } });
    expect(tooSmall.ok).toBe(false);
    if (!tooSmall.ok) {
      expect(tooSmall.reason).toMatch(/needs 12 semitones/);
      expect(tooSmall.suggestedStartOctaves).toEqual([]);
    }
  });

  it("fails explicitly when a recipe does not fit the scale size", () => {
    const result = realizePattern(ONE_OCTAVE_RUN, "C", "majorPentatonic", 4);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/degree index 5/);
    }
    const pentatonicRun = createRunRecipe({ degreeCount: 5 });
    const ok = realizePattern(pentatonicRun, "A", "minorPentatonic", 3, { direction: "down" });
    expect(ok.ok && ok.notes.map((n) => formatSpelledNote(n.spelled))).toEqual(["A4", "G4", "E4", "D4", "C4", "A3"]);
  });
});
