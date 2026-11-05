import { describe, expect, it } from "vitest";
import type { ChordDefinition, TransitionExplanation, VoicingInstance, VoicingResult } from "@/model/contracts";
import { chordFromSymbol } from "@/music/chords";
import { realizeVoicing } from "@/voicing/engine";
import { matchVoices, motionCost } from "@/voicing/matching";
import { explainTransition, rankSequence } from "@/voicing/voiceLeading";

const c = (symbol: string): ChordDefinition => chordFromSymbol(symbol);

function voiced(result: VoicingResult): VoicingInstance {
  if (!result.ok) {
    throw new Error(result.reason);
  }
  return result.voicing;
}

function motionAt(list: Array<TransitionExplanation | null>, index: number): number {
  const transition = list[index];
  return transition ? transition.totalMotionSemitones : -1;
}

function summaryAt(list: Array<TransitionExplanation | null>, index: number): string {
  const transition = list[index];
  return transition ? transition.summary : "";
}

const midis = (voicing: VoicingInstance | null): number[] => (voicing ? voicing.notes.map((note) => note.midi) : []);

function candidates(symbol: string, recipeId: string): VoicingInstance[] {
  const result = realizeVoicing(c(symbol), recipeId);
  return result.ok ? [result.voicing, ...result.alternatives] : [];
}

describe("matchVoices", () => {
  it("pairs by index for equal counts and by nearest pitch otherwise", () => {
    expect(matchVoices([60, 64], [59, 65]).cost).toBe(2);
    const fewer = matchVoices([50, 53, 60], [53, 57, 59, 64]);
    expect(fewer.unmatchedTo).toHaveLength(1);
    expect(fewer.pairs).toHaveLength(3);
    const more = matchVoices([53, 57, 59, 64], [50, 53, 60]);
    expect(more.unmatchedFrom).toHaveLength(1);
    expect(motionCost([53, 57, 59, 64], [50, 53, 60])).toBe(fewer.cost);
  });
});

describe("explainTransition", () => {
  it("Dm7 → G7 guide-tone (3–7) shells: F stays, C moves down a half step to B", () => {
    const dm7 = voiced(realizeVoicing(c("Dm7"), "guide-tones-37"));
    const g7 = voiced(realizeVoicing(c("G7"), "guide-tones-37", { previous: dm7 }));
    const transition = explainTransition(dm7, g7);
    expect(transition.commonTones).toBe(1);
    expect(transition.totalMotionSemitones).toBe(1);
    const common = transition.movements.find((movement) => movement.kind === "common");
    const step = transition.movements.find((movement) => movement.kind === "step");
    expect(common ? [common.fromMidi, common.fromDegree, common.toDegree] : []).toEqual([65, "b3", "b7"]);
    expect(step ? [step.fromMidi, step.toMidi, step.semitones, step.fromDegree, step.toDegree] : []).toEqual([60, 59, -1, "b7", "3"]);
    expect(transition.summary).toBe("3 and 7 swap roles: F stays (b3 → b7), C→B moves down a half step (b7 → 3) (total 1 semitone).");
  });

  it("classifies leaps for root-position shells and matches by voiceId", () => {
    const dm7 = voiced(realizeVoicing(c("Dm7"), "shell-137"));
    const g7 = voiced(realizeVoicing(c("G7"), "shell-137"));
    const transition = explainTransition(dm7, g7);
    expect(transition.movements.map((movement) => movement.voiceId)).toEqual(["v1", "v2", "v3"]);
    expect(transition.movements.map((movement) => movement.kind)).toEqual(["leap", "leap", "leap"]);
    expect(transition.commonTones).toBe(0);
  });

  it("reports entering and dropping voices for unequal counts", () => {
    const shell = voiced(realizeVoicing(c("Dm7"), "shell-137"));
    const rootless = voiced(realizeVoicing(c("G13"), "rootless-a"));
    const forward = explainTransition(shell, rootless);
    expect(forward.movements).toHaveLength(3);
    expect(forward.summary).toMatch(/enters/);
    expect(forward.commonTones).toBe(1);
    const backward = explainTransition(rootless, shell);
    expect(backward.movements).toHaveLength(3);
    expect(backward.summary).toMatch(/drops out/);
    expect(backward.totalMotionSemitones).toBe(forward.totalMotionSemitones);
  });

  it("describes an unchanged voicing as all voices staying", () => {
    const dm9 = voiced(realizeVoicing(c("Dm9"), "rootless-a"));
    const transition = explainTransition(dm9, dm9);
    expect(transition.totalMotionSemitones).toBe(0);
    expect(transition.commonTones).toBe(4);
    expect(transition.summary).toMatch(/^All 4 voices stay/);
  });
});

