/**
 * Shared piano / lane geometry (plan E08, E12).
 *
 * Pure and deterministic. All coordinates are CSS pixels relative to the keyboard's
 * top-left corner; callers multiply by devicePixelRatio when drawing into a canvas
 * backing store. The falling-note stage uses `laneX` from the same layout so lanes
 * align with the keys exactly, including black-key boundaries.
 */

export interface MidiRange {
  low: number;
  high: number;
}

export interface KeyRect {
  midi: number;
  black: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LaneRect {
  midi: number;
  black: boolean;
  /** Left edge in CSS px. */
  x: number;
  width: number;
  centerX: number;
}

export interface OctaveLabel {
  midi: number;
  label: string;
  /** Left edge of the C key in CSS px. */
  x: number;
  width: number;
}

export interface KeyLayoutOptions {
  /** Black key width as a fraction of the white key width (default 0.6). */
  blackWidthRatio?: number;
  /** Black key height as a fraction of the white key height (default 0.62). */
  blackHeightRatio?: number;
}

/** Standard 88-key piano bounds (A0..C8). */
export const PIANO_LOW = 21;
export const PIANO_HIGH = 108;
export const MIDI_MIN = 0;
export const MIDI_MAX = 127;
export const MIDDLE_C = 60;

export const DEFAULT_BLACK_WIDTH_RATIO = 0.6;
export const DEFAULT_BLACK_HEIGHT_RATIO = 0.62;
/** Fewest white keys a default range will show (one octave C..C). */
export const MIN_WHITE_KEYS = 8;

const BLACK_PCS: readonly boolean[] = [false, true, false, true, false, false, true, false, true, false, true, false];

/**
 * Centre of each black key measured from the LEFT edge of the white key directly below
 * it, in white-key widths. Derived from the real keyboard: the C–E group divides three
 * white keys into five equal slots and the F–B group divides four white keys into seven,
 * so C#/D# lean outwards and F#/A# lean outwards around the centred G#.
 */
const BLACK_CENTER_OFFSET: Record<number, number> = {
  1: 0.9, // C#: over C (0.9 of C's width)
  3: 1.1, // D#: from D's left edge
  6: 6 / 7, // F#
  8: 1.0, // G#: centred on the G/A boundary
  10: 8 / 7 // A#
};

function pitchClass(midi: number): number {
  return ((Math.round(midi) % 12) + 12) % 12;
}

export function isBlackKey(midi: number): boolean {
  return BLACK_PCS[pitchClass(midi)];
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/** Extend a range outward so it starts and ends on white keys, within MIDI 0..127. */
export function clampRangeToWhiteKeys(low: number, high: number): MidiRange {
  let lo = clampInt(Math.min(low, high), MIDI_MIN, MIDI_MAX);
  let hi = clampInt(Math.max(low, high), MIDI_MIN, MIDI_MAX);
  if (isBlackKey(lo)) {
    lo -= 1;
  }
  if (isBlackKey(hi)) {
    hi += 1;
  }
  // 0 (C-1) and 127 (G9) are white keys, so these never leave the MIDI range.
  return { low: lo, high: hi };
}

export function countWhiteKeys(low: number, high: number): number {
  let count = 0;
  for (let m = low; m <= high; m += 1) {
    if (!isBlackKey(m)) {
      count += 1;
    }
  }
  return count;
}

/** All white keys between bounds inclusive, ascending. */
function whiteKeysBetween(low: number, high: number): number[] {
  const out: number[] = [];
  for (let m = low; m <= high; m += 1) {
    if (!isBlackKey(m)) {
      out.push(m);
    }
  }
  return out;
}

const NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Scientific pitch name using sharps, e.g. 60 -> "C4". */
export function midiToPitchName(midi: number): string {
  const octave = Math.floor(Math.round(midi) / 12) - 1;
  return `${NOTE_NAMES_SHARP[pitchClass(midi)]}${octave}`;
}

export class KeyLayout {
  readonly low: number;
  readonly high: number;
  readonly width: number;
  readonly height: number;
  readonly whiteWidth: number;
  readonly blackWidth: number;
  readonly blackHeight: number;
  readonly whiteCount: number;
  /** White keys in ascending order. */
  readonly whiteKeys: KeyRect[];
  /** Black keys in ascending order. */
  readonly blackKeys: KeyRect[];
  /** Draw order: whites, then blacks (blacks on top). */
  readonly keys: KeyRect[];

  private readonly byMidi: Map<number, KeyRect>;
  private readonly whiteIndexByMidi: Map<number, number>;

  constructor(range: MidiRange, width: number, height: number = 120, options: KeyLayoutOptions = {}) {
    const clamped = clampRangeToWhiteKeys(range.low, range.high);
    this.low = clamped.low;
    this.high = clamped.high;
    this.width = Math.max(0, Number.isFinite(width) ? width : 0);
    this.height = Math.max(0, Number.isFinite(height) ? height : 0);

    const whites = whiteKeysBetween(this.low, this.high);
    this.whiteCount = whites.length;
    this.whiteWidth = this.whiteCount > 0 ? this.width / this.whiteCount : 0;
    this.blackWidth = this.whiteWidth * (options.blackWidthRatio ?? DEFAULT_BLACK_WIDTH_RATIO);
    this.blackHeight = this.height * (options.blackHeightRatio ?? DEFAULT_BLACK_HEIGHT_RATIO);

    this.byMidi = new Map<number, KeyRect>();
    this.whiteIndexByMidi = new Map<number, number>();
    this.whiteKeys = [];
    this.blackKeys = [];

    whites.forEach((midi, index) => {
      const rect: KeyRect = {
        midi,
        black: false,
        x: index * this.whiteWidth,
        y: 0,
        width: this.whiteWidth,
        height: this.height
      };
      this.whiteKeys.push(rect);
      this.byMidi.set(midi, rect);
      this.whiteIndexByMidi.set(midi, index);
    });

    for (let midi = this.low + 1; midi < this.high; midi += 1) {
      if (!isBlackKey(midi)) {
        continue;
      }
      const below = this.byMidi.get(midi - 1);
      if (!below) {
        continue;
      }
      const center = below.x + this.whiteWidth * BLACK_CENTER_OFFSET[pitchClass(midi)];
      const rect: KeyRect = {
        midi,
        black: true,
        x: center - this.blackWidth / 2,
        y: 0,
        width: this.blackWidth,
        height: this.blackHeight
      };
      this.blackKeys.push(rect);
      this.byMidi.set(midi, rect);
    }

    this.keys = [...this.whiteKeys, ...this.blackKeys];
  }

  get range(): MidiRange {
    return { low: this.low, high: this.high };
  }

  contains(midi: number): boolean {
    return this.byMidi.has(midi);
  }

  keyRect(midi: number): KeyRect | null {
    return this.byMidi.get(midi) ?? null;
  }

  /** Horizontal lane for the falling-note stage: identical to the key's x extent. */
  laneX(midi: number): LaneRect | null {
    const rect = this.byMidi.get(midi);
    if (!rect) {
      return null;
    }
    return { midi, black: rect.black, x: rect.x, width: rect.width, centerX: rect.x + rect.width / 2 };
  }

  /** Key under a point (CSS px). Black keys win where they overlap white keys. */
  midiAtPoint(x: number, y: number): number | null {
    if (this.whiteCount === 0 || x < 0 || x > this.width || y < 0 || y > this.height) {
      return null;
    }
    const index = Math.min(this.whiteCount - 1, Math.max(0, Math.floor(x / this.whiteWidth)));
    const white = this.whiteKeys[index];
    if (y <= this.blackHeight) {
      for (const candidate of [white.midi - 1, white.midi + 1]) {
        const rect = this.byMidi.get(candidate);
        if (rect && rect.black && x >= rect.x && x <= rect.x + rect.width) {
          return candidate;
        }
      }
    }
    return white.midi;
  }

  /** C keys in range with "C3"-style labels, for orientation markers. */
  octaveLabels(): OctaveLabel[] {
    return this.whiteKeys
      .filter((rect) => pitchClass(rect.midi) === 0)
      .map((rect) => ({ midi: rect.midi, label: midiToPitchName(rect.midi), x: rect.x, width: rect.width }));
  }

  /** Same range/options at a new size. */
  resized(width: number, height: number = this.height): KeyLayout {
    return new KeyLayout(
      { low: this.low, high: this.high },
      width,
      height,
      {
        blackWidthRatio: this.whiteWidth > 0 ? this.blackWidth / this.whiteWidth : DEFAULT_BLACK_WIDTH_RATIO,
        blackHeightRatio: this.height > 0 ? this.blackHeight / this.height : DEFAULT_BLACK_HEIGHT_RATIO
      }
    );
  }
}

export function createKeyLayout(range: MidiRange, width: number, height?: number, options?: KeyLayoutOptions): KeyLayout {
  return new KeyLayout(range, width, height, options);
}

const PIANO_WHITES: number[] = whiteKeysBetween(PIANO_LOW, PIANO_HIGH);

function whiteIndexInPiano(midi: number): number {
  return PIANO_WHITES.indexOf(midi);
}

/** A range of `count` white keys on an 88-key piano centred around middle C. */
export function rangeWithWhiteCount(count: number, centerMidi: number = MIDDLE_C): MidiRange {
  const n = clampInt(count, 1, PIANO_WHITES.length);
  if (n >= PIANO_WHITES.length) {
    return { low: PIANO_LOW, high: PIANO_HIGH };
  }
  const centerWhite = isBlackKey(centerMidi) ? centerMidi - 1 : centerMidi;
  let centerIndex = whiteIndexInPiano(clampInt(centerWhite, PIANO_LOW, PIANO_HIGH));
  if (centerIndex < 0) {
    centerIndex = whiteIndexInPiano(MIDDLE_C);
  }
  const start = Math.max(0, Math.min(PIANO_WHITES.length - n, centerIndex - Math.floor(n / 2)));
  return { low: PIANO_WHITES[start], high: PIANO_WHITES[start + n - 1] };
}

/**
 * Largest playable range for a container width: as many white keys as fit at
 * `minKeyWidthPx` each (at least one octave, at most 88 keys), centred on middle C.
 */
export function defaultRangeForWidth(widthPx: number, minKeyWidthPx: number = 22): MidiRange {
  const keyWidth = minKeyWidthPx > 0 ? minKeyWidthPx : 22;
  const fit = Math.floor(Math.max(0, widthPx) / keyWidth);
  const count = Math.max(MIN_WHITE_KEYS, Math.min(PIANO_WHITES.length, fit));
  return rangeWithWhiteCount(count, MIDDLE_C);
}

/**
 * Smallest white-key-bounded range that contains every note and at least `minKeys`
 * white keys, growing symmetrically. Stays on the 88-key piano when the notes do.
 */
export function rangeAroundNotes(notes: readonly number[], minKeys: number = MIN_WHITE_KEYS): MidiRange {
  const valid = notes.filter((n) => Number.isFinite(n));
  if (valid.length === 0) {
    return rangeWithWhiteCount(minKeys, MIDDLE_C);
  }
  const base = clampRangeToWhiteKeys(Math.min(...valid), Math.max(...valid));
  const outside = base.low < PIANO_LOW || base.high > PIANO_HIGH;
  const floor = outside ? MIDI_MIN : PIANO_LOW;
  const ceiling = outside ? MIDI_MAX : PIANO_HIGH;
  let { low, high } = base;
  let count = countWhiteKeys(low, high);
  let growLow = true;
  let guard = 0;
  while (count < minKeys && guard < 256) {
    guard += 1;
    const canLow = low > floor;
    const canHigh = high < ceiling;
    if (!canLow && !canHigh) {
      break;
    }
    if ((growLow && canLow) || !canHigh) {
      low = prevWhite(low);
    } else {
      high = nextWhite(high);
    }
    growLow = !growLow;
    count = countWhiteKeys(low, high);
  }
  return { low, high };
}

function prevWhite(midi: number): number {
  let m = midi - 1;
  while (m > MIDI_MIN && isBlackKey(m)) {
    m -= 1;
  }
  return Math.max(MIDI_MIN, m);
}

function nextWhite(midi: number): number {
  let m = midi + 1;
  while (m < MIDI_MAX && isBlackKey(m)) {
    m += 1;
  }
  return Math.min(MIDI_MAX, m);
}

/** Shift a range by whole octaves, staying within the 88-key piano. */
export function shiftRangeByOctaves(range: MidiRange, octaves: number): MidiRange {
  const r = clampRangeToWhiteKeys(range.low, range.high);
  let delta = Math.round(octaves) * 12;
  if (r.low + delta < PIANO_LOW) {
    delta = Math.ceil((PIANO_LOW - r.low) / 12) * 12;
  }
  if (r.high + delta > PIANO_HIGH) {
    delta = Math.floor((PIANO_HIGH - r.high) / 12) * 12;
  }
  if (r.low + delta < PIANO_LOW) {
    // Range wider than the piano can shift within; leave it unchanged.
    return r;
  }
  return clampRangeToWhiteKeys(r.low + delta, r.high + delta);
}

/** Widen (positive) or narrow (negative) by `whiteKeys` on each side, keeping ≥ one octave. */
export function resizeRange(range: MidiRange, whiteKeysPerSide: number): MidiRange {
  let { low, high } = clampRangeToWhiteKeys(range.low, range.high);
  const steps = Math.abs(Math.round(whiteKeysPerSide));
  for (let i = 0; i < steps; i += 1) {
    if (whiteKeysPerSide > 0) {
      if (low > PIANO_LOW) {
        low = prevWhite(low);
      }
      if (high < PIANO_HIGH) {
        high = nextWhite(high);
      }
    } else {
      if (countWhiteKeys(low, high) - 2 < MIN_WHITE_KEYS) {
        break;
      }
      low = nextWhite(low);
      high = prevWhite(high);
    }
  }
  return { low, high };
}

export function rangesEqual(a: MidiRange, b: MidiRange): boolean {
  return a.low === b.low && a.high === b.high;
}
