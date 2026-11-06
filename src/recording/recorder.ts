/**
 * Performance recorder (framework-free, clock-injected).
 *
 * Lifecycle: idle → (countIn →) recording → ready → idle (discard) / recording (new take).
 * Playback of a finished take is NOT the recorder's job: the runtime converts the take to a
 * `PerformanceTimeline` and plays it on the shared transport.
 *
 * Capture rules
 * - Only normalised learner `InputEvent`s are accepted (MIDI, computer keyboard, on-screen piano,
 *   replay). Transport/audition output never reaches the recorder, so playback is never recorded.
 * - `zeroMs` is an explicit performance-clock reading for beat 0 of the take; it may lie in the
 *   future while a count-in runs. Events are stored relative to it, so silence before the first
 *   note is kept.
 * - During the count-in, note attacks are dropped except within a short anticipation window
 *   before the downbeat (they are clamped to 0, so a slightly early first chord is not lost).
 *   Pedal state established before the downbeat is written as pedal events at 0.
 * - Note-offs that match no recorded attack are ignored; a `connection: false` event or an
 *   explicit `reset()` (device switch, panic) closes that source's notes with an `allNotesOff`.
 * - Stopping while keys are held or the pedal is down is safe: `pairRecordedNotes` closes them at
 *   the stop boundary; nothing is appended to the event list.
 * - Limits: `maxEvents` events / `maxMs` length. When reached, `limitReached` is raised and later
 *   events are ignored; the owner should stop the take.
 */
import type { HeldStateSnapshot, InputEvent, InputSource, TempoSpec, TimeSignatureSpec } from "@/model/contracts";
import { HeldStateTracker, sourceKeyOf } from "@/input/heldState";
import { PEDAL_DOWN_THRESHOLD } from "@/input/normalize";
import type { PerformanceRecording, RecordedEvent, RecordedEventType, RecordedSource } from "@/recording/types";
import { MAX_RECORDING_EVENTS, MAX_RECORDING_MS, RECORDING_KIND, RECORDING_SCHEMA_VERSION } from "@/recording/types";

export type RecorderStatus = "idle" | "countIn" | "recording" | "ready";

export interface RecorderSnapshot {
  status: RecorderStatus;
  /** Performance-clock time of beat 0 while a take is being captured; null otherwise. */
  zeroMs: number | null;
  /** Attacks captured so far (live) or in the finished take. */
  noteCount: number;
  eventCount: number;
  warnings: string[];
  limitReached: boolean;
  take: PerformanceRecording | null;
}

export interface RecorderStartOptions {
  tempo: TempoSpec;
  timeSignature: TimeSignatureSpec;
  countInBeats?: number;
  /** Performance-clock ms of beat 0. Default: now. */
  zeroMs?: number;
  title?: string;
  id?: string;
  /** Pedal state known to be down when the take starts (e.g. from the shared held-state tracker). */
  initialPedals?: Pick<HeldStateSnapshot, "sustainDown" | "sostenutoDown" | "softDown">;
}

export interface RecorderOptions {
  /** Performance clock (ms). Default performance.now(). */
  now?: () => number;
  /** Wall-clock ISO timestamp for createdAt/updatedAt. Default new Date().toISOString(). */
  nowIso?: () => string;
  newId?: (prefix: string) => string;
  maxEvents?: number;
  maxMs?: number;
  /** Attacks this close before the downbeat are kept (clamped to 0). Default 80 ms. */
  anticipationMs?: number;
}

type PedalType = "sustain" | "sostenuto" | "soft";
const PEDALS: readonly PedalType[] = ["sustain", "sostenuto", "soft"];

