/** Practice runtime (plan E13–E15): exercise compilation, matching, step/timed sessions, feedback. React-free. */
export {
  closeVoicer,
  engineVoicer,
  compileExercise,
  compiledExerciseInfo,
  defaultRecipeIdFor,
  impliedTonic,
  recipeFamilyLabel,
  stepNoteNames,
  targetLabel,
  transpositionBetween
} from "@/practice/compileExercise";
export type { CompileExerciseOptions, CompileExerciseResult, CompiledExerciseInfo, ExerciseVoicer } from "@/practice/compileExercise";

export {
  DEFAULT_ASSEMBLY_WINDOW_MS,
  chordAssembly,
  groupAttacks,
  isGradedPolicy,
  matchSequenceAttacks,
  matchStep,
  pitchClassKey,
  verdictForDelta
} from "@/practice/matching";
export type { AttackGroup, PitchMatch, SequenceMatchOptions, SequenceMatchResult, TimedAttack } from "@/practice/matching";

export { LEARNER_SOURCES, StepPracticeSession, isLearnerSource } from "@/practice/stepPractice";
export type { StepPhase, StepPracticeListener, StepPracticeOptions, StepPracticeState } from "@/practice/stepPractice";

export { DEFAULT_ONSET_WINDOW_MS, TimedPracticeSession } from "@/practice/timedPractice";
export type {
  DurationObservation,
  LoopRange,
  TimedPhase,
  TimedPracticeListener,
  TimedPracticeOptions,
  TimedPracticeState,
  TimedSnapshot
} from "@/practice/timedPractice";

export {
  CAVEAT_NOT_OBSERVED,
  CAVEAT_SELF_ASSESSMENT,
  SCORING_VERSION,
  SLOWER_TEMPO_FACTOR,
  SLOW_DOWN_BELOW,
  baseOccurrenceId,
  buildAttemptResult,
  chooseNextAction,
  describeResult,
  difficultOccurrences,
  evidenceFromAttempt,
  missCounts
} from "@/practice/feedback";
export type { BuildAttemptInput, EvidenceContext, ResultDescription } from "@/practice/feedback";

export { chordLabel, noteLabel, pitchClassLabel, roleName, spellMidi } from "@/practice/text";
