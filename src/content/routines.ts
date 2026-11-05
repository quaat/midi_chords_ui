import type { PracticeRoutine } from "@/model/contracts";
import { PC, draftMeta } from "@/content/authoring";

/**
 * Bounded routine presets (plan E28). Tempo increases are always learner-controlled;
 * completing a routine is not treated as evidence of mastery or healthy technique.
 */
export const routines: PracticeRoutine[] = [
  {
    id: "routine-starter-15",
    version: 1,
    title: "Starter routine (15 min)",
    description:
      "Warm up, play a scale run, apply a ii–V–I, then play section A of Evening Loop. About 15 minutes; each item keeps its own settings.",
    items: [
      {
        id: "rs15-1-warmup",
        kind: "warmup",
        refId: "wu-five-finger-c",
        settings: { key: PC.C, tempoBpm: 60, hand: "both", repeats: 2, assistance: "full", durationTargetSec: 180 },
      },
      {
        id: "rs15-2-scale",
        kind: "exercise",
        refId: "ex-c-major-run",
        settings: { key: PC.C, tempoBpm: 70, hand: "right", range: { low: 60, high: 72 }, repeats: 3, assistance: "reduced", durationTargetSec: 240 },
      },
      {
        id: "rs15-3-harmony",
        kind: "exercise",
        refId: "ex-ii-v-i-shells-c",
        settings: { key: PC.C, tempoBpm: 72, hand: "either", repeats: 4, assistance: "reduced", durationTargetSec: 240 },
      },
      {
        id: "rs15-4-song",
        kind: "chart",
        refId: "evening-loop",
        settings: { key: PC.C, tempoBpm: 80, hand: "either", repeats: 2, assistance: "full", sectionId: "A", durationTargetSec: 240 },
      },
    ],
    meta: draftMeta(),
  },
];
