/**
 * Performance-timeline compiler (plan E10).
 *
 * Turns an authored `MusicalSequence` (beats, chords, chosen voicings) into the single list of
 * `PerformedNote`s that audio playback, keyboard highlighting, MIDI export and the falling-note
 * stage all consume. Arpeggios, accompaniment and metronome clicks are compiled into real onsets
 * and durations in BEATS here, so nothing downstream re-derives timing.
 *
 * Pure and deterministic: no React, no audio, no clocks.
 */
import type {
  AccompanimentPatternId,
  ChordDefinition,
  ChordRole,
  DegreeLabel,
  Hand,
  MusicalSequence,
  PartId,
  PerformanceOccurrence,
  PerformanceTimeline,
  PerformedNote,
  SequenceEvent,
  SpelledNote,
  SpelledPitchClass,
  VoicedNote
} from "@/model/contracts";
import type { ArpeggiateOctaves, SynthSettings } from "@/types";
import { buildArpeggiatedNotes } from "@/playback/arpeggiation";
import { buildMetronomeNotes } from "@/playback/metronome";
import { beatsPerBar } from "@/timeline/clock";
import { parseChordSymbol } from "@/theory/chordParser";
import { buildVoicing } from "@/theory/voicing";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Legacy/fallback voicing for events without a concrete `VoicingInstance`. */
export interface FallbackVoicing {
  midi: number[];
  /** Root pitch class 0..11 (used by accompaniment patterns). */
  rootPc?: number;
  /** Slash-bass pitch class 0..11. */
  bassPc?: number;
}

/**
 * Produces learner notes for a chord event that has no `voicing`. `previousMidi` is the previous
 * chord's learner notes (for voice leading). Return null when the symbol cannot be voiced; the
 * event is then skipped with a warning.
 */
export type FallbackVoicer = (event: SequenceEvent, previousMidi?: number[]) => FallbackVoicing | null;

export interface CompileTimelineOptions {
  /** 0 = block chords; 1..3 = ascending arpeggio over that many octaves. Default 0. */
  arpeggiate?: ArpeggiateOctaves;
  /** Learner-part velocity 1..127. Default 96. */
  velocity?: number;
  /** Accompaniment pattern compiled into part "accompaniment". Default "none". */
  accompaniment?: AccompanimentPatternId;
  /** Accompaniment velocity. Default 80% of `velocity`. */
  accompanimentVelocity?: number;
  /**
   * Emit a voicing's `accompanimentBass` as an accompaniment note (sustained for the event) even
   * when the pattern is "none"/"sustained". Patterns with their own bass use it as the bass pitch.
   * Default true.
   */
  includeVoicingBass?: boolean;
  /** Compile metronome clicks (part "metronome") on every beat. Default false. */
  metronome?: boolean;
  /** Number of passes through the sequence. Each pass yields distinct occurrence IDs. Default 1. */
  repeats?: number;
  /** Count-in recorded on the timeline (no notes are created before beat 0). Default 0. */
  countInBeats?: number;
  /** Tempo override; default the sequence tempo. */
  tempoBpm?: number;
  /** Default: legacy chordParser + close voicing (base octave 4, bass octave 2, range 24..96, voice leading). */
  fallbackVoicer?: FallbackVoicer;
  timelineId?: string;
  arrangementId?: string;
}

export interface CompileTimelineResult {
  timeline: PerformanceTimeline;
  /** Non-blocking problems (unparseable symbols, empty voicings). */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Constants and small helpers
// ---------------------------------------------------------------------------

const DEFAULT_VELOCITY = 96;
const EPSILON = 1e-6;
const PART_ORDER: Record<PartId, number> = { learner: 0, accompaniment: 1, demonstration: 2, metronome: 3 };

const LETTER_PC: Record<SpelledPitchClass["letter"], number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Legacy voicing settings used by the default fallback voicer. */
export const LEGACY_FALLBACK_SETTINGS: Pick<
  SynthSettings,
  "baseOctave" | "bassOctave" | "voicingMode" | "maxSpread" | "minNote" | "maxNote" | "voiceLeading"
> = {
  baseOctave: 4,
  bassOctave: 2,
  voicingMode: "close",
  maxSpread: 30,
  minNote: 24,
  maxNote: 96,
  voiceLeading: true
};

function mod12(value: number): number {
  return ((value % 12) + 12) % 12;
}

export function spelledPcToPc(pc: SpelledPitchClass): number {
  return mod12(LETTER_PC[pc.letter] + pc.accidental);
}

function clampVelocity(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_VELOCITY;
  }
  return Math.min(127, Math.max(1, Math.round(value)));
}

