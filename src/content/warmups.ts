import { CONTENT_DRAFT_AUTHOR, FOUR_FOUR, PC } from "@/content/authoring";
import type { AuthoredNote, WarmupSpec, WarmupStep } from "@/content/authoring";

/**
 * Warm-ups (plan E28). None is pianist-reviewed yet (`reviewed: false`), so the UI must not
 * display finger numbers for them; fingering appears only inside the clearly marked
 * authored-guidance text.
 */

function both(left: number, right: number, beats: number): WarmupStep {
  const notes: AuthoredNote[] = [
    { midi: left, hand: "left" },
    { midi: right, hand: "right" },
  ];
  return { notes, durationBeats: beats };
}

function single(midi: number, beats: number): WarmupStep {
  return { notes: [{ midi, hand: "right" }], durationBeats: beats };
}

const REGISTER_SPLIT_NOTE: string =
  "Task assumption: notes below middle C (MIDI 60) are attributed to the left hand, notes at or above to the right. MIDI does not report which hand played.";

export const warmups: WarmupSpec[] = [
  {
    id: "wu-five-finger-c",
    version: 1,
    title: "Five-finger C position, hands an octave apart",
    objective: "Play C–D–E–F–G and back with both hands together, one octave apart, at an even pulse.",
    conceptIds: ["five-finger-warmup"],
    demand: "beginner",
    status: "draft",
    tempoBpm: 60,
    timeSignature: FOUR_FOUR,
    hands: "both",
    // Left C3..G3, right C4..G4, up and down (C D E F G F E D C), last note held two beats.
    steps: [
      both(48, 60, 1),
      both(50, 62, 1),
      both(52, 64, 1),
      both(53, 65, 1),
      both(55, 67, 1),
      both(53, 65, 1),
      both(52, 64, 1),
      both(50, 62, 1),
      both(48, 60, 2),
    ],
    reviewed: false,
    handAttribution: { kind: "registerSplit", splitMidi: 60, note: REGISTER_SPLIT_NOTE },
    guidance: {
      kind: "authoredGuidance",
      text: [
        "Authored guidance, not measured: one finger per key — right thumb on C4, left little finger on C3.",
        "Let the fingers drop from a relaxed hand; keep the wrist level and loose. Stop and rest if anything feels tight.",
        "This fingering suggestion has not yet been reviewed by a pianist.",
      ],
    },
    measuredObservations: ["timingSpread", "velocityConsistency", "handSynchrony"],
    variations: [
      { label: "Right hand only", guidance: "Play the right-hand line alone first if coordinating both hands is new." },
      { label: "Soft then loud", guidance: "Play once softly and once louder; the app reports the velocity difference it measured." },
    ],
    transferKeys: [PC.G, PC.F],
    author: CONTENT_DRAFT_AUTHOR,
  },
  {
    id: "wu-contrary-five",
    version: 1,
    title: "Contrary motion, five notes",
    objective: "Start both hands on C and move outward in mirror image for five notes, then return.",
    conceptIds: ["contrary-motion"],
    demand: "beginner",
    status: "draft",
    tempoBpm: 60,
    timeSignature: FOUR_FOUR,
    hands: "both",
    // Left C3 B2 A2 G2 F2 (down), right C4 D4 E4 F4 G4 (up), and back.
    steps: [
      both(48, 60, 1),
      both(47, 62, 1),
      both(45, 64, 1),
      both(43, 65, 1),
      both(41, 67, 1),
      both(43, 65, 1),
      both(45, 64, 1),
      both(47, 62, 1),
      both(48, 60, 2),
    ],
    reviewed: false,
    handAttribution: { kind: "registerSplit", splitMidi: 60, note: REGISTER_SPLIT_NOTE },
    guidance: {
      kind: "authoredGuidance",
      text: [
        "Authored guidance, not measured: both thumbs start on C (right on C4, left on C3), and the same finger number plays in each hand at the same time.",
        "Keep the movement small and even. The left hand crosses no keys; it simply walks down the white keys.",
        "This fingering suggestion has not yet been reviewed by a pianist.",
      ],
    },
    measuredObservations: ["timingSpread", "handSynchrony"],
    author: CONTENT_DRAFT_AUTHOR,
  },
  {
    id: "wu-broken-triad-c",
    version: 1,
    title: "Broken triad C–E–G–E",
    objective: "Play the broken C major triad C–E–G–E twice, first legato and then staccato.",
    conceptIds: ["articulation-dynamics", "triads-major-minor"],
    demand: "beginner",
    status: "draft",
    tempoBpm: 66,
    timeSignature: FOUR_FOUR,
    hands: "right",
    steps: [single(60, 1), single(64, 1), single(67, 1), single(64, 1), single(60, 1), single(64, 1), single(67, 1), single(64, 1), single(60, 4)],
    reviewed: false,
    handAttribution: { kind: "none" },
    guidance: {
      kind: "authoredGuidance",
      text: [
        "Authored guidance, not measured: a common choice is thumb on C, middle finger on E and little finger on G.",
        "First bar legato (connect the notes), second bar staccato (let each key spring back). Keep the forearm relaxed.",
        "This fingering suggestion has not yet been reviewed by a pianist.",
      ],
    },
    measuredObservations: ["timingSpread", "velocityConsistency", "releaseOverlap"],
    variations: [
      { label: "Crescendo", guidance: "Grow louder through the first bar; the app reports whether your measured velocities rose." },
      { label: "Left hand", guidance: "Play the same notes an octave lower with the left hand." },
    ],
    transferKeys: [PC.F, PC.G],
    author: CONTENT_DRAFT_AUTHOR,
  },
];
