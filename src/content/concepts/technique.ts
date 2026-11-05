import type { ConceptDefinition } from "@/model/contracts";
import { draftMeta } from "@/content/authoring";

/**
 * Warm-ups and technique strand (plan E28).
 *
 * Wording rule: every page separates **authored guidance** (fingering, relaxation, posture —
 * which MIDI cannot observe) from **measured observations** (timing spread, velocity
 * consistency, release overlap — which the app can report from MIDI input).
 */
export const techniqueConcepts: ConceptDefinition[] = [
  {
    id: "five-finger-warmup",
    title: "Five-finger warm-up",
    summary: "Five neighbouring notes under five fingers: a short, even pattern to start a session.",
    explanation: [
      "Authored guidance (not measured): place one finger on each of C, D, E, F and G, with the thumb on C in the right hand and the little finger on C in the left. Keep the hand loose and let each finger fall rather than push. Stop if anything feels strained.",
      "Measured observations: after the warm-up the app can report how evenly spaced your note onsets were (timing spread) and how similar your key velocities were (velocity consistency). These come directly from MIDI.",
      "What the app cannot see: hand shape, wrist height, tension and which finger you used. Completing the pattern quickly is not evidence of healthy technique; ask a teacher if you are unsure.",
    ],
    strand: "technique",
    demand: ["beginner"],
    tags: ["warm-up", "five finger", "technique", "evenness", "velocity", "timing spread"],
    prerequisites: ["keyboard-geography"],
    examples: [
      {
        id: "ff-c-position",
        label: "C position, up and down",
        kind: "melody",
        midi: [60, 62, 64, 65, 67, 65, 64, 62, 60],
        labels: ["1", "2", "3", "4", "5", "4", "3", "2", "1"],
      },
    ],
    exerciseIds: ["wu-five-finger-c"],
    applications: [{ label: "First item of the starter routine", conceptId: "scale-patterns-runs" }],
    related: ["contrary-motion", "articulation-dynamics"],
    glossary: [
      { term: "Timing spread", definition: "A measured statistic: how much your note onsets vary around the target beat." },
      { term: "Velocity consistency", definition: "A measured statistic: how similar the key velocities (loudness) of your notes are." },
      { term: "Authored guidance", definition: "Advice written by the content author, such as fingering or relaxation tips; the app does not measure it." },
    ],
    meta: draftMeta(),
  },
  {
    id: "contrary-motion",
    title: "Contrary motion",
    summary: "Both hands start on the same note and move outward in mirror image, so each finger matches its partner.",
    explanation: [
      "Authored guidance (not measured): start with the right thumb on middle C (C4) and the left thumb on the C an octave below (C3), then move outward note by note. The same finger number plays in both hands at once, which many players find easier than parallel motion.",
      "Measured observations: the app can report hand synchrony, meaning how close together the two hands' notes start, but only under the declared assumption that notes below middle C are the left hand. MIDI does not say which hand played a key.",
      "Begin slowly with a metronome. Increase tempo only when you choose to; the app may suggest it, but it is always optional and reversible.",
    ],
    strand: "technique",
    demand: ["beginner", "intermediate"],
    tags: ["contrary motion", "both hands", "coordination", "synchrony", "warm-up"],
    prerequisites: ["five-finger-warmup"],
    examples: [
      {
        id: "cm-five",
        label: "Contrary five notes from C",
        kind: "melody",
        midi: [48, 60, 47, 62, 45, 64, 43, 65, 41, 67],
        description: "Pairs played together: C3+C4, B2+D4, A2+E4, G2+F4, F2+G4.",
      },
    ],
    exerciseIds: ["wu-contrary-five"],
    applications: [{ label: "Coordinate hands for bass-and-chord accompaniment", conceptId: "accompaniment-patterns" }],
    related: ["five-finger-warmup", "accompaniment-patterns"],
    glossary: [
      { term: "Contrary motion", definition: "Two parts moving in opposite directions." },
      { term: "Hand synchrony", definition: "A measured statistic: how closely the two hands' simultaneous notes start, under a declared hand-split assumption." },
    ],
    meta: draftMeta(),
  },
  {
    id: "articulation-dynamics",
    title: "Articulation and dynamics patterns",
    summary: "Play the same notes legato or staccato, loud or soft; the app reports what MIDI shows about releases and velocities.",
    explanation: [
      "Articulation is how notes connect. Legato means each note is held until the next begins; staccato means short, detached notes. Dynamics are how loud you play.",
      "Measured observations: the app can report release overlap (whether a note was released before or after the next one started) and velocity patterns (for example, whether a planned crescendo actually rose). Note that digital pianos map key speed to velocity differently.",
      "Authored guidance (not measured): for staccato, let the key bounce back from a relaxed finger rather than snatching it away; for soft playing, start closer to the key. These are suggestions only; the app cannot observe motion or tone production.",
    ],
    strand: "technique",
    demand: ["intermediate"],
    tags: ["articulation", "legato", "staccato", "dynamics", "velocity", "release overlap"],
    prerequisites: ["five-finger-warmup"],
    examples: [
      {
        id: "art-broken-triad",
        label: "Broken triad C–E–G–E",
        kind: "melody",
        midi: [60, 64, 67, 64, 60, 64, 67, 64],
        labels: ["1", "3", "5", "3", "1", "3", "5", "3"],
        description: "Play once legato, once staccato; then once soft and once loud.",
      },
    ],
    exerciseIds: ["wu-broken-triad-c", "wu-five-finger-c"],
    applications: [{ label: "Vary the texture of Evening Loop", chartId: "evening-loop" }],
    related: ["five-finger-warmup", "accompaniment-patterns"],
    glossary: [
      { term: "Legato", definition: "Smoothly connected notes." },
      { term: "Staccato", definition: "Short, detached notes." },
      { term: "Release overlap", definition: "A measured statistic: the time between one note's release and the next note's start." },
    ],
    meta: draftMeta(),
  },
];
