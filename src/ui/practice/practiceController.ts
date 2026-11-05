/**
 * Practice controller (B5a): one per runtime, shared by the Practice stage (which "drives" it
 * while mounted: `attach()`), the context panel and the review panel (which only read/act).
 *
 * Flows
 * - Request: on every new `practiceRequestStore` request id, the exercise comes from the request
 *   side-store (practiceRequests.ts) or is built from the payload; mode/assistance/tempo/loop
 *   from the extras or the exercise's own timing.
 * - Step: StepPracticeSession fed by `input.held.onChange` (the session ignores non-learner
 *   sources), ticked every animation frame; the piano shows the step's targets via
 *   `setPianoTargetsOverride` according to the assistance level; "correct" advances after 600 ms
 *   unless the learner chose manual advance; the transport is stopped and parked at the step.
 * - Timed: TimedPracticeSession; learner part muted; count-in, tempo, metronome and loop set on
 *   the transport; `play()`; snapshots each frame and on every transport notification; attacks
 *   from `input.subscribeAttacks`; finishes when the transport stops (end or Stop).
 * - Listen: "Play it for me", then "I listened" records listened evidence.
 * - Free (explore and reflect): record attacks during playback into a trace, replay, write a
 *   self-assessment; nothing is scored.
 * - Every finished attempt is recorded with `progress.recordAttempt(result, evidence)`; routine
 *   items are marked complete; the review is built from `describeResult`.
 *
 * Latency: MIDI attack timestamps already have the calibrated offset subtracted by the input
 * layer, so sessions get `latencyOffsetMs: 0`; the offset is written into timed MIDI results.
 */
import type {
  AssistanceLevel,
  AttemptResult,
  ExerciseDefinition,
  ExerciseStep,
  InputSource,
  PerformedNote,
  ProgressEvidence,
  SpelledPitchClass
} from "@/model/contracts";
import type { HeldChange } from "@/input";
import { StepPracticeSession, TimedPracticeSession, buildAttemptResult, describeResult, evidenceFromAttempt } from "@/practice";
import type { ResultDescription, StepPracticeOptions, StepPracticeState, TimedPhase } from "@/practice";
import type { TransportStatus } from "@/playback/transport";
import type { LearnerAttack, StudioRuntimeCore } from "@/ui/runtime/runtimeCore";
import type { PracticeRequest } from "@/ui/runtime/practicePayload";
import { learnerNotesOf } from "@/ui/runtime/runtimeHelpers";
import type { LearnerTraceNote } from "@/ui/stage/stageRenderer";
import { notifyProgressChanged } from "@/ui/myPractice/progressStore";
import { pianoOverrideFor } from "@/ui/practice/assistance";
import { openExerciseInPractice } from "@/ui/practice/openExercise";
import type { PracticeLoopRegion, PracticeModeKind, PracticeRequestExtras, PracticeSourceKind } from "@/ui/practice/practiceRequests";
import { allowedModes, defaultMode, exerciseForRegion, exerciseFromPayload, getRequestExtras, requestConcept } from "@/ui/practice/practiceRequests";
import type { ReviewUiAction } from "@/ui/practice/reviewActions";
import { reviewActionFor } from "@/ui/practice/reviewActions";
import type { ReviewStepRow } from "@/ui/practice/reviewModel";
import { difficultTransitionLabels, reviewStepRows } from "@/ui/practice/reviewModel";
import { completeRoutineItem, continueRoutine, isRoutineFinished, routineStore } from "@/ui/practice/RoutineRunner";
import type { TraceAttack } from "@/ui/practice/traceModel";
import { DEFAULT_TRACE_BEATS, MAX_TRACE_ATTACKS, freeTraceNotes, replayNotes, stepTraceNotes, timedTraceNotes } from "@/ui/practice/traceModel";
import type { MeasuredAttack, WarmupFeedback } from "@/ui/practice/warmup";
import { warmupFeedback } from "@/ui/practice/warmup";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type PracticeStatus = "idle" | "ready" | "running" | "reflect" | "review";

export interface TimedView {
  phase: TimedPhase;
  onTime: number;
  early: number;
  late: number;
  missed: number;
  pending: number;
  extra: number;
  loopPass: number;
  onsetWindowMs: number;
}

export interface PracticeReview {
  result: AttemptResult;
  exercise: ExerciseDefinition;
  description: ResultDescription;
  recorded: boolean;
  recordMessage: string;
  action: ReviewUiAction;
  stepRows: ReviewStepRow[];
  transitions: string[];
  warmup: WarmupFeedback | null;
  /** Listen and free attempts: nothing was measured. */
  unscored: boolean;
}

export interface PracticeControllerState {
  requestId: number | null;
  title: string;
  source: PracticeSourceKind | null;
  exercise: ExerciseDefinition | null;
  extras: PracticeRequestExtras | null;
  allowedModes: PracticeModeKind[];
  mode: PracticeModeKind;
  status: PracticeStatus;
  assistance: AssistanceLevel;
  autoAdvance: boolean;
  tempoBpm: number;
  countInBeats: number;
  metronome: boolean;
  loopRegion: PracticeLoopRegion | null;
  loopEnabled: boolean;
  step: StepPracticeState | null;
  stepTrace: LearnerTraceNote[];
  timed: TimedView | null;
  confirmation: string | null;
  review: PracticeReview | null;
  takeNoteCount: number;
  message: string | null;
}

