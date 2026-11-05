/**
 * Entry points that open material in Practice (for Learn, Songs, My Practice, routines).
 *
 *   openExerciseInPractice(runtime, specId, { transposeTo?, mode?, assistance?, tempoBpm? })
 *   openArrangementInPractice(runtime, chartId, arrangementId, { sectionId?, mode?, chart?, arrangement? })
 *   openRunInPractice(runtime, { tonic, scaleId, patternId, startOctave, octaves, hand })
 *   openWarmupInPractice(runtime, warmupId, { tempoBpm?, repeats?, hand? })
 *   openMaterialInPractice(runtime, timeline, title?)
 *
 * Each compiles the material, then calls `runtime.navigate.openInPractice({ timeline, steps,
 * exerciseId, title })` and registers the rest (exercise definition, mode, policy, chart ids,
 * loop region, routine item) in the request side-store (practiceRequests.ts). All return
 * `{ ok, message, requestId? }` and never throw.
 */
import type {
  ArrangementDefinition,
  AssessmentContract,
  AssistanceLevel,
  ExerciseDefinition,
  MusicalSequence,
  PerformanceTimeline,
  SongChart,
  SpelledPitchClass
} from "@/model/contracts";
import { arrangementSteps, compileArrangement } from "@/charts/arrangement";
import type { CompiledArrangement } from "@/charts/arrangement";
import { conceptsForChart, getArrangement, getArrangementsForChart, getChart, getExerciseSpec, getWarmup } from "@/content";
import { formatPitchClass } from "@/music/pitch";
import { compileExercise } from "@/practice/compileExercise";
import { scaleRunExercise } from "@/scalelab/runs";
import type { PracticePayload } from "@/ui/runtime/practicePayload";
import type {
  PracticeLoopRegion,
  PracticeModeKind,
  PracticeNavigator,
  PracticeRequestExtras,
  PracticeRoutineRef,
  PracticeRunConfig
} from "@/ui/practice/practiceRequests";
import { exerciseFromPayload, materialPracticePayload, openWithExtras } from "@/ui/practice/practiceRequests";
import { warmupToSteps } from "@/ui/practice/warmup";

export interface OpenResult {
  ok: boolean;
  message: string;
  requestId?: number;
}

export interface OpenExerciseOptions {
  transposeTo?: SpelledPitchClass;
  mode?: PracticeModeKind;
  assistance?: AssistanceLevel;
  tempoBpm?: number;
  startHintLevel?: number;
  loopRegion?: PracticeLoopRegion | null;
  routine?: PracticeRoutineRef;
  /** Warm-ups only (when `specId` names a warm-up). */
  repeats?: number;
}

function done(requestId: number | null, title: string): OpenResult {
  if (requestId === null) {
    return { ok: false, message: `"${title}" could not be opened in Practice.` };
  }
  return { ok: true, message: `Opened "${title}" in Practice.`, requestId };
}

function baseExtras(options: {
  mode?: PracticeModeKind;
  assistance?: AssistanceLevel;
  tempoBpm?: number;
  startHintLevel?: number;
  loopRegion?: PracticeLoopRegion | null;
  routine?: PracticeRoutineRef;
}): Partial<PracticeRequestExtras> {
  const out: Partial<PracticeRequestExtras> = {};
  if (options.mode !== undefined) out.mode = options.mode;
  if (options.assistance !== undefined) out.assistance = options.assistance;
  if (options.tempoBpm !== undefined && options.tempoBpm > 0) out.tempoBpm = options.tempoBpm;
  if (options.startHintLevel !== undefined) out.startHintLevel = options.startHintLevel;
  if (options.loopRegion !== undefined) out.loopRegion = options.loopRegion;
  if (options.routine !== undefined) out.routine = options.routine;
  return out;
}

/** Compile an exercise spec (or a warm-up id) and open it in Practice. */
export function openExerciseInPractice(runtime: PracticeNavigator, specId: string, options: OpenExerciseOptions = {}): OpenResult {
  const spec = getExerciseSpec(specId);
  if (!spec) {
    if (getWarmup(specId)) {
      return openWarmupInPractice(runtime, specId, { tempoBpm: options.tempoBpm, repeats: options.repeats, mode: options.mode, assistance: options.assistance, routine: options.routine });
    }
    return { ok: false, message: `The exercise "${specId}" was not found.` };
  }
  const compiled = compileExercise(spec, options.transposeTo ? { transposeTo: options.transposeTo } : {});
  if (!compiled.ok) {
    return { ok: false, message: compiled.reason };
  }
  const exercise = compiled.exercise;
  const transposed = compiled.info.transposedTo;
  const title = transposed ? `${exercise.title} — in ${formatPitchClass(transposed, { unicode: true })}` : exercise.title;
  const payload: PracticePayload = { timeline: exercise.timeline, steps: exercise.steps, exerciseId: exercise.id, title };
  const extras: PracticeRequestExtras = {
    source: "exercise",
    exercise,
    specId: spec.id,
    sequence: compiled.info.sequence,
    notes: [...(spec.explanation ?? []), ...compiled.info.warnings],
    ...baseExtras(options)
  };
  if (transposed) extras.transposeTo = transposed;
  return done(openWithExtras(runtime, payload, extras), title);
}

