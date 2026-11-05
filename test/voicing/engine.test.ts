import { describe, expect, it } from "vitest";
import type { ChordDefinition, VoicingInstance, VoicingResult } from "@/model/contracts";
import { chordFromSymbol, chordPitchClasses, transposeChord } from "@/music/chords";
import { interval } from "@/music/intervals";
import { formatPitchClass, formatSpelledNote, mod12 } from "@/music/pitch";
import { inversionVoicing, realizeAll, realizeVoicing, recipeSupport } from "@/voicing/engine";
import { VOICING_RECIPES } from "@/voicing/recipes";

function voiced(result: VoicingResult): VoicingInstance {
  if (!result.ok) {
    throw new Error(`expected a voicing, got: ${result.reason}`);
  }
  return result.voicing;
}

function failure(result: VoicingResult): string {
  if (result.ok) {
    throw new Error(`expected a failure, got ${result.voicing.notes.map((note) => note.midi).join(" ")}`);
  }
  return result.reason;
}

const midis = (voicing: VoicingInstance): number[] => voicing.notes.map((note) => note.midi);
const degrees = (voicing: VoicingInstance): string[] => voicing.notes.map((note) => note.degree);
const names = (voicing: VoicingInstance): string[] => voicing.notes.map((note) => formatSpelledNote(note.spelled));

const c = (symbol: string): ChordDefinition => chordFromSymbol(symbol);

