"use client";

import { useState } from "react";
import clsx from "clsx";
import { Check, Headphones, Lightbulb, Play, RotateCcw, SkipForward, Square } from "lucide-react";
import type { PracticeController, PracticeControllerState } from "@/ui/practice/practiceController";

export interface PracticeControlsProps {
  controller: PracticeController;
  state: PracticeControllerState;
}

function StepControls({ controller, state }: PracticeControlsProps): JSX.Element {
  const step = state.step;
  if (!step || !step.step) {
    return (
      <div className="pls-practice-controls__row">
        <button type="button" className="pls-btn pls-btn--primary" onClick={() => controller.startStep()}>
          <Play size={16} aria-hidden="true" />
          <span>Start step practice</span>
        </button>
      </div>
    );
  }
  const phase = step.phase;
  const correct = phase === "correct";
  return (
    <>
      <p className="pls-practice-controls__prompt">{step.step.prompt}</p>
      <div className="pls-practice-feedback" aria-live="polite" aria-atomic="true">
        {phase === "listening" ? <p className="pls-practice-feedback__line">Listen first, then play.</p> : null}
        {phase === "waiting" && step.attempts === 0 ? <p className="pls-practice-feedback__line pls-practice-feedback__line--muted">Take your time — the step waits for you.</p> : null}
        {state.confirmation ? (
          <p className="pls-practice-feedback__line pls-practice-feedback__line--good">
            <Check size={16} aria-hidden="true" />
            <span>{state.confirmation}</span>
          </p>
        ) : null}
        {phase === "retry" ? (
          <p className="pls-practice-feedback__line pls-practice-feedback__line--retry">
            <span className="pls-practice-feedback__mark" aria-hidden="true">
              ×
            </span>
            <span>Not yet — adjust and try again.</span>
          </p>
        ) : null}
        {step.explanation.map((line, index) => (
          <p key={`${index}-${line}`} className="pls-practice-feedback__line">
            {line}
          </p>
        ))}
        {step.hint ? (
          <p className="pls-practice-feedback__line pls-practice-feedback__hint">
            <Lightbulb size={16} aria-hidden="true" />
            <span>{step.hint}</span>
          </p>
        ) : null}
        {step.heldOver.length > 0 && !correct ? (
          <p className="pls-practice-feedback__line pls-practice-feedback__line--muted">Keys held from before count again once you strike them anew.</p>
        ) : null}
      </div>
      <div className="pls-practice-controls__row">
        <button type="button" className="pls-btn pls-btn--small" onClick={() => controller.requestHint()} disabled={step.nextHint === null || correct}>
          <Lightbulb size={16} aria-hidden="true" />
          <span>{step.hintLevel === 0 ? "Need a hint?" : "Another hint"}</span>
        </button>
        {correct && !state.autoAdvance ? (
          <button type="button" className="pls-btn pls-btn--primary pls-btn--small" onClick={() => controller.nextStep()}>
            <SkipForward size={16} aria-hidden="true" />
            <span>Next</span>
          </button>
        ) : null}
        <button type="button" className="pls-btn pls-btn--small pls-btn--ghost" onClick={() => controller.skipStep()} disabled={correct}>
          <SkipForward size={16} aria-hidden="true" />
          <span>Skip step</span>
        </button>
        <button type="button" className="pls-btn pls-btn--small pls-btn--ghost" onClick={() => controller.restart()}>
          <RotateCcw size={16} aria-hidden="true" />
          <span>Restart</span>
        </button>
      </div>
    </>
  );
}

function TimedControls({ controller, state }: PracticeControlsProps): JSX.Element {
  const running = state.status === "running";
  const timed = state.timed;
  return (
    <>
      <div className="pls-practice-controls__row">
        {running ? (
          <button type="button" className="pls-btn pls-btn--primary" onClick={() => controller.stopTimed()}>
            <Square size={16} aria-hidden="true" />
            <span>Stop and review</span>
          </button>
        ) : (
          <button type="button" className="pls-btn pls-btn--primary" onClick={() => controller.startTimed()}>
            <Play size={16} aria-hidden="true" />
            <span>Start with count-in</span>
          </button>
        )}
        <span className="pls-practice-controls__facts">
          {state.tempoBpm} BPM · count-in {state.countInBeats} · {state.loopEnabled && state.loopRegion ? `looping ${state.loopRegion.label ?? "the selection"}` : "whole exercise"}
        </span>
      </div>
      {running ? (
        <p className="pls-practice-feedback__line pls-practice-feedback__line--muted">
          {timed && timed.phase === "countingIn" ? "Count-in… " : ""}Your part is muted; play it on the keys. Pitch and timing are reported separately afterwards.
        </p>
      ) : (
        <p className="pls-practice-feedback__line pls-practice-feedback__line--muted">The accompaniment and click play; your part is muted so you hear only yourself.</p>
      )}
      {running && timed ? (
        <dl className="pls-timed-counts" aria-live="off">
          <div>
            <dt>On time</dt>
            <dd>{timed.onTime}</dd>
          </div>
          <div>
            <dt>Early</dt>
            <dd>{timed.early}</dd>
          </div>
          <div>
            <dt>Late</dt>
            <dd>{timed.late}</dd>
          </div>
          <div>
            <dt>Missed</dt>
            <dd>{timed.missed}</dd>
          </div>
          <div>
            <dt>Extra</dt>
            <dd>{timed.extra}</dd>
          </div>
          <div>
            <dt>Window</dt>
            <dd>±{timed.onsetWindowMs} ms</dd>
          </div>
        </dl>
      ) : null}
    </>
  );
}

