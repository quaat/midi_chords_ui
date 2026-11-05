import type {
  ChordDefinition,
  MusicalSequence,
  SequenceEvent,
  VoicedNote,
  VoicingInstance
} from "@/model/contracts";
import type { SchedulerClock } from "@/timeline/clock";

export function chordEvent(id: string, index: number, symbol: string, startBeat: number, durationBeats: number): SequenceEvent {
  return { id, index, kind: "chord", symbol, startBeat, durationBeats };
}

export function restEvent(id: string, index: number, startBeat: number, durationBeats: number): SequenceEvent {
  return { id, index, kind: "rest", symbol: "NC", startBeat, durationBeats };
}

export function makeSequence(events: SequenceEvent[], bpm = 120, numerator = 4): MusicalSequence {
  const totalBeats = events.reduce((max, event) => Math.max(max, event.startBeat + event.durationBeats), 0);
  return {
    id: "seq1",
    version: 3,
    tempo: { bpm },
    timeSignature: { numerator, denominator: 4 },
    events,
    totalBeats
  };
}

export const C_MAJOR: ChordDefinition = {
  symbol: "C",
  root: { letter: "C", accidental: 0 },
  quality: "maj",
  qualityLabel: "Major",
  degrees: [
    { label: "1", interval: { number: 1, quality: "P" }, semitones: 0, role: "root", essential: false },
    { label: "3", interval: { number: 3, quality: "M" }, semitones: 4, role: "third", essential: true },
    { label: "5", interval: { number: 5, quality: "P" }, semitones: 7, role: "fifth", essential: false }
  ],
  extensions: [],
  alterations: [],
  added: []
};

function voiced(midi: number, letter: "C" | "E" | "G", octave: number, degree: string, role: "root" | "third" | "fifth", voiceId: string): VoicedNote {
  return { midi, spelled: { letter, accidental: 0, octave }, degree, role, hand: "right", voiceId };
}

/** C major first inversion E4 G4 C5 with an accompaniment bass C2. */
export const C_MAJOR_VOICING: VoicingInstance = {
  id: "v-c",
  chord: C_MAJOR,
  recipeId: "closeTriad",
  notes: [voiced(72, "C", 5, "1", "root", "v3"), voiced(64, "E", 4, "3", "third", "v1"), voiced(67, "G", 4, "5", "fifth", "v2")],
  omitted: [],
  accompanimentBass: { midi: 36, spelled: { letter: "C", accidental: 0, octave: 2 }, degree: "1", role: "root", hand: "left", voiceId: "bass" },
  explanation: ["First inversion"]
};

/** Clock backed by the (fake) global timers and performance.now(). */
export function fakeClock(): SchedulerClock {
  return {
    now: (): number => performance.now(),
    setTimeout: (callback: () => void, ms: number): unknown => setTimeout(callback, ms),
    clearTimeout: (handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>)
  };
}