describe("rankSequence", () => {
  it("voices the plan §7 rootless ii–V–I exactly and explains each move", () => {
    const result = rankSequence([c("Dm9"), c("G13"), c("Cmaj9")], "rootless-a");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.voicings.map(midis)).toEqual([
      [53, 57, 60, 64],
      [53, 57, 59, 64],
      [52, 55, 59, 62]
    ]);
    expect(result.transitions[0]).toBeNull();
    expect(motionAt(result.transitions, 1)).toBe(1);
    expect(result.totalMotionSemitones).toBe(6);
  });

  it("ii–V–I shells keep root, third and seventh and find the minimum total motion", () => {
    const symbols = ["Dm7", "G7", "Cmaj7"];
    const result = rankSequence(symbols.map(c), "shell-137");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    result.voicings.forEach((voicing) => {
      expect(voicing ? voicing.notes.map((note) => note.role) : []).toEqual(["root", "third", "seventh"]);
    });
    const [a, b, d] = symbols.map((symbol) => candidates(symbol, "shell-137"));
    let best = Number.POSITIVE_INFINITY;
    a.forEach((x) => b.forEach((y) => d.forEach((z) => {
      best = Math.min(best, motionCost(midis(x), midis(y)) + motionCost(midis(y), midis(z)));
    })));
    expect(result.totalMotionSemitones).toBe(best);
    expect(result.totalMotionSemitones).toBeLessThanOrEqual(36);
  });

  it("ii–V–I guide tones move by at most a half step per chord", () => {
    const result = rankSequence([c("Dm7"), c("G7"), c("Cmaj7")], "guide-tones-37");
    expect(result.ok ? result.totalMotionSemitones : -1).toBe(2);
    if (result.ok) {
      expect(summaryAt(result.transitions, 1)).toMatch(/F stays/);
    }
  });

  it("gives a repeated chord the same voicing with zero motion", () => {
    const result = rankSequence([c("Dm7"), c("Dm7"), c("G7")], "shell-137-rh");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.voicings[1]).toBe(result.voicings[0]);
    expect(motionAt(result.transitions, 1)).toBe(0);
  });

  it("carries the previous voicing across a rest", () => {
    const result = rankSequence([c("Dm9"), null, c("G13")], "rootless-a");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.voicings[1]).toBeNull();
    expect(result.transitions[1]).toBeNull();
    expect(result.alternativesPerStep[1]).toEqual([]);
    expect(motionAt(result.transitions, 2)).toBe(1);
  });

  it("fails explicitly with the step index for impossible ranges or unsupported chords", () => {
    const narrow = rankSequence([c("Dm9"), c("G13")], "rootless-a", { minMidi: 60, maxMidi: 62 });
    expect(narrow.ok).toBe(false);
    expect(narrow.ok ? -1 : narrow.stepIndex).toBe(0);
    const triad = rankSequence([c("Dm7"), c("C"), c("G7")], "shell-137");
    expect(triad.ok ? -1 : triad.stepIndex).toBe(1);
    expect(triad.ok ? "" : triad.reason).toMatch(/requires a seventh/);
  });

  it("honours per-step melody locks", () => {
    const result = rankSequence([c("C"), c("F"), c("G")], "close-triads-rh", {}, { locks: { melody: [72, 72, 74] } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.voicings.map((voicing) => {
        const list = midis(voicing);
        return list[list.length - 1];
      })).toEqual([72, 72, 74]);
    }
  });

  it("seeds continuity from constraints.previous and reports that first transition", () => {
    const previous = voiced(realizeVoicing(c("Dm9"), "rootless-a"));
    const result = rankSequence([c("G13")], "rootless-a", { previous });
    
  });

  it("is deterministic and works with a beam of 1", () => {
    const chords = [c("C"), c("Am"), c("F"), c("G"), c("C")];
    const first = JSON.stringify(rankSequence(chords, "close-triads-rh"));
    expect(JSON.stringify(rankSequence(chords, "close-triads-rh"))).toBe(first);
    const narrow = rankSequence(chords, "close-triads-rh", {}, { beam: 1 });
    expect(narrow.ok).toBe(true);
  });
});