function isValidMidi(midi: number): boolean {
  return Number.isFinite(midi) && midi >= 0 && midi <= 127;
}

/** Default fallback voicer: the legacy parser + voicing engine. */
export const legacyFallbackVoicer: FallbackVoicer = (event: SequenceEvent, previousMidi?: number[]): FallbackVoicing | null => {
  try {
    const description = parseChordSymbol(event.symbol);
    const voiced = buildVoicing(description, LEGACY_FALLBACK_SETTINGS, previousMidi);
    return { midi: voiced.notes, rootPc: description.rootPc, bassPc: description.bassPc };
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Note seeds (pitch + teaching metadata, no timing yet)
// ---------------------------------------------------------------------------

interface NoteSeed {
  midi: number;
  spelled?: SpelledNote;
  degree?: DegreeLabel;
  role?: ChordRole;
  hand?: Hand;
  finger?: number;
}

interface ResolvedHarmony {
  learner: NoteSeed[];
  rootPc: number;
  bassPc?: number;
  /** Complete chord pitch classes for accompaniment (even when the learner voicing omits some). */
  chordPcs: number[];
  /** Explicit accompaniment bass from the voicing, when present. */
  voicingBass?: NoteSeed;
  chord?: ChordDefinition;
}

function seedFromVoicedNote(note: VoicedNote): NoteSeed {
  const seed: NoteSeed = { midi: note.midi, spelled: note.spelled, degree: note.degree, role: note.role, hand: note.hand };
  if (note.finger !== undefined) {
    seed.finger = note.finger;
  }
  return seed;
}

function chordPitchClasses(chord: ChordDefinition): number[] {
  const rootPc = spelledPcToPc(chord.root);
  const pcs: number[] = [];
  chord.degrees.forEach((degree) => {
    const pc = mod12(rootPc + degree.semitones);
    if (!pcs.includes(pc)) {
      pcs.push(pc);
    }
  });
  if (!pcs.includes(rootPc)) {
    pcs.unshift(rootPc);
  }
  return pcs;
}

function uniquePcs(midi: number[]): number[] {
  const pcs: number[] = [];
  midi.forEach((m) => {
    const pc = mod12(m);
    if (!pcs.includes(pc)) {
      pcs.push(pc);
    }
  });
  return pcs;
}

function resolveHarmony(
  event: SequenceEvent,
  previousMidi: number[] | undefined,
  voicer: FallbackVoicer,
  warnings: string[]
): ResolvedHarmony | null {
  const voicing = event.voicing;
  if (voicing) {
    const learner = voicing.notes.filter((note) => isValidMidi(note.midi)).map(seedFromVoicedNote);
    const chord = voicing.chord;
    const harmony: ResolvedHarmony = {
      learner,
      rootPc: spelledPcToPc(chord.root),
      chordPcs: chordPitchClasses(chord),
      chord
    };
    if (chord.bass) {
      harmony.bassPc = spelledPcToPc(chord.bass);
    }
    if (voicing.accompanimentBass && isValidMidi(voicing.accompanimentBass.midi)) {
      harmony.voicingBass = seedFromVoicedNote(voicing.accompanimentBass);
    }
    return harmony;
  }

  const fallback = voicer(event, previousMidi);
  if (!fallback) {
    warnings.push(`Event ${event.id} ("${event.symbol}") could not be voiced and was skipped.`);
    return null;
  }
  const midi = fallback.midi.filter(isValidMidi);
  if (midi.length === 0) {
    warnings.push(`Event ${event.id} ("${event.symbol}") produced no playable notes.`);
    return null;
  }
  const chord = event.chord;
  const lowest = Math.min(...midi);
  const rootPc = chord ? spelledPcToPc(chord.root) : fallback.rootPc !== undefined ? mod12(fallback.rootPc) : mod12(lowest);
  const harmony: ResolvedHarmony = {
    learner: midi.map((m) => ({ midi: m })),
    rootPc,
    chordPcs: chord ? chordPitchClasses(chord) : uniquePcs(midi)
  };
  if (chord && chord.bass) {
    harmony.bassPc = spelledPcToPc(chord.bass);
  } else if (fallback.bassPc !== undefined) {
    harmony.bassPc = mod12(fallback.bassPc);
  }
  if (chord) {
    harmony.chord = chord;
  }
  return harmony;
}

// ---------------------------------------------------------------------------
// Timing: block / arpeggio for the learner part
// ---------------------------------------------------------------------------

interface TimedSeed {
  seed: NoteSeed;
  /** Offset from the occurrence start, beats. */
  offset: number;
  duration: number;
}

function transposeSeed(seed: NoteSeed, octaves: number): NoteSeed {
  if (octaves === 0) {
    return seed;
  }
  const out: NoteSeed = { midi: seed.midi + octaves * 12 };
  if (seed.spelled) {
    out.spelled = { letter: seed.spelled.letter, accidental: seed.spelled.accidental, octave: seed.spelled.octave + octaves };
  }
  if (seed.degree !== undefined) {
    out.degree = seed.degree;
  }
  if (seed.role !== undefined) {
    out.role = seed.role;
  }
  if (seed.hand !== undefined) {
    out.hand = seed.hand;
  }
  // Fingering is only reviewed for the written voicing, not for transposed arpeggio copies.
  return out;
}

/**
 * Learner timing. Reuses `buildArpeggiatedNotes` (same ordering and gate math as the legacy
 * scheduler/MIDI export) but in beats, and keeps each note's teaching metadata.
 */
function timeLearnerSeeds(seeds: NoteSeed[], durationBeats: number, octaves: ArpeggiateOctaves): TimedSeed[] {
  const sorted = seeds
    .map((seed, index) => ({ seed, index }))
    .sort((a, b) => (a.seed.midi !== b.seed.midi ? a.seed.midi - b.seed.midi : a.index - b.index))
    .map((entry) => entry.seed);

  const expanded: NoteSeed[] = [];
  if (octaves === 0) {
    sorted.forEach((seed) => expanded.push(seed));
  } else {
    for (let octave = 0; octave < octaves; octave += 1) {
      sorted.forEach((seed) => {
        if (isValidMidi(seed.midi + octave * 12)) {
          expanded.push(transposeSeed(seed, octave));
        }
      });
    }
  }

  const timings = buildArpeggiatedNotes(
    sorted.map((seed) => seed.midi),
    durationBeats,
    octaves,
    0
  );

  const used: boolean[] = expanded.map(() => false);
  const out: TimedSeed[] = [];
  timings.forEach((timing, index) => {
    let seedIndex = -1;
    if (index < expanded.length && !used[index] && expanded[index].midi === timing.note) {
      seedIndex = index;
    } else {
      seedIndex = expanded.findIndex((seed, i) => !used[i] && seed.midi === timing.note);
    }
    const seed: NoteSeed = seedIndex >= 0 ? expanded[seedIndex] : { midi: timing.note };
    if (seedIndex >= 0) {
      used[seedIndex] = true;
    }
    out.push({ seed, offset: timing.startOffset, duration: timing.duration });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Accompaniment patterns
// ---------------------------------------------------------------------------

/** Bass two octaves below the learner's base octave (octave 2, MIDI 36..47). */
const ACCOMPANIMENT_BASS_BASE = 36;
/** Accompaniment chord in octave 3 (root MIDI 48..59), close position above the root. */
const ACCOMPANIMENT_CHORD_BASE = 48;

function accompanimentChordSeeds(harmony: ResolvedHarmony): NoteSeed[] {
  const rootMidi = ACCOMPANIMENT_CHORD_BASE + harmony.rootPc;
  const intervals = harmony.chordPcs.map((pc) => mod12(pc - harmony.rootPc));
  const unique: number[] = [];
  intervals.forEach((interval) => {
    if (!unique.includes(interval)) {
      unique.push(interval);
    }
  });
  unique.sort((a, b) => a - b);
  return unique.map((interval) => ({ midi: rootMidi + interval }));
}

function accompanimentBassSeed(harmony: ResolvedHarmony): NoteSeed {
  if (harmony.voicingBass) {
    return harmony.voicingBass;
  }
  const pc = harmony.bassPc !== undefined ? harmony.bassPc : harmony.rootPc;
  const seed: NoteSeed = { midi: ACCOMPANIMENT_BASS_BASE + pc };
  if (pc === harmony.rootPc) {
    seed.role = "root";
  }
  return seed;
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

/** Slot starts inside [start, end): the occurrence start plus every whole beat after it. */
function beatSlots(start: number, end: number): number[] {
  const slots: number[] = [start];
  let beat = Math.floor(start + EPSILON) + 1;
  if (beat - start < EPSILON) {
    beat += 1;
  }
  for (; beat < end - EPSILON; beat += 1) {
    slots.push(beat);
  }
  return slots;
}

function positionInBar(beat: number, barLength: number): number {
  const raw = beat - Math.floor((beat + EPSILON) / barLength) * barLength;
  return nearlyEqual(raw, barLength) ? 0 : raw;
}

/** Accompaniment timing with ABSOLUTE onsets (beats). */
interface AbsoluteSeed {
  seed: NoteSeed;
  onset: number;
  duration: number;
}

function compileAccompaniment(
  pattern: AccompanimentPatternId,
  harmony: ResolvedHarmony,
  start: number,
  duration: number,
  barLength: number,
  includeVoicingBass: boolean
): AbsoluteSeed[] {
  const end = start + duration;
  const out: AbsoluteSeed[] = [];

  if (pattern === "none") {
    if (includeVoicingBass && harmony.voicingBass) {
      out.push({ seed: harmony.voicingBass, onset: start, duration });
    }
    return out;
  }

  if (!includeVoicingBass && harmony.voicingBass) {
    // Generated root/bass instead of the voicing's explicit bass.
    const copy: ResolvedHarmony = { ...harmony };
    delete copy.voicingBass;
    return compileAccompaniment(pattern, copy, start, duration, barLength, true);
  }

  const bass = accompanimentBassSeed(harmony);

  if (pattern === "sustained") {
    out.push({ seed: bass, onset: start, duration });
    accompanimentChordSeeds(harmony).forEach((seed) => out.push({ seed, onset: start, duration }));
    return out;
  }

  const slots = beatSlots(start, end);

  if (pattern === "rootOnly") {
    const bassSlots = slots.filter((slot, index) => index === 0 || nearlyEqual(positionInBar(slot, barLength), 0));
    bassSlots.forEach((slot, index) => {
      const next = index + 1 < bassSlots.length ? bassSlots[index + 1] : end;
      out.push({ seed: bass, onset: slot, duration: next - slot });
    });
    return out;
  }

  // bassAndChord: bass on beat 1 (and 3 in 4/4), chord on the other beats; the first slot of
  // every chord change carries the bass so each harmony is grounded.
  const chordSeeds = accompanimentChordSeeds(harmony);
  slots.forEach((slot, index) => {
    const next = index + 1 < slots.length ? slots[index + 1] : end;
    const pos = positionInBar(slot, barLength);
    const isBassBeat = index === 0 || nearlyEqual(pos, 0) || (nearlyEqual(barLength, 4) && nearlyEqual(pos, 2));
    if (isBassBeat) {
      out.push({ seed: bass, onset: slot, duration: next - slot });
    } else {
      chordSeeds.forEach((seed) => out.push({ seed, onset: slot, duration: next - slot }));
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

function makeNote(
  seed: NoteSeed,
  part: PartId,
  occurrence: PerformanceOccurrence,
  index: number,
  onsetBeat: number,
  durationBeats: number,
  velocity: number
): PerformedNote {
  const note: PerformedNote = {
    id: `${occurrence.occurrenceId}:${part}:${index}`,
    eventId: occurrence.eventId,
    occurrenceId: occurrence.occurrenceId,
    part,
    midi: seed.midi,
    onsetBeat,
    durationBeats,
    velocity
  };
  if (seed.spelled) {
    note.spelled = seed.spelled;
  }
  if (seed.degree !== undefined) {
    note.degree = seed.degree;
  }
  if (seed.role !== undefined) {
    note.role = seed.role;
  }
  if (seed.hand !== undefined) {
    note.hand = seed.hand;
  }
  if (seed.finger !== undefined) {
    note.finger = seed.finger;
  }
  return note;
}

function sequenceLength(sequence: MusicalSequence): number {
  let end = 0;
  sequence.events.forEach((event) => {
    end = Math.max(end, event.startBeat + Math.max(0, event.durationBeats));
  });
  return sequence.totalBeats > 0 ? Math.max(sequence.totalBeats, end) : end;
}

export function compareNotes(a: PerformedNote, b: PerformedNote): number {
  if (a.onsetBeat !== b.onsetBeat) {
    return a.onsetBeat - b.onsetBeat;
  }
  if (a.part !== b.part) {
    return PART_ORDER[a.part] - PART_ORDER[b.part];
  }
  if (a.midi !== b.midi) {
    return a.midi - b.midi;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function compileTimelineWithDiagnostics(sequence: MusicalSequence, options: CompileTimelineOptions = {}): CompileTimelineResult {
  const warnings: string[] = [];
  const bpm = options.tempoBpm !== undefined && options.tempoBpm > 0 ? options.tempoBpm : sequence.tempo.bpm;
  const repeats = Math.max(1, Math.floor(options.repeats ?? 1));
  const octaves: ArpeggiateOctaves = options.arpeggiate ?? 0;
  const velocity = clampVelocity(options.velocity ?? DEFAULT_VELOCITY);
  const accompanimentVelocity = clampVelocity(options.accompanimentVelocity ?? velocity * 0.8);
  const pattern: AccompanimentPatternId = options.accompaniment ?? "none";
  const includeVoicingBass = options.includeVoicingBass ?? true;
  const voicer = options.fallbackVoicer ?? legacyFallbackVoicer;
  const barLength = beatsPerBar(sequence.timeSignature.numerator, sequence.timeSignature.denominator);
  const passLength = sequenceLength(sequence);

  const events = [...sequence.events].sort((a, b) => (a.startBeat !== b.startBeat ? a.startBeat - b.startBeat : a.index - b.index));

  // Resolve every chord once (voice leading follows event order); passes reuse the same harmony.
  const harmonies = new Map<string, ResolvedHarmony | null>();
  let previousMidi: number[] | undefined;
  events.forEach((event) => {
    if (event.kind !== "chord" || event.durationBeats <= 0) {
      return;
    }
    const harmony = resolveHarmony(event, previousMidi, voicer, warnings);
    harmonies.set(event.id, harmony);
    if (harmony && harmony.learner.length > 0) {
      previousMidi = harmony.learner.map((seed) => seed.midi);
    }
  });

  const notes: PerformedNote[] = [];
  const occurrences: PerformanceOccurrence[] = [];

  for (let pass = 0; pass < repeats; pass += 1) {
    const passOffset = pass * passLength;
    events.forEach((event) => {
      const harmony = harmonies.get(event.id) ?? null;
      const occurrence: PerformanceOccurrence = {
        occurrenceId: `${event.id}#${pass}`,
        eventId: event.id,
        passIndex: pass,
        startBeat: event.startBeat + passOffset,
        durationBeats: event.durationBeats,
        symbol: event.symbol
      };
      const chord = harmony?.chord ?? event.chord;
      if (chord) {
        occurrence.chord = chord;
      }
      occurrences.push(occurrence);

      if (event.kind !== "chord" || event.durationBeats <= 0 || !harmony) {
        return;
      }

      timeLearnerSeeds(harmony.learner, event.durationBeats, octaves).forEach((timed, index) => {
        notes.push(makeNote(timed.seed, "learner", occurrence, index, occurrence.startBeat + timed.offset, timed.duration, velocity));
      });

      compileAccompaniment(pattern, harmony, occurrence.startBeat, event.durationBeats, barLength, includeVoicingBass).forEach(
        (timed, index) => {
          if (timed.duration > EPSILON && isValidMidi(timed.seed.midi)) {
            notes.push(makeNote(timed.seed, "accompaniment", occurrence, index, timed.onset, timed.duration, accompanimentVelocity));
          }
        }
      );
    });
  }

  const totalBeats = passLength * repeats;
  if (options.metronome) {
    buildMetronomeNotes({ startBeat: 0, endBeat: totalBeats, beatsPerBar: barLength, bpm }).forEach((note) => notes.push(note));
  }

  notes.sort(compareNotes);

  const timeline: PerformanceTimeline = {
    id: options.timelineId ?? `${sequence.id}@${sequence.version}`,
    sourceId: sequence.id,
    sourceVersion: sequence.version,
    tempo: { bpm },
    timeSignature: { numerator: sequence.timeSignature.numerator, denominator: sequence.timeSignature.denominator },
    notes,
    occurrences,
    totalBeats
  };
  if (options.arrangementId !== undefined) {
    timeline.arrangementId = options.arrangementId;
  }
  const countIn = Math.max(0, options.countInBeats ?? 0);
  if (countIn > 0) {
    timeline.countInBeats = countIn;
  }
  return { timeline, warnings };
}

export function compileTimeline(sequence: MusicalSequence, options: CompileTimelineOptions = {}): PerformanceTimeline {
  return compileTimelineWithDiagnostics(sequence, options).timeline;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface SliceOptions {
  /** Shift the slice so that `startBeat` becomes beat 0. Default false (absolute beats kept). */
  rebase?: boolean;
}

/**
 * Notes whose onset lies in [startBeat, endBeat), with durations clipped to `endBeat`, plus the
 * occurrences that overlap the range (clipped). Notes that started before the range are not
 * included (they belong to an earlier attack).
 */
export function sliceTimeline(timeline: PerformanceTimeline, startBeat: number, endBeat: number, options: SliceOptions = {}): PerformanceTimeline {
  const start = Math.max(0, Math.min(startBeat, endBeat));
  const end = Math.max(start, endBeat);
  const shift = options.rebase ? start : 0;

  const notes: PerformedNote[] = timeline.notes
    .filter((note) => note.onsetBeat >= start - EPSILON && note.onsetBeat < end - EPSILON)
    .map((note) => ({
      ...note,
      onsetBeat: note.onsetBeat - shift,
      durationBeats: Math.min(note.durationBeats, end - note.onsetBeat)
    }));

  const occurrences: PerformanceOccurrence[] = timeline.occurrences
    .filter((occ) => occ.startBeat < end - EPSILON && occ.startBeat + occ.durationBeats > start + EPSILON)
    .map((occ) => {
      const occStart = Math.max(occ.startBeat, start);
      const occEnd = Math.min(occ.startBeat + occ.durationBeats, end);
      return { ...occ, startBeat: occStart - shift, durationBeats: occEnd - occStart };
    });

  const sliced: PerformanceTimeline = {
    ...timeline,
    id: `${timeline.id}[${start}-${end}]`,
    notes,
    occurrences,
    totalBeats: options.rebase ? end - start : end
  };
  return sliced;
}

export function timelineLearnerNotes(timeline: PerformanceTimeline): PerformedNote[] {
  return timeline.notes.filter((note) => note.part === "learner");
}

export function timelineNotesForParts(timeline: PerformanceTimeline, parts: PartId[]): PerformedNote[] {
  return timeline.notes.filter((note) => parts.includes(note.part));
}

/** Notes sounding at `beat` (onset <= beat < onset + duration), optionally for one part. */
export function notesAtBeat(timeline: PerformanceTimeline, beat: number, part?: PartId): PerformedNote[] {
  return timeline.notes.filter(
    (note) =>
      (part === undefined || note.part === part) &&
      note.onsetBeat <= beat + EPSILON &&
      beat < note.onsetBeat + note.durationBeats - EPSILON
  );
}

/** The occurrence covering `beat`, or null (between/after occurrences). */
export function occurrenceAtBeat(timeline: PerformanceTimeline, beat: number): PerformanceOccurrence | null {
  for (const occ of timeline.occurrences) {
    if (occ.startBeat <= beat + EPSILON && beat < occ.startBeat + occ.durationBeats - EPSILON) {
      return occ;
    }
  }
  return null;
}
