"use client";

import clsx from "clsx";
import type { StaticStep } from "@/ui/stage/staticSteps";

export interface StaticStepViewProps {
  /** Current step first, then upcoming steps. */
  steps: StaticStep[];
  title?: string;
  showDegrees?: boolean;
  showHands?: boolean;
  emptyMessage?: string;
  className?: string;
}

function handLabel(hand: string | undefined): string | null {
  if (hand === "left") {
    return "LH";
  }
  if (hand === "right") {
    return "RH";
  }
  return null;
}

function StepNotes({ step, showDegrees, showHands }: { step: StaticStep; showDegrees: boolean; showHands: boolean }): JSX.Element {
  if (step.notes.length === 0) {
    return <p className="pls-steps__none">No notes to play</p>;
  }
  return (
    <ul className="pls-steps__notes">
      {step.notes.map((note) => {
        const hand = showHands ? handLabel(note.hand) : null;
        return (
          <li key={`${step.id}-${note.midi}`} className="pls-steps__note">
            <span className="pls-steps__note-name">{note.name}</span>
            {showDegrees && note.degree ? <span className="pls-steps__note-degree">{note.degree}</span> : null}
            {hand ? <span className="pls-steps__note-hand">{hand}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Non-moving alternative to the falling notes: the current step and the next few, in
 * plain DOM. Only the current step is a polite live region, and it changes once per step.
 */
export function StaticStepView({
  steps,
  title = "Steps",
  showDegrees = true,
  showHands = true,
  emptyMessage = "Nothing to play yet.",
  className
}: StaticStepViewProps): JSX.Element {
  const [current, ...upcoming] = steps;
  return (
    <section className={clsx("pls-steps", className)} aria-label={title}>
      <div className="pls-steps__current" aria-live="polite" aria-atomic="true">
        {current ? (
          <>
            <p className="pls-steps__kicker">{current.sounding === false ? "Get ready" : "Now"}</p>
            <p className="pls-steps__symbol">{current.symbol}</p>
            {current.positionLabel ? <p className="pls-steps__position">{current.positionLabel}</p> : null}
            <StepNotes step={current} showDegrees={showDegrees} showHands={showHands} />
          </>
        ) : (
          <p className="pls-steps__empty">{emptyMessage}</p>
        )}
      </div>
      {upcoming.length > 0 ? (
        <ol className="pls-steps__upcoming" aria-label="Next steps">
          {upcoming.map((step, i) => (
            <li key={step.id} className={clsx("pls-steps__item", i === 0 && "pls-steps__item--next")}>
              <div className="pls-steps__item-head">
                <span className="pls-steps__item-kicker">{i === 0 ? "Next" : `Then`}</span>
                <span className="pls-steps__item-symbol">{step.symbol}</span>
                {step.positionLabel ? <span className="pls-steps__position">{step.positionLabel}</span> : null}
              </div>
              <StepNotes step={step} showDegrees={showDegrees} showHands={showHands} />
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
