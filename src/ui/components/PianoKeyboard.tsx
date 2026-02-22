"use client";

interface PianoKeyboardProps {
  activeNotes: number[];
  currentChordLabel: string;
  width?: number;
}

const BLACK_CLASSES = new Set([1, 3, 6, 8, 10]);

function isBlack(midi: number): boolean {
  return BLACK_CLASSES.has(((midi % 12) + 12) % 12);
}

export function PianoKeyboard({ activeNotes, currentChordLabel, width = 1100 }: PianoKeyboardProps): JSX.Element {
  const minMidi = 36;
  const maxMidi = 96;
  const all = Array.from({ length: maxMidi - minMidi + 1 }, (_, i) => i + minMidi);
  const whites = all.filter((note) => !isBlack(note));
  const whiteWidth = width / whites.length;

  const xByMidi = new Map<number, number>();
  whites.forEach((midi, idx) => {
    xByMidi.set(midi, idx * whiteWidth);
  });

  const activeSet = new Set(activeNotes);

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Virtual Keyboard</h2>
        <span className="panel-subtitle">{currentChordLabel || "No active chord"}</span>
      </header>
      <div className="keyboard-wrap">
        <svg viewBox={`0 0 ${width} 180`} role="img" aria-label="Virtual piano keyboard">
          {whites.map((midi) => {
            const x = xByMidi.get(midi) ?? 0;
            const active = activeSet.has(midi);
            return (
              <rect
                key={`w-${midi}`}
                x={x}
                y={0}
                width={whiteWidth}
                height={180}
                className={active ? "white-key active" : "white-key"}
              />
            );
          })}
          {all.filter((midi) => isBlack(midi)).map((midi) => {
            const prevWhite = midi - 1;
            const x = (xByMidi.get(prevWhite) ?? 0) + whiteWidth * 0.65;
            const active = activeSet.has(midi);
            return (
              <rect
                key={`b-${midi}`}
                x={x}
                y={0}
                width={whiteWidth * 0.7}
                height={110}
                rx={3}
                className={active ? "black-key active" : "black-key"}
              />
            );
          })}
        </svg>
      </div>
    </section>
  );
}
