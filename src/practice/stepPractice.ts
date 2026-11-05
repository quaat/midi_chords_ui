/**
 * Step practice session (plan E13): the exercise waits for an acceptable answer.
 *
 * Framework-free state machine. Events in: `onAttack`, `onRelease`, `onPedal`, `onReset`
 * (or `onInputChange` with HeldStateTracker changes), `onDemonstrationEnded`, `tick(nowMs)`,
 * `requestHint`, `next`, `skip`, `restart`. State out: `getState()` (cached; a new object only
 * after a change, so it suits `useSyncExternalStore`) and `subscribe(listener)`.
 *
 * Phases: "idle" → ("listening" while a demonstration plays) → "waiting" → "correct" | "retry"
 * → (next) ... → "complete".
 *
 * Fairness rules
 * - Only learner sources count ("midi", "computerKeyboard", "touch", "replay"). Accompaniment,
 *   demonstration and metronome notes are ignored even if a caller forwards them.
 * - Notes held (or pedal-sustained) when a step begins are "held over": they never count until
 *   they are struck again after the step began, so a held answer or a repeated chord from the
 *   previous step cannot advance the next one. Attacks timestamped before `stepStartedAtMs`
 *   (when the caller supplies it) are not fresh either.
 * - Pedal-sustained notes count only when `timing.sustainCounts` is true.
 * - Chord assembly: attacks within `timing.assemblyWindowMs` (default 80 ms) of the first attack
 *   of a group form one attempt. The attempt is judged as soon as the counted notes reach the
 *   target count, or once the window has elapsed (`tick(nowMs)`, or the next attack after it).
 * - Notes still held from an earlier attempt of the same step keep counting, so a learner can
 *   add a missing note without replaying the whole chord.
 * - Wrong extra notes under "exactVoicing" never advance.
 */
import type {
  AssistanceLevel,
  AttemptResult,
  ExerciseDefinition,
  ExerciseStep,
  InputSource,
  PitchObservation
} from "@/model/contracts";
import type { HeldChange } from "@/input/heldState";
import { DEFAULT_ASSEMBLY_WINDOW_MS, matchStep } from "@/practice/matching";
import type { PitchMatch } from "@/practice/matching";
import { buildAttemptResult } from "@/practice/feedback";
import type { BuildAttemptInput } from "@/practice/feedback";

export type StepPhase = "idle" | "listening" | "waiting" | "correct" | "retry" | "complete";

export const LEARNER_SOURCES: readonly InputSource[] = ["midi", "computerKeyboard", "touch", "replay"];

/** True for sources that represent the learner's own playing. */
export function isLearnerSource(source: string): source is InputSource {
  return (LEARNER_SOURCES as readonly string[]).includes(source);
}

export interface StepPracticeOptions {
  /** Start each step in "listening" until `onDemonstrationEnded()` (default false). */
  demonstrate?: boolean;
  /** Input source reported in the result (default: first counted learner source, else "midi"). */
  inputSource?: InputSource;
  assistance?: AssistanceLevel;
  /** Hint level each step starts at (default 0). */
  startHintLevel?: number;
  /** Performance-clock time (ms) the first step begins; attacks before it are not fresh. */
  nowMs?: number;
  /** Wall clock for ISO timestamps (default Date.now). */
  clock?: () => number;
  /** Attempt id override. */
  attemptId?: string;
}

export interface StepPracticeState {
  phase: StepPhase;
  exerciseId: string | null;
  stepIndex: number;
  stepCount: number;
  step: ExerciseStep | null;
  /** Learner keys physically down. */
  pressed: number[];
  /** Learner keys released but held by the sustain pedal. */
  sustained: number[];
  sustainDown: boolean;
  /** Notes that count toward the current step's answer right now. */
  counted: number[];
  /** Notes held from before the step began; they count only after being struck again. */
  heldOver: number[];
  /** Result of the most recent evaluation of this step. */
  lastMatch: PitchMatch | null;
  /** Plain-language lines for the learner (missing/unexpected notes, encouragement). */
  explanation: string[];
  hintLevel: number;
  /** Most specific hint revealed so far (null when none). */
  hint: string | null;
  /** The next hint rung the UI may offer ("Need a hint?"); revealing it needs `requestHint()`. */
  nextHint: string | null;
  attempts: number;
  observations: PitchObservation[];
  result: AttemptResult | null;
}

export type StepPracticeListener = (state: StepPracticeState) => void;

function sorted(values: Iterable<number>): number[] {
  return Array.from(values).sort((a, b) => a - b);
}

