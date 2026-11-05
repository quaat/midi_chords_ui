/**
 * Timeline transport (plan E10) — framework-free.
 *
 * Plays a compiled `PerformanceTimeline` through a `TimelineEngine` with a bounded lookahead:
 * a tick runs every `tickMs` (25 ms) and hands the engine every note on/off due within the next
 * `lookaheadMs` (150 ms), stamped with performance-clock milliseconds.
 *
 * Time model
 * - A `ClockMapping` relates the performance clock to an unwrapped "linear" beat axis that starts
 *   at the play position minus the count-in. Loop passes keep increasing the linear beat; the
 *   musical position is the linear beat folded into the loop region.
 * - Every play/seek/stop/pause/loop/tempo/mute/output change increments `generation`, cancels the
 *   pending tick timer, drops queued work and sends `allNotesOff` so nothing stale or stuck
 *   survives. Restarts while playing re-anchor the clock at the current beat (continuous position)
 *   and "chase" notes already sounding at that beat.
 * - Repeated pitches across a loop boundary or between adjacent events are retriggered: the
 *   noteOff is always issued before the noteOn at the same instant.
 *
 * Listener semantics (what the UI may rely on)
 * - `subscribe(fn)`: called on state changes only — load, play start, count-in → playing, loop
 *   wrap, pause, stop, natural end, seek, tempo/loop/count-in/metronome/mute changes. Never per frame.
 * - `getSnapshot()`: live position computed from the clock on every call (poll it from
 *   requestAnimationFrame). Returns a new object each call.
 * - `getStateSnapshot()`: cached object that only changes when listeners are notified — use it
 *   with React `useSyncExternalStore`.
 * - `onNoteOn` / `onNoteOff`: fired (within one tick, ≤ 25 ms) when a note actually starts/stops
 *   sounding, with the exact `PerformedNote` object from the timeline (same reference that audio,
 *   highlighting and export use). The note's `part` tells demonstration/accompaniment/metronome
 *   apart from learner material; NONE of these events are learner input. On pause/stop/seek and
 *   other restarts every note that was reported on gets a matching `onNoteOff`.
 */
import type { PartId, PerformanceTimeline, PerformedNote, TransportSnapshot, TransportState } from "@/model/contracts";
import type { TimelineEngine } from "@/playback/timelineEngines";
import { COUNT_IN_EVENT_ID, DEFAULT_METRONOME_CHANNEL, buildMetronomeNotes, countInNotes } from "@/playback/metronome";
import type { SchedulerClock } from "@/timeline/clock";
import { ClockMapping, TempoMap, beatsPerBar, beatsToSeconds, defaultSchedulerClock } from "@/timeline/clock";

export interface LoopRegion {
  startBeat: number;
  endBeat: number;
}

export type ChannelRouting = Record<PartId, number>;

export const DEFAULT_CHANNEL_BY_PART: ChannelRouting = {
  learner: 1,
  accompaniment: 2,
  demonstration: 3,
  metronome: DEFAULT_METRONOME_CHANNEL
};

export const MIN_LOOP_BEATS = 0.25;

export interface TransportOptions {
  /** Performance clock + timers. Default: performance.now() and global setTimeout. */
  clock?: SchedulerClock;
  /** How far ahead notes are handed to the engine. Default 150 ms. */
  lookaheadMs?: number;
  /** Scheduler tick interval. Default 25 ms. */
  tickMs?: number;
  /**
   * Notes whose onset is further than this in the past (late tick, background tab) are not played
   * at their onset: they are attacked "now" (flagged chased) if still sounding, else dropped. Default 100 ms.
   */
  maxLateMs?: number;
  /** Re-attack notes already sounding at the position after a restart/resume. Default true. */
  chaseNotes?: boolean;
  channelByPart?: Partial<ChannelRouting>;
  /** Count-in override; default the timeline's `countInBeats`. */
  countInBeats?: number;
  /** Metronome on/off; default "follow the timeline" (on iff it contains metronome notes). */
  metronome?: boolean;
}