// ---------------------------------------------------------------------------
// Charts / arrangements
// ---------------------------------------------------------------------------

export interface OpenArrangementOptions {
  sectionId?: string;
  mode?: PracticeModeKind;
  assistance?: AssistanceLevel;
  tempoBpm?: number;
  countInBeats?: number;
  metronome?: boolean;
  routine?: PracticeRoutineRef;
  /** A chart not in the content bundle (e.g. a user chart from the chart store). */
  chart?: SongChart;
  arrangement?: ArrangementDefinition;
}

/** The arrangement a routine/song item uses when none is named: the first one with learner notes. */
export function defaultArrangementId(chart: SongChart): string | null {
  const arrangements = chart.arrangementIds
    .map((id) => getArrangement(id))
    .filter((found): found is ArrangementDefinition => found !== undefined);
  const withNotes = arrangements.find((arrangement) => arrangement.learnerPart.kind !== "chartOnly");
  if (withNotes) return withNotes.id;
  if (arrangements.length > 0) return arrangements[0].id;
  const fallback = getArrangementsForChart(chart.id);
  return fallback.length > 0 ? fallback[0].id : null;
}

function contractFor(arrangement: ArrangementDefinition): AssessmentContract {
  if (arrangement.policy.kind === "free" || arrangement.policy.kind === "listen") return "exploreReflect";
  if (arrangement.policy.kind === "roles" || arrangement.policy.kind === "pitchClass") return "satisfyConstraints";
  return "reproduce";
}

/** An ExerciseDefinition for a compiled arrangement (chart, arrangement and exercise ids stay separate). */
export function arrangementExercise(compiled: CompiledArrangement, chart: SongChart, arrangement: ArrangementDefinition): ExerciseDefinition {
  const beatsPerBar = Math.max(1, Math.round((chart.timeSignature.numerator * 4) / Math.max(1, chart.timeSignature.denominator)));
  return {
    id: `chart:${chart.id}:${arrangement.id}`,
    version: chart.version,
    title: `${chart.title} — ${arrangement.name}`,
    objective: arrangement.description,
    conceptIds: conceptsForChart(chart.id).map((concept) => concept.id),
    prerequisites: [],
    contract: contractFor(arrangement),
    timeline: compiled.timeline,
    steps: arrangementSteps(compiled),
    policy: arrangement.policy,
    timing: { mode: "timed", onsetWindowMs: 150, countInBeats: beatsPerBar, assemblyWindowMs: 80 },
    demand: arrangement.demand,
    status: chart.meta.status
  };
}

export function openArrangementInPractice(runtime: PracticeNavigator, chartId: string, arrangementId: string, options: OpenArrangementOptions = {}): OpenResult {
  const chart = options.chart && options.chart.id === chartId ? options.chart : getChart(chartId);
  if (!chart) {
    return { ok: false, message: `The song chart "${chartId}" was not found.` };
  }
  const arrangement = options.arrangement && options.arrangement.id === arrangementId ? options.arrangement : getArrangement(arrangementId);
  if (!arrangement) {
    return { ok: false, message: `The arrangement "${arrangementId}" was not found.` };
  }
  const beatsPerBar = Math.max(1, Math.round((chart.timeSignature.numerator * 4) / Math.max(1, chart.timeSignature.denominator)));
  const compiled = compileArrangement(chart, arrangement, {
    tempoBpm: options.tempoBpm,
    countInBeats: options.countInBeats ?? beatsPerBar,
    metronome: options.metronome ?? false,
    loop: options.sectionId ? { sectionId: options.sectionId } : undefined
  });
  if (!compiled.ok) {
    return { ok: false, message: compiled.reason };
  }
  const exercise = arrangementExercise(compiled, chart, arrangement);
  const section = options.sectionId ? chart.sections.find((candidate) => candidate.id === options.sectionId) : undefined;
  const title = `${exercise.title}${section ? ` (section ${section.label})` : ""}`;
  const payload: PracticePayload = { timeline: compiled.timeline, steps: exercise.steps, exerciseId: exercise.id, title };
  const extras: PracticeRequestExtras = {
    source: "arrangement",
    exercise,
    chartId: chart.id,
    arrangementId: arrangement.id,
    chartTitle: chart.title,
    chartExpansion: compiled.expansion,
    sequence: compiled.sequence,
    notes: [...compiled.warnings],
    ...baseExtras({ mode: options.mode, assistance: options.assistance, tempoBpm: options.tempoBpm, routine: options.routine })
  };
  if (options.sectionId) extras.sectionId = options.sectionId;
  if (options.countInBeats !== undefined) extras.countInBeats = Math.max(0, Math.round(options.countInBeats));
  if (options.metronome !== undefined) extras.metronome = options.metronome;
  if (compiled.loopRegion) {
    extras.loopRegion = {
      startBeat: compiled.loopRegion.startBeat,
      endBeat: compiled.loopRegion.endBeat,
      label: `Section ${section ? section.label : compiled.loopRegion.sectionId}`
    };
  }
  return done(openWithExtras(runtime, payload, extras), title);
}

