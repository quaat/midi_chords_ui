"use client";

import { useState } from "react";
import clsx from "clsx";
import { Play, Timer, Shuffle, Music } from "lucide-react";
import type { SpelledPitchClass } from "@/model/contracts";
import { getChart, getPlayable, supportedInputsFor } from "@/content";
import { formatPitchClass } from "@/music/pitch";
import { useStudioRuntime } from "@/ui/runtime/useStudioRuntime";
import { DEMAND_LABELS, STATUS_LABELS, policyExplanation, policyLabel } from "@/ui/learn/learnLogic";
import type { UnitMarker } from "@/ui/learn/learnLogic";
import { openChartInSongs, practiseExercise } from "@/ui/learn/learnActions";

export interface ExerciseCardProps {
  exerciseId: string;
  marker?: UnitMarker;
  /** Show objective and explanation text (detail view) rather than the compact row. */
  detailed?: boolean;
  onOpenConcept?: (conceptId: string) => void;
}

/** One exercise or warm-up with its demand, policy, input needs and Practise buttons. */
export function ExerciseCard({ exerciseId, marker, detailed = false, onOpenConcept }: ExerciseCardProps): JSX.Element {
  const runtime = useStudioRuntime();
  const [message, setMessage] = useState<string | null>(null);
  const playable = getPlayable(exerciseId);

  if (!playable) {
    return (
      <div className="pls-learn-ex pls-learn-ex--missing">
        <p className="pls-learn-ex__title">{exerciseId}</p>
        <p className="pls-learn-muted">This exercise is not available in this version.</p>
      </div>
    );
  }

  const run = (mode?: "step" | "timed", transposeTo?: SpelledPitchClass): void => {
    const options: { mode?: "step" | "timed"; transposeTo?: SpelledPitchClass } = {};
    if (mode) options.mode = mode;
    if (transposeTo) options.transposeTo = transposeTo;
    setMessage(practiseExercise(runtime, exerciseId, options));
  };

  if (playable.kind === "warmup") {
    const warmup = playable.spec;
    return (
      <div className={clsx("pls-learn-ex", detailed && "pls-learn-ex--detailed")}>
        <div className="pls-learn-ex__head">
          <p className="pls-learn-ex__title">{warmup.title}</p>
          <span className="pls-badge">Warm-up</span>
          <span className="pls-badge">{DEMAND_LABELS[warmup.demand]}</span>
          {warmup.status !== "reviewed" ? <span className="pls-badge pls-learn-badge--draft">{STATUS_LABELS[warmup.status]}</span> : null}
          {marker && marker.done ? <span className="pls-badge pls-learn-badge--done">{marker.label}</span> : null}
        </div>
        <p className="pls-learn-ex__objective">{warmup.objective}</p>
        <p className="pls-learn-muted">Guidance is authored advice; MIDI can only report timing, evenness and overlap — not fingering or posture.</p>
        {detailed ? (
          <ul className="pls-learn-list">
            {warmup.guidance.text.map((line: string) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        <div className="pls-learn-actions">
          <button type="button" className="pls-btn pls-btn--small pls-btn--primary" onClick={() => run("step")}>
            <Play size={14} aria-hidden="true" /> Practise (step)
          </button>
          <button type="button" className="pls-btn pls-btn--small" onClick={() => run("timed")}>
            <Timer size={14} aria-hidden="true" /> Practise (timed)
          </button>
        </div>
        {message ? (
          <p className="pls-error-text" role="status">
            {message}
          </p>
        ) : null}
      </div>
    );
  }

  const spec = playable.spec;
  const inputs = supportedInputsFor(spec);
  const policy = spec.policy;
  const unscored = policy.kind === "listen" || policy.kind === "free";
  const chart = spec.application && spec.application.chartId ? getChart(spec.application.chartId) : undefined;

  return (
    <div className={clsx("pls-learn-ex", detailed && "pls-learn-ex--detailed")}>
      <div className="pls-learn-ex__head">
        <p className="pls-learn-ex__title">{spec.title}</p>
        <span className="pls-badge">{DEMAND_LABELS[spec.demand]}</span>
        <span className="pls-badge pls-learn-badge--policy" title={policyExplanation(policy)}>
          {policyLabel(policy)}
        </span>
        {spec.status !== "reviewed" ? <span className="pls-badge pls-learn-badge--draft">{STATUS_LABELS[spec.status]}</span> : null}
        {inputs.length === 1 && inputs[0] === "midi" ? <span className="pls-badge">MIDI keyboard</span> : null}
        {marker && marker.done ? <span className="pls-badge pls-learn-badge--done">{marker.label}</span> : null}
      </div>
      <p className="pls-learn-ex__objective">{spec.objective}</p>
      {detailed ? (
        <>
          <p className="pls-learn-muted">{policyExplanation(policy)}</p>
          {spec.explanation && spec.explanation.length > 0 ? (
            <ul className="pls-learn-list">
              {spec.explanation.map((line: string) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
          {onOpenConcept && spec.conceptIds.length > 0 ? (
            <p className="pls-learn-inline-links">
              Concepts:{" "}
              {spec.conceptIds.map((id: string) => (
                <button key={id} type="button" className="pls-link-button" onClick={() => onOpenConcept(id)}>
                  {id}
                </button>
              ))}
            </p>
          ) : null}
        </>
      ) : null}
      <div className="pls-learn-actions">
        {unscored ? (
          <button type="button" className="pls-btn pls-btn--small pls-btn--primary" onClick={() => run()}>
            <Play size={14} aria-hidden="true" /> {policy.kind === "listen" ? "Listen in Practice" : "Play freely (not scored)"}
          </button>
        ) : (
          <>
            <button type="button" className="pls-btn pls-btn--small pls-btn--primary" onClick={() => run("step")}>
              <Play size={14} aria-hidden="true" /> Practise (step)
            </button>
            <button type="button" className="pls-btn pls-btn--small" onClick={() => run("timed")}>
              <Timer size={14} aria-hidden="true" /> Practise (timed)
            </button>
          </>
        )}
        {!unscored && spec.transferKeys
          ? spec.transferKeys.map((key: SpelledPitchClass) => (
              <button
                key={`${key.letter}${key.accidental}`}
                type="button"
                className="pls-btn pls-btn--small pls-btn--ghost"
                onClick={() => run("step", key)}
                title="Transfer: the same exercise transposed"
              >
                <Shuffle size={14} aria-hidden="true" /> In {formatPitchClass(key, { unicode: true })}
              </button>
            ))
          : null}
        {chart ? (
          <button type="button" className="pls-btn pls-btn--small pls-btn--ghost" onClick={() => openChartInSongs(runtime, chart.id)}>
            <Music size={14} aria-hidden="true" /> {chart.title}
          </button>
        ) : null}
      </div>
      {message ? (
        <p className="pls-error-text" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