/** Snapshot with transport settings; assignable to the shared `TransportSnapshot` contract. */
export interface TransportStatus extends TransportSnapshot {
  loop: LoopRegion | null;
  countInBeats: number;
  /** The beat the running count-in leads into; null when not counting in. */
  countInTargetBeat: number | null;
  metronomeEnabled: boolean;
  mutedParts: PartId[];
  /** Zero-based loop pass (0 without a loop). */
  loopPass: number;
  timelineId: string | null;
}

export interface NoteEventInfo {
  /** Performance-clock time the engine was asked to sound the event at. */
  atMs: number;
  channel: number;
  generation: number;
  /** Unwrapped beat on the transport's linear axis (grows across loop passes). */
  linearBeat: number;
  /** True when the note was re-attacked after a restart rather than at its onset. */
  chased: boolean;
  /** True for count-in clicks. */
  countIn: boolean;
}

export type NoteListener = (note: PerformedNote, info: NoteEventInfo) => void;
export type TransportListener = (status: TransportStatus) => void;

export interface LoadOptions {
  /** Keep the current position (clamped) instead of returning to 0. */
  keepPosition?: boolean;
}

interface PendingOff {
  linear: number;
  note: PerformedNote;
  channel: number;
  chased: boolean;
  countIn: boolean;
}

interface DispatchItem {
  linear: number;
  kind: "on" | "off";
  note: PerformedNote;
  channel: number;
  chased: boolean;
  countIn: boolean;
  order: number;
}

interface QueuedNoteEvent {
  atMs: number;
  kind: "on" | "off";
  note: PerformedNote;
  info: NoteEventInfo;
  order: number;
}

const EPSILON = 1e-6;
const MIN_CHASE_REMAINING_BEATS = 0.05;

function lowerBound(notes: PerformedNote[], beat: number): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].onsetBeat < beat) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

export class Transport {
  private engine: TimelineEngine;
  private clock: SchedulerClock;
  private readonly lookaheadMs: number;
  private readonly tickMs: number;
  private readonly maxLateMs: number;
  private readonly chaseNotes: boolean;

  private timeline: PerformanceTimeline | null = null;
  /** Notes eligible for playback, sorted by onset (mutes and metronome applied). */
  private playable: PerformedNote[] = [];

  private state: TransportState = "stopped";
  private restBeat = 0;
  private tempoOverride: number | null = null;
  private loop: LoopRegion | null = null;
  private countInOverride: number | null;
  private metronomeSetting: boolean | null;
  private readonly muted = new Set<PartId>();
  private readonly channelByPart: ChannelRouting;

  private generation = 0;
  private mapping: ClockMapping | null = null;
  private scheduledLinear = 0;
  private countInTarget: number | null = null;
  private countInClicks: PerformedNote[] = [];
  private chasePending: number | null = null;
  private endLinear: number | null = null;
  private pendingOffs: PendingOff[] = [];
  private noteQueue: QueuedNoteEvent[] = [];
  private readonly reportedSounding = new Map<string, { note: PerformedNote; channel: number }>();
  private timer: unknown = null;
  private timerActive = false;
  private startPending = false;
  private lastPass = 0;
  private order = 0;
  private disposed = false;

  private readonly stateListeners = new Set<TransportListener>();
  private readonly noteOnListeners = new Set<NoteListener>();
  private readonly noteOffListeners = new Set<NoteListener>();
  private cachedStatus: TransportStatus | null = null;

  constructor(engine: TimelineEngine, options: TransportOptions = {}) {
    this.engine = engine;
    this.clock = options.clock ?? defaultSchedulerClock();
    this.lookaheadMs = options.lookaheadMs ?? 150;
    this.tickMs = options.tickMs ?? 25;
    this.maxLateMs = options.maxLateMs ?? 100;
    this.chaseNotes = options.chaseNotes ?? true;
    this.channelByPart = { ...DEFAULT_CHANNEL_BY_PART, ...(options.channelByPart ?? {}) };
    this.countInOverride = options.countInBeats ?? null;
    this.metronomeSetting = options.metronome ?? null;
  }

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  /** Replace the clock/timers (tests). Cancels any running playback first. */
  injectClock(clock: SchedulerClock): void {
    if (this.isActive() || this.startPending) {
      this.stop();
    }
    this.clock = clock;
  }

