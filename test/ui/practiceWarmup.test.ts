import { describe, expect, it } from "vitest";
import type { AttemptResult } from "@/model/contracts";
import type { WarmupSpec } from "@/content/authoring";
import { getWarmup } from "@/content";
import { WARMUP_CAVEAT, warmupFeedback, warmupToSteps } from "@/ui/practice/warmup";

function fiveFinger(): WarmupSpec {
  const warmup = getWarmup("wu-five-finger-c");
  if (!warmup) throw new Error("missing warm-up fixture");
  return warmup;
}

function timedResult(deltas: number[]): AttemptResult {
  return {
    id: "a1",
    exerciseId: "wu-five-finger-c",
    exerciseVersion: 1,
    scoringVersion: "x",
    startedAt: "2026-11-04T10:00:00.000Z",
    mode: "timed",
    inputSource: "midi",
    assistance: "none",
    hintLevel: 0,
    policy: { kind: "exactVoicing" },
    pitch: [],
    timing: deltas.map((deltaMs, index) => ({
      targetNoteId: `n${index}@0`,
      occurrenceId: `o${index}@0`,
      expectedOnsetMs: index * 1000,
      actualOnsetMs: index * 1000 + deltaMs,
      deltaMs,
      verdict: "onTime" as const
    })),
    summary: { stepsCompleted: 0, stepsTotal: 0, difficultOccurrenceIds: [] }
  };
}

describe("warmupToSteps", () => {
  it("produces exact targets with hand labels, one step per authored attack", () => {
    const warmup = fiveFinger();
    const practice = warmupToSteps(warmup);
    expect(practice.steps).toHaveLength(warmup.steps.length);
    const first = practice.steps[0];
    expect(first.policy).toEqual({ kind: "exactVoicing" });
    expect(first.targets.map((n) => [n.midi, n.hand])).toEqual([
      [48, "left"],
      [60, "right"]
    ]);
    expect(first.targets.every((n) => n.part === "learner")).toBe(true);
    expect(first.prompt).toContain("LH");
    expect(first.prompt).toContain("RH");
    expect(practice.exercise.policy.kind).toBe("exactVoicing");
    expect(practice.exercise.contract).toBe("reproduce");
    expect(practice.timeline.totalBeats).toBe(warmup.steps.reduce((sum, step) => sum + step.durationBeats, 0));
  });

  it("never carries finger numbers for an unreviewed warm-up", () => {
    const warmup: WarmupSpec = { ...fiveFinger(), steps: [{ notes: [{ midi: 60, hand: "right", finger: 1 }], durationBeats: 1 }] };
    expect(warmupToSteps(warmup).steps[0].targets[0].finger).toBeUndefined();
    expect(warmupToSteps({ ...warmup, reviewed: true }).steps[0].targets[0].finger).toBe(1);
  });

  it("applies tempo, repeats (distinct occurrences) and a hand filter", () => {
    const warmup = fiveFinger();
    const practice = warmupToSteps(warmup, { tempoBpm: 50, repeats: 2, hand: "right" });
    expect(practice.timeline.tempo.bpm).toBe(50);
    expect(practice.steps).toHaveLength(warmup.steps.length * 2);
    const ids = new Set(practice.steps.map((step) => step.occurrenceId));
    expect(ids.size).toBe(practice.steps.length);
    expect(practice.steps.every((step) => step.targets.every((n) => n.hand === "right"))).toBe(true);
    expect(practice.title).toContain("right hand");
  });
});

describe("warmupFeedback", () => {
  it("reports only measured observations and keeps guidance separate", () => {
    const warmup = fiveFinger();
    const attacks = [
      { midi: 48, velocity: 60, timestampMs: 0 },
      { midi: 60, velocity: 70, timestampMs: 12 },
      { midi: 50, velocity: 64, timestampMs: 1000 },
      { midi: 62, velocity: 66, timestampMs: 1030 }
    ];
    const feedback = warmupFeedback(warmup, attacks, timedResult([-10, 10, 20]));
    const kinds = feedback.measured.map((item) => item.kind);
    expect(kinds).toEqual(["timingSpread", "velocityConsistency", "handSynchrony"]);
    kinds.forEach((kind) => expect(warmup.measuredObservations).toContain(kind));
    const sync = feedback.measured.find((item) => item.kind === "handSynchrony");
    expect(sync?.value).toBe("21 ms apart on average");
    expect(feedback.authoredGuidance).toEqual(warmup.guidance.text);
    expect(feedback.caveat).toBe(WARMUP_CAVEAT);
    expect(feedback.handAttributionNote).toBeTruthy();
    // Guidance text never appears among the measured items.
    feedback.measured.forEach((item) => expect(feedback.authoredGuidance.join(" ")).not.toContain(item.detail));
  });

  it("says what could not be measured instead of inventing values", () => {
    const warmup = fiveFinger();
    const feedback = warmupFeedback(warmup, [{ midi: 60, velocity: 64, timestampMs: 0 }], null);
    expect(feedback.measured).toEqual([]);
    expect(feedback.notMeasured.length).toBe(warmup.measuredObservations.length);
    const noSplit = warmupFeedback({ ...warmup, handAttribution: { kind: "none" } }, [], null);
    expect(noSplit.notMeasured.some((line) => line.includes("Hand synchrony"))).toBe(true);
    expect(noSplit.handAttributionNote).toBeUndefined();
  });
});
