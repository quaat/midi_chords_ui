const NATURAL_PCS: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11
};

const NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function parseNoteName(noteText: string): { name: string; pc: number } | null {
  const trimmed = noteText.trim();
  const match = trimmed.match(/^([A-Ga-g])([#b]?)$/);
  if (!match) {
    return null;
  }

  const letter = match[1].toUpperCase();
  const accidental = match[2] || "";
  let pc = NATURAL_PCS[letter];
  if (accidental === "#") {
    pc += 1;
  } else if (accidental === "b") {
    pc -= 1;
  }

  pc = (pc + 12) % 12;
  return {
    name: `${letter}${accidental}`,
    pc
  };
}

export function pcToNoteName(pc: number): string {
  return NOTE_NAMES_SHARP[(pc + 1200) % 12];
}

export function midiToNoteName(midi: number): string {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${pcToNoteName(pc)}${octave}`;
}

export function pcToMidi(pc: number, octave: number): number {
  return 12 * (octave + 1) + ((pc + 1200) % 12);
}
