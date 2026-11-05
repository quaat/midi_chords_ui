import { CONTENT_DRAFT_AUTHOR, FOUR_FOUR, PC } from "@/content/authoring";
import type { MelodySpec } from "@/content/authoring";

/**
 * Original four-bar melody for the harmonisation journey (plan E29).
 *
 *   Bar 1: E4 D4 C4 E4   (D is a passing tone)
 *   Bar 2: F4 A4 — F4    (A held two beats)
 *   Bar 3: G4 F4 D4 —    (F is a non-chord tone over plain G since it leaps to D; a chord tone over G7)
 *   Bar 4: E4 — C4 —
 */
export const melodies: MelodySpec[] = [
  {
    id: "mel-four-bar-c",
    version: 1,
    status: "draft",
    title: "Four-bar melody in C (“Stepping Home”)",
    key: { tonic: PC.C, mode: "major" },
    timeSignature: FOUR_FOUR,
    notes: [
      { midi: 64, startBeat: 0, durationBeats: 1, degree: "3" },
      { midi: 62, startBeat: 1, durationBeats: 1, degree: "2" },
      { midi: 60, startBeat: 2, durationBeats: 1, degree: "1" },
      { midi: 64, startBeat: 3, durationBeats: 1, degree: "3" },
      { midi: 65, startBeat: 4, durationBeats: 1, degree: "4" },
      { midi: 69, startBeat: 5, durationBeats: 2, degree: "6" },
      { midi: 65, startBeat: 7, durationBeats: 1, degree: "4" },
      { midi: 67, startBeat: 8, durationBeats: 1, degree: "5" },
      { midi: 65, startBeat: 9, durationBeats: 1, degree: "4" },
      { midi: 62, startBeat: 10, durationBeats: 2, degree: "2" },
      { midi: 64, startBeat: 12, durationBeats: 2, degree: "3" },
      { midi: 60, startBeat: 14, durationBeats: 2, degree: "1" },
    ],
    harmonicRhythmBeats: 4,
    palette: ["C", "Dm", "Em", "F", "G", "Am", "G7", "C/E", "F/A"],
    solutions: [
      {
        id: "sol-plain",
        label: "Plain cadence",
        chords: ["C", "F", "G7", "C"],
        explanation: [
          "Every strong-beat melody note is a chord tone: E over C, F over F, G over G7, E over C.",
          "Bass C–F–G–C: the roots outline I–IV–V–I, and G7 → C gives a full close.",
          "In bar 3 the F is the seventh of G7, so it is a chord tone rather than a passing tone.",
        ],
      },
      {
        id: "sol-minor-colour",
        label: "Minor colour",
        chords: ["Am", "Dm", "G7", "C"],
        explanation: [
          "Am and Dm share the melody's main notes (C and E in bar 1; F and A in bar 2), so the tune is unchanged but the start sounds darker.",
          "Bass A–D–G–C falls by fifths each bar, a strong forward pull towards the final C.",
          "The phrase still ends with the same V7–I close as the plain solution.",
        ],
      },
      {
        id: "sol-rising-bass",
        label: "Rising bass",
        chords: ["C/E", "F", "G", "C"],
        explanation: [
          "Putting E in the bass under the first chord makes the bass climb by step: E–F–G before landing on C.",
          "Over plain G (no seventh) the F in bar 3 is a non-chord tone: it steps down from G but then leaps to D, so it is heard as a colour note rather than a passing tone.",
          "The slash chord changes only the bass; the harmony of bar 1 is still C major.",
        ],
      },
    ],
    assumptions: [
      "Style: simple pop/folk harmonisation; one chord per bar, fixed.",
      "Strong-beat melody notes (beats 1 and 3) are expected to be chord tones.",
      "Stepwise notes on weak beats between chord tones are accepted as passing tones; no other non-chord-tone analysis is applied.",
      "Classical part-writing rules (parallel fifths, doubling) are not treated as constraints for this activity.",
      "The melody and its rhythm stay fixed while solutions are compared.",
    ],
    conceptIds: ["harmonising-melody", "harmonising-scale"],
    author: CONTENT_DRAFT_AUTHOR,
  },
];
