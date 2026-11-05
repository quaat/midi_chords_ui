import type { ArrangementDefinition, ChartBar, ChordSpan, SongChart } from "@/model/contracts";
import { CONTENT_DRAFT_AUTHOR, FOUR_FOUR, PC, draftMeta } from "@/content/authoring";

/** One-chord 4/4 bar. Span IDs are `${barId}-s1`. */
function bar(id: string, symbol: string, romanNumeral?: string): ChartBar {
  const span: ChordSpan = { id: `${id}-s1`, symbol, startBeat: 0, durationBeats: 4 };
  if (romanNumeral) span.romanNumeral = romanNumeral;
  return { id, spans: [span] };
}

/** Two-chord 4/4 bar, two beats each. Span IDs are `${barId}-s1`, `${barId}-s2`. */
function splitBar(id: string, first: [string, string], second: [string, string]): ChartBar {
  return {
    id,
    spans: [
      { id: `${id}-s1`, symbol: first[0], romanNumeral: first[1], startBeat: 0, durationBeats: 2 },
      { id: `${id}-s2`, symbol: second[0], romanNumeral: second[1], startBeat: 2, durationBeats: 2 },
    ],
  };
}

/**
 * Evening Loop — original pop/folk chart in C.
 * A: | C | G/B | Am | F  G |    B: | F | C/E | Dm | G |    Order: A A B A
 */
export const eveningLoop: SongChart = {
  id: "evening-loop",
  version: 1,
  title: "Evening Loop",
  composer: CONTENT_DRAFT_AUTHOR,
  key: { tonic: PC.C, mode: "major" },
  timeSignature: FOUR_FOUR,
  tempo: { bpm: 84 },
  sections: [
    {
      id: "A",
      label: "A",
      bars: [bar("el-a1", "C", "I"), bar("el-a2", "G/B", "V6"), bar("el-a3", "Am", "vi"), splitBar("el-a4", ["F", "IV"], ["G", "V"])],
    },
    {
      id: "B",
      label: "B",
      bars: [bar("el-b1", "F", "IV"), bar("el-b2", "C/E", "I6"), bar("el-b3", "Dm", "ii"), bar("el-b4", "G", "V")],
    },
  ],
  performanceOrder: ["A", "A", "B", "A"],
  provenance: { origin: "original", author: CONTENT_DRAFT_AUTHOR, note: "Written for this app; free to use within it." },
  arrangementIds: ["evening-loop-simple", "evening-loop-richer", "evening-loop-chart-only"],
  meta: draftMeta(),
};

/**
 * Dorian Drift — original D Dorian modal vamp.
 * Pickup: 2 beats NC.  A: | Dm7 | Em7 | Dm7 | Em7 | Dm7 | G7 | Em7  G7 | Dm7 |    Order: pickup A A
 */
export const dorianDrift: SongChart = {
  id: "dorian-drift",
  version: 1,
  title: "Dorian Drift",
  composer: CONTENT_DRAFT_AUTHOR,
  key: { tonic: PC.D, mode: "dorian" },
  timeSignature: FOUR_FOUR,
  tempo: { bpm: 92 },
  pickupBeats: 2,
  sections: [
    {
      id: "pickup",
      label: "Pickup",
      bars: [{ id: "dd-p1", beats: 2, spans: [{ id: "dd-p1-s1", symbol: "NC", startBeat: 0, durationBeats: 2, isRest: true }] }],
    },
    {
      id: "A",
      label: "A",
      bars: [
        bar("dd-a1", "Dm7", "i7"),
        bar("dd-a2", "Em7", "ii7"),
        bar("dd-a3", "Dm7", "i7"),
        bar("dd-a4", "Em7", "ii7"),
        bar("dd-a5", "Dm7", "i7"),
        bar("dd-a6", "G7", "IV7"),
        splitBar("dd-a7", ["Em7", "ii7"], ["G7", "IV7"]),
        bar("dd-a8", "Dm7", "i7"),
      ],
    },
  ],
  performanceOrder: ["pickup", "A", "A"],
  provenance: { origin: "original", author: CONTENT_DRAFT_AUTHOR, note: "Written for this app; free to use within it." },
  arrangementIds: ["dorian-drift-simple", "dorian-drift-chart-only"],
  meta: draftMeta(),
};

export const charts: SongChart[] = [eveningLoop, dorianDrift];

export const arrangements: ArrangementDefinition[] = [
  {
    id: "evening-loop-simple",
    chartId: "evening-loop",
    name: "Simple: bass notes",
    description:
      "Play one bass note per chord with the left hand while the accompaniment sustains the chords. For slash chords play the written bass (B under G/B, E under C/E).",
    demand: "beginner",
    learnerPart: { kind: "roots", hand: "left", register: { low: 36, high: 55 } },
    accompaniment: { pattern: "sustained", register: { low: 55, high: 76 } },
    policy: { kind: "pitchClass" },
    meta: draftMeta(),
  },
  {
    id: "evening-loop-richer",
    chartId: "evening-loop",
    name: "Richer: right-hand triads",
    description:
      "Play close-position triads in the right hand, choosing inversions for small moves, over a bass-and-chord accompaniment. Any inversion with root, third and fifth is accepted.",
    demand: "intermediate",
    learnerPart: { kind: "voicingRecipe", voicingRecipeId: "close-triads-rh", hand: "right", register: { low: 59, high: 79 } },
    accompaniment: { pattern: "bassAndChord", register: { low: 36, high: 58 } },
    policy: { kind: "roles", requiredRoles: ["root", "third", "fifth"], octaveFree: true },
    meta: draftMeta(),
  },
  {
    id: "evening-loop-chart-only",
    chartId: "evening-loop",
    name: "Chart only: comp freely",
    description: "Read the symbols and comp however you like. Nothing is scored; record and replay to reflect.",
    demand: "intermediate",
    learnerPart: { kind: "chartOnly" },
    accompaniment: { pattern: "rootOnly", register: { low: 36, high: 52 } },
    policy: { kind: "free" },
    meta: draftMeta(),
  },
  {
    id: "dorian-drift-simple",
    chartId: "dorian-drift",
    name: "Simple: block triads",
    description: "Play the triad of each chord (Dm, Em, G) as a block chord on beat 1 while the accompaniment plays roots.",
    demand: "intermediate",
    learnerPart: { kind: "blockTriads", hand: "right", register: { low: 57, high: 76 } },
    accompaniment: { pattern: "rootOnly", register: { low: 36, high: 52 } },
    policy: { kind: "roles", requiredRoles: ["root", "third", "fifth"], octaveFree: true },
    meta: draftMeta(),
  },
  {
    id: "dorian-drift-chart-only",
    chartId: "dorian-drift",
    name: "Chart only: improvise",
    description: "Improvise a melody with D Dorian over the sustained vamp. Nothing is scored; silence is never a missed note.",
    demand: "intermediate",
    learnerPart: { kind: "chartOnly" },
    accompaniment: { pattern: "sustained", register: { low: 41, high: 65 } },
    policy: { kind: "free" },
    meta: draftMeta(),
  },
];