export class StepPracticeSession {
  private exercise: ExerciseDefinition | null = null;
  private options: StepPracticeOptions = {};
  private phase: StepPhase = "idle";
  private stepIndex = 0;
  private pressed = new Set<number>();
  private sustained = new Set<number>();
  private sustainDown = false;
  private fresh = new Set<number>();
  private heldOver = new Set<number>();
  private stepStartedAtMs: number | undefined;
  private groupStartMs: number | null = null;
  private groupEvaluated = true;
  private lastMatch: PitchMatch | null = null;
  private lastPlayed: number[] = [];
  private explanation: string[] = [];
  private hintLevel = 0;
  private stepMaxHint = 0;
  private maxHintLevel = 0;
  private attempts = 0;
  private observations: PitchObservation[] = [];
  private result: AttemptResult | null = null;
  private startedAt = "";
  private detectedSource: InputSource | null = null;
  private lastEventMs: number | undefined;
  private listeners = new Set<StepPracticeListener>();
  private cached: StepPracticeState | null = null;

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  start(exercise: ExerciseDefinition, options: StepPracticeOptions = {}): void {
    this.exercise = exercise;
    this.options = { ...options };
    this.observations = [];
    this.result = null;
    this.maxHintLevel = 0;
    this.detectedSource = null;
    this.stepStartedAtMs = undefined;
    this.startedAt = new Date((options.clock ?? Date.now)()).toISOString();
    this.stepIndex = 0;
    if (exercise.steps.length === 0) {
      this.phase = "complete";
      this.finishAttempt();
      this.emit();
      return;
    }
    this.beginStep(options.nowMs);
    this.emit();
  }

  /** Start the same exercise again from step 1 with the same options. */
  restart(nowMs?: number): void {
    if (!this.exercise) {
      return;
    }
    const options: StepPracticeOptions = { ...this.options };
    if (nowMs !== undefined) {
      options.nowMs = nowMs;
    } else if (this.lastEventMs !== undefined) {
      options.nowMs = this.lastEventMs;
    }
    this.start(this.exercise, options);
  }

  /** Replay the demonstration of the current step (phase "listening"). */
  requestDemonstration(): void {
    if (!this.exercise || this.phase === "complete" || this.phase === "idle") {
      return;
    }
    this.phase = "listening";
    this.emit();
  }

  onDemonstrationEnded(nowMs?: number): void {
    if (this.phase !== "listening" || !this.exercise) {
      return;
    }
    this.markHeldOver(nowMs);
    const step = this.currentStep();
    if (step && step.policy.kind === "listen") {
      const match = matchStep(step, [], step.policy);
      this.lastMatch = match;
      this.explanation = [...match.notes];
      this.phase = "correct";
      this.record(step, match, [], true);
    } else {
      this.phase = this.attempts > 0 && this.lastMatch && !this.lastMatch.correct ? "retry" : "waiting";
    }
    this.emit();
  }

  /** Advance after "correct". Returns false when not in "correct". */
  next(nowMs?: number): boolean {
    if (this.phase !== "correct" || !this.exercise) {
      return false;
    }
    this.advance(nowMs);
    this.emit();
    return true;
  }

  /** Give up on the current step (recorded as not correct) and move on. */
  skip(nowMs?: number): void {
    const step = this.currentStep();
    if (!step || this.phase === "complete" || this.phase === "idle") {
      return;
    }
    if (this.phase !== "correct") {
      const match = this.lastMatch ?? matchStep(step, this.lastPlayed);
      this.record(step, match, this.lastPlayed, false);
    }
    this.advance(nowMs);
    this.emit();
  }

