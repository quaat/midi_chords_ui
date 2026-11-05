"use client";

import clsx from "clsx";
import { ChevronLeft, ChevronRight, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import type { MidiRange } from "@/ui/piano/geometry";
import {
  countWhiteKeys,
  MIN_WHITE_KEYS,
  midiToPitchName,
  PIANO_HIGH,
  PIANO_LOW,
  rangeAroundNotes,
  rangesEqual,
  resizeRange,
  shiftRangeByOctaves
} from "@/ui/piano/geometry";

export interface RangeControlsProps {
  range: MidiRange;
  onRangeChange: (range: MidiRange) => void;
  /** Notes to fit when "Fit to notes" is pressed; the button is disabled when empty. */
  fitNotes?: number[];
  /** Minimum white keys for fit-to-notes (default one octave). */
  minWhiteKeys?: number;
  className?: string;
}

export function RangeControls({ range, onRangeChange, fitNotes, minWhiteKeys = MIN_WHITE_KEYS, className }: RangeControlsProps): JSX.Element {
  const down = shiftRangeByOctaves(range, -1);
  const up = shiftRangeByOctaves(range, 1);
  const narrower = resizeRange(range, -1);
  const wider = resizeRange(range, 1);
  const canFit = Array.isArray(fitNotes) && fitNotes.length > 0;
  const fitted = canFit ? rangeAroundNotes(fitNotes as number[], minWhiteKeys) : range;
  const whiteCount = countWhiteKeys(range.low, range.high);

  const apply = (next: MidiRange): void => {
    if (!rangesEqual(next, range)) {
      onRangeChange(next);
    }
  };

  return (
    <div className={clsx("pls-range-controls", className)} role="group" aria-label="Keyboard range">
      <button
        type="button"
        className="pls-btn pls-btn--icon"
        onClick={() => apply(down)}
        disabled={rangesEqual(down, range) || range.low <= PIANO_LOW}
        aria-label="Shift keyboard one octave down"
        title="Octave down"
      >
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      <span className="pls-range-controls__readout" aria-live="off">
        {midiToPitchName(range.low)}–{midiToPitchName(range.high)}
        <span className="pls-range-controls__count"> · {whiteCount} white keys</span>
      </span>
      <button
        type="button"
        className="pls-btn pls-btn--icon"
        onClick={() => apply(up)}
        disabled={rangesEqual(up, range) || range.high >= PIANO_HIGH}
        aria-label="Shift keyboard one octave up"
        title="Octave up"
      >
        <ChevronRight size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="pls-btn pls-btn--icon"
        onClick={() => apply(narrower)}
        disabled={rangesEqual(narrower, range)}
        aria-label="Show fewer keys"
        title="Fewer keys (larger)"
      >
        <ZoomIn size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="pls-btn pls-btn--icon"
        onClick={() => apply(wider)}
        disabled={rangesEqual(wider, range)}
        aria-label="Show more keys"
        title="More keys (smaller)"
      >
        <ZoomOut size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="pls-btn pls-btn--small"
        onClick={() => apply(fitted)}
        disabled={!canFit || rangesEqual(fitted, range)}
        title="Fit the keyboard to the current notes"
      >
        <Maximize2 size={14} aria-hidden="true" /> Fit to notes
      </button>
    </div>
  );
}
