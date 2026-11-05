/**
 * Held-key and pedal state per input source (plan §4 "Timing and input", E09).
 *
 * Physically pressed keys and pedal-sustained sound are tracked separately so that
 * assessment can decide (by explicit policy) whether pedal-held notes count. State is
 * kept per source key — a MIDI port + channel, or the single computer keyboard / touch
 * source — so two devices holding the same pitch never cancel each other.
 *
 * The tracker is pure: it never reads clocks or devices; feed it InputEvents.
 */

import type { HeldStateSnapshot, InputEvent, InputSource } from "@/model/contracts";
import { isPedalDown } from "@/input/normalize";

export type PedalKind = "sustain" | "sostenuto" | "soft";

export interface AttackChange {
  kind: "attack";
  midi: number;
  velocity: number;
  timestampMs: number;
  source: InputSource;
  sourceKey: string;
  portId?: string;
  channel?: number;
  /** True when the pitch was already sounding (pressed or sustained) on this source. */
  retrigger: boolean;
}

export interface ReleaseChange {
  kind: "release";
  midi: number;
  timestampMs: number;
  source: InputSource;
  sourceKey: string;
  /** True when the key was released but keeps sounding because a pedal holds it. */
  stillSounding: boolean;
}

export interface PedalChange {
  kind: "pedal";
  pedal: PedalKind;
  down: boolean;
  value: number;
  timestampMs: number;
  source: InputSource;
  sourceKey: string;
  /** Pitches that stopped sounding because this pedal came up. */
  damped: number[];
}

export type ResetReason = "allNotesOff" | "disconnect" | "reset" | "clearSource";

export interface ResetChange {
  kind: "reset";
  reason: ResetReason;
  /** null when every source was reset. */
  sourceKey: string | null;
  portId?: string;
  timestampMs?: number;
  /** Pitches (pressed or sustained) that were cleared. */
  cleared: number[];
}

export type HeldChange = AttackChange | ReleaseChange | PedalChange | ResetChange;

export type HeldChangeListener = (change: HeldChange) => void;

interface SourceState {
  key: string;
  source: InputSource;
  portId?: string;
  channel?: number;
  /** midi → last attack velocity */
  pressed: Map<number, number>;
  sustained: Set<number>;
  sostenutoCaptured: Set<number>;
  sustainDown: boolean;
  sostenutoDown: boolean;
  softDown: boolean;
}

/**
 * Stable source identity. MIDI (and replayed MIDI) is keyed by port + channel; the
 * computer keyboard and touch input each form a single source.
 */
export function sourceKeyOf(event: { source: InputSource; portId?: string; channel?: number }): string {
  if (event.source === "computerKeyboard" || event.source === "touch") {
    return event.source;
  }
  const port = event.portId !== undefined && event.portId !== "" ? event.portId : "unknown";
  const channel = event.channel !== undefined ? event.channel : 1;
  return `${event.source}:${port}#${channel}`;
}

function sortedNumbers(values: Iterable<number>): number[] {
  return Array.from(values).sort((a, b) => a - b);
}

function emptySnapshot(): HeldStateSnapshot {
  return { pressed: [], sustained: [], sustainDown: false, sostenutoDown: false, softDown: false };
}

export class HeldStateTracker {
  private sources = new Map<string, SourceState>();
  private listeners = new Set<HeldChangeListener>();

