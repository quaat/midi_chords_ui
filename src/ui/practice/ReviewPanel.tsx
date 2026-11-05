"use client";

import clsx from "clsx";
import { ArrowRight, BookOpen, Check, RotateCcw } from "lucide-react";
import { SCORING_VERSION } from "@/practice";
import { useSessionDispatch } from "@/state/useSessionStore";
import { useStudioRuntime } from "@/ui/runtime/useStudioRuntime";
import type { PracticeController, PracticeReview } from "@/ui/practice/practiceController";
import { requestConcept } from "@/ui/practice/practiceRequests";

export interface ReviewPanelProps {
  review: PracticeReview;
  controller: PracticeController;
}

const MODE_TEXT: Record<string, string> = {
  listen: "Listening",
  assisted: "Assisted",
  step: "Step practice",
  timed: "Timed practice",
  free: "Free playing"
};

const ASSISTANCE_TEXT: Record<string, string> = {
  full: "full hints",
  reduced: "reduced hints",
  none: "no visual hints"
};

/** Session review (plan E15): pitch and timing kept apart, one primary next action. */
export function ReviewPanel({ review, controller }: ReviewPanelProps): JSX.Element {
  const runtime = useStudioRuntime();
  const dispatch = useSessionDispatch();
  const { result, description } = review;
  const conceptId = review.exercise.conceptIds.length > 0 ? review.exercise.conceptIds[0] : null;
  const anyHints = review.stepRows.some((row) => row.hintLevelUsed > 0);

  return (
    <section className="pls-review" aria-label="Practice review">
      <header className="pls-review__head">
        <h2 className="pls-review__title">Review</h2>
        <p className="pls-review__meta">
          {MODE_TEXT[result.mode] ?? result.mode} · {ASSISTANCE_TEXT[result.assistance] ?? result.assistance}
          {result.tempoBpm !== undefined ? ` · ${Math.round(result.tempoBpm)} BPM` : ""}
          {result.hintLevel > 0 ? ` · hint level ${result.hintLevel}` : ""}
        </p>
        <p className={clsx("pls-review__saved", !review.recorded && "pls-error-text")} role="status">
          {review.recordMessage}
        </p>
      </header>

      {review.unscored ? (
        <p className="pls-review__line">
          Nothing was scored: {result.mode === "listen" ? "this was a listening step." : "this was free playing (explore and reflect)."}
        </p>
      ) : (
        <div className="pls-review__lines">
          <p className="pls-review__line">
            <span className="pls-review__label">Pitch</span>
            <span>{description.pitchLine}</span>
          </p>
          <p className="pls-review__line">
            <span className="pls-review__label">Timing</span>
            <span>{description.timingLine}</span>
          </p>
        </div>
      )}

      {review.warmup ? (
        <div className="pls-review__warmup">
          <h3 className="pls-review__subtitle">Measured</h3>
          {review.warmup.measured.length > 0 ? (
            <ul className="pls-review__list">
              {review.warmup.measured.map((item) => (
                <li key={item.kind}>
                  <strong>{item.label}:</strong> {item.value} <span className="pls-review__detail">{item.detail}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pls-review__detail">Nothing measurable was recorded.</p>
          )}
          {review.warmup.notMeasured.length > 0 ? (
            <ul className="pls-review__list pls-review__list--muted">
              {review.warmup.notMeasured.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
          <h3 className="pls-review__subtitle">Authored guidance (not measured)</h3>
          <ul className="pls-review__list pls-review__guidance">
            {review.warmup.authoredGuidance.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {review.warmup.handAttributionNote ? <p className="pls-review__detail">{review.warmup.handAttributionNote}</p> : null}
          <p className="pls-review__detail">{review.warmup.caveat}</p>
        </div>
      ) : null}

      {review.stepRows.length > 0 ? (
        <div className="pls-review__table-wrap">
          <table className="pls-review__table">
            <caption className="pls-sr-only">Result per step</caption>
            <thead>
              <tr>
                <th scope="col">Step</th>
                <th scope="col">Pitch</th>
                <th scope="col">Tries</th>
                {anyHints ? <th scope="col">Hints used</th> : null}
                <th scope="col">Missing</th>
                <th scope="col">Extra</th>
              </tr>
            </thead>
            <tbody>
              {review.stepRows.map((row) => (
                <tr key={row.key} className={clsx(!row.correct && "pls-review__row--miss")}>
                  <th scope="row">{row.label}</th>
                  <td>{row.correct ? "correct" : "not correct"}</td>
                  <td>{row.attempts}</td>
                  {anyHints ? <td>{row.hintLevelUsed}</td> : null}
                  <td>
                    {row.missing.length > 0 ? row.missing.join(" ") : "—"}
                    {row.missingRoles.length > 0 ? <span className="pls-review__detail"> ({row.missingRoles.join(", ")})</span> : null}
                  </td>
                  <td>{row.extra.length > 0 ? row.extra.join(" ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {review.transitions.length > 0 ? (
        <div>
          <h3 className="pls-review__subtitle">Changes to practise</h3>
          <ul className="pls-review__list">
            {review.transitions.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.selfAssessment ? (
        <div className="pls-review__self">
          <h3 className="pls-review__subtitle">Your notes (not measured)</h3>
          <p className="pls-review__selftext">{result.selfAssessment}</p>
        </div>
      ) : null}

      <ul className="pls-review__caveats">
        {description.caveats.map((line) => (
          <li key={line}>{line}</li>
        ))}
        {result.scoringVersion !== SCORING_VERSION ? <li>Scored with scoring version {result.scoringVersion}.</li> : null}
      </ul>

      <div className="pls-review__actions">
        <button type="button" className="pls-btn pls-btn--primary" onClick={() => controller.applyReviewAction(review.action)}>
          {review.action.type === "routineNext" ? <ArrowRight size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
          <span>{review.action.label}</span>
        </button>
        {review.action.type !== "again" ? (
          <button type="button" className="pls-btn" onClick={() => controller.restart()}>
            <RotateCcw size={16} aria-hidden="true" />
            <span>Retry</span>
          </button>
        ) : null}
        {conceptId ? (
          <button
            type="button"
            className="pls-btn pls-btn--ghost"
            onClick={() => {
              requestConcept(conceptId);
              runtime.navigate.openEntry("learn");
            }}
          >
            <BookOpen size={16} aria-hidden="true" />
            <span>Back to Learn</span>
          </button>
        ) : null}
        <button type="button" className="pls-btn pls-btn--ghost" onClick={() => dispatch({ type: "setMode", mode: "explore" })}>
          <span>Back to Explore</span>
        </button>
      </div>
    </section>
  );
}