  load(timeline: PerformanceTimeline, options: LoadOptions = {}): void {
    if (this.disposed) {
      return;
    }
    const keep = options.keepPosition ? this.currentMusicalPosition() : 0;
    this.cancelPlayback();
    this.timeline = timeline;
    this.loop = this.normalizeLoop(this.loop);
    this.rebuildPlayable();
    this.state = "stopped";
    this.restBeat = Math.max(0, Math.min(keep, timeline.totalBeats));
    this.emit();
  }

  getTimeline(): PerformanceTimeline | null {
    return this.timeline;
  }

  /** Tempo override in BPM; null restores the timeline tempo. Position in beats stays continuous. */
  setTempo(bpm: number | null): void {
    if (this.disposed) {
      return;
    }
    this.tempoOverride = bpm !== null && Number.isFinite(bpm) && bpm > 0 ? bpm : null;
    if (this.isActive() && this.mapping) {
      this.restartAt(this.mapping.nowBeats(this.clock.now()), true);
    }
    this.emit();
  }

  /** Loop region in beats (clamped to the timeline), or null. */
  setLoop(region: LoopRegion | null): void {
    if (this.disposed) {
      return;
    }
    const position = this.currentMusicalPosition();
    const wasCountingIn = this.state === "countingIn";
    const target = this.countInTarget;
    this.loop = this.normalizeLoop(region);
    if (this.isActive()) {
      if (wasCountingIn && target !== null) {
        this.beginAt(this.positionForLoop(target), true);
      } else {
        this.restartAt(this.positionForLoop(position), false);
      }
    }
    this.emit();
  }

  /** Count-in beats for subsequent play() calls; null restores the timeline's count-in. */
  setCountIn(beats: number | null): void {
    if (this.disposed) {
      return;
    }
    this.countInOverride = beats !== null && Number.isFinite(beats) ? Math.max(0, Math.round(beats)) : null;
    this.emit();
  }

  setMetronome(enabled: boolean): void {
    if (this.disposed) {
      return;
    }
    this.metronomeSetting = enabled;
    this.rebuildPlayable();
    this.restartIfActive();
    this.emit();
  }

  setPartMuted(part: PartId, muted: boolean): void {
    if (this.disposed) {
      return;
    }
    if (muted) {
      this.muted.add(part);
    } else {
      this.muted.delete(part);
    }
    this.rebuildPlayable();
    this.restartIfActive();
    this.emit();
  }

  isPartMuted(part: PartId): boolean {
    return this.muted.has(part);
  }

  /** Route a part to a 1-based MIDI channel. */
  setPartChannel(part: PartId, channel: number): void {
    if (this.disposed) {
      return;
    }
    this.channelByPart[part] = Math.min(16, Math.max(1, Math.round(channel)));
    this.restartIfActive();
  }

  getChannelRouting(): ChannelRouting {
    return { ...this.channelByPart };
  }

  /** Switch output adapter. The old engine is silenced; playback continues on the new one. */
  async setEngine(engine: TimelineEngine): Promise<void> {
    if (this.disposed || engine === this.engine) {
      return;
    }
    const old = this.engine;
    this.safeEngine(() => old.allNotesOff());
    this.engine = engine;
    if (!this.isActive()) {
      return;
    }
    // Suspend scheduling while the new engine prepares; the clock keeps running.
    this.generation += 1;
    this.clearTimer();
    this.releaseReportedNotes();
    this.pendingOffs = [];
    const generation = this.generation;
    try {
      await engine.prepare();
    } catch {
      // Keep going: notes are simply dropped by an unavailable engine.
    }
    if (generation !== this.generation || this.disposed || !this.mapping) {
      return;
    }
    this.restartAt(this.mapping.nowBeats(this.clock.now()), true);
  }

  getEngine(): TimelineEngine {
    return this.engine;
  }

  // -------------------------------------------------------------------------
  // Transport control
  // -------------------------------------------------------------------------

