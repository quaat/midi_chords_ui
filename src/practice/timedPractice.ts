/**
 * Timed practice session (plan E14): onsets are graded against the exercise timeline.
 *
 * Events in: `onTransportSnapshot(snapshot)` (poll `Transport.getSnapshot()` each frame and on
 * every `subscribe` notification), `onAttack(midi, timestampMs, source)`, `onRelease(...)`,
 * `update()`; then `finish()` or `abort()`. State out: `getState()` / `subscribe(listener)`.
 *
 * Clock model
 * - Attack timestamps and the injected `clock()` must share one clock (performance.now ms).
 * - Musical beats map to clock ms through an anchor taken when the transport is first seen
 *   "playing" at beat ≥ 0: expected(note, pass) = anchorMs + (linear(note, pass) − anchorBeat)
 *   × 60000 / bpm, with linear(beat, pass) = beat + pass × loopLength. Each play segment (until
 *   pause/stop/seek/tempo change, i.e. a new transport `generation`) has its own anchor.
 * - `latencyOffsetMs` is subtracted from every attack timestamp (input arrives that much late);
 *   `actualOnsetMs` in observations is the adjusted time.
 *
 * Grading
 * - onTime when |delta| ≤ onsetWindowMs (default 120; the exact boundary is on time); early/late
 *   when outside that but within the search window (default 2 × onset window); otherwise the
 *   attack is an extra and the target is missed. A target is finalised as missed once the clock
 *   passes expected + search window.
 * - Count-in attacks are ignored (not penalised) — except attacks inside the search window just
 *   before beat 0, which may anticipate the downbeat. Attacks while paused/stopped are ignored
 *   and targets whose window was still open at a pause are dropped, not penalised.
 * - Policy decides the timing targets: exactVoicing → every learner note (exact MIDI);
 *   pitchClass → every learner note (pitch class); roles → only notes whose role is required
 *   (pitch class unless octaveFree === false); listen/free → nothing is graded.
 * - Loops: observations are keyed per pass — targetNoteId `${noteId}@${pass}` and occurrenceId
 *   `${occurrenceId}@${pass}` (use `baseOccurrenceId` to strip the suffix).
 * - Durations are graded only when `timing.gradeDuration` (reported in state, not in the
 *   AttemptResult contract).
 */
import type {
  AssistanceLevel,
  AttemptResult,
  ExerciseDefinition,
  ExerciseStep,
  InputSource,
  PerformedNote,
  PitchObservation,
  TimingObservation,
  TransportSnapshot
} from "@/model/contracts";
import { mod12 } from "@/music";
import { buildAttemptResult } from "@/practice/feedback";
import type { BuildAttemptInput } from "@/practice/feedback";
import { matchSequenceAttacks, matchStep } from "@/practice/matching";
import type { TimedAttack } from "@/practice/matching";
import { isLearnerSource } from "@/practice/stepPractice";

export const DEFAULT_ONSET_WINDOW_MS = 120;

export type TimedPhase = "idle" | "ready" | "countingIn" | "playing" | "paused" | "stopped" | "finished" | "aborted";

export interface LoopRange {
  startBeat: number;
  endBeat: number;
}

export interface TimedPracticeOptions {
  /** Tempo used when snapshots do not carry one; also reported in the result. Default: timeline tempo. */
  tempoBpm?: number;
  /** Subtracted from attack timestamps. Default 0. */
  latencyOffsetMs?: number;
  /** Count-in the transport is configured with (reported only; count-in is read from snapshots). */
  countInBeats?: number;
  /** Loop region; snapshots carrying `loop` take precedence. */
  loop?: LoopRange | null;
  /** Performance clock shared with attack timestamps. Default performance.now / Date.now. */
  clock?: () => number;
  /** Wall clock for ISO timestamps. Default Date.now. */
  wallClock?: () => number;
  /** Credit window for early/late attacks. Default 2 × onset window. */
  searchWindowMs?: number;
  inputSource?: InputSource;
  assistance?: AssistanceLevel;
  hintLevel?: number;
  attemptId?: string;
}

