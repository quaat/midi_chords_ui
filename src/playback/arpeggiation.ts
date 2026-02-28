import type { ArpeggiateOctaves } from "@/types";

export interface ArpeggiatedNote {
  note: number;
  startOffset: number;
  duration: number;
}

function isValidMidiNote(note: number): boolean {
  return Number.isFinite(note) && note >= 0 && note <= 127;
}

export function buildArpeggiatedNotes(
  notes: number[],
  totalDuration: number,
  octaves: ArpeggiateOctaves,
  minDuration = 0
): ArpeggiatedNote[] {
  if (totalDuration <= 0) {
    return [];
  }

  const sorted = [...notes].filter(isValidMidiNote).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return [];
  }

  if (octaves === 0) {
    return sorted.map((note) => ({
      note,
      startOffset: 0,
      duration: totalDuration
    }));
  }

  const expanded: number[] = [];
  for (let octave = 0; octave < octaves; octave += 1) {
    const transposition = octave * 12;
    sorted.forEach((note) => {
      const shifted = note + transposition;
      if (isValidMidiNote(shifted)) {
        expanded.push(shifted);
      }
    });
  }

  if (expanded.length === 0) {
    return [];
  }

  const step = totalDuration / expanded.length;
  const gate = step * 0.95;

  return expanded
    .map((note, idx) => {
      const startOffset = idx * step;
      const remaining = totalDuration - startOffset;
      if (remaining <= 0) {
        return null;
      }
      const duration = Math.min(remaining, Math.max(minDuration, gate));
      if (duration <= 0) {
        return null;
      }
      return {
        note,
        startOffset,
        duration
      };
    })
    .filter((note): note is ArpeggiatedNote => note !== null);
}