const INITIAL_STATE: PracticeControllerState = {
  requestId: null,
  title: "",
  source: null,
  exercise: null,
  extras: null,
  allowedModes: [],
  mode: "step",
  status: "idle",
  assistance: "full",
  autoAdvance: true,
  tempoBpm: 80,
  countInBeats: 4,
  metronome: true,
  loopRegion: null,
  loopEnabled: false,
  step: null,
  stepTrace: [],
  timed: null,
  confirmation: null,
  review: null,
  takeNoteCount: 0,
  message: null
};

export const AUTO_ADVANCE_MS = 600;
const TIMED_PUBLISH_MS = 120;
const EPSILON = 1e-6;

type Listener = () => void;
type FrameHandle = { kind: "raf"; id: number } | { kind: "timeout"; id: ReturnType<typeof setTimeout> };

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function requestFrame(callback: () => void): FrameHandle {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    return { kind: "raf", id: window.requestAnimationFrame(() => callback()) };
  }
  return { kind: "timeout", id: setTimeout(callback, 16) };
}

function cancelFrame(handle: FrameHandle | null): void {
  if (!handle) {
    return;
  }
  if (handle.kind === "raf") {
    if (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(handle.id);
    }
  } else {
    clearTimeout(handle.id);
  }
}

function clampTempo(bpm: number): number {
  return Math.max(20, Math.min(300, Math.round(bpm)));
}

function beatsPerBarOf(exercise: ExerciseDefinition): number {
  const ts = exercise.timeline.timeSignature;
  return Math.max(1, Math.round((ts.numerator * 4) / Math.max(1, ts.denominator)));
}