  /**
   * Start playback from `fromBeat` (default: paused/seeked position, or 0). With a loop region the
   * start is moved to the loop start when it lies outside the loop. A count-in (if configured)
   * runs first: position goes from start − countIn up to start (negative when starting at 0).
   * Resolves after the engine is prepared; a stop/seek/pause meanwhile cancels the start.
   */
  async play(fromBeat?: number): Promise<void> {
    if (this.disposed || !this.timeline) {
      return;
    }
    if (this.isActive()) {
      if (fromBeat !== undefined) {
        this.seek(fromBeat);
      }
      return;
    }
    const total = this.totalBeats();
    if (total <= 0) {
      return;
    }
    let start = Math.max(0, Math.min(fromBeat ?? this.restBeat, total));
    if (start >= total - EPSILON) {
      start = 0;
    }
    if (this.loop && (start < this.loop.startBeat - EPSILON || start >= this.loop.endBeat - EPSILON)) {
      start = this.loop.startBeat;
    }

    this.cancelPlayback();
    const generation = this.generation;
    this.startPending = true;
    try {
      await this.engine.prepare();
    } catch {
      if (generation === this.generation) {
        this.startPending = false;
      }
      return;
    }
    if (generation !== this.generation || this.disposed) {
      return;
    }
    this.startPending = false;
    this.beginAt(start, true);
    this.emit();
  }

  pause(): void {
    if (this.disposed) {
      return;
    }
    if (!this.isActive()) {
      if (this.startPending) {
        this.cancelPlayback();
      }
      return;
    }
    const position = this.state === "countingIn" && this.countInTarget !== null ? this.countInTarget : this.currentMusicalPosition();
    this.cancelPlayback();
    this.state = "paused";
    this.restBeat = Math.max(0, Math.min(position, this.totalBeats()));
    this.emit();
  }

  /** Stop and return to beat 0. */
  stop(): void {
    if (this.disposed) {
      return;
    }
    this.cancelPlayback();
    this.state = "stopped";
    this.restBeat = 0;
    this.emit();
  }

