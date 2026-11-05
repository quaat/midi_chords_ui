/**
 * On-screen piano (pointer/touch) learner input. The piano component calls
 * press/release/cancel from its pointer handlers; this class turns them into InputEvents
 * with source "touch". Multiple pointers are tracked independently; a pitch is released
 * only when the last pointer holding it lets go.
 */

import type { InputEvent } from "@/model/contracts";

export interface TouchInputOptions {
  velocity?: number;
  channel?: number;
  /** Performance clock (ms). Default performance.now(). */
  now?: () => number;
}

export type TouchInputListener = (event: InputEvent) => void;

function defaultNow(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

export class TouchInput {
  private readonly velocity: number;
  private readonly channel: number;
  private readonly now: () => number;
  /** pointerId → midi */
  private pointers = new Map<number, number>();
  private listeners = new Set<TouchInputListener>();

  constructor(options: TouchInputOptions = {}) {
    this.velocity = Math.max(1, Math.min(127, Math.round(options.velocity ?? 90)));
    this.channel = options.channel ?? 1;
    this.now = options.now ?? defaultNow;
  }

  onEvent(listener: TouchInputListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  heldNotes(): number[] {
    return Array.from(new Set<number>(this.pointers.values())).sort((a, b) => a - b);
  }

  /** pointerdown on a key. A pointer already holding another key releases it first. */
  press(midi: number, pointerId: number, velocity?: number): void {
    const current = this.pointers.get(pointerId);
    if (current === midi) {
      return;
    }
    if (current !== undefined) {
      this.releasePointer(pointerId);
    }
    this.pointers.set(pointerId, midi);
    const vel = velocity !== undefined ? Math.max(1, Math.min(127, Math.round(velocity))) : this.velocity;
    this.emit("noteOn", midi, vel);
  }

  /**
   * pointerup on a key. The pointer's own key is released (the midi argument is accepted for
   * symmetry with press; a pointer that slid off its key still releases what it holds).
   * Unknown pointers are ignored.
   */
  release(_midi: number, pointerId: number): void {
    this.releasePointer(pointerId);
  }

  /** Pointer slid onto another key while down (glissando). */
  moveTo(midi: number, pointerId: number): void {
    if (!this.pointers.has(pointerId)) {
      return;
    }
    this.press(midi, pointerId);
  }

  /** pointercancel / lostpointercapture: release whatever that pointer held. */
  cancel(pointerId: number): void {
    this.releasePointer(pointerId);
  }

  releaseAll(): void {
    const notes = this.heldNotes();
    this.pointers.clear();
    for (const midi of notes) {
      this.emit("noteOff", midi, 0);
    }
  }

  private releasePointer(pointerId: number): void {
    const midi = this.pointers.get(pointerId);
    if (midi === undefined) {
      return;
    }
    this.pointers.delete(pointerId);
    if (!this.isMidiHeld(midi)) {
      this.emit("noteOff", midi, 0);
    }
  }

  private isMidiHeld(midi: number): boolean {
    for (const value of this.pointers.values()) {
      if (value === midi) {
        return true;
      }
    }
    return false;
  }

  private emit(type: "noteOn" | "noteOff", midi: number, velocity: number): void {
    const event: InputEvent = {
      source: "touch",
      type,
      timestampMs: this.now(),
      channel: this.channel,
      midi,
      velocity
    };
    this.listeners.forEach((listener) => listener(event));
  }
}
