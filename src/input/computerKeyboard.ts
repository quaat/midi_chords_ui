/**
 * Computer-keyboard learner input (plan §4: usable fallback when Web MIDI is unsupported
 * or denied).
 *
 * Layout (by physical key `code`, so it works on QWERTY/QWERTZ/AZERTY/Nordic layouts):
 *   lower row  Z S X D C V G B H N J M ,   = C..B, C  starting at baseMidi (default 48 = C3)
 *   upper row  Q 2 W 3 E R 5 T 6 Y 7 U I   = C..B, C  one octave higher (60 = C4 by default)
 *   "-" / "="  (codes Minus / Equal)       = octave down / up (clamped to the MIDI range)
 *   Space                                  = sustain pedal (CC64 127 / 0)
 *
 * Auto-repeat keydowns are ignored, as are keys pressed with Ctrl/Meta/Alt (shortcuts).
 * Every held note (and sustain) is released on window blur and on visibilitychange, so a
 * lost keyup can never leave a stuck note.
 */

import type { InputEvent } from "@/model/contracts";

export interface KeyLike {
  code: string;
  key: string;
  repeat: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

export interface KeyEventTarget {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

export interface ComputerKeyboardOptions {
  /** MIDI note of the lower-row "Z" key. Default 48 (C3). */
  baseMidi?: number;
  velocity?: number;
  channel?: number;
  /** Performance clock (ms). Default performance.now(). */
  now?: () => number;
}

export type ComputerKeyboardListener = (event: InputEvent) => void;

/** Semitone offset from baseMidi for each physical key code. */
export const COMPUTER_KEY_OFFSETS: Readonly<Record<string, number>> = {
  KeyZ: 0,
  KeyS: 1,
  KeyX: 2,
  KeyD: 3,
  KeyC: 4,
  KeyV: 5,
  KeyG: 6,
  KeyB: 7,
  KeyH: 8,
  KeyN: 9,
  KeyJ: 10,
  KeyM: 11,
  Comma: 12,
  KeyQ: 12,
  Digit2: 13,
  KeyW: 14,
  Digit3: 15,
  KeyE: 16,
  KeyR: 17,
  Digit5: 18,
  KeyT: 19,
  Digit6: 20,
  KeyY: 21,
  Digit7: 22,
  KeyU: 23,
  KeyI: 24
};

/** Fallback by `key` for environments that do not report `code`. */
const KEY_CHAR_TO_CODE: Readonly<Record<string, string>> = {
  z: "KeyZ", s: "KeyS", x: "KeyX", d: "KeyD", c: "KeyC", v: "KeyV", g: "KeyG", b: "KeyB",
  h: "KeyH", n: "KeyN", j: "KeyJ", m: "KeyM", ",": "Comma",
  q: "KeyQ", "2": "Digit2", w: "KeyW", "3": "Digit3", e: "KeyE", r: "KeyR", "5": "Digit5",
  t: "KeyT", "6": "Digit6", y: "KeyY", "7": "Digit7", u: "KeyU", i: "KeyI",
  "-": "Minus", "=": "Equal", " ": "Space"
};

export const OCTAVE_DOWN_CODE = "Minus";
export const OCTAVE_UP_CODE = "Equal";
export const SUSTAIN_CODE = "Space";

const HIGHEST_OFFSET = 24;

function defaultNow(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function clampBase(base: number): number {
  // Keep every mapped key (base .. base+24) inside 0..127.
  return Math.max(0, Math.min(127 - HIGHEST_OFFSET, Math.round(base)));
}

function resolveCode(event: KeyLike): string {
  if (event.code) {
    return event.code;
  }
  const mapped = KEY_CHAR_TO_CODE[event.key.toLowerCase()];
  return mapped !== undefined ? mapped : "";
}

export class ComputerKeyboardInput {
  private baseMidi: number;
  private readonly velocity: number;
  private readonly channel: number;
  private readonly now: () => number;
  /** code → midi sounding for that key (captured at press, so octave shifts don't strand notes). */
  private held = new Map<string, number>();
  private sustainDown = false;
  private listeners = new Set<ComputerKeyboardListener>();

  constructor(options: ComputerKeyboardOptions = {}) {
    this.baseMidi = clampBase(options.baseMidi ?? 48);
    this.velocity = Math.max(1, Math.min(127, Math.round(options.velocity ?? 96)));
    this.channel = options.channel ?? 1;
    this.now = options.now ?? defaultNow;
  }

  onEvent(listener: ComputerKeyboardListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getBaseMidi(): number {
    return this.baseMidi;
  }

  setBaseMidi(midi: number): void {
    this.baseMidi = clampBase(midi);
  }

  /** Shift by whole octaves; returns the new base. Held notes keep their pitch until released. */
  shiftOctave(delta: number): number {
    this.baseMidi = clampBase(this.baseMidi + 12 * Math.round(delta));
    return this.baseMidi;
  }

  /** MIDI note a key code would play now, or null. */
  midiForCode(code: string): number | null {
    const offset = COMPUTER_KEY_OFFSETS[code];
    return offset === undefined ? null : this.baseMidi + offset;
  }

  heldNotes(): number[] {
    return Array.from(new Set<number>(this.held.values())).sort((a, b) => a - b);
  }

  isSustainDown(): boolean {
    return this.sustainDown;
  }

  /** Returns true when the key was handled (callers should preventDefault). */
  handleKeyDown(event: KeyLike): boolean {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return false;
    }
    const code = resolveCode(event);
    if (code === "") {
      return false;
    }
    if (code === OCTAVE_DOWN_CODE || code === OCTAVE_UP_CODE) {
      if (!event.repeat) {
        this.shiftOctave(code === OCTAVE_UP_CODE ? 1 : -1);
      }
      return true;
    }
    if (code === SUSTAIN_CODE) {
      if (!event.repeat && !this.sustainDown) {
        this.sustainDown = true;
        this.emit({ type: "sustain", value: 127 });
      }
      return true;
    }
    const midi = this.midiForCode(code);
    if (midi === null) {
      return false;
    }
    if (event.repeat || this.held.has(code)) {
      return true;
    }
    this.held.set(code, midi);
    this.emit({ type: "noteOn", midi, velocity: this.velocity });
    return true;
  }

  handleKeyUp(event: KeyLike): boolean {
    const code = resolveCode(event);
    if (code === "") {
      return false;
    }
    if (code === OCTAVE_DOWN_CODE || code === OCTAVE_UP_CODE) {
      return true;
    }
    if (code === SUSTAIN_CODE) {
      if (this.sustainDown) {
        this.sustainDown = false;
        this.emit({ type: "sustain", value: 0 });
      }
      return true;
    }
    const midi = this.held.get(code);
    if (midi === undefined) {
      return COMPUTER_KEY_OFFSETS[code] !== undefined;
    }
    this.held.delete(code);
    if (!this.isMidiStillHeld(midi)) {
      this.emit({ type: "noteOff", midi, velocity: 0 });
    }
    return true;
  }

  /** Release every held note and the sustain pedal (blur, visibility change, unmount). */
  releaseAll(): void {
    const notes = this.heldNotes();
    this.held.clear();
    for (const midi of notes) {
      this.emit({ type: "noteOff", midi, velocity: 0 });
    }
    if (this.sustainDown) {
      this.sustainDown = false;
      this.emit({ type: "sustain", value: 0 });
    }
  }

  /**
   * Attach to a browser target (usually `window`). Listens for keydown/keyup/blur and
   * visibilitychange; pass `document` as `visibilityTarget` because visibilitychange fires
   * on the document. Focus inside text fields is ignored. Returns a detach function.
   */
  attach(target: KeyEventTarget, visibilityTarget?: KeyEventTarget): () => void {
    const onKeyDown = (event: Event): void => {
      const keyEvent = event as KeyboardEvent;
      if (isEditableTarget(keyEvent.target)) {
        return;
      }
      if (this.handleKeyDown(keyEvent)) {
        keyEvent.preventDefault();
      }
    };
    const onKeyUp = (event: Event): void => {
      const keyEvent = event as KeyboardEvent;
      if (this.handleKeyUp(keyEvent)) {
        keyEvent.preventDefault();
      }
    };
    const onRelease = (): void => {
      this.releaseAll();
    };
    const visibility = visibilityTarget ?? target;
    target.addEventListener("keydown", onKeyDown);
    target.addEventListener("keyup", onKeyUp);
    target.addEventListener("blur", onRelease);
    visibility.addEventListener("visibilitychange", onRelease);
    return () => {
      target.removeEventListener("keydown", onKeyDown);
      target.removeEventListener("keyup", onKeyUp);
      target.removeEventListener("blur", onRelease);
      visibility.removeEventListener("visibilitychange", onRelease);
      this.releaseAll();
    };
  }

  private isMidiStillHeld(midi: number): boolean {
    for (const value of this.held.values()) {
      if (value === midi) {
        return true;
      }
    }
    return false;
  }

  private emit(partial: { type: "noteOn" | "noteOff" | "sustain"; midi?: number; velocity?: number; value?: number }): void {
    const event: InputEvent = {
      source: "computerKeyboard",
      type: partial.type,
      timestampMs: this.now(),
      channel: this.channel
    };
    if (partial.midi !== undefined) {
      event.midi = partial.midi;
    }
    if (partial.velocity !== undefined) {
      event.velocity = partial.velocity;
    }
    if (partial.value !== undefined) {
      event.value = partial.value;
    }
    this.listeners.forEach((listener) => listener(event));
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") {
    return false;
  }
  const element = target as { tagName?: unknown; isContentEditable?: unknown };
  if (element.isContentEditable === true) {
    return true;
  }
  const tag = typeof element.tagName === "string" ? element.tagName.toUpperCase() : "";
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