  /**
   * Move to `beat` (clamped to the timeline). While playing, playback continues from there
   * (a running count-in is cancelled). With a loop, seeking at/after the loop end goes to the loop start.
   */
  seek(beat: number): void {
    if (this.disposed) {
      return;
    }
    const total = this.totalBeats();
    const target = this.positionForLoop(Math.max(0, Math.min(Number.isFinite(beat) ? beat : 0, total)));
    if (this.isActive()) {
      this.restartAt(target, false);
    } else {
      this.cancelPlayback();
      this.restBeat = target;
    }
    this.emit();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.cancelPlayback();
    this.disposed = true;
    this.state = "stopped";
    this.stateListeners.clear();
    this.noteOnListeners.clear();
    this.noteOffListeners.clear();
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  // -------------------------------------------------------------------------
  // Observation
  // -------------------------------------------------------------------------

  subscribe(listener: TransportListener): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  onNoteOn(listener: NoteListener): () => void {
    this.noteOnListeners.add(listener);
    return () => {
      this.noteOnListeners.delete(listener);
    };
  }

  onNoteOff(listener: NoteListener): () => void {
    this.noteOffListeners.add(listener);
    return () => {
      this.noteOffListeners.delete(listener);
    };
  }

  /** Live snapshot (position read from the clock now). New object per call. */
  getSnapshot(): TransportStatus {
    const tempoBpm = this.bpm();
    const total = this.totalBeats();
    let state: TransportState = this.state;
    let position = this.restBeat;
    let pass = 0;
    if (this.isActive() && this.mapping) {
      const linear = this.mapping.nowBeats(this.clock.now());
      position = this.musicalAt(linear);
      pass = this.passAt(linear);
      if (state === "countingIn" && this.countInTarget !== null && linear >= this.countInTarget - EPSILON) {
        state = "playing";
      }
      if (!this.loop && state === "playing") {
        position = Math.min(position, total);
      }
    }
    return {
      state,
      positionBeats: position,
      positionSeconds: beatsToSeconds(position, tempoBpm),
      tempoBpm,
      totalBeats: total,
      loop: this.loop ? { startBeat: this.loop.startBeat, endBeat: this.loop.endBeat } : null,
      generation: this.generation,
      countInBeats: this.effectiveCountIn(),
      countInTargetBeat: state === "countingIn" ? this.countInTarget : null,
      metronomeEnabled: this.metronomeEnabled(),
      mutedParts: [...this.muted],
      loopPass: pass,
      timelineId: this.timeline ? this.timeline.id : null
    };
  }

  /** Cached snapshot that only changes when subscribers are notified (for useSyncExternalStore). */
  getStateSnapshot(): TransportStatus {
    if (!this.cachedStatus) {
      this.cachedStatus = this.getSnapshot();
    }
    return this.cachedStatus;
  }

  /** Notes currently reported as sounding (after onNoteOn, before onNoteOff). */
  getSoundingNotes(): PerformedNote[] {
    return [...this.reportedSounding.values()].map((entry) => entry.note);
  }

  /** Notes eligible for playback after mutes/metronome (what the transport will schedule). */
  getPlayableNotes(): PerformedNote[] {
    return [...this.playable];
  }

  // -------------------------------------------------------------------------
  // Internals: state helpers
  // -------------------------------------------------------------------------

  private isActive(): boolean {
    return this.state === "playing" || this.state === "countingIn";
  }

  private bpm(): number {
    if (this.tempoOverride !== null) {
      return this.tempoOverride;
    }
    return this.timeline ? this.timeline.tempo.bpm : 120;
  }

  private totalBeats(): number {
    return this.timeline ? this.timeline.totalBeats : 0;
  }

  private barLength(): number {
    if (!this.timeline) {
      return 4;
    }
    return beatsPerBar(this.timeline.timeSignature.numerator, this.timeline.timeSignature.denominator);
  }

  private effectiveCountIn(): number {
    const raw = this.countInOverride ?? (this.timeline ? this.timeline.countInBeats ?? 0 : 0);
    return Math.max(0, Math.round(raw));
  }

  private metronomeEnabled(): boolean {
    if (this.metronomeSetting !== null) {
      return this.metronomeSetting;
    }
    return this.timeline ? this.timeline.notes.some((note) => note.part === "metronome") : false;
  }

  private normalizeLoop(region: LoopRegion | null): LoopRegion | null {
    if (!region || !Number.isFinite(region.startBeat) || !Number.isFinite(region.endBeat)) {
      return null;
    }
    const total = this.timeline ? this.timeline.totalBeats : Number.POSITIVE_INFINITY;
    const start = Math.max(0, Math.min(region.startBeat, total));
    const end = Math.max(0, Math.min(region.endBeat, total));
    if (end - start < MIN_LOOP_BEATS) {
      return null;
    }
    return { startBeat: start, endBeat: end };
  }

  private positionForLoop(position: number): number {
    if (this.loop && position >= this.loop.endBeat - EPSILON) {
      return this.loop.startBeat;
    }
    return position;
  }

  private currentMusicalPosition(): number {
    if (this.isActive() && this.mapping) {
      const linear = this.mapping.nowBeats(this.clock.now());
      if (this.state === "countingIn" && this.countInTarget !== null && linear < this.countInTarget) {
        return this.countInTarget;
      }
      return Math.min(this.musicalAt(linear), this.totalBeats());
    }
    return this.restBeat;
  }

  /** Fold a linear beat into musical time (count-in and loop aware). */
  private musicalAt(linear: number): number {
    if (this.countInTarget !== null && linear < this.countInTarget - EPSILON) {
      return linear;
    }
    const loop = this.loop;
    if (loop && linear >= loop.startBeat - EPSILON) {
      const length = loop.endBeat - loop.startBeat;
      const pass = Math.floor((linear - loop.startBeat + EPSILON) / length);
      return Math.max(loop.startBeat, linear - pass * length);
    }
    return linear;
  }

  private passAt(linear: number): number {
    const loop = this.loop;
    if (!loop || linear < loop.startBeat - EPSILON || (this.countInTarget !== null && linear < this.countInTarget - EPSILON)) {
      return 0;
    }
    return Math.max(0, Math.floor((linear - loop.startBeat + EPSILON) / (loop.endBeat - loop.startBeat)));
  }

  private rebuildPlayable(): void {
    const timeline = this.timeline;
    if (!timeline) {
      this.playable = [];
      return;
    }
    const metronomeOn = this.metronomeEnabled() && !this.muted.has("metronome");
    const hasMetronomeNotes = timeline.notes.some((note) => note.part === "metronome");
    const notes = timeline.notes.filter(
      (note) => note.durationBeats > 0 && !this.muted.has(note.part) && (note.part !== "metronome" || metronomeOn)
    );
    if (metronomeOn && !hasMetronomeNotes) {
      buildMetronomeNotes({ startBeat: 0, endBeat: timeline.totalBeats, beatsPerBar: this.barLength(), bpm: this.bpm() }).forEach(
        (note) => notes.push(note)
      );
    }
    // Stable by onset; ties keep the compiler's order.
    this.playable = notes
      .map((note, index) => ({ note, index }))
      .sort((a, b) => (a.note.onsetBeat !== b.note.onsetBeat ? a.note.onsetBeat - b.note.onsetBeat : a.index - b.index))
      .map((entry) => entry.note);
  }

  private channelFor(note: PerformedNote): number {
    const routed = this.channelByPart[note.part];
    if (Number.isFinite(routed)) {
      return routed;
    }
    return note.channel ?? 1;
  }

  private emit(): void {
    this.cachedStatus = this.getSnapshot();
    const status = this.cachedStatus;
    [...this.stateListeners].forEach((listener) => {
      try {
        listener(status);
      } catch {
        // Listener errors must not break the transport.
      }
    });
  }

  private safeEngine(action: () => void): void {
    try {
      action();
    } catch {
      // An output failure must not break scheduling.
    }
  }

  private clearTimer(): void {
    if (this.timerActive) {
      this.clock.clearTimeout(this.timer);
    }
    this.timer = null;
    this.timerActive = false;
  }

  /** Emit onNoteOff for every reported note and drop queued note events. */
  private releaseReportedNotes(): void {
    const now = this.clock.now();
    const entries = [...this.reportedSounding.values()];
    this.reportedSounding.clear();
    this.noteQueue = [];
    entries.forEach((entry) => {
      this.notify(this.noteOffListeners, entry.note, {
        atMs: now,
        channel: entry.channel,
        generation: this.generation,
        linearBeat: Number.NaN,
        chased: false,
        countIn: entry.note.eventId === COUNT_IN_EVENT_ID
      });
    });
  }

  /** New generation: cancel timers, silence the engine, forget scheduled work. */
  private cancelPlayback(): void {
    this.generation += 1;
    this.startPending = false;
    this.clearTimer();
    this.safeEngine(() => this.engine.allNotesOff());
    this.releaseReportedNotes();
    this.pendingOffs = [];
    this.mapping = null;
    this.countInTarget = null;
    this.countInClicks = [];
    this.chasePending = null;
    this.endLinear = null;
  }

  /** Start a fresh run at musical `start` (optionally with count-in). Engine must be prepared. */
  private beginAt(start: number, withCountIn: boolean): void {
    this.cancelPlayback();
    const generation = this.generation;
    const countIn = withCountIn ? this.effectiveCountIn() : 0;
    const startLinear = start - countIn;
    this.mapping = new ClockMapping(this.clock.now(), startLinear, TempoMap.constant(this.bpm()));
    this.scheduledLinear = startLinear;
    if (countIn > 0) {
      this.countInTarget = start;
      this.countInClicks = countInNotes(countIn, this.bpm(), { targetBeat: start, beatsPerBar: this.barLength() });
      this.state = "countingIn";
    } else {
      this.state = "playing";
    }
    this.chasePending = this.chaseNotes ? start : null;
    this.restBeat = start;
    this.lastPass = this.passAt(start);
    this.runTick(generation);
  }

  /** Re-anchor at linear beat `linear` while playing (seek/tempo/loop/mute/output changes). */
  private restartAt(linear: number, keepCountIn: boolean): void {
    const wasCountingIn = this.state === "countingIn";
    const target = this.countInTarget;
    const clicks = this.countInClicks;
    this.cancelPlayback();
    const generation = this.generation;
    this.mapping = new ClockMapping(this.clock.now(), linear, TempoMap.constant(this.bpm()));
    this.scheduledLinear = linear;
    if (keepCountIn && wasCountingIn && target !== null && linear < target - EPSILON) {
      this.countInTarget = target;
      this.countInClicks = clicks;
      this.state = "countingIn";
      this.chasePending = this.chaseNotes ? target : null;
    } else {
      this.state = "playing";
      this.chasePending = this.chaseNotes ? linear : null;
    }
    this.lastPass = this.passAt(linear);
    this.runTick(generation);
  }

  private restartIfActive(): void {
    if (this.isActive() && this.mapping) {
      this.restartAt(this.mapping.nowBeats(this.clock.now()), true);
    }
  }

  // -------------------------------------------------------------------------
  // Internals: scheduling
  // -------------------------------------------------------------------------

  private runTick(generation: number): void {
    if (generation !== this.generation || this.disposed) {
      return;
    }
    this.timerActive = false;
    this.timer = null;
    this.tick();
    if (generation !== this.generation || this.disposed || !this.isActive()) {
      return;
    }
    this.timer = this.clock.setTimeout(() => this.runTick(generation), this.tickMs);
    this.timerActive = true;
  }

  private tick(): void {
    const mapping = this.mapping;
    if (!mapping) {
      return;
    }
    const generation = this.generation;
    const now = this.clock.now();
    const horizon = mapping.nowBeats(now + this.lookaheadMs);
    this.dispatchUntil(horizon, now, mapping);
    this.flushNoteEvents(now);
    if (generation !== this.generation) {
      // A note listener paused/stopped/seeked the transport.
      return;
    }

    const linear = mapping.nowBeats(now);
    if (this.state === "countingIn" && this.countInTarget !== null && linear >= this.countInTarget - EPSILON) {
      this.state = "playing";
      this.emit();
    }
    if (this.loop) {
      const pass = this.passAt(linear);
      if (pass !== this.lastPass) {
        this.lastPass = pass;
        this.emit();
      }
    }
    if (
      this.endLinear !== null &&
      linear >= this.endLinear - EPSILON &&
      this.pendingOffs.length === 0 &&
      this.noteQueue.length === 0
    ) {
      this.cancelPlayback();
      this.state = "stopped";
      this.restBeat = 0;
      this.emit();
    }
  }

  private pushOn(items: DispatchItem[], note: PerformedNote, linear: number, offLinear: number, chased: boolean, countIn: boolean): void {
    const channel = this.channelFor(note);
    items.push({ linear, kind: "on", note, channel, chased, countIn, order: this.order++ });
    this.pendingOffs.push({ linear: Math.max(linear, offLinear), note, channel, chased, countIn });
  }

  private collectChase(chaseLinear: number, items: DispatchItem[]): void {
    const musical = this.musicalAt(chaseLinear);
    const offset = chaseLinear - musical;
    const loop = this.loop;
    const regionEnd = loop ? loop.endBeat : this.totalBeats();
    this.playable.forEach((note) => {
      if (note.part === "metronome") {
        return;
      }
      const end = Math.min(note.onsetBeat + note.durationBeats, regionEnd);
      if (note.onsetBeat < musical - EPSILON && end - musical > MIN_CHASE_REMAINING_BEATS) {
        this.pushOn(items, note, chaseLinear, end + offset, true, false);
      }
    });
  }

  private dispatchUntil(horizon: number, now: number, mapping: ClockMapping): void {
    const items: DispatchItem[] = [];
    const lateLimit = mapping.nowBeats(now - this.maxLateMs);
    const nowLinear = mapping.nowBeats(now);

    if (
      this.chasePending !== null &&
      this.chasePending < horizon - EPSILON &&
      (this.countInTarget === null || this.chasePending >= this.countInTarget - EPSILON)
    ) {
      this.collectChase(this.chasePending, items);
      this.chasePending = null;
    }

    const total = this.totalBeats();
    let cursor = this.scheduledLinear;
    let guard = 0;
    while (cursor < horizon - EPSILON && guard < 10000) {
      guard += 1;

      // Count-in zone: clicks only.
      if (this.countInTarget !== null && cursor < this.countInTarget - EPSILON) {
        const segmentEnd = Math.min(horizon, this.countInTarget);
        if (!this.muted.has("metronome")) {
          this.countInClicks.forEach((click) => {
            if (click.onsetBeat >= cursor - EPSILON && click.onsetBeat < segmentEnd - EPSILON && click.onsetBeat >= lateLimit) {
              this.pushOn(items, click, click.onsetBeat, Math.min(click.onsetBeat + click.durationBeats, this.countInTarget ?? segmentEnd), false, true);
            }
          });
        }
        cursor = segmentEnd;
        continue;
      }

      if (this.endLinear !== null) {
        cursor = horizon;
        break;
      }

      const musical = this.musicalAt(cursor);
      const offset = cursor - musical;
      const loop = this.loop;
      let boundary = total;
      let clipEnd = total;
      if (loop) {
        clipEnd = loop.endBeat;
        boundary = musical < loop.startBeat - EPSILON ? loop.startBeat : loop.endBeat;
      }
      const segmentEnd = Math.min(boundary, musical + (horizon - cursor));

      for (let i = lowerBound(this.playable, musical - EPSILON); i < this.playable.length; i += 1) {
        const note = this.playable[i];
        if (note.onsetBeat >= segmentEnd - EPSILON) {
          break;
        }
        const linear = note.onsetBeat + offset;
        if (loop && note.onsetBeat >= clipEnd - EPSILON) {
          continue;
        }
        const offLinear = Math.min(note.onsetBeat + note.durationBeats, clipEnd) + offset;
        if (linear < lateLimit) {
          // Too late to sound at its onset (stalled tick): attack now only if it still has a
          // meaningful remainder, never burst a backlog of past notes.
          if (note.part !== "metronome" && offLinear - nowLinear > MIN_CHASE_REMAINING_BEATS) {
            this.pushOn(items, note, nowLinear, offLinear, true, false);
          }
          continue;
        }
        this.pushOn(items, note, linear, offLinear, false, false);
      }

      if (!loop && segmentEnd >= total - EPSILON) {
        this.endLinear = total + offset;
      }
      let next = segmentEnd + offset;
      if (next <= cursor + 1e-9) {
        next = cursor + EPSILON;
      }
      cursor = next;
    }
    this.scheduledLinear = Math.max(this.scheduledLinear, cursor);

    const keep: PendingOff[] = [];
    this.pendingOffs.forEach((pending) => {
      if (pending.linear < horizon - EPSILON || (this.endLinear !== null && pending.linear <= this.endLinear + EPSILON && horizon > this.endLinear)) {
        items.push({
          linear: pending.linear,
          kind: "off",
          note: pending.note,
          channel: pending.channel,
          chased: pending.chased,
          countIn: pending.countIn,
          order: this.order++
        });
      } else {
        keep.push(pending);
      }
    });
    this.pendingOffs = keep;

    if (items.length === 0) {
      return;
    }
    items.sort((a, b) => {
      if (Math.abs(a.linear - b.linear) > EPSILON) {
        return a.linear - b.linear;
      }
      if (a.kind !== b.kind) {
        return a.kind === "off" ? -1 : 1;
      }
      return a.order - b.order;
    });

    const generation = this.generation;
    items.forEach((item) => {
      const atMs = Math.max(now, mapping.beatToPerfMs(item.linear));
      if (item.kind === "on") {
        this.safeEngine(() => this.engine.noteOn(item.note.midi, item.note.velocity, item.channel, atMs));
      } else {
        this.safeEngine(() => this.engine.noteOff(item.note.midi, item.channel, atMs));
      }
      this.noteQueue.push({
        atMs,
        kind: item.kind,
        note: item.note,
        order: item.order,
        info: { atMs, channel: item.channel, generation, linearBeat: item.linear, chased: item.chased, countIn: item.countIn }
      });
    });
    this.noteQueue.sort((a, b) => (a.atMs !== b.atMs ? a.atMs - b.atMs : 0));
  }

  private flushNoteEvents(now: number): void {
    const generation = this.generation;
    while (this.noteQueue.length > 0 && this.noteQueue[0].atMs <= now + EPSILON) {
      const event = this.noteQueue.shift();
      if (!event) {
        break;
      }
      if (event.kind === "on") {
        this.reportedSounding.set(event.note.id, { note: event.note, channel: event.info.channel });
        this.notify(this.noteOnListeners, event.note, event.info);
      } else {
        if (!this.reportedSounding.has(event.note.id)) {
          continue;
        }
        this.reportedSounding.delete(event.note.id);
        this.notify(this.noteOffListeners, event.note, event.info);
      }
      if (generation !== this.generation) {
        // A listener restarted/stopped the transport; the queue was reset.
        return;
      }
    }
  }

  private notify(listeners: Set<NoteListener>, note: PerformedNote, info: NoteEventInfo): void {
    [...listeners].forEach((listener) => {
      try {
        listener(note, info);
      } catch {
        // ignore listener errors
      }
    });
  }
}
