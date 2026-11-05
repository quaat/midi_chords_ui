/**
 * Adapter from the shared model to the legacy notation inputs (ResolvedEvent[] + SynthSettings)
 * used by src/notation/generateMusicXml.ts and src/ui/components/SheetMusicView.tsx.
 *
 * Notation shows the HARMONIC REDUCTION: one block chord per sequence event (learner notes of
 * the event's first occurrence in a block-chord timeline). Arpeggios and accompaniment patterns
 * of the performed arrangement are deliberately not written out.
 */
import type { MusicalSequence, PerformanceTimeline } from "@/model/contracts";
import type { ResolvedEvent, SynthSettings } from "@/types";
import { beatsPerBar } from "@/music/legacy";
import { midiToNoteName } from "@/ui/piano/pianoLabels";

export const NOTATION_TICKS_PER_BEAT = 480;

export const NOTATION_RELATIONSHIP_LABEL =
  "Notation shows the harmonic reduction of each chord, not the performed arrangement (arpeggio/accompaniment).";

export function notationSettings(sequence: MusicalSequence): SynthSettings {
  return {
    tempoBpm: sequence.tempo.bpm,
    timeSignature: { numerator: sequence.timeSignature.numerator, denominator: sequence.timeSignature.denominator },
    defaultChordMeasures: 1,
    ticksPerBeat: NOTATION_TICKS_PER_BEAT,
    midiChannel: 1,
    velocity: 92,
    program: 1,
    baseOctave: 4,
    bassOctave: 2,
    voicingMode: "close",
    arpeggiateOctaves: 0,
    voiceLeading: true,
    maxSpread: 30,
    minNote: 24,
    maxNote: 96
  };
}

/**
 * One ResolvedEvent per sequence event, in start order. `blockTimeline` should be compiled with
 * arpeggiate 0 so the learner notes of `<eventId>#0` are the chord as a block; accompaniment
 * notes are ignored. Events without notes in the timeline are written as rests.
 */
export function notationEventsFromSequence(sequence: MusicalSequence, blockTimeline: PerformanceTimeline | null): ResolvedEvent[] {
  const tpb = NOTATION_TICKS_PER_BEAT;
  const bar = beatsPerBar(sequence.timeSignature);
  const secondsPerBeat = 60 / (sequence.tempo.bpm > 0 ? sequence.tempo.bpm : 120);
  const notesByOccurrence = new Map<string, number[]>();
  if (blockTimeline) {
    blockTimeline.notes.forEach((note) => {
      if (note.part !== "learner") {
        return;
      }
      const list = notesByOccurrence.get(note.occurrenceId) ?? [];
      if (!list.includes(note.midi)) {
        list.push(note.midi);
      }
      notesByOccurrence.set(note.occurrenceId, list);
    });
  }
  const ordered = [...sequence.events].sort((a, b) => a.startBeat - b.startBeat || a.index - b.index);
  return ordered.map((event, index) => {
    const midi = (notesByOccurrence.get(`${event.id}#0`) ?? []).slice().sort((a, b) => a - b);
    const isRest = event.kind === "rest" || midi.length === 0;
    return {
      index,
      line: event.sourceLine ?? index + 1,
      chordSymbol: event.kind === "rest" ? "NC" : event.symbol,
      isRest,
      noteNumbers: isRest ? [] : midi,
      noteNames: isRest ? [] : midi.map((value) => midiToNoteName(value, { withOctave: true, unicode: false })),
      startTick: Math.round(event.startBeat * tpb),
      durationTicks: Math.round(event.durationBeats * tpb),
      startSeconds: event.startBeat * secondsPerBeat,
      durationSeconds: event.durationBeats * secondsPerBeat,
      durationMeasures: bar > 0 ? event.durationBeats / bar : 1
    };
  });
}

/** Index (into notationEventsFromSequence's output) of the event with `eventId`, or null. */
export function notationIndexOfEvent(sequence: MusicalSequence, eventId: string | null): number | null {
  if (eventId === null) {
    return null;
  }
  const ordered = [...sequence.events].sort((a, b) => a.startBeat - b.startBeat || a.index - b.index);
  const index = ordered.findIndex((event) => event.id === eventId);
  return index >= 0 ? index : null;
}
