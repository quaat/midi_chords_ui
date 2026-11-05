"use client";

/**
 * Practice mode (B5a). StudioApp renders `PracticeMode()` as the stage above the piano and
 * `PracticeContextPanel()` in the context panel (both without props).
 *
 * The stage drives the shared practice controller (practiceController.ts) while mounted:
 * request handling, step/timed/listen/free sessions, the piano target layer and recording.
 * Views follow the session's `practiceView`: falling notes, static steps, notation, chord chart.
 */
import { useMemo } from "react";
import type { PartId } from "@/model/contracts";
import type { PracticeView } from "@/state/sessionStore";
import { useSessionDispatch, useSessionStore } from "@/state/useSessionStore";
import type { LabelMode } from "@/ui/piano/pianoLabels";
import { NotationView } from "@/ui/notation/NotationView";
import { useCurrentOccurrence, useMaterial, usePianoLayout, useStudioRuntime } from "@/ui/runtime/useStudioRuntime";
import { FallingNotesStage } from "@/ui/stage/FallingNotesStage";
import type { FallingNotesStageOptions, LearnerTraceNote, StageLabelMode } from "@/ui/stage/FallingNotesStage";
import { Placeholder } from "@/ui/workspace/Placeholder";
import { PracticeViewSwitch } from "@/ui/workspace/PracticeViewSwitch";
import { assistanceView } from "@/ui/practice/assistance";
import { ChartView } from "@/ui/practice/ChartView";
import { PracticeControls } from "@/ui/practice/PracticeControls";
import { PracticeHeader } from "@/ui/practice/PracticeHeader";
import type { PracticeControllerState } from "@/ui/practice/practiceController";
import { usePracticeSession } from "@/ui/practice/PracticeSession";
import { ReviewPanel } from "@/ui/practice/ReviewPanel";
import { StepListView } from "@/ui/practice/StepListView";

export { PracticeContextPanel } from "@/ui/practice/PracticeContextPanel";

const ALL_PARTS = new Set<PartId>(["learner", "accompaniment", "demonstration"]);
const NO_LEARNER_PARTS = new Set<PartId>(["accompaniment", "demonstration"]);

function stageLabels(labelMode: LabelMode, showLabels: boolean): StageLabelMode {
  if (!showLabels) {
    return "none";
  }
  switch (labelMode) {
    case "noteNames":
      return "names";
    case "chordDegrees":
    case "scaleDegrees":
      return "degrees";
    case "fingers":
      return "hands";
    default:
      return "none";
  }
}

interface StageProps {
  view: PracticeView;
  state: PracticeControllerState;
  getLiveTrace: () => readonly LearnerTraceNote[];
}

function PracticeStage({ view, state, getLiveTrace }: StageProps): JSX.Element {
  const runtime = useStudioRuntime();
  const material = useMaterial();
  const layout = usePianoLayout();
  const position = useCurrentOccurrence();
  const reducedMotion = useSessionStore((s) => s.reducedMotion);
  const labelMode = useSessionStore((s) => s.labelMode);
  const assist = assistanceView(state.assistance);
  const usingStepTrace = state.mode === "step";
  const partsVisible = assist.showLearnerLane ? ALL_PARTS : NO_LEARNER_PARTS;
  const showLabels = stageLabels(labelMode, assist.showLabels);
  const stepTrace = state.stepTrace;
  const options = useMemo<FallingNotesStageOptions>(
    () => ({
      showBeatGrid: true,
      showLabels,
      partsVisible,
      reducedMotion,
      learnerTrace: usingStepTrace ? stepTrace : undefined
    }),
    [showLabels, partsVisible, reducedMotion, usingStepTrace, stepTrace]
  );

  const exercise = state.exercise;
  const stepIndex = useMemo(() => {
    if (!exercise) {
      return -1;
    }
    if (state.mode === "step" && state.step) {
      return state.step.stepIndex;
    }
    const occurrenceId = position.current ? position.current.occurrenceId : null;
    return occurrenceId ? exercise.steps.findIndex((step) => step.occurrenceId === occurrenceId) : 0;
  }, [exercise, state.mode, state.step, position]);

  if (view === "static") {
    if (exercise) {
      return <StepListView exercise={exercise} currentIndex={stepIndex} assistance={state.assistance} />;
    }
    if (!layout) {
      return <Placeholder title="Practice" description="Preparing the piano…" />;
    }
    return <FallingNotesStage timeline={material.timeline} getSnapshot={runtime.getTransportSnapshot} layout={layout} options={{ ...options, reducedMotion: true }} />;
  }

  if (view === "notation") {
    const sequence = state.extras && state.extras.sequence ? state.extras.sequence : material.sequence;
    if (!sequence) {
      return (
        <p className="pls-practice-empty">
          Notation is not available for this material (it has no chord sequence). Try the static steps or the chord chart view.
        </p>
      );
    }
    const step = state.mode === "step" && state.step && state.step.step ? state.step.step : null;
    const occurrence = exercise && step ? exercise.timeline.occurrences.find((candidate) => candidate.occurrenceId === step.occurrenceId) : null;
    const activeEventId = occurrence ? occurrence.eventId : position.current ? position.current.eventId : null;
    return <NotationView sequence={sequence} activeEventId={activeEventId} />;
  }

  if (view === "chart") {
    return (
      <ChartView
        timeline={exercise ? exercise.timeline : material.timeline}
        expansion={state.extras && state.extras.chartExpansion ? state.extras.chartExpansion : null}
        title={state.extras && state.extras.chartTitle ? state.extras.chartTitle : state.title}
        getSnapshot={runtime.getTransportSnapshot}
      />
    );
  }

  if (!layout) {
    return <Placeholder title="Practice" description="Preparing the piano…" />;
  }
  return (
    <FallingNotesStage
      timeline={material.timeline}
      getSnapshot={runtime.getTransportSnapshot}
      layout={layout}
      options={options}
      getLearnerTrace={usingStepTrace ? undefined : getLiveTrace}
      ariaLabel={assist.showLearnerLane ? undefined : "Falling notes: accompaniment only; your part is hidden at this hint level."}
    />
  );
}

export function PracticeMode(): JSX.Element {
  const { controller, state } = usePracticeSession({ drive: true });
  const view = useSessionStore((s) => s.practiceView);
  const dispatch = useSessionDispatch();
  const hasRequest = state.exercise !== null;

  return (
    <div className="pls-practice">
      <div className="pls-practice__bar pls-practice-top">
        {hasRequest ? <PracticeHeader controller={controller} state={state} /> : <p className="pls-practice-top__hint">Choose an exercise in the panel, or press Play to follow the falling notes.</p>}
        <PracticeViewSwitch value={view} onChange={(next) => dispatch({ type: "setPracticeView", view: next })} />
      </div>
      <PracticeControls controller={controller} state={state} />
      <div className="pls-practice__body">
        {state.status === "review" && state.review ? (
          <div className="pls-practice-review-wrap">
            <ReviewPanel review={state.review} controller={controller} />
          </div>
        ) : (
          <PracticeStage view={view} state={state} getLiveTrace={controller.getLiveTrace} />
        )}
      </div>
    </div>
  );
}