/** Snapshot accepted from the transport (`TransportStatus` adds `loopPass`). */
export type TimedSnapshot = TransportSnapshot & { loopPass?: number };

export interface DurationObservation {
  targetNoteId: string;
  occurrenceId: string;
  expectedDurationMs: number;
  actualDurationMs?: number;
  verdict: "ok" | "short" | "long" | "unknown";
}

export interface TimedPracticeState {
  phase: TimedPhase;
  exerciseId: string | null;
  tempoBpm: number;
  latencyOffsetMs: number;
  onsetWindowMs: number;
  searchWindowMs: number;
  /** Resolved observations so far (matched or finalised as missed), in expected-time order. */
  observations: TimingObservation[];
  /** Pitch observations for fully resolved occurrence passes. */
  pitch: PitchObservation[];
  /** Targets created but not yet resolved. */
  pendingTargets: number;
  /** Learner attacks not credited to any target. */
  extraAttacks: number;
  durations: DurationObservation[];
  /** Loop pass at the clock's current position (0 without a loop). */
  loopPass: number;
  result: AttemptResult | null;
}

export type TimedPracticeListener = (state: TimedPracticeState) => void;

interface TargetInstance {
  key: string;
  occKey: string;
  note: PerformedNote;
  pass: number;
  expectedMs: number;
}

interface StoredAttack extends TimedAttack {
  rawMs: number;
}

interface Release {
  midi: number;
  timestampMs: number;
}

interface Segment {
  generation: number;
  anchorMs: number;
  anchorLinear: number;
  passAtAnchor: number;
  msPerBeat: number;
  loop: LoopRange | null;
  instances: TargetInstance[];
  created: Set<string>;
  attacks: StoredAttack[];
  releases: Release[];
  closedAtMs: number | null;
}

interface SegmentEvaluation {
  observations: { instance: TargetInstance; observation: TimingObservation; attack: StoredAttack | null }[];
  extras: StoredAttack[];
  pending: number;
}

const EPS = 1e-6;

