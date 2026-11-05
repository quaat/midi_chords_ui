/**
 * Small learner-facing text helpers shared by the practice runtime (plan E13/E15).
 * Spelling follows the chord (or key) context so that explanations never rename a note
 * enharmonically ("B♭ is missing" in a Cm7 chord, not "A♯ is missing").
 */
import type { ChordDefinition, ChordRole, SpelledNote, SpelledPitchClass } from "@/model/contracts";
import { chordTones, formatPitchClass, formatSpelledNote, midiOf, mod12, noteFromMidi, pitchClassOf } from "@/music";
import type { SpellingPreference } from "@/music";

export const ROLE_NAMES: Readonly<Record<ChordRole, string>> = {
  root: "root",
  third: "third",
  fifth: "fifth",
  sixth: "sixth",
  seventh: "seventh",
  ninth: "ninth",
  eleventh: "eleventh",
  thirteenth: "thirteenth",
  suspension: "suspended tone",
  added: "added tone"
};

export function roleName(role: ChordRole): string {
  return ROLE_NAMES[role];
}

/** Pitch class (0..11) → chord spelling, from the chord's own degrees (and slash bass). */
export function chordSpellingMap(chord: ChordDefinition): Map<number, SpelledPitchClass> {
  const map = new Map<number, SpelledPitchClass>();
  chordTones(chord, 4).forEach((tone) => {
    const pc = mod12(tone.midi);
    if (!map.has(pc)) {
      map.set(pc, { letter: tone.spelled.letter, accidental: tone.spelled.accidental });
    }
  });
  if (chord.bass) {
    const pc = pitchClassOf(chord.bass);
    if (!map.has(pc)) {
      map.set(pc, { letter: chord.bass.letter, accidental: chord.bass.accidental });
    }
  }
  return map;
}

/** Spelled note for `midi` using `pitch` as its spelling, or null when they disagree. */
export function noteWithSpelling(midi: number, pitch: SpelledPitchClass): SpelledNote | null {
  if (mod12(pitchClassOf(pitch)) !== mod12(midi)) {
    return null;
  }
  // midiOf = 12 * (octave + 1) + letterPc + accidental; solve for the octave.
  const base: SpelledNote = { letter: pitch.letter, accidental: pitch.accidental, octave: 4 };
  const offset = midi - midiOf(base);
  if (offset % 12 !== 0) {
    return null;
  }
  return { letter: pitch.letter, accidental: pitch.accidental, octave: 4 + offset / 12 };
}

/** Spell a MIDI note in a chord context (chord spelling when the pitch class belongs to it). */
export function spellMidi(midi: number, chord?: ChordDefinition, preference: SpellingPreference = "smart"): SpelledNote {
  if (chord) {
    const pitch = chordSpellingMap(chord).get(mod12(midi));
    if (pitch) {
      const spelled = noteWithSpelling(midi, pitch);
      if (spelled) {
        return spelled;
      }
    }
  }
  return noteFromMidi(midi, preference);
}

/** "F3", "B♭3" — note name with octave (unicode accidentals). */
export function noteLabel(midi: number, chord?: ChordDefinition, spelled?: SpelledNote): string {
  const note = spelled && midiOf(spelled) === midi ? spelled : spellMidi(midi, chord);
  return formatSpelledNote(note, { unicode: true });
}

/** "F", "B♭" — pitch-class name (unicode accidentals). */
export function pitchClassLabel(midi: number, chord?: ChordDefinition, spelled?: SpelledNote): string {
  const note = spelled && midiOf(spelled) === midi ? spelled : spellMidi(midi, chord);
  return formatPitchClass(note, { unicode: true });
}

/** "F3 A3 C4 E4" for a list of notes (ascending). */
export function noteList(notes: { midi: number; spelled?: SpelledNote }[], chord?: ChordDefinition): string {
  return [...notes]
    .sort((a, b) => a.midi - b.midi)
    .map((note) => noteLabel(note.midi, chord, note.spelled))
    .join(" ");
}

/** Chord symbol for learner-facing text (unicode accidentals in the root/bass). */
export function chordLabel(chord: ChordDefinition): string {
  return chord.symbol.replace(/^([A-G])b/, "$1♭").replace(/^([A-G])#/, "$1♯").replace(/\/([A-G])b/, "/$1♭").replace(/\/([A-G])#/, "/$1♯");
}

/** Join "a", "b", "c" → "a, b and c". */
export function joinWords(words: string[]): string {
  if (words.length <= 1) {
    return words.join("");
  }
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}