// ---------------------------------------------------------------------------
// Scale runs, warm-ups, current material
// ---------------------------------------------------------------------------

export interface OpenRunOptions {
  tempoBpm?: number;
  mode?: PracticeModeKind;
  assistance?: AssistanceLevel;
  routine?: PracticeRoutineRef;
}

export function openRunInPractice(runtime: PracticeNavigator, run: PracticeRunConfig, options: OpenRunOptions = {}): OpenResult {
  const result = scaleRunExercise(run.tonic, run.scaleId, run.patternId, run.startOctave, run.octaves, run.hand, options.tempoBpm ? { tempoBpm: options.tempoBpm } : {});
  if (!result.ok) {
    return { ok: false, message: result.reason };
  }
  const tonicName = formatPitchClass(result.config.tonic, { unicode: true });
  const title = `${tonicName} ${run.scaleId} — ${result.recipe.name}`;
  const exerciseId = `run:${tonicName}:${run.scaleId}:${run.patternId}:${run.startOctave}:${run.octaves}:${run.hand}`;
  const payload: PracticePayload = { timeline: result.timeline, steps: result.steps, exerciseId, title };
  const exercise = exerciseFromPayload(payload);
  exercise.key = { tonic: result.config.tonic, mode: run.scaleId };
  exercise.objective = result.fingeringNote;
  const extras: PracticeRequestExtras = {
    source: "run",
    exercise,
    run: { ...run, tonic: result.config.tonic },
    notes: [result.fingeringNote],
    ...baseExtras(options)
  };
  return done(openWithExtras(runtime, payload, extras), title);
}

export interface OpenWarmupOptions {
  tempoBpm?: number;
  repeats?: number;
  hand?: "left" | "right" | "either" | "both";
  mode?: PracticeModeKind;
  assistance?: AssistanceLevel;
  routine?: PracticeRoutineRef;
}

export function openWarmupInPractice(runtime: PracticeNavigator, warmupId: string, options: OpenWarmupOptions = {}): OpenResult {
  const warmup = getWarmup(warmupId);
  if (!warmup) {
    return { ok: false, message: `The warm-up "${warmupId}" was not found.` };
  }
  const practice = warmupToSteps(warmup, { tempoBpm: options.tempoBpm, repeats: options.repeats, hand: options.hand });
  if (practice.steps.length === 0) {
    return { ok: false, message: `"${warmup.title}" has no notes for that hand.` };
  }
  const payload: PracticePayload = { timeline: practice.timeline, steps: practice.steps, exerciseId: practice.exercise.id, title: practice.title };
  const extras: PracticeRequestExtras = {
    source: "warmup",
    exercise: practice.exercise,
    specId: warmup.id,
    warmup,
    notes: practice.handAttributionNote ? [practice.handAttributionNote] : [],
    ...baseExtras(options)
  };
  return done(openWithExtras(runtime, payload, extras), practice.title);
}

/** "Practise the current progression": one roles-policy step per chord of the material. */
export function openMaterialInPractice(runtime: PracticeNavigator, timeline: PerformanceTimeline, title?: string, sequence?: MusicalSequence | null): OpenResult {
  const payload = materialPracticePayload(timeline, title);
  if (!payload.steps || payload.steps.length === 0) {
    return { ok: false, message: "The current material has no notes to practise." };
  }
  const extras: PracticeRequestExtras = { source: "material", exercise: exerciseFromPayload(payload), mode: "step" };
  if (sequence) extras.sequence = sequence;
  return done(openWithExtras(runtime, payload, extras), payload.title);
}
