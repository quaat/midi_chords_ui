"use client";

import { useMemo } from "react";
import { Ear, Headphones } from "lucide-react";
import type { AssistanceLevel, SpelledPitchClass } from "@/model/contracts";
import { getExerciseSpec } from "@/content";
import { formatPitchClass } from "@/music/pitch";
import { useMaterial } from "@/ui/runtime/useStudioRuntime";
import { ASSISTANCE_LEVELS } from "@/ui/practice/assistance";
import type { PracticeController, PracticeControllerState } from "@/ui/practice/practiceController";
import { PRACTICE_MODE_LABELS } from "@/ui/practice/practiceRequests";

export interface PracticeHeaderProps {
  controller: PracticeController;
  state: PracticeControllerState;
}

function keyId(pc: SpelledPitchClass): string {
  return `${pc.letter}${pc.accidental}`;
}

function sameKey(a: SpelledPitchClass, b: SpelledPitchClass): boolean {
  return a.letter === b.letter && a.accidental === b.accidental;
}

/** Keys an exercise can be played in: the authored key plus its declared transfer keys. */
function keyOptions(state: PracticeControllerState): { options: SpelledPitchClass[]; current: SpelledPitchClass | null } {
  const extras = state.extras;
  if (!extras || extras.source !== "exercise" || !extras.specId) {
    return { options: [], current: null };
  }
  const spec = getExerciseSpec(extras.specId);
  if (!spec || !spec.key || !spec.transferKeys || spec.transferKeys.length === 0) {
    return { options: [], current: null };
  }
  const options: SpelledPitchClass[] = [spec.key.tonic];
  spec.transferKeys.forEach((pc) => {
    if (!options.some((existing) => sameKey(existing, pc))) {
      options.push(pc);
    }
  });
  return { options, current: extras.transposeTo ?? spec.key.tonic };
}

/** Compact header above the practice stage. */
export function PracticeHeader({ controller, state }: PracticeHeaderProps): JSX.Element {
  const material = useMaterial();
  const keys = useMemo(() => keyOptions(state), [state]);
  const running = state.status === "running";
  const step = state.step;
  const hints = step && step.step ? step.step.hints.length : 0;
  const busyTake = running && (state.mode === "timed" || state.mode === "free");

  return (
    <div className="pls-practice-header">
      <div className="pls-practice-header__title">
        <h2 className="pls-practice-header__name">{state.title || "Practice"}</h2>
        <span className="pls-badge">{PRACTICE_MODE_LABELS[state.mode]}</span>
        {state.mode === "step" && step && step.stepCount > 0 ? (
          <span className="pls-practice-header__fact">
            Step {Math.min(step.stepIndex + 1, step.stepCount)} of {step.stepCount}
          </span>
        ) : null}
        <span className="pls-practice-header__fact">{state.tempoBpm} BPM</span>
        {state.mode === "step" && hints > 0 && step ? (
          <span className="pls-practice-header__fact">
            Hints {step.hintLevel}/{hints}
          </span>
        ) : null}
        {state.loopEnabled && state.loopRegion ? <span className="pls-practice-header__fact">Loop: {state.loopRegion.label ?? "selected bars"}</span> : null}
      </div>
      <div className="pls-practice-header__actions">
        <button
          type="button"
          className="pls-btn pls-btn--small"
          onClick={() => controller.playForMe()}
          disabled={busyTake || !material.timeline}
          aria-pressed={material.demonstrating}
          title="Play the whole exercise for you (learner part as demonstration)"
        >
          <Headphones size={16} aria-hidden="true" />
          <span>{material.demonstrating ? "Stop demo" : "Play it for me"}</span>
        </button>
        <button type="button" className="pls-btn pls-btn--small" onClick={() => controller.listenCurrent()} disabled={busyTake} title="Hear only the current step">
          <Ear size={16} aria-hidden="true" />
          <span>Listen</span>
        </button>
        <label className="pls-field pls-field--inline">
          <span className="pls-field__label">Hints</span>
          <select
            className="pls-select"
            value={state.assistance}
            onChange={(event) => controller.setAssistance(event.target.value as AssistanceLevel)}
            disabled={busyTake}
            aria-label="Visual hints on the piano"
          >
            {ASSISTANCE_LEVELS.map((level) => (
              <option key={level.value} value={level.value} title={level.description}>
                {level.label}
              </option>
            ))}
          </select>
        </label>
        {keys.options.length > 1 && keys.current ? (
          <label className="pls-field pls-field--inline">
            <span className="pls-field__label">Key</span>
            <select
              className="pls-select"
              value={keyId(keys.current)}
              disabled={running && state.mode !== "step"}
              onChange={(event) => {
                const chosen = keys.options.find((pc) => keyId(pc) === event.target.value);
                if (chosen) {
                  controller.transposeTo(chosen);
                }
              }}
              aria-label="Play in another key"
            >
              {keys.options.map((pc) => (
                <option key={keyId(pc)} value={keyId(pc)}>
                  {formatPitchClass(pc, { unicode: true })}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
    </div>
  );
}