  onChange(listener: HeldChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Apply one input event; returns (and emits) the resulting changes. */
  apply(event: InputEvent): HeldChange[] {
    const changes = this.compute(event);
    for (const change of changes) {
      this.emit(change);
    }
    return changes;
  }

  /** Aggregate snapshot across all sources. A pitch pressed anywhere is never reported as sustained. */
  snapshot(): HeldStateSnapshot {
    const pressed = new Set<number>();
    const sustained = new Set<number>();
    const result = emptySnapshot();
    this.sources.forEach((state) => {
      state.pressed.forEach((_velocity, midi) => pressed.add(midi));
      state.sustained.forEach((midi) => sustained.add(midi));
      result.sustainDown = result.sustainDown || state.sustainDown;
      result.sostenutoDown = result.sostenutoDown || state.sostenutoDown;
      result.softDown = result.softDown || state.softDown;
    });
    pressed.forEach((midi) => sustained.delete(midi));
    result.pressed = sortedNumbers(pressed);
    result.sustained = sortedNumbers(sustained);
    return result;
  }

  /** Snapshot for one source key, or null when the source has no state. */
  snapshotFor(sourceKey: string): HeldStateSnapshot | null {
    const state = this.sources.get(sourceKey);
    if (!state) {
      return null;
    }
    return {
      pressed: sortedNumbers(state.pressed.keys()),
      sustained: sortedNumbers(state.sustained),
      sustainDown: state.sustainDown,
      sostenutoDown: state.sostenutoDown,
      softDown: state.softDown
    };
  }

  /** Pitches currently sounding (pressed ∪ sustained) across all sources, ascending. */
  sounding(): number[] {
    const all = new Set<number>();
    this.sources.forEach((state) => {
      state.pressed.forEach((_velocity, midi) => all.add(midi));
      state.sustained.forEach((midi) => all.add(midi));
    });
    return sortedNumbers(all);
  }

  /** Physically pressed pitches across all sources, ascending. */
  pressed(): number[] {
    return this.snapshot().pressed;
  }

  sourceKeys(): string[] {
    return Array.from(this.sources.keys()).sort();
  }

  /** Clear every source (panic). Always emits one "reset" change. */
  reset(timestampMs?: number): void {
    const cleared = this.sounding();
    this.sources.clear();
    const change: ResetChange = { kind: "reset", reason: "reset", sourceKey: null, cleared };
    if (timestampMs !== undefined) {
      change.timestampMs = timestampMs;
    }
    this.emit(change);
  }

  /** Clear one source key. Emits "reset" only when that source had state. */
  clearSource(sourceKey: string, timestampMs?: number): HeldChange[] {
    const state = this.sources.get(sourceKey);
    if (!state) {
      return [];
    }
    const change = this.clearState(state, "clearSource", timestampMs);
    this.emit(change);
    return [change];
  }

  /** Clear every source belonging to a MIDI port (any channel). */
  clearPort(portId: string, timestampMs?: number): HeldChange[] {
    const changes = this.clearPortInternal(portId, "disconnect", timestampMs);
    for (const change of changes) {
      this.emit(change);
    }
    return changes;
  }

  private clearPortInternal(portId: string, reason: ResetReason, timestampMs?: number): HeldChange[] {
    const matching: SourceState[] = [];
    this.sources.forEach((state) => {
      if (state.portId === portId) {
        matching.push(state);
      }
    });
    return matching.map((state) => this.clearState(state, reason, timestampMs));
  }

  private clearState(state: SourceState, reason: ResetReason, timestampMs?: number): ResetChange {
    const cleared = new Set<number>(state.sustained);
    state.pressed.forEach((_velocity, midi) => cleared.add(midi));
    this.sources.delete(state.key);
    const change: ResetChange = { kind: "reset", reason, sourceKey: state.key, cleared: sortedNumbers(cleared) };
    if (state.portId !== undefined) {
      change.portId = state.portId;
    }
    if (timestampMs !== undefined) {
      change.timestampMs = timestampMs;
    }
    return change;
  }

  private stateFor(event: InputEvent): SourceState {
    const key = sourceKeyOf(event);
    const existing = this.sources.get(key);
    if (existing) {
      return existing;
    }
    const created: SourceState = {
      key,
      source: event.source,
      pressed: new Map<number, number>(),
      sustained: new Set<number>(),
      sostenutoCaptured: new Set<number>(),
      sustainDown: false,
      sostenutoDown: false,
      softDown: false
    };
    if (event.portId !== undefined) {
      created.portId = event.portId;
    }
    if (event.channel !== undefined) {
      created.channel = event.channel;
    }
    this.sources.set(key, created);
    return created;
  }

  private compute(event: InputEvent): HeldChange[] {
    switch (event.type) {
      case "noteOn":
        return this.noteOn(event);
      case "noteOff":
        return this.noteOff(event);
      case "sustain":
      case "sostenuto":
      case "soft":
        return this.pedal(event, event.type);
      case "allNotesOff": {
        const state = this.sources.get(sourceKeyOf(event));
        return state ? [this.clearState(state, "allNotesOff", event.timestampMs)] : [];
      }
      case "connection":
        if (event.connected === false && event.portId !== undefined) {
          return this.clearPortInternal(event.portId, "disconnect", event.timestampMs);
        }
        return [];
      default:
        return [];
    }
  }

  private noteOn(event: InputEvent): HeldChange[] {
    if (event.midi === undefined) {
      return [];
    }
    const velocity = event.velocity !== undefined ? event.velocity : 0;
    if (velocity <= 0) {
      // Defensive: zero-velocity note-on is a note-off even if a caller skipped normalisation.
      return this.noteOff({ ...event, type: "noteOff", velocity: 0 });
    }
    const state = this.stateFor(event);
    const midi = event.midi;
    const retrigger = state.pressed.has(midi) || state.sustained.has(midi);
    state.sustained.delete(midi);
    state.pressed.set(midi, velocity);
    const change: AttackChange = {
      kind: "attack",
      midi,
      velocity,
      timestampMs: event.timestampMs,
      source: event.source,
      sourceKey: state.key,
      retrigger
    };
    if (event.portId !== undefined) {
      change.portId = event.portId;
    }
    if (event.channel !== undefined) {
      change.channel = event.channel;
    }
    return [change];
  }

  private noteOff(event: InputEvent): HeldChange[] {
    if (event.midi === undefined) {
      return [];
    }
    const state = this.sources.get(sourceKeyOf(event));
    // A note-off for a key that is not physically pressed (already released, sustained-only,
    // or never seen) changes nothing.
    if (!state || !state.pressed.has(event.midi)) {
      return [];
    }
    const midi = event.midi;
    state.pressed.delete(midi);
    const held = state.sustainDown || (state.sostenutoDown && state.sostenutoCaptured.has(midi));
    if (held) {
      state.sustained.add(midi);
    }
    return [
      {
        kind: "release",
        midi,
        timestampMs: event.timestampMs,
        source: event.source,
        sourceKey: state.key,
        stillSounding: held
      }
    ];
  }

  private pedal(event: InputEvent, pedal: PedalKind): HeldChange[] {
    const value = event.value !== undefined ? event.value : 0;
    const down = isPedalDown(value);
    const state = this.stateFor(event);
    const current = pedal === "sustain" ? state.sustainDown : pedal === "sostenuto" ? state.sostenutoDown : state.softDown;
    if (current === down) {
      // Continuous controller streams (half-pedal) repeat values; only transitions matter.
      return [];
    }
    const damped: number[] = [];
    if (pedal === "sustain") {
      state.sustainDown = down;
      if (!down) {
        state.sustained.forEach((midi) => {
          if (!(state.sostenutoDown && state.sostenutoCaptured.has(midi))) {
            damped.push(midi);
          }
        });
      }
    } else if (pedal === "sostenuto") {
      state.sostenutoDown = down;
      if (down) {
        // Sostenuto captures only the keys physically pressed at the moment it goes down.
        state.sostenutoCaptured = new Set<number>(state.pressed.keys());
      } else {
        if (!state.sustainDown) {
          state.sustained.forEach((midi) => {
            if (state.sostenutoCaptured.has(midi)) {
              damped.push(midi);
            }
          });
        }
        state.sostenutoCaptured = new Set<number>();
      }
    } else {
      state.softDown = down;
    }
    for (const midi of damped) {
      state.sustained.delete(midi);
    }
    return [
      {
        kind: "pedal",
        pedal,
        down,
        value,
        timestampMs: event.timestampMs,
        source: event.source,
        sourceKey: state.key,
        damped: damped.sort((a, b) => a - b)
      }
    ];
  }

  private emit(change: HeldChange): void {
    this.listeners.forEach((listener) => {
      listener(change);
    });
  }
}