function defaultClock(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

export class TimedPracticeSession {
  private exercise: ExerciseDefinition | null = null;
  private options: TimedPracticeOptions = {};
  private phase: TimedPhase = "idle";
  private segments: Segment[] = [];
  private open: Segment | null = null;
  private countInBuffer: StoredAttack[] = [];
  private usedKeys = new Set<string>();
  private targets: PerformedNote[] = [];
  private steps = new Map<string, ExerciseStep>();
  private startedAt = "";
  private result: AttemptResult | null = null;
  private detectedSource: InputSource | null = null;
  private lastLoop: LoopRange | null = null;
  private lastPassSeen = 0;
  private listeners = new Set<TimedPracticeListener>();
  private cached: TimedPracticeState | null = null;

  start(exercise: ExerciseDefinition, options: TimedPracticeOptions = {}): void {
    this.exercise = exercise;
    this.options = { ...options };
    this.phase = "ready";
    this.segments = [];
    this.open = null;
    this.countInBuffer = [];
    this.usedKeys = new Set<string>();
    this.result = null;
    this.detectedSource = null;
    this.lastLoop = options.loop ?? null;
    this.lastPassSeen = 0;
    this.startedAt = new Date((options.wallClock ?? Date.now)()).toISOString();
    this.steps = new Map<string, ExerciseStep>();
    exercise.steps.forEach((step) => this.steps.set(step.occurrenceId, step));
    this.targets = this.timingTargets(exercise);
    this.emit();
  }

  // -------------------------------------------------------------------------
  // Events in
  // -------------------------------------------------------------------------

  onTransportSnapshot(snapshot: TimedSnapshot, atMs?: number): void {
    if (!this.exercise || this.phase === "finished" || this.phase === "aborted" || this.phase === "idle") {
      return;
    }
    const now = atMs ?? this.now();
    const loop = this.loopFrom(snapshot);
    const playing = snapshot.state === "playing" && snapshot.positionBeats >= -EPS;
    if (this.open && (!playing || snapshot.generation !== this.open.generation)) {
      this.closeSegment(now);
    }
    if (playing && !this.open) {
      this.openSegment(snapshot, loop, now);
    }
    if (snapshot.state === "countingIn" || (snapshot.state === "playing" && !playing)) {
      this.phase = "countingIn";
    } else if (snapshot.state === "playing") {
      this.phase = "playing";
    } else if (snapshot.state === "paused") {
      this.phase = "paused";
      this.countInBuffer = [];
    } else {
      this.phase = this.segments.length > 0 || this.open ? "stopped" : "ready";
      this.countInBuffer = [];
    }
    this.ensureInstances(now);
    this.emit();
  }

  onAttack(midi: number, timestampMs: number, source: string): void {
    if (!this.exercise || !isLearnerSource(source)) {
      return;
    }
    const adjusted = timestampMs - this.latencyMs();
    const attack: StoredAttack = { midi, timestampMs: adjusted, rawMs: timestampMs };
    if (this.open) {
      if (this.detectedSource === null) this.detectedSource = source;
      this.open.attacks.push(attack);
      this.ensureInstances(this.now());
      this.emit();
      return;
    }
    if (this.phase === "countingIn") {
      // Kept only so an attack anticipating beat 0 can be credited; older ones are dropped.
      if (this.detectedSource === null) this.detectedSource = source;
      this.countInBuffer.push(attack);
    }
    // Paused / stopped / ready: ignored.
  }

  onRelease(midi: number, timestampMs: number, source: string = "midi"): void {
    if (!this.exercise || !isLearnerSource(source) || !this.open) {
      return;
    }
    this.open.releases.push({ midi, timestampMs: timestampMs - this.latencyMs() });
  }

  /** Re-evaluate against the clock (finalises missed targets). Call from an animation frame. */
  update(nowMs?: number): void {
    if (!this.exercise) {
      return;
    }
    this.ensureInstances(nowMs ?? this.now());
    this.emit(nowMs);
  }

  /** End the attempt and build the result (mode "timed"). */
  finish(nowMs?: number): AttemptResult | null {
    if (!this.exercise || this.phase === "finished" || this.phase === "aborted") {
      return this.result;
    }
    const now = nowMs ?? this.now();
    this.ensureInstances(now);
    if (this.open) {
      this.closeSegment(now);
    }
    const { timing, pitch } = this.collect(now);
    const exercise = this.exercise;
    const input: BuildAttemptInput = {
      exercise,
      mode: "timed",
      pitch,
      timing,
      inputSource: this.options.inputSource ?? this.detectedSource ?? "midi",
      assistance: this.options.assistance ?? "none",
      hintLevel: this.options.hintLevel ?? 0,
      startedAt: this.startedAt,
      completedAt: new Date((this.options.wallClock ?? Date.now)()).toISOString(),
      tempoBpm: this.tempoBpm(),
      latencyOffsetMs: this.latencyMs(),
      stepsCompleted: pitch.filter((obs) => obs.correct).length,
      stepsTotal: pitch.length
    };
    if (this.options.attemptId !== undefined) input.id = this.options.attemptId;
    this.result = buildAttemptResult(input);
    this.phase = "finished";
    this.emit(now);
    return this.result;
  }

  /** Discard the attempt (no result). */
  abort(): void {
    this.open = null;
    this.segments = [];
    this.countInBuffer = [];
    this.result = null;
    this.phase = "aborted";
    this.emit();
  }

  // -------------------------------------------------------------------------
  // State out
  // -------------------------------------------------------------------------

  getState(): TimedPracticeState {
    if (!this.cached) {
      this.cached = this.buildState(this.now());
    }
    return this.cached;
  }

  subscribe(listener: TimedPracticeListener): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  /** Expected onset (clock ms) of a target note in a loop pass under the current anchor, or null. */
  expectedOnsetMs(note: PerformedNote, pass: number = 0): number | null {
    const segment = this.open ?? (this.segments.length > 0 ? this.segments[this.segments.length - 1] : null);
    if (!segment) {
      return null;
    }
    return this.expectedIn(segment, note.onsetBeat, pass);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private now(): number {
    return (this.options.clock ?? defaultClock)();
  }

  private latencyMs(): number {
    return this.options.latencyOffsetMs ?? 0;
  }

  private onsetWindowMs(): number {
    const value = this.exercise ? this.exercise.timing.onsetWindowMs : undefined;
    return value !== undefined && value >= 0 ? value : DEFAULT_ONSET_WINDOW_MS;
  }

  private searchWindowMs(): number {
    return this.options.searchWindowMs ?? this.onsetWindowMs() * 2;
  }

  private tempoBpm(): number {
    if (this.options.tempoBpm !== undefined && this.options.tempoBpm > 0) {
      return this.options.tempoBpm;
    }
    return this.exercise ? this.exercise.timeline.tempo.bpm : 120;
  }

  private loopFrom(snapshot: TimedSnapshot): LoopRange | null {
    if (snapshot.loop) {
      this.lastLoop = { startBeat: snapshot.loop.startBeat, endBeat: snapshot.loop.endBeat };
    } else if (snapshot.loop === null && this.options.loop === undefined) {
      this.lastLoop = null;
    } else if (this.options.loop !== undefined) {
      this.lastLoop = this.options.loop;
    }
    return this.lastLoop;
  }

  private matchKey(): (midi: number) => number {
    const policy = this.exercise ? this.exercise.policy : null;
    if (!policy) return (midi: number): number => midi;
    if (policy.kind === "pitchClass") return mod12;
    if (policy.kind === "roles" && policy.octaveFree !== false) return mod12;
    return (midi: number): number => midi;
  }

  private timingTargets(exercise: ExerciseDefinition): PerformedNote[] {
    const policy = exercise.policy;
    if (policy.kind === "listen" || policy.kind === "free") {
      return [];
    }
    const notes: PerformedNote[] = [];
    exercise.steps.forEach((step) => {
      step.targets.forEach((note) => {
        if (policy.kind === "roles") {
          if (note.role !== undefined && policy.requiredRoles.includes(note.role)) notes.push(note);
          return;
        }
        notes.push(note);
      });
    });
    return notes.sort((a, b) => (a.onsetBeat !== b.onsetBeat ? a.onsetBeat - b.onsetBeat : a.midi - b.midi));
  }

  private linear(beat: number, pass: number, loop: LoopRange | null): number {
    return loop ? beat + pass * (loop.endBeat - loop.startBeat) : beat;
  }

  private expectedIn(segment: Segment, beat: number, pass: number): number {
    return segment.anchorMs + (this.linear(beat, pass, segment.loop) - segment.anchorLinear) * segment.msPerBeat;
  }

  private openSegment(snapshot: TimedSnapshot, loop: LoopRange | null, now: number): void {
    const bpm = snapshot.tempoBpm > 0 ? snapshot.tempoBpm : this.tempoBpm();
    const loopValid = loop && loop.endBeat - loop.startBeat > EPS ? loop : null;
    const pass = loopValid ? (typeof snapshot.loopPass === "number" ? snapshot.loopPass : this.lastPassSeen) : 0;
    const position = Math.max(0, snapshot.positionBeats);
    const segment: Segment = {
      generation: snapshot.generation,
      anchorMs: now,
      anchorLinear: this.linear(position, pass, loopValid),
      passAtAnchor: pass,
      msPerBeat: 60000 / bpm,
      loop: loopValid,
      instances: [],
      created: new Set<string>(),
      attacks: [],
      releases: [],
      closedAtMs: null
    };
    // Adopt count-in attacks that may anticipate the first onset; drop the rest.
    const earliest = now - this.searchWindowMs();
    this.countInBuffer.forEach((attack) => {
      if (attack.timestampMs >= earliest - EPS) segment.attacks.push(attack);
    });
    this.countInBuffer = [];
    this.open = segment;
    this.segments.push(segment);
  }

  private currentPass(segment: Segment, now: number): number {
    if (!segment.loop) return 0;
    const end = segment.closedAtMs ?? now;
    const linearNow = segment.anchorLinear + (end - segment.anchorMs) / segment.msPerBeat;
    const length = segment.loop.endBeat - segment.loop.startBeat;
    return Math.max(segment.passAtAnchor, Math.floor((linearNow - segment.loop.startBeat + EPS) / length));
  }

  private closeSegment(now: number): void {
    const segment = this.open;
    if (!segment) return;
    this.ensureInstances(now);
    segment.closedAtMs = now;
    this.lastPassSeen = this.currentPass(segment, now);
    // Drop targets that were not reached, or whose window was still open without a credited attack.
    const evaluation = this.evaluateSegment(segment, now);
    const keep = new Set<string>(evaluation.observations.map((entry) => entry.instance.key));
    segment.instances = segment.instances.filter((instance) => keep.has(instance.key));
    this.open = null;
  }

  private ensureInstances(now: number): void {
    const segment = this.open;
    if (!segment || !this.exercise) return;
    const horizonLinear = segment.anchorLinear + (now - segment.anchorMs + this.searchWindowMs()) / segment.msPerBeat;
    const loop = segment.loop;
    const notes = loop ? this.targets.filter((note) => note.onsetBeat >= loop.startBeat - EPS && note.onsetBeat < loop.endBeat - EPS) : this.targets;
    const passes: number[] = [];
    if (loop) {
      for (let pass = segment.passAtAnchor; this.linear(loop.startBeat, pass, loop) <= horizonLinear + EPS; pass += 1) {
        passes.push(pass);
        if (passes.length > 10000) break;
      }
    } else {
      passes.push(0);
    }
    passes.forEach((pass) => {
      notes.forEach((note) => {
        const lin = this.linear(note.onsetBeat, pass, loop);
        if (lin < segment.anchorLinear - EPS || lin > horizonLinear + EPS) return;
        const id = `${note.id}@${pass}`;
        if (segment.created.has(id)) return;
        segment.created.add(id);
        let key = id;
        let occKey = `${note.occurrenceId}@${pass}`;
        if (this.usedKeys.has(key)) {
          // The same pass was played again (seek back after pause): keep keys distinct.
          let n = 2;
          while (this.usedKeys.has(`${id}.${n}`)) n += 1;
          key = `${id}.${n}`;
          occKey = `${occKey}.${n}`;
        }
        this.usedKeys.add(key);
        segment.instances.push({ key, occKey, note, pass, expectedMs: this.expectedIn(segment, note.onsetBeat, pass) });
      });
    });
  }

  /** Match a segment. Resolved = credited with an attack, or missed once its search window closed. */
  private evaluateSegment(segment: Segment, now: number): SegmentEvaluation {
    const window = this.onsetWindowMs();
    const search = this.searchWindowMs();
    const end = segment.closedAtMs ?? now;
    const instances = [...segment.instances].sort((a, b) => a.expectedMs - b.expectedMs);
    const byNote = new Map<PerformedNote, TargetInstance>();
    const pseudo: PerformedNote[] = instances.map((instance) => {
      const copy: PerformedNote = { ...instance.note, id: instance.key, occurrenceId: instance.occKey };
      byNote.set(copy, instance);
      return copy;
    });
    const match = matchSequenceAttacks(
      pseudo,
      segment.attacks,
      (note: PerformedNote): number => {
        const instance = byNote.get(note);
        return instance ? instance.expectedMs : 0;
      },
      window,
      { searchWindowMs: search, matchKey: this.matchKey() }
    );
    const observations: SegmentEvaluation["observations"] = [];
    let pending = 0;
    match.observations.forEach((observation, index) => {
      const instance = instances[index];
      const attackIndex = match.assignment[index];
      if (attackIndex >= 0) {
        observations.push({ instance, observation, attack: segment.attacks[attackIndex] });
        return;
      }
      if (instance.expectedMs + search < end - EPS) {
        observations.push({ instance, observation, attack: null });
      } else {
        pending += 1;
      }
    });
    return { observations, extras: match.extraAttacks.map((attack) => attack as StoredAttack), pending };
  }

  private collect(now: number): { timing: TimingObservation[]; pitch: PitchObservation[]; pending: number; extras: number; durations: DurationObservation[] } {
    const timing: TimingObservation[] = [];
    const pitch: PitchObservation[] = [];
    const durations: DurationObservation[] = [];
    let pending = 0;
    let extras = 0;
    const search = this.searchWindowMs();
    this.segments.forEach((segment) => {
      const evaluation = this.evaluateSegment(segment, now);
      pending += evaluation.pending;
      extras += evaluation.extras.length;
      evaluation.observations.forEach((entry) => timing.push(entry.observation));

      // Pitch per resolved occurrence pass.
      const groups = new Map<string, { instances: TargetInstance[]; played: number[]; onsetMs: number }>();
      evaluation.observations.forEach((entry) => {
        const group = groups.get(entry.instance.occKey) ?? { instances: [], played: [], onsetMs: entry.instance.expectedMs };
        group.instances.push(entry.instance);
        group.onsetMs = Math.min(group.onsetMs, entry.instance.expectedMs);
        if (entry.attack && !group.played.includes(entry.attack.midi)) group.played.push(entry.attack.midi);
        groups.set(entry.instance.occKey, group);
      });
      groups.forEach((group, occKey) => {
        const step = this.steps.get(group.instances[0].note.occurrenceId);
        if (!step) return;
        const unresolved = segment.instances.some((instance) => instance.occKey === occKey && !group.instances.includes(instance));
        if (unresolved) return;
        evaluation.extras.forEach((attack) => {
          if (Math.abs(attack.timestampMs - group.onsetMs) <= search + EPS && !group.played.includes(attack.midi)) group.played.push(attack.midi);
        });
        const played = [...group.played].sort((a, b) => a - b);
        const result = matchStep(step, played, step.policy);
        pitch.push({
          stepId: step.id,
          occurrenceId: occKey,
          expectedMidi: step.targets.map((note) => note.midi).sort((a, b) => a - b),
          playedMidi: played,
          missingMidi: result.missingMidi,
          extraMidi: result.extraMidi,
          missingRoles: result.missingRoles,
          correct: result.correct,
          attempts: 1,
          hintLevelUsed: this.options.hintLevel ?? 0
        });
      });

      if (this.exercise && this.exercise.timing.gradeDuration) {
        evaluation.observations.forEach((entry) => {
          const expectedDurationMs = entry.instance.note.durationBeats * segment.msPerBeat;
          const base: DurationObservation = { targetNoteId: entry.instance.key, occurrenceId: entry.instance.occKey, expectedDurationMs, verdict: "unknown" };
          const attack = entry.attack;
          if (attack) {
            const release = segment.releases.find((r) => r.midi === attack.midi && r.timestampMs >= attack.timestampMs);
            if (release) {
              const actual = release.timestampMs - attack.timestampMs;
              const tolerance = Math.max(this.onsetWindowMs(), expectedDurationMs * 0.3);
              base.actualDurationMs = actual;
              base.verdict = actual < expectedDurationMs - tolerance ? "short" : actual > expectedDurationMs + tolerance ? "long" : "ok";
            }
          }
          durations.push(base);
        });
      }
    });
    timing.sort((a, b) => a.expectedOnsetMs - b.expectedOnsetMs);
    return { timing, pitch, pending, extras, durations };
  }

  private buildState(now: number): TimedPracticeState {
    const collected = this.exercise ? this.collect(now) : { timing: [], pitch: [], pending: 0, extras: 0, durations: [] };
    const segment = this.open ?? (this.segments.length > 0 ? this.segments[this.segments.length - 1] : null);
    return {
      phase: this.phase,
      exerciseId: this.exercise ? this.exercise.id : null,
      tempoBpm: this.tempoBpm(),
      latencyOffsetMs: this.latencyMs(),
      onsetWindowMs: this.onsetWindowMs(),
      searchWindowMs: this.searchWindowMs(),
      observations: collected.timing,
      pitch: collected.pitch,
      pendingTargets: collected.pending,
      extraAttacks: collected.extras,
      durations: collected.durations,
      loopPass: segment ? this.currentPass(segment, now) : 0,
      result: this.result
    };
  }

  private emit(nowMs?: number): void {
    this.cached = null;
    if (this.listeners.size === 0) {
      return;
    }
    const state = this.buildState(nowMs ?? this.now());
    this.cached = state;
    this.listeners.forEach((listener) => listener(state));
  }
}