function ListenControls({ controller }: PracticeControlsProps): JSX.Element {
  return (
    <>
      <p className="pls-practice-feedback__line pls-practice-feedback__line--muted">Listen and watch the keys. Nothing is scored; “I listened” records that you heard it.</p>
      <div className="pls-practice-controls__row">
        <button type="button" className="pls-btn" onClick={() => controller.playForMe()}>
          <Headphones size={16} aria-hidden="true" />
          <span>Play it for me</span>
        </button>
        <button type="button" className="pls-btn pls-btn--primary" onClick={() => controller.markListened()}>
          <Check size={16} aria-hidden="true" />
          <span>I listened</span>
        </button>
      </div>
    </>
  );
}

function FreeControls({ controller, state }: PracticeControlsProps): JSX.Element {
  const [notes, setNotes] = useState("");
  const running = state.status === "running";
  if (state.status === "reflect") {
    return (
      <div className="pls-reflect">
        <p className="pls-practice-feedback__line">
          Take recorded: {state.takeNoteCount} note{state.takeNoteCount === 1 ? "" : "s"}. Nothing is scored — replay it and write down what you noticed.
        </p>
        <label className="pls-field">
          <span className="pls-field__label">Your notes (not measured)</span>
          <textarea className="pls-input pls-reflect__text" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="What worked? What would you change next time?" />
        </label>
        <div className="pls-practice-controls__row">
          <button type="button" className="pls-btn" onClick={() => controller.replayTake()} disabled={state.takeNoteCount === 0}>
            <Play size={16} aria-hidden="true" />
            <span>Replay my take</span>
          </button>
          <button
            type="button"
            className="pls-btn pls-btn--primary"
            onClick={() => {
              controller.saveFreeTake(notes);
              setNotes("");
            }}
          >
            <Check size={16} aria-hidden="true" />
            <span>Save take and notes</span>
          </button>
          <button type="button" className="pls-btn pls-btn--ghost" onClick={() => controller.discardTake()}>
            <span>Discard</span>
          </button>
        </div>
      </div>
    );
  }
  return (
    <>
      <p className="pls-practice-feedback__line pls-practice-feedback__line--muted">Free playing: record yourself over the backing, then replay and reflect. Nothing is scored.</p>
      <div className="pls-practice-controls__row">
        {running ? (
          <button type="button" className="pls-btn pls-btn--primary" onClick={() => controller.stopFreeTake()}>
            <Square size={16} aria-hidden="true" />
            <span>Stop recording</span>
          </button>
        ) : (
          <button type="button" className="pls-btn pls-btn--primary" onClick={() => controller.startFreeTake()}>
            <Play size={16} aria-hidden="true" />
            <span>Record a take</span>
          </button>
        )}
      </div>
    </>
  );
}

/** Mode-specific controls and live feedback, between the header and the stage. */
export function PracticeControls({ controller, state }: PracticeControlsProps): JSX.Element | null {
  if (!state.exercise || state.status === "review") {
    return null;
  }
  return (
    <div className={clsx("pls-practice-controls", `pls-practice-controls--${state.mode}`)}>
      {state.message ? (
        <p className="pls-practice-message" role="status">
          <span>{state.message}</span>
          <button type="button" className="pls-link-button" onClick={() => controller.dismissMessage()}>
            Dismiss
          </button>
        </p>
      ) : null}
      {state.mode === "step" ? <StepControls controller={controller} state={state} /> : null}
      {state.mode === "timed" ? <TimedControls controller={controller} state={state} /> : null}
      {state.mode === "listen" ? <ListenControls controller={controller} state={state} /> : null}
      {state.mode === "free" ? <FreeControls controller={controller} state={state} /> : null}
    </div>
  );
}
