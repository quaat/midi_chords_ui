import type { ExerciseSpec } from "@/content/authoring";
import { ROOTLESS_II_V_I_C_STEPS } from "@/content/exercises";
import type { AnswerPolicy, TimingPolicy } from "@/model/contracts";

export const STEP: TimingPolicy = { mode: "step", assemblyWindowMs: 60 };
export const TIMED: TimingPolicy = { mode: "timed", onsetWindowMs: 120, countInBeats: 4, assemblyWindowMs: 60 };

export function baseSpec(overrides: Partial<ExerciseSpec>): ExerciseSpec {
  const policy: AnswerPolicy = { kind: "exactVoicing" };
  return {
    id: "ex-test",
    version: 1,
    title: "Test exercise",
    objective: "Test",
    conceptIds: ["concept-test"],
    prerequisites: [],
    contract: "reproduce",
    demand: "beginner",
    status: "draft",
    key: { tonic: { letter: "C", accidental: 0 }, mode: "major" },
    tempoBpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    timing: STEP,
    policy,
    material: { kind: "singleNotes", prompts: [{ label: "Middle C", midi: 60 }] },
    hintLadder: ["Look at the keyboard.", "Find the group of two black keys."],
    ...overrides
  };
}

export function rootlessSpec(overrides: Partial<ExerciseSpec> = {}): ExerciseSpec {
  return baseSpec({
    id: "ex-rootless",
    title: "Rootless ii–V–I",
    contract: "reproduce",
    policy: { kind: "exactVoicing" },
    material: { kind: "explicitNotes", steps: ROOTLESS_II_V_I_C_STEPS },
    transferKeys: [
      { letter: "F", accidental: 0 },
      { letter: "B", accidental: -1 }
    ],
    ...overrides
  });
}
