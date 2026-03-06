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
const NOTE_NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const NOTE_NAMES_SMART = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

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

export function pcToNoteName(pc: number, preference: "sharp" | "flat" | "smart" = "sharp"): string {
  const normalized = (pc + 1200) % 12;

  if (preference === "flat") {
    return NOTE_NAMES_FLAT[normalized];
  }

  if (preference === "smart") {
    return NOTE_NAMES_SMART[normalized];
  }

  return NOTE_NAMES_SHARP[normalized];
}

export function midiToNoteName(midi: number): string {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${pcToNoteName(pc)}${octave}`;
}

export function pcToMidi(pc: number, octave: number): number {
  return 12 * (octave + 1) + ((pc + 1200) % 12);
}