function sameTimedView(a: TimedView | null, b: TimedView): boolean {
  return (
    a !== null &&
    a.phase === b.phase &&
    a.onTime === b.onTime &&
    a.early === b.early &&
    a.late === b.late &&
    a.missed === b.missed &&
    a.pending === b.pending &&
    a.extra === b.extra &&
    a.loopPass === b.loopPass
  );
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class PracticeController {
  private readonly runtime: StudioRuntimeCore;
  private state: PracticeControllerState = INITIAL_STATE;
  private readonly listeners = new Set<Listener>();

  private attached = false;
  private detachers: Array<() => void> = [];
  private frame: FrameHandle | null = null;

  private request: PracticeRequest | null = null;
  private baseExercise: ExerciseDefinition | null = null;
  private stepExercise: ExerciseDefinition | null = null;
  private stepSession: StepPracticeSession | null = null;
  private stepUnsubscribe: (() => void) | null = null;
  private prevPhase: StepPracticeState["phase"] | null = null;
  private prevIndex = -1;
  private advanceTimer: ReturnType<typeof setTimeout> | null = null;
  private startHintLevel = 0;

  private timedSession: TimedPracticeSession | null = null;
  private timedNotes = new Map<string, PerformedNote>();
  private lastTimedPublish = 0;
  private freeActive = false;
  private seenActive = false;
  private attemptStartedAt = new Date().toISOString();

  private attacks: TraceAttack[] = [];
  private liveTrace: LearnerTraceNote[] = [];
  private measured: MeasuredAttack[] = [];
  private lastSource: InputSource | null = null;
  private overrideKey = "";
  private savedMetronome: boolean | null = null;

  constructor(runtime: StudioRuntimeCore) {
    this.runtime = runtime;
  }

  // -------------------------------------------------------------------------
  // Store interface
  // -------------------------------------------------------------------------

  readonly getState = (): PracticeControllerState => this.state;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Live learner trace for timed/free (read once per frame by the stage). */
  readonly getLiveTrace = (): readonly LearnerTraceNote[] => this.liveTrace;

  private setState(patch: Partial<PracticeControllerState>): void {
    let changed = false;
    for (const key of Object.keys(patch) as (keyof PracticeControllerState)[]) {
      if (!Object.is(this.state[key], patch[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) {
      return;
    }
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  // -------------------------------------------------------------------------
  // Attach / detach (the Practice stage drives the controller while mounted)
  // -------------------------------------------------------------------------

  attach(): () => void {
    if (this.attached) {
      this.detach();
    }
    this.attached = true;
    const rt = this.runtime;
    const offs: Array<() => void> = [];
    offs.push(rt.practiceRequestStore.subscribe(() => this.syncRequest()));
    offs.push(rt.input.held.onChange((change) => this.onHeldChange(change)));
    offs.push(rt.input.subscribeAttacks((attack) => this.onAttack(attack)));
    offs.push(rt.transport.subscribe((status) => this.onTransport(status)));
    offs.push(rt.session.subscribe(() => this.refreshOverride()));
    offs.push(rt.positionStore.subscribe(() => this.refreshOverride()));
    this.detachers = offs;
    this.startFrames();
    this.overrideKey = "";
    const before = this.state.requestId;
    this.syncRequest();
    if (before !== null && before === this.state.requestId) {
      this.applyTransportSettings();
    }
    if (this.state.status === "running" && this.state.mode === "step" && this.state.step) {
      this.seekToStep(this.state.step.step);
    }
    this.refreshOverride();
    return () => this.detach();
  }

  private detach(): void {
    if (!this.attached) {
      return;
    }
    this.attached = false;
    this.detachers.forEach((off) => off());
    this.detachers = [];
    cancelFrame(this.frame);
    this.frame = null;
    this.clearAdvanceTimer();
    if (this.timedSession || this.freeActive) {
      // Leaving Practice mid-run discards a timed/free take (nothing half-scored is saved).
      this.abortRunning();
      this.setState({ status: "ready", timed: null, message: "The take was stopped when you left Practice; nothing was recorded." });
    }
    this.overrideKey = "";
    this.runtime.setPianoTargetsOverride(null);
    if (this.baseExercise) {
      // Other modes play their own material at its own tempo, without a practice loop.
      const transport = this.runtime.transport;
      transport.setTempo(null);
      transport.setCountIn(null);
      transport.setLoop(null);
    }
  }

  /** Tempo/count-in of the practice material on the shared transport (outside takes). */
  private applyTransportSettings(): void {
    const exercise = this.baseExercise;
    if (!exercise) {
      return;
    }
    const transport = this.runtime.transport;
    transport.setTempo(Math.abs(this.state.tempoBpm - exercise.timeline.tempo.bpm) < EPSILON ? null : this.state.tempoBpm);
    transport.setCountIn(this.state.countInBeats);
  }

  private startFrames(): void {
    const tick = (): void => {
      this.frame = null;
      if (!this.attached) {
        return;
      }
      const now = nowMs();
      const s = this.state;
      if (this.stepSession && s.status === "running" && s.mode === "step") {
        this.stepSession.tick(now);
      }
      if (this.timedSession && s.status === "running" && s.mode === "timed") {
        this.timedSession.onTransportSnapshot(this.runtime.transport.getSnapshot(), now);
        this.timedSession.update(now);
        if (now - this.lastTimedPublish >= TIMED_PUBLISH_MS) {
          this.lastTimedPublish = now;
          this.publishTimed(now, false);
        }
      }
      this.frame = requestFrame(tick);
    };
    this.frame = requestFrame(tick);
  }

  // -------------------------------------------------------------------------
  // Requests
  // -------------------------------------------------------------------------

  private syncRequest(): void {
    const request = this.runtime.practiceRequestStore.getState().request;
    if (!request) {
      if (this.state.requestId !== null) {
        this.abortRunning();
        this.request = null;
        this.baseExercise = null;
        this.state = { ...INITIAL_STATE, autoAdvance: this.state.autoAdvance };
        this.listeners.forEach((listener) => listener());
        this.refreshOverride();
      }
      return;
    }
    if (request.requestId === this.state.requestId) {
      return;
    }
    this.loadRequest(request);
  }

  private loadRequest(request: PracticeRequest): void {
    this.abortRunning();
    const extras = getRequestExtras(request.requestId);
    const exercise = extras && extras.exercise ? extras.exercise : exerciseFromPayload(request);
    this.request = request;
    this.baseExercise = exercise;
    this.startHintLevel = extras && extras.startHintLevel !== undefined ? extras.startHintLevel : 0;
    const tempo = clampTempo(extras && extras.tempoBpm !== undefined ? extras.tempoBpm : exercise.timeline.tempo.bpm);
    const countIn = extras && extras.countInBeats !== undefined ? extras.countInBeats : exercise.timing.countInBeats ?? beatsPerBarOf(exercise);
    const loopRegion = extras && extras.loopRegion ? extras.loopRegion : null;
    this.setState({
      requestId: request.requestId,
      title: request.title,
      source: extras ? extras.source : "payload",
      exercise,
      extras,
      allowedModes: allowedModes(exercise),
      mode: defaultMode(exercise, extras ? extras.mode : undefined),
      status: "ready",
      assistance: extras && extras.assistance ? extras.assistance : "full",
      tempoBpm: tempo,
      countInBeats: countIn,
      metronome: extras && extras.metronome !== undefined ? extras.metronome : this.state.metronome,
      loopRegion,
      loopEnabled: loopRegion !== null,
      step: null,
      stepTrace: [],
      timed: null,
      confirmation: null,
      review: null,
      takeNoteCount: 0,
      message: null
    });
    this.runtime.transport.setLoop(null);
    this.applyTransportSettings();
    this.enterMode();
  }

  private ensureTimeline(): void {
    const exercise = this.baseExercise;
    if (!exercise) {
      return;
    }
    const rt = this.runtime;
    const current = rt.transport.getTimeline();
    if (!current || current.id !== exercise.timeline.id) {
      if (rt.materialStore.getState().demonstrating) {
        rt.stopDemonstration();
      }
      rt.loadTimeline(exercise.timeline, {
        sourceKind: "exercise",
        sourceId: this.request && this.request.exerciseId ? this.request.exerciseId : exercise.timeline.id,
        title: this.state.title,
        version: exercise.timeline.sourceVersion
      });
    }
  }

  private enterMode(): void {
    this.attemptStartedAt = new Date().toISOString();
    if (this.state.mode === "step") {
      this.startStep();
      return;
    }
    this.setState({ status: "ready", step: null, stepTrace: [], timed: null, confirmation: null });
    this.refreshOverride();
  }

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  setMode(mode: PracticeModeKind): void {
    if (!this.state.allowedModes.includes(mode) || !this.baseExercise) {
      return;
    }
    this.abortRunning();
    this.setState({ mode, review: null, message: null });
    this.enterMode();
  }

  setAssistance(level: AssistanceLevel): void {
    if (level === this.state.assistance) {
      return;
    }
    this.setState({ assistance: level });
    if (this.state.status === "running" && this.state.mode === "step") {
      // The assistance level is part of the attempt record, so a change starts a new attempt.
      this.startStep();
      this.setState({ message: "Hint level changed — the steps start again so the result records the hints you used." });
    }
    this.refreshOverride();
  }

  setAutoAdvance(enabled: boolean): void {
    this.setState({ autoAdvance: enabled });
    const step = this.stepSession ? this.stepSession.getState() : null;
    if (enabled && step && step.phase === "correct") {
      this.scheduleAdvance(step.stepIndex);
    } else if (!enabled) {
      this.clearAdvanceTimer();
    }
  }

  setTempo(bpm: number): void {
    if (!Number.isFinite(bpm)) {
      return;
    }
    const tempo = clampTempo(bpm);
    this.setState({ tempoBpm: tempo });
    if (this.state.status !== "running") {
      this.applyTransportSettings();
    }
  }

  setCountIn(beats: number): void {
    const value = Math.max(0, Math.min(16, Math.round(beats)));
    this.setState({ countInBeats: value });
    if (this.state.status !== "running") {
      this.applyTransportSettings();
    }
  }

  /** Click during timed/free takes (applied when a take starts, restored afterwards). */
  setMetronome(enabled: boolean): void {
    this.setState({ metronome: enabled });
  }

  setLoopEnabled(enabled: boolean): void {
    if (enabled && !this.state.loopRegion) {
      return;
    }
    this.setState({ loopEnabled: enabled });
    if (this.state.status === "running" && this.state.mode === "step") {
      this.startStep();
    }
  }

  setLoopRegion(region: PracticeLoopRegion | null): void {
    this.setState({ loopRegion: region, loopEnabled: region !== null });
  }

  // -------------------------------------------------------------------------
  // Step practice
  // -------------------------------------------------------------------------

  startStep(): void {
    const base = this.baseExercise;
    if (!base) {
      return;
    }
    this.abortRunning();
    this.ensureTimeline();
    this.runtime.transport.stop();
    const exercise = this.state.loopEnabled ? exerciseForRegion(base, this.state.loopRegion) : base;
    this.stepExercise = exercise;
    this.measured = [];
    this.prevPhase = null;
    this.prevIndex = -1;
    this.attemptStartedAt = new Date().toISOString();
    const session = new StepPracticeSession();
    this.stepSession = session;
    this.stepUnsubscribe = session.subscribe((state) => this.onStepState(session, state));
    this.setState({ status: "running", mode: "step", review: null, confirmation: null, timed: null, message: null });
    const options: StepPracticeOptions = { assistance: this.state.assistance, startHintLevel: this.startHintLevel, nowMs: nowMs() };
    session.start(exercise, options);
  }

  private onStepState(session: StepPracticeSession, state: StepPracticeState): void {
    if (session !== this.stepSession) {
      return;
    }
    const prevPhase = this.prevPhase;
    const prevIndex = this.prevIndex;
    this.prevPhase = state.phase;
    this.prevIndex = state.stepIndex;
    let confirmation = this.state.confirmation;
    if (state.stepIndex !== prevIndex) {
      confirmation = null;
      this.clearAdvanceTimer();
      this.seekToStep(state.step);
    }
    if (state.phase === "correct" && prevPhase !== "correct") {
      const last = state.stepIndex + 1 >= state.stepCount;
      confirmation = last ? "Correct — that was the last step." : this.state.autoAdvance ? "Correct — the next step follows in a moment." : "Correct — press Next when you are ready.";
      if (this.state.autoAdvance) {
        this.scheduleAdvance(state.stepIndex);
      }
    }
    const occurrence = state.step ? this.occurrenceOf(state.step) : null;
    const trace = occurrence ? stepTraceNotes(state, occurrence.startBeat, Math.max(0.5, occurrence.durationBeats)) : [];
    this.setState({ step: state, confirmation, stepTrace: trace });
    this.refreshOverride();
    if (state.phase === "complete" && prevPhase !== "complete" && state.result) {
      this.completeAttempt(state.result, this.stepExercise ?? this.baseExercise, null);
    }
  }

  private occurrenceOf(step: ExerciseStep): { startBeat: number; durationBeats: number } | null {
    const exercise = this.baseExercise;
    if (!exercise) {
      return null;
    }
    const found = exercise.timeline.occurrences.find((occurrence) => occurrence.occurrenceId === step.occurrenceId);
    return found ? { startBeat: found.startBeat, durationBeats: found.durationBeats } : null;
  }

  /** Park the (stopped) transport at the step so the stage and current/next strip show it. */
  private seekToStep(step: ExerciseStep | null): void {
    if (!step || !this.attached) {
      return;
    }
    const occurrence = this.occurrenceOf(step);
    if (!occurrence) {
      return;
    }
    const rt = this.runtime;
    if (rt.materialStore.getState().demonstrating) {
      return;
    }
    this.ensureTimeline();
    const snapshot = rt.transport.getSnapshot();
    if (snapshot.state === "playing" || snapshot.state === "countingIn") {
      return;
    }
    if (Math.abs(snapshot.positionBeats - occurrence.startBeat) > EPSILON) {
      rt.transport.seek(occurrence.startBeat);
    }
  }

  private scheduleAdvance(stepIndex: number): void {
    this.clearAdvanceTimer();
    this.advanceTimer = setTimeout(() => {
      this.advanceTimer = null;
      const session = this.stepSession;
      if (!session) {
        return;
      }
      const state = session.getState();
      if (state.phase === "correct" && state.stepIndex === stepIndex) {
        session.next(nowMs());
      }
    }, AUTO_ADVANCE_MS);
  }

  private clearAdvanceTimer(): void {
    if (this.advanceTimer !== null) {
      clearTimeout(this.advanceTimer);
      this.advanceTimer = null;
    }
  }

  nextStep(): void {
    this.clearAdvanceTimer();
    if (this.stepSession) {
      this.stepSession.next(nowMs());
    }
  }

  skipStep(): void {
    this.clearAdvanceTimer();
    if (this.stepSession) {
      this.stepSession.skip(nowMs());
    }
  }

  requestHint(): void {
    if (this.stepSession) {
      this.stepSession.requestHint();
    }
  }

  /** Start the current mode again (new attempt). */
  restart(): void {
    if (!this.baseExercise) {
      return;
    }
    this.abortRunning();
    this.setState({ review: null, message: null });
    this.enterMode();
  }

  // -------------------------------------------------------------------------
  // Timed practice
  // -------------------------------------------------------------------------

  private activeLoop(): { startBeat: number; endBeat: number } | null {
    const region = this.state.loopRegion;
    return this.state.loopEnabled && region ? { startBeat: region.startBeat, endBeat: region.endBeat } : null;
  }

  startTimed(): void {
    const exercise = this.baseExercise;
    if (!exercise || !this.state.allowedModes.includes("timed")) {
      return;
    }
    this.abortRunning();
    this.ensureTimeline();
    const transport = this.runtime.transport;
    const loop = this.activeLoop();
    transport.stop();
    transport.setTempo(this.state.tempoBpm);
    transport.setCountIn(this.state.countInBeats);
    this.applyTakeMetronome();
    transport.setLoop(loop);
    transport.setPartMuted("learner", true);
    this.timedNotes = new Map(exercise.timeline.notes.map((note) => [note.id, note]));
    this.attacks = [];
    this.liveTrace = [];
    this.measured = [];
    this.seenActive = false;
    this.lastTimedPublish = 0;
    const session = new TimedPracticeSession();
    session.start(exercise, {
      tempoBpm: this.state.tempoBpm,
      latencyOffsetMs: 0,
      countInBeats: this.state.countInBeats,
      loop,
      assistance: this.state.assistance,
      hintLevel: 0
    });
    this.timedSession = session;
    this.setState({ status: "running", mode: "timed", review: null, confirmation: null, message: null, timed: null });
    this.refreshOverride();
    void transport.play(loop ? loop.startBeat : 0);
  }

  /** Stop button: finish and review the timed attempt. */
  stopTimed(): void {
    this.finishTimed();
  }

  private publishTimed(now: number, finished: boolean): void {
    const session = this.timedSession;
    if (!session) {
      return;
    }
    const state = session.getState();
    const count = (verdict: string): number => state.observations.filter((obs) => obs.verdict === verdict).length;
    const view: TimedView = {
      phase: state.phase,
      onTime: count("onTime"),
      early: count("early"),
      late: count("late"),
      missed: count("missed"),
      pending: state.pendingTargets,
      extra: state.extraAttacks,
      loopPass: state.loopPass,
      onsetWindowMs: state.onsetWindowMs
    };
    const policy = this.baseExercise ? this.baseExercise.policy : null;
    const pitchClassOnly = policy !== null && (policy.kind === "pitchClass" || (policy.kind === "roles" && policy.octaveFree !== false));
    this.liveTrace = timedTraceNotes(this.attacks, state.observations, this.timedNotes, {
      nowMs: now,
      searchWindowMs: state.searchWindowMs,
      pass: state.loopPass,
      pitchClassOnly,
      finished
    });
    if (!sameTimedView(this.state.timed, view)) {
      this.setState({ timed: view });
    }
  }

  private finishTimed(): void {
    const session = this.timedSession;
    if (!session || this.state.status !== "running" || this.state.mode !== "timed") {
      return;
    }
    const now = nowMs();
    session.onTransportSnapshot(this.runtime.transport.getSnapshot(), now);
    const result = session.finish(now);
    this.publishTimed(now, true);
    this.timedSession = null;
    this.restoreTransport();
    if (!result) {
      this.setState({ status: "ready" });
      return;
    }
    this.completeAttempt(result, this.baseExercise, null);
  }

  private applyTakeMetronome(): void {
    const transport = this.runtime.transport;
    if (this.savedMetronome === null) {
      this.savedMetronome = transport.getSnapshot().metronomeEnabled;
    }
    transport.setMetronome(this.state.metronome);
  }

  /** After a take: stop, unmute the learner part, restore the click, drop the take's loop. */
  private restoreTransport(): void {
    const transport = this.runtime.transport;
    const snapshot = transport.getSnapshot();
    if (snapshot.state !== "stopped") {
      transport.stop();
    }
    if (transport.isPartMuted("learner")) {
      transport.setPartMuted("learner", false);
    }
    if (this.savedMetronome !== null) {
      transport.setMetronome(this.savedMetronome);
      this.savedMetronome = null;
    }
    if (snapshot.loop) {
      transport.setLoop(null);
    }
    this.applyTransportSettings();
  }

  // -------------------------------------------------------------------------
  // Free (explore and reflect) and listen
  // -------------------------------------------------------------------------

  startFreeTake(): void {
    if (!this.baseExercise || !this.state.allowedModes.includes("free")) {
      return;
    }
    this.abortRunning();
    this.ensureTimeline();
    const transport = this.runtime.transport;
    const loop = this.activeLoop();
    transport.stop();
    transport.setTempo(this.state.tempoBpm);
    transport.setCountIn(this.state.countInBeats);
    this.applyTakeMetronome();
    transport.setLoop(loop);
    if (transport.isPartMuted("learner")) {
      transport.setPartMuted("learner", false);
    }
    this.attacks = [];
    this.liveTrace = [];
    this.measured = [];
    this.seenActive = false;
    this.freeActive = true;
    this.attemptStartedAt = new Date().toISOString();
    this.setState({ status: "running", mode: "free", review: null, takeNoteCount: 0, message: null });
    this.refreshOverride();
    void transport.play(loop ? loop.startBeat : 0);
  }

  stopFreeTake(): void {
    if (!this.freeActive) {
      return;
    }
    this.freeActive = false;
    this.restoreTransport();
    this.setState({ status: "reflect", takeNoteCount: this.attacks.length });
    this.refreshOverride();
  }

  replayTake(): void {
    const timeline = this.baseExercise ? this.baseExercise.timeline : null;
    const tempo = Math.max(60, Math.min(140, timeline ? timeline.tempo.bpm : 90));
    const notes = replayNotes(this.attacks, tempo);
    if (notes.length > 0) {
      this.runtime.audition.playNotes(notes);
    }
  }

  discardTake(): void {
    this.attacks = [];
    this.liveTrace = [];
    this.setState({ status: "ready", takeNoteCount: 0 });
  }

  /** Save a free take: an unscored attempt with the learner's own notes. */
  saveFreeTake(selfAssessment: string): void {
    const base = this.baseExercise;
    if (!base) {
      return;
    }
    const exercise: ExerciseDefinition = { ...base, policy: { kind: "free" } };
    const text = selfAssessment.trim();
    const result = buildAttemptResult({
      exercise,
      mode: "free",
      pitch: [],
      timing: [],
      inputSource: this.fallbackSource(),
      assistance: this.state.assistance,
      startedAt: this.attemptStartedAt,
      completedAt: new Date().toISOString(),
      tempoBpm: this.state.tempoBpm,
      selfAssessment: text === "" ? undefined : text
    });
    this.completeAttempt(result, exercise, []);
  }

  /** Listen mode: "I listened" records listened evidence (no score). */
  markListened(): void {
    const base = this.baseExercise;
    if (!base) {
      return;
    }
    const exercise: ExerciseDefinition = { ...base, policy: { kind: "listen" } };
    const result = buildAttemptResult({
      exercise,
      mode: "listen",
      pitch: [],
      timing: [],
      inputSource: this.fallbackSource(),
      assistance: this.state.assistance,
      startedAt: this.attemptStartedAt,
      completedAt: new Date().toISOString(),
      tempoBpm: this.state.tempoBpm
    });
    this.completeAttempt(result, exercise, evidenceFromAttempt(result, exercise));
  }

  /** "Listen": hear the current step's (or current chord's) target notes. */
  listenCurrent(): void {
    const rt = this.runtime;
    let midis: number[] = [];
    const step = this.state.step && this.state.step.step ? this.state.step.step : null;
    if (step && this.state.mode === "step") {
      midis = step.targets.map((note) => note.midi);
    } else {
      const position = rt.positionStore.getState();
      const timeline = this.baseExercise ? this.baseExercise.timeline : rt.transport.getTimeline();
      midis = learnerNotesOf(timeline, position.current ? position.current.occurrenceId : null).map((note) => note.midi);
      if (midis.length === 0 && this.baseExercise && this.baseExercise.steps.length > 0) {
        midis = this.baseExercise.steps[0].targets.map((note) => note.midi);
      }
    }
    if (midis.length > 0) {
      rt.audition.playChord(midis, 2);
    }
  }

  /** "Play it for me" (toggles). Not while a timed/free take runs. */
  playForMe(): void {
    if (this.state.status === "running" && (this.state.mode === "timed" || this.state.mode === "free")) {
      return;
    }
    if (this.runtime.materialStore.getState().demonstrating) {
      this.runtime.stopDemonstration();
      return;
    }
    this.ensureTimeline();
    void this.runtime.playForMe();
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  private onHeldChange(change: HeldChange): void {
    if (this.stepSession && this.state.status === "running" && this.state.mode === "step") {
      this.stepSession.onInputChange(change);
    }
    if (change.kind === "release" && !change.stillSounding) {
      this.markReleased(change.midi);
    } else if (change.kind === "pedal") {
      change.damped.forEach((midi) => this.markReleased(midi));
    }
  }

  private onAttack(attack: LearnerAttack): void {
    this.lastSource = attack.source;
    const s = this.state;
    if (s.status !== "running") {
      return;
    }
    this.measured.push({ midi: attack.midi, velocity: attack.velocity, timestampMs: attack.timestampMs });
    if (this.measured.length > 4000) {
      this.measured.shift();
    }
    if (s.mode === "timed" && this.timedSession) {
      this.timedSession.onAttack(attack.midi, attack.timestampMs, attack.source);
      this.recordTraceAttack(attack);
      this.publishTimed(nowMs(), false);
    } else if (s.mode === "free" && this.freeActive) {
      this.recordTraceAttack(attack);
      this.liveTrace = freeTraceNotes(this.attacks);
    }
  }

  private recordTraceAttack(attack: LearnerAttack): void {
    const snapshot = this.runtime.transport.getSnapshot();
    const bpm = snapshot.tempoBpm > 0 ? snapshot.tempoBpm : this.state.tempoBpm;
    const ageBeats = (Math.max(0, nowMs() - attack.timestampMs) * bpm) / 60000;
    this.attacks.push({
      midi: attack.midi,
      velocity: attack.velocity,
      atMs: attack.timestampMs,
      onsetBeat: snapshot.positionBeats - ageBeats,
      durationBeats: DEFAULT_TRACE_BEATS,
      pass: snapshot.loopPass,
      released: false
    });
    if (this.attacks.length > MAX_TRACE_ATTACKS) {
      this.attacks.shift();
    }
  }

  private markReleased(midi: number): void {
    if (this.attacks.length === 0) {
      return;
    }
    for (let i = this.attacks.length - 1; i >= 0; i -= 1) {
      const attack = this.attacks[i];
      if (attack.midi === midi && !attack.released) {
        attack.released = true;
        const position = this.runtime.transport.getSnapshot().positionBeats;
        if (position > attack.onsetBeat) {
          attack.durationBeats = Math.max(0.125, position - attack.onsetBeat);
        }
        if (this.freeActive) {
          this.liveTrace = freeTraceNotes(this.attacks);
        }
        return;
      }
    }
  }

  private fallbackSource(): InputSource {
    if (this.lastSource) {
      return this.lastSource;
    }
    const selected = this.runtime.session.getState().inputSource;
    return selected === "none" ? "touch" : selected;
  }

  // -------------------------------------------------------------------------
  // Transport notifications
  // -------------------------------------------------------------------------

  private onTransport(status: TransportStatus): void {
    const s = this.state;
    const active = status.state === "playing" || status.state === "countingIn";
    if (this.timedSession && s.status === "running" && s.mode === "timed") {
      this.timedSession.onTransportSnapshot(status, nowMs());
      if (active) {
        this.seenActive = true;
      } else if (status.state === "stopped" && this.seenActive) {
        void Promise.resolve().then(() => this.finishTimed());
      }
      return;
    }
    if (this.freeActive && s.status === "running" && s.mode === "free") {
      if (active) {
        this.seenActive = true;
      } else if (status.state === "stopped" && this.seenActive) {
        void Promise.resolve().then(() => this.stopFreeTake());
      }
      return;
    }
    if (s.status === "running" && s.mode === "step" && status.state === "stopped" && s.step && s.step.step) {
      const step = s.step.step;
      void Promise.resolve().then(() => {
        if (this.state.status === "running" && this.state.mode === "step") {
          this.seekToStep(step);
        }
      });
    }
  }

  // -------------------------------------------------------------------------
  // Piano target layer
  // -------------------------------------------------------------------------

  private refreshOverride(): void {
    if (!this.attached) {
      return;
    }
    const rt = this.runtime;
    const s = this.state;
    const labelMode = rt.session.getState().labelMode;
    let key = "none";
    let next: ReturnType<typeof pianoOverrideFor> | null = null;
    if (s.status === "running" && s.mode === "step" && s.step && s.step.step) {
      const step = s.step.step;
      key = `step|${s.requestId}|${step.id}|${s.assistance}|${labelMode}`;
      next = pianoOverrideFor(step.targets, step.chord ?? null, s.assistance, labelMode);
    } else if (s.exercise && (s.status === "ready" || s.status === "running" || s.status === "reflect") && s.assistance !== "full") {
      if (s.assistance === "none") {
        key = `empty|${s.requestId}`;
        next = pianoOverrideFor([], null, "none", labelMode);
      } else {
        const position = rt.positionStore.getState();
        const occurrence = position.current;
        key = `occ|${s.requestId}|${occurrence ? occurrence.occurrenceId : "-"}|${position.timelineId ?? "-"}`;
        const notes = learnerNotesOf(rt.transport.getTimeline(), occurrence ? occurrence.occurrenceId : null);
        next = pianoOverrideFor(notes, occurrence && occurrence.chord ? occurrence.chord : null, "reduced", labelMode);
      }
    }
    if (key === this.overrideKey) {
      return;
    }
    this.overrideKey = key;
    rt.setPianoTargetsOverride(next);
  }

  // -------------------------------------------------------------------------
  // Completion and review
  // -------------------------------------------------------------------------

  private abortRunning(): void {
    this.clearAdvanceTimer();
    if (this.stepUnsubscribe) {
      this.stepUnsubscribe();
      this.stepUnsubscribe = null;
    }
    this.stepSession = null;
    if (this.timedSession) {
      const session = this.timedSession;
      this.timedSession = null;
      session.abort();
      this.restoreTransport();
    }
    if (this.freeActive) {
      this.freeActive = false;
      this.restoreTransport();
    }
    this.seenActive = false;
  }

  private latencyOffset(): number {
    try {
      const prefs = this.runtime.stores.preferences.get();
      return prefs.ok ? prefs.value.latencyOffsetMs : 0;
    } catch {
      return 0;
    }
  }

  private completeAttempt(result: AttemptResult, exercise: ExerciseDefinition | null, evidenceOverride: ProgressEvidence[] | null): void {
    const base = this.baseExercise;
    const reviewed = exercise ?? base;
    if (!reviewed || !base) {
      return;
    }
    const extras = this.state.extras;
    const patched: AttemptResult = { ...result };
    if (extras && extras.chartId && patched.chartId === undefined) patched.chartId = extras.chartId;
    if (extras && extras.arrangementId && patched.arrangementId === undefined) patched.arrangementId = extras.arrangementId;
    if (patched.mode === "timed" && patched.inputSource === "midi") {
      const offset = this.latencyOffset();
      if (offset !== 0) patched.latencyOffsetMs = offset;
    }
    // Evidence comes from the compiled exercise (transfer detection uses its compile record).
    const evidence = evidenceOverride ?? evidenceFromAttempt(patched, base);
    if (extras && extras.routine) {
      const routineId = extras.routine.routineId;
      evidence.forEach((entry) => {
        entry.routineId = routineId;
      });
    }
    let recorded = false;
    let recordMessage = "";
    try {
      const saved = this.runtime.stores.progress.recordAttempt(patched, evidence);
      recorded = saved.ok;
      recordMessage = saved.ok ? "Saved to My Practice." : `Not saved: ${saved.error.message}`;
    } catch (error) {
      recordMessage = `Not saved: ${error instanceof Error ? error.message : String(error)}`;
    }
    notifyProgressChanged();
    if (extras && extras.routine) {
      completeRoutineItem(this.runtime, extras.routine);
    }
    const active = routineStore.getState().active;
    const routineActive = active !== null && extras !== null && extras.routine !== undefined && active.routineId === extras.routine.routineId && !isRoutineFinished(active.items, active.cursor);
    const unscored = patched.mode === "listen" || patched.mode === "free";
    const review: PracticeReview = {
      result: patched,
      exercise: reviewed,
      description: describeResult(patched, base),
      recorded,
      recordMessage,
      action: reviewActionFor(patched.nextAction, {
        assistance: this.state.assistance,
        currentTempoBpm: this.state.tempoBpm,
        routineActive,
        canTranspose: extras !== null && extras.source === "exercise" && extras.specId !== undefined
      }),
      stepRows: unscored ? [] : reviewStepRows(patched, base),
      transitions: unscored ? [] : difficultTransitionLabels(patched, base),
      warmup: extras && extras.warmup ? warmupFeedback(extras.warmup, this.measured, patched) : null,
      unscored
    };
    this.clearAdvanceTimer();
    this.setState({ status: "review", review, confirmation: null });
    this.refreshOverride();
  }

  /** Run the review's primary next action. */
  applyReviewAction(action: ReviewUiAction): void {
    const rt = this.runtime;
    const extras = this.state.extras;
    switch (action.type) {
      case "retryTimed": {
        this.setTempo(action.tempoBpm);
        const mode: PracticeModeKind = this.state.allowedModes.includes("timed") ? "timed" : "step";
        this.abortRunning();
        this.setState({ mode, review: null, message: `Tempo set to ${clampTempo(action.tempoBpm)} BPM. Press Start when you are ready.` });
        this.enterMode();
        return;
      }
      case "loop": {
        const region: PracticeLoopRegion = { startBeat: action.startBeat, endBeat: action.endBeat, label: action.label, occurrenceIds: action.occurrenceIds };
        this.abortRunning();
        this.setState({ loopRegion: region, loopEnabled: true, review: null, message: null });
        this.enterMode();
        return;
      }
      case "restartAssisted":
        this.abortRunning();
        this.startHintLevel = 0;
        this.setState({ assistance: action.assistance, review: null, message: null });
        this.enterMode();
        return;
      case "transpose": {
        if (!extras || !extras.specId) {
          this.restart();
          return;
        }
        const opened = openExerciseInPractice(rt, extras.specId, {
          transposeTo: action.tonic,
          mode: this.state.mode,
          assistance: this.state.assistance,
          routine: extras.routine
        });
        if (!opened.ok) {
          this.setState({ message: opened.message });
        }
        return;
      }
      case "reviewConcept": {
        const conceptId = action.conceptId ?? (this.baseExercise && this.baseExercise.conceptIds.length > 0 ? this.baseExercise.conceptIds[0] : null);
        if (conceptId) {
          requestConcept(conceptId);
        }
        rt.navigate.openEntry("learn");
        return;
      }
      case "routineNext": {
        const opened = continueRoutine(rt);
        if (!opened.ok) {
          this.setState({ message: opened.message });
        }
        return;
      }
      case "again":
      default:
        this.restart();
    }
  }

  /** Re-open the same exercise in another key (header key select). */
  transposeTo(tonic: SpelledPitchClass): void {
    const extras = this.state.extras;
    if (!extras || !extras.specId || extras.source !== "exercise") {
      return;
    }
    const opened = openExerciseInPractice(this.runtime, extras.specId, {
      transposeTo: tonic,
      mode: this.state.mode,
      assistance: this.state.assistance,
      tempoBpm: this.state.tempoBpm,
      routine: extras.routine
    });
    if (!opened.ok) {
      this.setState({ message: opened.message });
    }
  }

  dismissMessage(): void {
    this.setState({ message: null });
  }
}

const controllers = new WeakMap<StudioRuntimeCore, PracticeController>();

/** The single practice controller of a runtime. */
export function getPracticeController(runtime: StudioRuntimeCore): PracticeController {
  let controller = controllers.get(runtime);
  if (!controller) {
    controller = new PracticeController(runtime);
    controllers.set(runtime, controller);
  }
  return controller;
}
