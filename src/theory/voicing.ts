import type { ChordDescription, SynthSettings, VoicingMode } from "@/types";
import { midiToNoteName, pcToMidi } from "@/theory/notes";

const TRIAD_CLASSES = {
  third: [3, 4],
  fifth: [6, 7, 8]
};

function clampToRange(note: number, minNote: number, maxNote: number): number {
  let result = note;
  while (result < minNote) {
    result += 12;
  }
  while (result > maxNote) {
    result -= 12;
  }
  if (result < minNote) {
    return minNote;
  }
  if (result > maxNote) {
    return maxNote;
  }
  return result;
}

function dedupeSorted(notes: number[]): number[] {
  return [...new Set(notes)].sort((a, b) => a - b);
}

function applyMode(baseNotes: number[], intervals: number[], mode: VoicingMode): number[] {
  const notes = [...baseNotes].sort((a, b) => a - b);
  if (notes.length === 0) {
    return [];
  }

  if (mode === "close") {
    return notes;
  }

  if (mode === "open") {
    const out = [...notes];
    for (let i = 1; i < out.length; i += 2) {
      out[i] += 12;
    }
    return out.sort((a, b) => a - b);
  }

  if (mode === "spread") {
    const out = notes.map((note, idx) => note + 12 * Math.floor(idx / 2));
    return out.sort((a, b) => a - b);
  }

  const root = notes[0];
  const thirds = notes.filter((_, idx) => TRIAD_CLASSES.third.includes(((intervals[idx] ?? 0) % 12 + 12) % 12));
  const fifths = notes.filter((_, idx) => TRIAD_CLASSES.fifth.includes(((intervals[idx] ?? 0) % 12 + 12) % 12));
  const rest = notes.filter((note) => note !== root && !thirds.includes(note) && !fifths.includes(note));

  const out: number[] = [root];
  if (fifths[0] !== undefined) {
    out.push(fifths[0] + 12);
  }
  if (thirds[0] !== undefined) {
    out.push(thirds[0] + 12);
  }
  rest.forEach((note, idx) => out.push(note + 12 * Math.max(1, idx % 2)));
  return out.sort((a, b) => a - b);
}

function applyMaxSpread(notes: number[], maxSpread: number): number[] {
  if (notes.length <= 1 || maxSpread <= 0) {
    return notes;
  }

  const out = [...notes].sort((a, b) => a - b);
  while (out[out.length - 1] - out[0] > maxSpread) {
    const highest = out[out.length - 1] - 12;
    if (highest <= out[0]) {
      break;
    }
    out[out.length - 1] = highest;
    out.sort((a, b) => a - b);
  }
  return out;
}

function voiceLead(previous: number[] | undefined, current: number[], minNote: number, maxNote: number): number[] {
  if (!previous || previous.length === 0 || current.length === 0) {
    return current;
  }

  const prev = [...previous].sort((a, b) => a - b);
  const base = [...current].sort((a, b) => a - b);
  const medianPrev = prev[Math.floor(prev.length / 2)];

  const localShifted = base.map((note) => {
    let best = note;
    let bestDist = Math.abs(note - medianPrev);
    for (const shift of [-24, -12, 0, 12, 24]) {
      const candidate = clampToRange(note + shift, minNote, maxNote);
      const dist = Math.abs(candidate - medianPrev);
      if (dist < bestDist) {
        bestDist = dist;
        best = candidate;
      }
    }
    return best;
  });

  let bestSet = dedupeSorted(localShifted);
  let bestCost = Number.POSITIVE_INFINITY;

  for (const globalShift of [-24, -12, 0, 12, 24]) {
    const candidate = dedupeSorted(localShifted.map((note) => clampToRange(note + globalShift, minNote, maxNote)));
    const cost = candidate.reduce((sum, note) => {
      const nearest = prev.reduce((innerBest, p) => Math.min(innerBest, Math.abs(note - p)), Number.POSITIVE_INFINITY);
      return sum + nearest;
    }, 0);
    if (cost < bestCost) {
      bestCost = cost;
      bestSet = candidate;
    }
  }

  return bestSet;
}

export function buildVoicing(
  chord: ChordDescription,
  settings: Pick<SynthSettings, "baseOctave" | "bassOctave" | "voicingMode" | "maxSpread" | "minNote" | "maxNote" | "voiceLeading">,
  previousVoicing?: number[]
): { notes: number[]; noteNames: string[] } {
  const rootMidi = pcToMidi(chord.rootPc, settings.baseOctave);
  const baseNotes = chord.intervals.map((interval) => rootMidi + interval);

  let notes = applyMode(baseNotes, chord.intervals, settings.voicingMode);
  notes = applyMaxSpread(notes, settings.maxSpread);
  notes = notes.map((note) => clampToRange(note, settings.minNote, settings.maxNote));
  notes = dedupeSorted(notes);

  if (chord.bassPc !== undefined) {
    let bassMidi = pcToMidi(chord.bassPc, settings.bassOctave);
    while (notes.length > 0 && bassMidi >= notes[0]) {
      bassMidi -= 12;
    }
    bassMidi = clampToRange(bassMidi, settings.minNote, settings.maxNote);
    notes = dedupeSorted([bassMidi, ...notes]);
  }

  if (settings.voiceLeading) {
    notes = voiceLead(previousVoicing, notes, settings.minNote, settings.maxNote);
  }

  return {
    notes,
    noteNames: notes.map((note) => midiToNoteName(note))
  };
}
