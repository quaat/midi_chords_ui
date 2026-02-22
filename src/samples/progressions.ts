export interface SampleProgression {
  id: string;
  title: string;
  description: string;
  text: string;
}

export const SAMPLE_PROGRESSIONS: SampleProgression[] = [
  {
    id: "neo-soul-walk",
    title: "Neo Soul Walk",
    description: "Slash chords and floaty major extensions.",
    text: `# Neo-soul slash movement
Cmaj9/E | 1
Dm11/F | 1
G13/B | 1
Cmaj9 | 1`
  },
  {
    id: "modal-rests",
    title: "Modal Rests",
    description: "Demonstrates NC rests and short durations.",
    text: `# Rests + syncopation
Am7 | 0.5
NC | 0.5
Dm11 | 1
G7b9 | 1
Cmaj9 | 2`
  },
  {
    id: "altered-turnaround",
    title: "Altered Turnaround",
    description: "Extensions and alterations with slash bass.",
    text: `# Altered dominant color
Fmaj9 | 1
G7b9 | 0.5
G7#11 | 0.5
Em7b5/Bb | 1
A7b13 | 1
Dm11 | 1
G13 | 1
Cmaj9 | 2`
  }
];
