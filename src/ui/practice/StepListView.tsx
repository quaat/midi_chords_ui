"use client";

import clsx from "clsx";
import type { AssistanceLevel, ExerciseDefinition, ExerciseStep, Hand } from "@/model/contracts";
import { noteLabel } from "@/practice/text";
import { prettyDegree } from "@/ui/piano/pianoLabels";
import { assistanceView } from "@/ui/practice/assistance";

export interface StepListViewProps {
  exercise: ExerciseDefinition;
  /** Index of the current step (-1: none yet). */
  currentIndex: number;
  assistance: AssistanceLevel;
  /** How many upcoming steps to list after the current one. */
  upcoming?: number;
}

function handTag(hand: Hand | undefined): string | null {
  if (hand === "left") return "LH";
  if (hand === "right") return "RH";
  return null;
}

function StepNotes({ step, showNames }: { step: ExerciseStep; showNames: boolean }): JSX.Element {
  if (!showNames) {
    return <p className="pls-steplist__hidden">Notes hidden at this hint level — play from the prompt.</p>;
  }
  if (step.targets.length === 0) {
    return <p className="pls-steplist__hidden">Nothing fixed to play here (free).</p>;
  }
  return (
    <ul className="pls-steplist__notes">
      {[...step.targets]
        .sort((a, b) => a.midi - b.midi)
        .map((note) => {
          const hand = handTag(note.hand);
          return (
            <li key={note.id} className="pls-steplist__note">
              <span className="pls-steplist__name">{noteLabel(note.midi, step.chord, note.spelled)}</span>
              {note.degree ? <span className="pls-steplist__degree">{prettyDegree(note.degree)}</span> : null}
              {hand ? <span className="pls-steplist__hand">{hand}</span> : null}
            </li>
          );
        })}
    </ul>
  );
}

/** Non-moving step list (plan "static step view"): current prompt, notes, degrees, hands, next steps. */
export function StepListView({ exercise, currentIndex, assistance, upcoming = 3 }: StepListViewProps): JSX.Element {
  const view = assistanceView(assistance);
  const index = Math.max(0, currentIndex);
  const current = exercise.steps[index];
  const next = exercise.steps.slice(index + 1, index + 1 + upcoming);
  if (!current) {
    return <p className="pls-practice-empty">No steps in this exercise.</p>;
  }
  return (
    <section className="pls-steplist" aria-label="Steps">
      <div className="pls-steplist__current" aria-live="polite" aria-atomic="true">
        <p className="pls-steplist__kicker">
          Step {index + 1} of {exercise.steps.length}
        </p>
        <p className="pls-steplist__prompt">{current.prompt}</p>
        <StepNotes step={current} showNames={view.showNoteNames} />
      </div>
      {next.length > 0 ? (
        <ol className="pls-steplist__upcoming" aria-label="Next steps">
          {next.map((step, offset) => (
            <li key={step.id} className={clsx("pls-steplist__item", offset === 0 && "pls-steplist__item--next")}>
              <span className="pls-steplist__item-kicker">{offset === 0 ? "Next" : "Then"}</span>
              <span className="pls-steplist__item-prompt">{step.prompt}</span>
              <StepNotes step={step} showNames={view.showNoteNames} />
            </li>
          ))}
        </ol>
      ) : (
        <p className="pls-steplist__last">This is the last step.</p>
      )}
    </section>
  );
}