function defaultNow(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

let idCounter = 0;
function defaultId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

function isPedal(type: InputEvent["type"]): type is PedalType {
  return type === "sustain" || type === "sostenuto" || type === "soft";
}

export class PerformanceRecorder {
  private readonly now: () => number;
  private readonly nowIso: () => string;
  private readonly newId: (prefix: string) => string;
  private readonly maxEvents: number;
  private readonly maxMs: number;
  private readonly anticipationMs: number;

  private status: RecorderStatus = "idle";
  private tracker = new HeldStateTracker();
  private events: RecordedEvent[] = [];
  private noteCount = 0;
  private warnings: string[] = [];
  private limitReached = false;
  private zeroMs: number | null = null;
  private meta: { tempo: TempoSpec; timeSignature: TimeSignatureSpec; countInBeats: number; title: string; id: string } | null = null;
  private take: PerformanceRecording | null = null;
  private readonly sourceMeta = new Map<string, { source: InputSource; portId?: string; portName?: string; channel?: number }>();
  /** Pedal values seen before beat 0, per source key. */
  private readonly preZeroPedals = new Map<string, Map<PedalType, number>>();
  private initialPedals = new Set<PedalType>();
  private initialFlushed = false;

  private readonly listeners = new Set<() => void>();
  private cached: RecorderSnapshot | null = null;

  constructor(options: RecorderOptions = {}) {
    this.now = options.now ?? defaultNow;
    this.nowIso = options.nowIso ?? (() => new Date().toISOString());
    this.newId = options.newId ?? defaultId;
    this.maxEvents = options.maxEvents ?? MAX_RECORDING_EVENTS;
    this.maxMs = options.maxMs ?? MAX_RECORDING_MS;
    this.anticipationMs = options.anticipationMs ?? 80;
  }

  // -------------------------------------------------------------------------
  // Observation
  // -------------------------------------------------------------------------

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Cached; a new object only after a change was notified (useSyncExternalStore-safe). */
  getSnapshot(): RecorderSnapshot {
    if (!this.cached) {
      this.cached = this.buildSnapshot();
    }
    return this.cached;
  }

  getStatus(): RecorderStatus {
    return this.resolveStatus();
  }

  isActive(): boolean {
    return this.status === "countIn" || this.status === "recording";
  }

  getTake(): PerformanceRecording | null {
    return this.take;
  }

  /** Milliseconds captured so far (0 before the downbeat), or the finished take's length. */
  elapsedMs(): number {
    if (this.isActive() && this.zeroMs !== null) {
      return Math.min(this.maxMs, Math.max(0, this.now() - this.zeroMs));
    }
    return this.take ? this.take.durationMs : 0;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Begin a take. Returns false (and does nothing) while another take is being captured. */
  start(options: RecorderStartOptions): boolean {
    if (this.isActive()) {
      return false;
    }
    const zero = options.zeroMs ?? this.now();
    this.tracker = new HeldStateTracker();
    this.events = [];
    this.noteCount = 0;
    this.warnings = [];
    this.limitReached = false;
    this.sourceMeta.clear();
    this.preZeroPedals.clear();
    this.initialPedals = new Set<PedalType>();
    if (options.initialPedals) {
      if (options.initialPedals.sustainDown) this.initialPedals.add("sustain");
      if (options.initialPedals.sostenutoDown) this.initialPedals.add("sostenuto");
      if (options.initialPedals.softDown) this.initialPedals.add("soft");
    }
    this.initialFlushed = false;
    this.take = null;
    this.zeroMs = zero;
    this.meta = {
      tempo: { bpm: Number.isFinite(options.tempo.bpm) && options.tempo.bpm > 0 ? options.tempo.bpm : 120 },
      timeSignature: { numerator: options.timeSignature.numerator, denominator: options.timeSignature.denominator },
      countInBeats: Math.max(0, Math.round(options.countInBeats ?? 0)),
      title: options.title ?? "Take",
      id: options.id ?? this.newId("rec")
    };
    this.status = zero > this.now() ? "countIn" : "recording";
    this.notify();
    return true;
  }

  /** Re-evaluate countIn → recording (call when the clock passes beat 0, e.g. from the transport). */
  tick(): void {
    const resolved = this.resolveStatus();
    if (resolved !== this.status) {
      this.status = resolved;
      this.notify();
    }
  }

  /**
   * Finish the take at `atMs` (default now). Held notes are not altered here: pairing closes them
   * at the stop boundary. Returns the take (possibly without any note), or null when not active.
   */
  stop(atMs?: number): PerformanceRecording | null {
    if (!this.isActive() || this.zeroMs === null || !this.meta) {
      return null;
    }
    const stopAt = atMs ?? this.now();
    this.flushInitialPedals(null);
    const durationMs = Math.min(this.maxMs, Math.max(0, stopAt - this.zeroMs));
    const nowIso = this.nowIso();
    const take: PerformanceRecording = {
      schemaVersion: RECORDING_SCHEMA_VERSION,
      kind: RECORDING_KIND,
      id: this.meta.id,
      title: this.meta.title,
      createdAt: nowIso,
      updatedAt: nowIso,
      tempo: { ...this.meta.tempo },
      timeSignature: { ...this.meta.timeSignature },
      countInBeats: this.meta.countInBeats,
      durationMs,
      events: this.events.filter((event) => event.atMs <= durationMs),
      sources: this.collectSources()
    };
    this.take = take;
    this.status = "ready";
    this.zeroMs = null;
    this.tracker = new HeldStateTracker();
    this.notify();
    return take;
  }

  /** Drop the finished take (or abort a running one without keeping anything). */
  discard(): void {
    if (this.isActive()) {
      this.stop();
    }
    this.take = null;
    this.events = [];
    this.noteCount = 0;
    this.warnings = [];
    this.status = "idle";
    this.notify();
  }

  /** Install an existing take (e.g. loaded from storage). Ignored while capturing. */
  setTake(recording: PerformanceRecording | null): boolean {
    if (this.isActive()) {
      return false;
    }
    this.take = recording;
    this.events = [];
    this.warnings = [];
    this.noteCount = recording ? recording.events.filter((event) => event.type === "noteOn").length : 0;
    this.status = recording ? "ready" : "idle";
    this.notify();
    return true;
  }

  /** Update the finished take's title (returns the new take, or null). */
  retitle(title: string): PerformanceRecording | null {
    if (!this.take) {
      return null;
    }
    this.take = { ...this.take, title, updatedAt: this.nowIso() };
    this.notify();
    return this.take;
  }

  // -------------------------------------------------------------------------
  // Capture
  // -------------------------------------------------------------------------

  /** Feed one learner input event. Ignored unless a take is being captured. */
  handleEvent(event: InputEvent): void {
    if (!this.isActive() || this.zeroMs === null) {
      return;
    }
    if (event.type === "connection") {
      if (event.connected === false && event.portId !== undefined) {
        this.closePort(event.portId, event.timestampMs, `${event.portName || "The MIDI device"} disconnected; its held notes were closed.`);
      }
      return;
    }
    if (this.limitReached) {
      return;
    }
    const rel = event.timestampMs - this.zeroMs;
    if (rel > this.maxMs) {
      this.limitReached = true;
      this.warnings.push("The maximum recording length was reached.");
      this.notify();
      return;
    }
    this.rememberSource(event);

    if (rel < -this.anticipationMs) {
      this.handlePreZero(event);
      return;
    }
    this.flushInitialPedals(event);
    const atMs = Math.max(0, rel);
    const changes = this.tracker.apply({ ...event, timestampMs: atMs });
    let record = false;
    if (event.type === "noteOn") {
      record = changes.length > 0;
    } else if (event.type === "noteOff") {
      record = changes.length > 0;
    } else if (isPedal(event.type)) {
      record = true;
    } else if (event.type === "allNotesOff") {
      record = changes.length > 0;
    }
    if (!record) {
      return;
    }
    this.push(this.toRecorded(event, atMs));
    if (changes.some((change) => change.kind === "attack")) {
      this.noteCount += 1;
      this.notify();
    }
    if (this.status === "countIn") {
      this.tick();
    }
  }

  /**
   * Close every note of one MIDI port (device switch) at `atMs` (default now). A port with no
   * open notes changes nothing.
   */
  closePort(portId: string, atMs?: number, warning?: string): void {
    if (!this.isActive() || this.zeroMs === null) {
      return;
    }
    const at = Math.max(0, (atMs ?? this.now()) - this.zeroMs);
    const changes = this.tracker.apply({ source: "midi", type: "connection", timestampMs: at, portId, connected: false });
    let changed = false;
    for (const change of changes) {
      if (change.kind === "reset" && change.sourceKey !== null) {
        const meta = this.sourceMeta.get(change.sourceKey);
        if (meta) {
          this.push({ type: "allNotesOff", atMs: at, source: meta.source, ...(meta.portId !== undefined ? { portId: meta.portId } : {}), ...(meta.channel !== undefined ? { channel: meta.channel } : {}) });
          changed = true;
        }
      }
    }
    if (changed && warning) {
      this.warnings.push(warning);
    }
    if (changed) {
      this.notify();
    }
  }

  /** Close every open note of every source (panic). */
  reset(atMs?: number, warning?: string): void {
    if (!this.isActive() || this.zeroMs === null) {
      return;
    }
    const at = Math.max(0, (atMs ?? this.now()) - this.zeroMs);
    let changed = false;
    for (const key of this.tracker.sourceKeys()) {
      const meta = this.sourceMeta.get(key);
      if (!meta) {
        continue;
      }
      const event: InputEvent = { source: meta.source, type: "allNotesOff", timestampMs: at };
      if (meta.portId !== undefined) event.portId = meta.portId;
      if (meta.channel !== undefined) event.channel = meta.channel;
      const changes = this.tracker.apply(event);
      if (changes.length > 0) {
        this.push(this.toRecorded(event, at));
        changed = true;
      }
    }
    if (changed && warning) {
      this.warnings.push(warning);
    }
    if (changed) {
      this.notify();
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private resolveStatus(): RecorderStatus {
    if (this.status === "countIn" && this.zeroMs !== null && this.now() >= this.zeroMs) {
      return "recording";
    }
    return this.status;
  }

  private rememberSource(event: InputEvent): void {
    const key = sourceKeyOf(event);
    if (this.sourceMeta.has(key)) {
      return;
    }
    const meta: { source: InputSource; portId?: string; portName?: string; channel?: number } = { source: event.source };
    if (event.portId !== undefined) meta.portId = event.portId;
    if (event.portName !== undefined) meta.portName = event.portName;
    if (event.channel !== undefined) meta.channel = event.channel;
    this.sourceMeta.set(key, meta);
  }

  private collectSources(): RecordedSource[] {
    const seen = new Set<string>();
    const out: RecordedSource[] = [];
    this.sourceMeta.forEach((meta) => {
      const id = `${meta.source}:${meta.portId ?? ""}`;
      if (seen.has(id)) {
        return;
      }
      seen.add(id);
      const source: RecordedSource = { source: meta.source };
      if (meta.portId !== undefined) source.portId = meta.portId;
      if (meta.portName !== undefined) source.portName = meta.portName;
      out.push(source);
    });
    return out;
  }

  private handlePreZero(event: InputEvent): void {
    // Before the downbeat (count-in): keep pedal state, let the tracker see releases, drop attacks.
    if (isPedal(event.type)) {
      const key = sourceKeyOf(event);
      let pedals = this.preZeroPedals.get(key);
      if (!pedals) {
        pedals = new Map<PedalType, number>();
        this.preZeroPedals.set(key, pedals);
      }
      pedals.set(event.type, event.value ?? 0);
      this.tracker.apply({ ...event, timestampMs: 0 });
      return;
    }
    if (event.type === "noteOff" || event.type === "allNotesOff") {
      this.tracker.apply({ ...event, timestampMs: 0 });
    }
    // noteOn during the count-in: dropped (pickups are not captured; see README).
  }

  /** Write pedal-down events at 0 for pedals held before the downbeat (once). */
  private flushInitialPedals(trigger: InputEvent | null): void {
    if (this.initialFlushed) {
      return;
    }
    this.initialFlushed = true;
    const covered = new Set<PedalType>();
    this.preZeroPedals.forEach((pedals, key) => {
      const meta = this.sourceMeta.get(key);
      if (!meta) {
        return;
      }
      PEDALS.forEach((pedal) => {
        const value = pedals.get(pedal);
        if (value !== undefined && value >= PEDAL_DOWN_THRESHOLD) {
          this.push({ type: pedal, atMs: 0, value, source: meta.source, ...(meta.portId !== undefined ? { portId: meta.portId } : {}), ...(meta.channel !== undefined ? { channel: meta.channel } : {}) });
          covered.add(pedal);
        }
      });
    });
    if (trigger && this.initialPedals.size > 0) {
      PEDALS.forEach((pedal) => {
        if (!this.initialPedals.has(pedal) || covered.has(pedal)) {
          return;
        }
        const event: InputEvent = { source: trigger.source, type: pedal, timestampMs: 0, value: 127 };
        if (trigger.portId !== undefined) event.portId = trigger.portId;
        if (trigger.channel !== undefined) event.channel = trigger.channel;
        this.tracker.apply(event);
        this.push(this.toRecorded(event, 0));
      });
    }
    this.preZeroPedals.clear();
  }

  private toRecorded(event: InputEvent, atMs: number): RecordedEvent {
    const recorded: RecordedEvent = { type: event.type as RecordedEventType, atMs, source: event.source };
    if (event.portId !== undefined) recorded.portId = event.portId;
    if (event.channel !== undefined) recorded.channel = event.channel;
    if (event.midi !== undefined) recorded.midi = event.midi;
    if (event.velocity !== undefined) recorded.velocity = event.velocity;
    if (event.value !== undefined) recorded.value = event.value;
    return recorded;
  }

  private push(event: RecordedEvent): void {
    if (this.events.length >= this.maxEvents) {
      if (!this.limitReached) {
        this.limitReached = true;
        this.warnings.push("The maximum number of recorded events was reached.");
        this.notify();
      }
      return;
    }
    this.events.push(event);
  }

  private buildSnapshot(): RecorderSnapshot {
    return {
      status: this.status,
      zeroMs: this.isActive() ? this.zeroMs : null,
      noteCount: this.noteCount,
      eventCount: this.isActive() ? this.events.length : this.take ? this.take.events.length : 0,
      warnings: [...this.warnings],
      limitReached: this.limitReached,
      take: this.take
    };
  }

  private notify(): void {
    this.cached = null;
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch {
        // A faulty listener must not break capture.
      }
    });
  }
}