describe("plan §7 rootless fixture", () => {
  it("realises Dm9, G13, Cmaj9 rootless-a as the authored example without a previous voicing", () => {
    const dm9 = voiced(realizeVoicing(c("Dm9"), "rootless-a"));
    const g13 = voiced(realizeVoicing(c("G13"), "rootless-a"));
    const cmaj9 = voiced(realizeVoicing(c("Cmaj9"), "rootless-a"));
    expect(midis(dm9)).toEqual([53, 57, 60, 64]);
    expect(degrees(dm9)).toEqual(["b3", "5", "b7", "9"]);
    expect(names(dm9)).toEqual(["F3", "A3", "C4", "E4"]);
    expect(midis(g13)).toEqual([53, 57, 59, 64]);
    expect(degrees(g13)).toEqual(["b7", "9", "3", "13"]);
    expect(names(g13)).toEqual(["F3", "A3", "B3", "E4"]);
    expect(midis(cmaj9)).toEqual([52, 55, 59, 62]);
    expect(degrees(cmaj9)).toEqual(["3", "5", "7", "9"]);
    expect(names(cmaj9)).toEqual(["E3", "G3", "B3", "D4"]);
  });

  it("holds when constraints.previous chains the three chords", () => {
    const dm9 = voiced(realizeVoicing(c("Dm9"), "rootless-a"));
    const g13 = voiced(realizeVoicing(c("G13"), "rootless-a", { previous: dm9 }));
    const cmaj9 = voiced(realizeVoicing(c("Cmaj9"), "rootless-a", { previous: g13 }));
    expect(midis(g13)).toEqual([53, 57, 59, 64]);
    expect(midis(cmaj9)).toEqual([52, 55, 59, 62]);
  });

  it("adds the accompaniment bass D2, G2, C2 spelled from the root", () => {
    const bass = ["Dm9", "G13", "Cmaj9"].map((symbol) => {
      const voicing = voiced(realizeVoicing(c(symbol), "rootless-a"));
      const note = voicing.accompanimentBass;
      return note ? `${formatSpelledNote(note.spelled)}:${note.midi}:${note.role}:${note.hand}` : "none";
    });
    expect(bass).toEqual(["D2:38:root:left", "G2:43:root:left", "C2:36:root:left"]);
  });

  it("explains the chosen degrees and lists the omitted root", () => {
    const dm9 = voiced(realizeVoicing(c("Dm9"), "rootless-a"));
    expect(dm9.explanation[0]).toBe("Dm9 rootless A: F (b3), A (5), C (b7), E (9); root D left to accompaniment");
    expect(dm9.omitted).toEqual([{ role: "root", degree: "1", reason: "rootless recipe leaves the root to the bass" }]);
    expect(dm9.recipeId).toBe("rootless-a");
    expect(dm9.notes.map((note) => note.voiceId)).toEqual(["v1", "v2", "v3", "v4"]);
  });

  it("says why G13 rootless-a leaves out the fifth", () => {
    const g13 = voiced(realizeVoicing(c("G13"), "rootless-a"));
    const fifth = g13.omitted.find((tone) => tone.degree === "5");
    expect(fifth ? fifth.reason : "").toMatch(/13 takes the fifth's place/);
  });

  it("realises the B forms with the seventh (minor/major) or third (dominant) at the bottom", () => {
    expect(degrees(voiced(realizeVoicing(c("Dm9"), "rootless-b")))).toEqual(["b7", "9", "b3", "5"]);
    expect(degrees(voiced(realizeVoicing(c("G13"), "rootless-b")))).toEqual(["3", "13", "b7", "9"]);
    expect(degrees(voiced(realizeVoicing(c("Cmaj9"), "rootless-b")))).toEqual(["7", "9", "3", "5"]);
  });

  it("transposes: Gm9 rootless-a is Dm9 rootless-a shifted up a fourth with flat spellings", () => {
    const dm9 = voiced(realizeVoicing(c("Dm9"), "rootless-a"));
    const gm9Chord = transposeChord(c("Dm9"), interval("P", 4));
    const gm9 = voiced(realizeVoicing(gm9Chord, "rootless-a"));
    expect(gm9Chord.symbol).toBe("Gm9");
    expect(midis(gm9)).toEqual(midis(dm9).map((midi) => midi + 5));
    expect(gm9.notes.map((note) => formatPitchClass(note.spelled))).toEqual(["Bb", "D", "F", "A"]);
    expect(degrees(gm9)).toEqual(degrees(dm9));
  });
});

describe("rootless details", () => {
  it("uses a written alteration in place of the plain ninth (C7b9)", () => {
    const voicing = voiced(realizeVoicing(c("C7b9"), "rootless-a"));
    expect(degrees(voicing)).toEqual(["b7", "b9", "3", "5"]);
    expect(voicing.notes.map((note) => formatPitchClass(note.spelled))).toEqual(["Bb", "Db", "E", "G"]);
  });

  it("keeps the root of a half-diminished chord and explains why", () => {
    const voicing = voiced(realizeVoicing(c("Cm7b5"), "rootless-a"));
    expect(degrees(voicing)).toEqual(["b3", "b5", "b7", "1"]);
    expect(voicing.explanation.join(" ")).toMatch(/natural 9 clashes/);
  });

  it("puts the root in the ninth's place when a seventh chord has no written 9", () => {
    const voicing = voiced(realizeVoicing(c("Dm7"), "rootless-a"));
    expect(degrees(voicing)).toEqual(["b3", "5", "b7", "1"]);
    expect(voicing.explanation.join(" ")).toMatch(/no written 9/);
  });
});

describe("shells, guide tones and close voicings", () => {
  it("shell-137 on C7 plays C E Bb, omits and lists the fifth", () => {
    const voicing = voiced(realizeVoicing(c("C7"), "shell-137"));
    expect(voicing.notes.map((note) => formatPitchClass(note.spelled))).toEqual(["C", "E", "Bb"]);
    expect(degrees(voicing)).toEqual(["1", "3", "b7"]);
    expect(voicing.notes.every((note) => note.hand === "left")).toBe(true);
    expect(voicing.omitted).toEqual([{ role: "fifth", degree: "5", reason: "shell omits the fifth" }]);
    expect(voicing.accompanimentBass).toBeUndefined();
    midis(voicing).forEach((midi) => {
      expect(midi).toBeGreaterThanOrEqual(43);
      expect(midi).toBeLessThanOrEqual(67);
    });
  });

  it("shell-137 uses the sixth of a 6 chord", () => {
    expect(degrees(voiced(realizeVoicing(c("C6"), "shell-137")))).toEqual(["1", "3", "6"]);
  });

  it("shell-137 on a triad fails and suggests close-triads-rh", () => {
    const reason = failure(realizeVoicing(c("C"), "shell-137"));
    expect(reason).toMatch(/shell-137 requires a seventh/);
    expect(reason).toMatch(/C has none/);
    expect(reason).toMatch(/try close-triads-rh/);
  });

  it("shell-137 on a sus chord explains the missing third", () => {
    expect(failure(realizeVoicing(c("C7sus4"), "shell-137"))).toMatch(/requires a third; C7sus4 has a suspended 4 instead/);
  });

  it("guide tones on Dm7 are F and C (b3 and b7) over a D accompaniment", () => {
    const voicing = voiced(realizeVoicing(c("Dm7"), "guide-tones-37"));
    expect(voicing.notes.map((note) => formatPitchClass(note.spelled)).sort()).toEqual(["C", "F"]);
    expect(degrees(voicing).sort()).toEqual(["b3", "b7"]);
    expect(voicing.notes).toHaveLength(2);
    expect(voicing.accompanimentBass ? voicing.accompanimentBass.midi : 0).toBe(38);
    expect(voicing.omitted.map((tone) => tone.degree)).toEqual(["1", "5"]);
  });

  it("accepts the guide-tones alias", () => {
    expect(voiced(realizeVoicing(c("G7"), "guide-tones")).recipeId).toBe("guide-tones-37");
  });

  it("close-triads-rh on C gives C4 E4 G4 in 60..84 with accompaniment bass C2", () => {
    const result = realizeVoicing(c("C"), "close-triads-rh");
    const voicing = voiced(result);
    expect(names(voicing)).toEqual(["C4", "E4", "G4"]);
    expect(voicing.accompanimentBass ? formatSpelledNote(voicing.accompanimentBass.spelled) : "").toBe("C2");
    [voicing, ...(result.ok ? result.alternatives : [])].forEach((item) => {
      midis(item).forEach((midi) => {
        expect(midi).toBeGreaterThanOrEqual(60);
        expect(midi).toBeLessThanOrEqual(84);
      });
    });
  });

  it("close-triads-rh puts a slash bass lowest: C/E realises as E G C", () => {
    const result = realizeVoicing(c("C/E"), "close-triads-rh");
    const voicing = voiced(result);
    expect(voicing.notes.map((note) => formatPitchClass(note.spelled))).toEqual(["E", "G", "C"]);
    if (result.ok) {
      result.alternatives.forEach((alternative) => expect(formatPitchClass(alternative.notes[0].spelled)).toBe("E"));
    }
    const bass = voicing.accompanimentBass;
    expect(bass ? `${formatSpelledNote(bass.spelled)}:${bass.degree}:${bass.role}` : "").toBe("E2:3:third");
  });

  it("close-triads-rh rejects a seventh chord and names an alternative", () => {
    const reason = failure(realizeVoicing(c("Dm7"), "close-triads-rh"));
    expect(reason).toMatch(/close-triads-rh does not support Minor 7 chords/);
    expect(reason).toMatch(/try (shell-137|close-sevenths-rh|close-rp)/);
  });

  it("close-sevenths-rh adds only the named extension", () => {
    const voicing = voiced(realizeVoicing(c("G13"), "close-sevenths-rh"));
    expect(degrees(voicing).sort()).toEqual(["1", "13", "3", "5", "b7"]);
    expect(voicing.omitted.map((tone) => tone.degree)).toEqual(["9"]);
    expect(failure(realizeVoicing(c("C"), "close-sevenths-rh"))).toMatch(/try close-triads-rh/);
  });

  it("close-rp plays every tone with the root lowest inside one octave", () => {
    const voicing = voiced(realizeVoicing(c("Dm9"), "close-rp"));
    expect(degrees(voicing)).toEqual(["1", "9", "b3", "5", "b7"]);
    const list = midis(voicing);
    expect(list[list.length - 1] - list[0]).toBeLessThanOrEqual(12);
    expect(voicing.omitted).toEqual([]);
  });

  it("open spreads 1-5-3-7 over more than an octave and splits the hands at the largest gap", () => {
    const voicing = voiced(realizeVoicing(c("Cmaj7"), "open"));
    expect(names(voicing)).toEqual(["C3", "G3", "E4", "B4"]);
    expect(voicing.notes.map((note) => note.hand)).toEqual(["left", "left", "right", "right"]);
    expect(voicing.explanation.join(" ")).toMatch(/Left hand: C3 G3; right hand: E4 B4/);
  });

  it("keeps double-flat and sharp spellings from the chord degrees", () => {
    const dim = voiced(realizeVoicing(c("Cdim7"), "shell-137"));
    expect(dim.notes[2].spelled.letter).toBe("B");
    expect(dim.notes[2].spelled.accidental).toBe(-2);
    const sharp = voiced(realizeVoicing(c("F#7"), "shell-137"));
    expect(sharp.notes.map((note) => formatPitchClass(note.spelled))).toEqual(["F#", "A#", "E"]);
  });
});

describe("constraints", () => {
  it("honours a melody lock on the top note", () => {
    const voicing = voiced(realizeVoicing(c("C"), "close-triads-rh", { melodyMidi: 72 }));
    expect(midis(voicing)).toEqual([64, 67, 72]);
    expect(midis(voiced(realizeVoicing(c("Dm9"), "rootless-a", { melodyMidi: 64 })))).toEqual([53, 57, 60, 64]);
  });

  it("fails explicitly when the melody is not a chord tone, not played, or cannot be on top", () => {
    expect(failure(realizeVoicing(c("Dm9"), "rootless-a", { melodyMidi: 66 }))).toMatch(/not a chord tone of Dm9/);
    expect(failure(realizeVoicing(c("Dm9"), "rootless-a", { melodyMidi: 62 }))).toMatch(/the 1 of Dm9, which rootless-a does not play/);
    expect(failure(realizeVoicing(c("Dm9"), "rootless-a", { melodyMidi: 65 }))).toMatch(/puts F4 on top/);
  });

  it("honours a bass lock on the lowest learner note", () => {
    expect(midis(voiced(realizeVoicing(c("C"), "close-triads-rh", { bassMidi: 64 })))).toEqual([64, 67, 72]);
  });

  it("returns ok:false for an impossible range instead of moving pitch classes", () => {
    const narrow = realizeVoicing(c("Dm9"), "rootless-a", { minMidi: 60, maxMidi: 66 });
    expect(failure(narrow)).toMatch(/pitch classes are never changed/);
    expect(failure(realizeVoicing(c("Dm9"), "rootless-a", { minMidi: 80, maxMidi: 90 }))).toMatch(/fits within MIDI 80..90/);
    expect(failure(realizeVoicing(c("Dm9"), "rootless-a", { minMidi: 70, maxMidi: 60 }))).toMatch(/is empty/);
  });

  it("never returns a pitch class outside the chord (any recipe, several chords, tight ranges)", () => {
    const symbols = ["C", "Cm", "C/E", "Dm9", "G13", "Cmaj9", "C7b9", "F#7", "Bbm7", "Cm7b5", "Cdim7", "Ab6", "Ebmaj7"];
    const ranges: Array<{ minMidi?: number; maxMidi?: number }> = [{}, { minMidi: 50, maxMidi: 64 }, { minMidi: 58, maxMidi: 70 }];
    symbols.forEach((symbol) => {
      const chord = c(symbol);
      const allowed = new Set<number>(chordPitchClasses(chord));
      VOICING_RECIPES.forEach((recipe) => {
        ranges.forEach((range) => {
          const result = realizeVoicing(chord, recipe.id, range);
          if (!result.ok) {
            expect(result.reason.length).toBeGreaterThan(0);
            return;
          }
          [result.voicing, ...result.alternatives].forEach((voicing) => {
            voicing.notes.forEach((note) => expect(allowed.has(mod12(note.midi))).toBe(true));
            if (range.minMidi !== undefined && range.maxMidi !== undefined) {
              voicing.notes.forEach((note) => {
                expect(note.midi).toBeGreaterThanOrEqual(range.minMidi ?? 0);
                expect(note.midi).toBeLessThanOrEqual(range.maxMidi ?? 127);
              });
            }
          });
        });
      });
    });
  });

  it("lets explicit min/max widen the default register (regression: G/B after C with minMidi 59)", () => {
    const previous = voiced(realizeVoicing(c("C"), "close-triads-rh"));
    expect(midis(previous)).toEqual([60, 64, 67]);
    const result = realizeVoicing(c("G/B"), "close-triads-rh", { minMidi: 59, maxMidi: 79, previous });
    expect(midis(voiced(result))).toEqual([59, 62, 67]);
    const alternatives = result.ok ? result.alternatives.map(midis) : [];
    expect(alternatives).toContainEqual([71, 74, 79]);
    alternatives.forEach((list) => expect(list[0] % 12).toBe(11));
    expect(voiced(result).explanation.join(" ")).toMatch(/smallest movement from the previous voicing \(3 semitones/);
  });

  it("rejects a shape wider than 12 semitones for one hand", () => {
    const reason = failure(realizeVoicing(c("C"), "open", { hand: "right" }));
    expect(reason).toMatch(/too wide for one hand/);
  });

  it("applies a tighter maxSpan constraint", () => {
    expect(failure(realizeVoicing(c("Cmaj7"), "shell-137", { maxSpanSemitones: 8 }))).toMatch(/span limit/);
  });

  it("drops non-essential tones visibly to meet a note-count limit, never essential ones", () => {
    const voicing = voiced(realizeVoicing(c("G13"), "close-rp", { noteCount: { min: 3, max: 4 } }));
    expect(degrees(voicing)).toEqual(["1", "3", "13", "b7"]);
    const reasons = voicing.omitted.map((tone) => `${tone.degree}:${tone.reason}`);
    expect(reasons).toContain("5:dropped to meet the note-count limit of 4");
    expect(reasons).toContain("9:dropped to meet the note-count limit of 4");
    expect(failure(realizeVoicing(c("Dm9"), "rootless-a", { noteCount: { min: 3, max: 3 } }))).toMatch(/does not overlap/);
  });

  it("ranks deterministically: identical input gives identical output", () => {
    const run = (): string => JSON.stringify(["C", "Dm9", "G13", "C/E"].map((symbol) => VOICING_RECIPES.map((recipe) => realizeVoicing(c(symbol), recipe.id))));
    expect(run()).toBe(run());
  });

  it("prefers continuity with the previous voicing over the register centre", () => {
    const f = voiced(realizeVoicing(c("F"), "close-triads-rh"));
    expect(midis(f)).toEqual([60, 65, 69]);
    const after = voiced(realizeVoicing(c("C"), "close-triads-rh", { previous: f }));
    expect(midis(after)).toEqual([60, 64, 67]);
    const g = voiced(realizeVoicing(c("G"), "close-triads-rh", { previous: f }));
    expect(midis(g)).toEqual([62, 67, 71]);
  });

  it("returns up to four alternatives", () => {
    const result = realizeVoicing(c("C"), "close-triads-rh");
    expect(result.ok ? result.alternatives.length : -1).toBe(4);
  });
});

describe("inspectors and inversions", () => {
  it("realizeAll returns one entry per catalogue recipe", () => {
    const all = realizeAll(c("Dm9"));
    expect(all.map((entry) => entry.recipeId)).toEqual(VOICING_RECIPES.map((recipe) => recipe.id));
    const rootless = all.find((entry) => entry.recipeId === "rootless-a");
    expect(rootless && rootless.result.ok).toBe(true);
    const triads = all.find((entry) => entry.recipeId === "close-triads-rh");
    expect(triads ? triads.result.ok : true).toBe(false);
  });

  it("recipeSupport reports an alternative", () => {
    const support = recipeSupport(c("C"), "rootless-a");
    expect(support.ok).toBe(false);
    expect(support.ok ? "" : support.alternativeRecipeId).toBe("close-triads-rh");
  });

  it("inversionVoicing adapts music inversion() and explains what moved", () => {
    const voicing = voiced(inversionVoicing(c("C7"), 1, 4));
    expect(voicing.recipeId).toBe("close-rp");
    expect(names(voicing)).toEqual(["E4", "G4", "Bb4", "C5"]);
    expect(voicing.explanation.join(" ")).toMatch(/root \(1\) moved up an octave, so the third \(3\) is now lowest/);
    expect(failure(inversionVoicing(c("C"), 3))).toMatch(/no third inversion/);
  });
});
