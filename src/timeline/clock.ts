/**
 * Explicit clock mapping between musical time (beats) and real time (plan §4 "Timing and input").
 *
 * Three different clocks exist in the browser and they are NOT interchangeable:
 *
 * 1. Musical time — quarter-note beats from the start of a timeline. This is the authored
 *    source of truth (`PerformedNote.onsetBeat`).
 * 2. The performance clock — `performance.now()` in milliseconds. Web MIDI input/output
 *    timestamps and `InputEvent.timestampMs` live on this clock. The transport anchors its
 *    musical position to this clock.
 * 3. The Web Audio clock — `AudioContext.currentTime` (Tone.now()) in seconds. It starts at an
 *    arbitrary point, runs on the audio thread and drifts relative to `performance.now()`.
 *
 * The transport only speaks performance-clock milliseconds. Output adapters translate a
 * performance-clock time into their own clock *at call time* (see `perfMsToAudioSeconds`), so
 * drift never accumulates beyond one lookahead window.
 */

const MIN_BPM = 1;

function safeBpm(bpm: number): number {
  if (!Number.isFinite(bpm) || bpm < MIN_BPM) {
    return MIN_BPM;
  }
  return bpm;
}

/** Converts a beat count to seconds at a constant tempo. */
export function beatsToSeconds(beats: number, bpm: number): number {
  return (beats * 60) / safeBpm(bpm);
}

/** Converts seconds to a beat count at a constant tempo. */
export function secondsToBeats(seconds: number, bpm: number): number {
  return (seconds * safeBpm(bpm)) / 60;
}

/** Beats per bar measured in quarter-note beats (6/8 = 3, 7/8 = 3.5, 4/4 = 4). */
export function beatsPerBar(numerator: number, denominator: number): number {
  const num = Number.isFinite(numerator) && numerator > 0 ? numerator : 4;
  const den = Number.isFinite(denominator) && denominator > 0 ? denominator : 4;
  return num * (4 / den);
}

export interface TempoMapEntry {
  /** Beat at which this tempo takes effect. */
  beat: number;
  bpm: number;
}

/**
 * Piecewise-constant tempo map. v1 uses a single entry, but every conversion goes through the
 * map so later tempo changes fit without changing the transport API. Beats before the first
 * entry (e.g. a negative count-in) use the first entry's tempo.
 */
export class TempoMap {
  private readonly entries: TempoMapEntry[];
  /** Seconds elapsed at each entry's beat, measured from beat 0. */
  private readonly secondsAtEntry: number[];

  constructor(entries: TempoMapEntry[] | number) {
    const list: TempoMapEntry[] =
      typeof entries === "number" ? [{ beat: 0, bpm: entries }] : entries.map((entry) => ({ beat: entry.beat, bpm: entry.bpm }));
    if (list.length === 0) {
      list.push({ beat: 0, bpm: 120 });
    }
    list.sort((a, b) => a.beat - b.beat);
    this.entries = list.map((entry) => ({ beat: entry.beat, bpm: safeBpm(entry.bpm) }));

    this.secondsAtEntry = [];
    const first = this.entries[0];
    // Seconds at the first entry, measured from beat 0 at the first tempo.
    let seconds = beatsToSeconds(first.beat, first.bpm);
    this.secondsAtEntry.push(seconds);
    for (let i = 1; i < this.entries.length; i += 1) {
      const prev = this.entries[i - 1];
      const entry = this.entries[i];
      seconds += beatsToSeconds(entry.beat - prev.beat, prev.bpm);
      this.secondsAtEntry.push(seconds);
    }
  }

  static constant(bpm: number): TempoMap {
    return new TempoMap(bpm);
  }

  getEntries(): TempoMapEntry[] {
    return this.entries.map((entry) => ({ beat: entry.beat, bpm: entry.bpm }));
  }

  private entryIndexAtBeat(beat: number): number {
    let index = 0;
    for (let i = 1; i < this.entries.length; i += 1) {
      if (this.entries[i].beat <= beat) {
        index = i;
      } else {
        break;
      }
    }
    return index;
  }

  private entryIndexAtSeconds(seconds: number): number {
    let index = 0;
    for (let i = 1; i < this.secondsAtEntry.length; i += 1) {
      if (this.secondsAtEntry[i] <= seconds) {
        index = i;
      } else {
        break;
      }
    }
    return index;
  }

  bpmAt(beat: number): number {
    return this.entries[this.entryIndexAtBeat(beat)].bpm;
  }

  /** Seconds from beat 0 to `beat` (negative for negative beats). */
  secondsAt(beat: number): number {
    const index = this.entryIndexAtBeat(beat);
    const entry = this.entries[index];
    return this.secondsAtEntry[index] + beatsToSeconds(beat - entry.beat, entry.bpm);
  }

  /** Inverse of `secondsAt`. */
  beatAt(seconds: number): number {
    const index = this.entryIndexAtSeconds(seconds);
    const entry = this.entries[index];
    return entry.beat + secondsToBeats(seconds - this.secondsAtEntry[index], entry.bpm);
  }
}

/**
 * Relates the performance clock to musical time: `originMs` (a `performance.now()` reading,
 * typically taken when the transport starts or re-anchors) corresponds to `originBeat`.
 */
export class ClockMapping {
  readonly originMs: number;
  readonly originBeat: number;
  readonly tempoMap: TempoMap;
  private readonly originSeconds: number;

  constructor(originMs: number, originBeat: number, tempoMap: TempoMap) {
    this.originMs = originMs;
    this.originBeat = originBeat;
    this.tempoMap = tempoMap;
    this.originSeconds = tempoMap.secondsAt(originBeat);
  }

  /** Musical position (beats) at a performance-clock reading. */
  nowBeats(perfNowMs: number): number {
    return this.tempoMap.beatAt(this.originSeconds + (perfNowMs - this.originMs) / 1000);
  }

  /** Performance-clock time (ms) at which `beat` occurs. */
  beatToPerfMs(beat: number): number {
    return this.originMs + (this.tempoMap.secondsAt(beat) - this.originSeconds) * 1000;
  }

  /** Re-anchor at `perfNowMs` keeping the beat position continuous, optionally with a new tempo map. */
  reanchor(perfNowMs: number, tempoMap?: TempoMap): ClockMapping {
    const beat = this.nowBeats(perfNowMs);
    return new ClockMapping(perfNowMs, beat, tempoMap ?? this.tempoMap);
  }
}

/**
 * Translate a performance-clock time into the Web Audio clock. Call it at the moment the event
 * is handed to the audio engine: `audioNowSec` (Tone.now()) and `perfNowMs` (performance.now())
 * must be sampled together. Times in the past are clamped to "now".
 */
export function perfMsToAudioSeconds(atMs: number, perfNowMs: number, audioNowSec: number): number {
  return audioNowSec + Math.max(0, atMs - perfNowMs) / 1000;
}

/** Clock + timer source used by the transport and timer-based adapters (injectable for tests). */
export interface SchedulerClock {
  /** Performance-clock time in ms. */
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/**
 * Default clock: `performance.now()` and the global timers. Globals are looked up lazily on every
 * call so that test fake timers installed after construction are honoured.
 */
export function defaultSchedulerClock(): SchedulerClock {
  return {
    now(): number {
      if (typeof performance !== "undefined" && typeof performance.now === "function") {
        return performance.now();
      }
      return Date.now();
    },
    setTimeout(callback: () => void, ms: number): unknown {
      return globalThis.setTimeout(callback, ms);
    },
    clearTimeout(handle: unknown): void {
      globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
    }
  };
}