  /** Reveal the next hint rung for this step; returns it (or the last rung when exhausted). */
  requestHint(): string | null {
    const step = this.currentStep();
    if (!step || step.hints.length === 0 || this.phase === "complete") {
      return null;
    }
    this.hintLevel = Math.min(step.hints.length, this.hintLevel + 1);
    this.stepMaxHint = Math.max(this.stepMaxHint, this.hintLevel);
    this.maxHintLevel = Math.max(this.maxHintLevel, this.hintLevel);
    this.emit();
    return step.hints[this.hintLevel - 1];
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  onAttack(midi: number, timestampMs: number, source: string): void {
    if (!isLearnerSource(source) || !this.exercise) {
      return;
    }
    this.lastEventMs = timestampMs;
    this.pressed.add(midi);
    this.sustained.delete(midi);
    const accepting = this.phase === "waiting" || this.phase === "retry";
    const isFresh = this.stepStartedAtMs === undefined || timestampMs >= this.stepStartedAtMs;
    if (!accepting || !isFresh) {
      // Outside an answer phase the note is just held; it becomes held-over at the next step.
      if (accepting) {
        this.heldOver.add(midi);
      }
      this.emit();
      return;
    }
    if (this.detectedSource === null) {
      this.detectedSource = source;
    }
    // Close an earlier group whose window has elapsed (when the caller never ticked).
    if (this.groupStartMs !== null && !this.groupEvaluated && timestampMs - this.groupStartMs > this.windowMs()) {
      this.evaluate();
      if (this.phase === "correct") {
        // The previous group already answered the step; this attack belongs to the next one.
        this.heldOver.add(midi);
        this.emit();
        return;
      }
    }
    this.heldOver.delete(midi);
    this.fresh.add(midi);
    if (this.groupStartMs === null || this.groupEvaluated || timestampMs - this.groupStartMs > this.windowMs()) {
      this.groupStartMs = timestampMs;
      this.groupEvaluated = false;
    }
    const step = this.currentStep();
    if (step && this.countedNotes().length >= this.targetCount(step)) {
      this.evaluate();
    }
    this.emit();
  }

  /**
   * Key released. `stillSounding` (from HeldStateTracker) overrides the session's own pedal state.
   */
  onRelease(midi: number, timestampMs?: number, source: string = "midi", stillSounding?: boolean): void {
    if (!isLearnerSource(source)) {
      return;
    }
    if (timestampMs !== undefined) {
      this.lastEventMs = timestampMs;
    }
    if (!this.pressed.has(midi)) {
      return;
    }
    this.pressed.delete(midi);
    const sounding = stillSounding ?? this.sustainDown;
    if (sounding) {
      this.sustained.add(midi);
    } else {
      this.fresh.delete(midi);
      this.heldOver.delete(midi);
    }
    this.emit();
  }

  /** Sustain pedal change. Pedal up damps every sustained (not pressed) note. */
  onPedal(down: boolean, timestampMs?: number, source: string = "midi"): void {
    if (!isLearnerSource(source)) {
      return;
    }
    if (timestampMs !== undefined) {
      this.lastEventMs = timestampMs;
    }
    this.sustainDown = down;
    if (!down) {
      this.sustained.forEach((midi) => {
        if (!this.pressed.has(midi)) {
          this.fresh.delete(midi);
          this.heldOver.delete(midi);
        }
      });
      this.sustained.clear();
    }
    this.emit();
  }

  /** All notes off / device disconnected: forget held state (nothing is evaluated). */
  onReset(): void {
    this.pressed.clear();
    this.sustained.clear();
    this.fresh.clear();
    this.heldOver.clear();
    this.sustainDown = false;
    this.emit();
  }

  /** Adapter for `HeldStateTracker.onChange`. Only the sustain pedal affects answers. */
  onInputChange(change: HeldChange): void {
    switch (change.kind) {
      case "attack":
        this.onAttack(change.midi, change.timestampMs, change.source);
        return;
      case "release":
        this.onRelease(change.midi, change.timestampMs, change.source, change.stillSounding);
        return;
      case "pedal":
        if (change.pedal === "sustain") {
          this.onPedal(change.down, change.timestampMs, change.source);
        }
        return;
      case "reset":
        this.onReset();
        return;
      default:
        return;
    }
  }

  /** Close the assembly window when it has elapsed (call from a timer or animation frame). */
  tick(nowMs: number): void {
    if (this.groupStartMs === null || this.groupEvaluated) {
      return;
    }
    if (this.phase !== "waiting" && this.phase !== "retry") {
      return;
    }
    if (nowMs - this.groupStartMs >= this.windowMs()) {
      this.evaluate();
      this.emit();
    }
  }

  // -------------------------------------------------------------------------
  // State out
  // -------------------------------------------------------------------------

  getState(): StepPracticeState {
    if (!this.cached) {
      const step = this.currentStep();
      const hints = step ? step.hints : [];
      this.cached = {
        phase: this.phase,
        exerciseId: this.exercise ? this.exercise.id : null,
        stepIndex: this.stepIndex,
        stepCount: this.exercise ? this.exercise.steps.length : 0,
        step,
        pressed: sorted(this.pressed),
        sustained: sorted(this.sustained),
        sustainDown: this.sustainDown,
        counted: this.countedNotes(),
        heldOver: sorted(this.heldOver),
        lastMatch: this.lastMatch,
        explanation: [...this.explanation],
        hintLevel: this.hintLevel,
        hint: this.hintLevel > 0 && hints.length > 0 ? hints[Math.min(this.hintLevel, hints.length) - 1] : null,
        nextHint: this.hintLevel < hints.length ? hints[this.hintLevel] : null,
        attempts: this.attempts,
        observations: [...this.observations],
        result: this.result
      };
    }
    return this.cached;
  }

  subscribe(listener: StepPracticeListener): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  getResult(): AttemptResult | null {
    return this.result;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private currentStep(): ExerciseStep | null {
    if (!this.exercise || this.phase === "complete") {
      return null;
    }
    return this.exercise.steps[this.stepIndex] ?? null;
  }

  private windowMs(): number {
    const value = this.exercise ? this.exercise.timing.assemblyWindowMs : undefined;
    return value !== undefined && value >= 0 ? value : DEFAULT_ASSEMBLY_WINDOW_MS;
  }

  private sustainCounts(): boolean {
    return this.exercise ? this.exercise.timing.sustainCounts === true : false;
  }

  private targetCount(step: ExerciseStep): number {
    const unique = new Set<number>(step.targets.map((note) => note.midi));
    return Math.max(1, unique.size);
  }

  /** Fresh notes that are pressed (or sustained when sustain counts). */
  private countedNotes(): number[] {
    const out: number[] = [];
    this.fresh.forEach((midi) => {
      if (this.pressed.has(midi) || (this.sustainCounts() && this.sustained.has(midi))) {
        out.push(midi);
      }
    });
    return out.sort((a, b) => a - b);
  }

  private markHeldOver(nowMs?: number): void {
    this.heldOver = new Set<number>([...Array.from(this.pressed), ...Array.from(this.sustained)]);
    this.fresh.clear();
    this.groupStartMs = null;
    this.groupEvaluated = true;
    if (nowMs !== undefined) {
      this.stepStartedAtMs = nowMs;
    }
  }

  private beginStep(nowMs?: number): void {
    this.markHeldOver(nowMs ?? this.lastEventMs);
    if (nowMs === undefined && this.lastEventMs === undefined) {
      this.stepStartedAtMs = undefined;
    }
    this.lastMatch = null;
    this.lastPlayed = [];
    this.explanation = [];
    this.attempts = 0;
    this.hintLevel = Math.max(0, this.options.startHintLevel ?? 0);
    this.stepMaxHint = this.hintLevel;
    this.maxHintLevel = Math.max(this.maxHintLevel, this.hintLevel);
    this.phase = this.options.demonstrate ? "listening" : "waiting";
  }

  private evaluate(): void {
    const step = this.currentStep();
    this.groupEvaluated = true;
    if (!step) {
      return;
    }
    const played = this.countedNotes();
    if (played.length === 0) {
      return;
    }
    const match = matchStep(step, played, step.policy);
    this.attempts += 1;
    this.lastMatch = match;
    this.lastPlayed = played;
    if (match.correct) {
      this.phase = "correct";
      this.explanation = match.notes.length > 0 && step.policy.kind !== "exactVoicing" ? [...match.notes] : [];
      this.record(step, match, played, true);
    } else {
      this.phase = "retry";
      this.explanation = [...match.notes];
    }
  }

  private record(step: ExerciseStep, match: PitchMatch, played: number[], correct: boolean): void {
    const observation: PitchObservation = {
      stepId: step.id,
      occurrenceId: step.occurrenceId,
      expectedMidi: step.targets.map((note) => note.midi).sort((a, b) => a - b),
      playedMidi: [...played],
      missingMidi: [...match.missingMidi],
      extraMidi: [...match.extraMidi],
      missingRoles: [...match.missingRoles],
      correct,
      attempts: this.attempts,
      hintLevelUsed: this.stepMaxHint
    };
    this.observations = this.observations.filter((obs) => obs.stepId !== step.id).concat([observation]);
  }

  private advance(nowMs?: number): void {
    if (!this.exercise) {
      return;
    }
    if (this.stepIndex + 1 >= this.exercise.steps.length) {
      this.stepIndex = this.exercise.steps.length;
      this.phase = "complete";
      this.markHeldOver(nowMs);
      this.finishAttempt();
      return;
    }
    this.stepIndex += 1;
    this.beginStep(nowMs);
  }

  private finishAttempt(): void {
    if (!this.exercise) {
      return;
    }
    const clock = this.options.clock ?? Date.now;
    const input: BuildAttemptInput = {
      exercise: this.exercise,
      mode: "step",
      pitch: [...this.observations],
      timing: [],
      inputSource: this.options.inputSource ?? this.detectedSource ?? "midi",
      assistance: this.options.assistance ?? "none",
      hintLevel: this.maxHintLevel,
      startedAt: this.startedAt,
      completedAt: new Date(clock()).toISOString(),
      tempoBpm: this.exercise.timeline.tempo.bpm,
      stepsTotal: this.exercise.steps.length
    };
    if (this.options.attemptId !== undefined) {
      input.id = this.options.attemptId;
    }
    this.result = buildAttemptResult(input);
  }

  private emit(): void {
    this.cached = null;
    const state = this.getState();
    this.listeners.forEach((listener) => listener(state));
  }
}
