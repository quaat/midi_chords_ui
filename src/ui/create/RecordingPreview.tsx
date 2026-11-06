"use client";

import { useMemo } from "react";
import type { RecordedNote } from "@/recording";
import { msToBeats } from "@/recording";

export interface RecordingPreviewProps {
  notes: readonly RecordedNote[];
  /** Playback/loop length in beats (bar-fitted when enabled). */
  totalBeats: number;
  tempoBpm: number;
  barBeats: number;
  className?: string;
}

const WIDTH = 400;
const HEIGHT = 84;
const PAD = 2;

/**
 * Minimal horizontal piano-roll preview of a take (time left → right, pitch bottom → top, bar
 * lines, note opacity by velocity). Read-only; the accessible description carries the summary.
 */
export function RecordingPreview({ notes, totalBeats, tempoBpm, barBeats, className }: RecordingPreviewProps): JSX.Element {
  const model = useMemo(() => {
    const total = Math.max(totalBeats, 0.001);
    let low = 127;
    let high = 0;
    notes.forEach((note) => {
      low = Math.min(low, note.midi);
      high = Math.max(high, note.midi);
    });
    if (notes.length === 0) {
      low = 48;
      high = 72;
    }
    low = Math.max(0, low - 1);
    high = Math.min(127, high + 1);
    const rows = Math.max(1, high - low + 1);
    const rowHeight = (HEIGHT - 2 * PAD) / rows;
    const rects = notes.map((note) => {
      const onset = msToBeats(note.onsetMs, tempoBpm);
      const length = Math.max(0.05, msToBeats(note.soundingMs, tempoBpm));
      const x = PAD + (onset / total) * (WIDTH - 2 * PAD);
      const w = Math.max(1, (Math.min(length, total - onset) / total) * (WIDTH - 2 * PAD));
      const y = PAD + (high - note.midi) * rowHeight;
      return { id: note.id, x, y, w, h: Math.max(1, rowHeight - 0.5), opacity: 0.35 + 0.65 * (note.velocity / 127) };
    });
    const bars: number[] = [];
    const bar = barBeats > 0 ? barBeats : 4;
    for (let beat = bar; beat < total - 1e-6; beat += bar) {
      bars.push(PAD + (beat / total) * (WIDTH - 2 * PAD));
    }
    return { rects, bars, low, high };
  }, [notes, totalBeats, tempoBpm, barBeats]);

  const description =
    notes.length === 0
      ? "Empty take."
      : `${notes.length} notes between MIDI ${model.low + 1} and ${model.high - 1} over ${totalBeats.toFixed(1)} beats.`;

  return (
    <svg
      className={className}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Recording preview: ${description}`}
    >
      {model.bars.map((x) => (
        <line key={x} x1={x} x2={x} y1={0} y2={HEIGHT} className="pls-record__preview-bar" />
      ))}
      {model.rects.map((rect) => (
        <rect key={rect.id} x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={1} className="pls-record__preview-note" style={{ opacity: rect.opacity }} />
      ))}
    </svg>
  );
}
