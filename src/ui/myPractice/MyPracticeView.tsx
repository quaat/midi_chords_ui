"use client";

/**
 * My Practice (plan E19/E28/E31): continue where you left off, transparent review suggestions,
 * routines, progress by concept (five evidence kinds kept apart), goals and data controls.
 * All progress reads go through `useProgress()`.
 */
import { Fragment, useMemo, useState } from "react";
import clsx from "clsx";
import { ListChecks, Play } from "lucide-react";
import type { ExerciseDefinition, ProgressFile } from "@/model/contracts";
import { contentBundle, getChart, getConcept, getExerciseSpec, getWarmup } from "@/content";
import { compileExercise, SCORING_VERSION } from "@/practice";
import { useStudioRuntime } from "@/ui/runtime/useStudioRuntime";
import { DataSection, GoalsSection } from "@/ui/myPractice/MyPracticeData";
import type { ContinueTarget, EvidenceRow } from "@/ui/myPractice/progressModel";
import { EVIDENCE_COLUMNS, continueModel, evidenceRows, occurrenceDescriber, scoringVersionSummary, suggestionRows, transitionRows } from "@/ui/myPractice/progressModel";
import { useProgress } from "@/ui/myPractice/useProgress";
import { openArrangementInPractice, openExerciseInPractice } from "@/ui/practice/openExercise";
import { requestConcept } from "@/ui/practice/practiceRequests";
import { resumableRoutines, startRoutine } from "@/ui/practice/RoutineRunner";

function conceptTitle(conceptId: string): string {
  const concept = getConcept(conceptId);
  return concept ? concept.title : conceptId;
}

function exerciseTitle(exerciseId: string): string {
  const spec = getExerciseSpec(exerciseId);
  if (spec) return spec.title;
  const warmup = getWarmup(exerciseId);
  if (warmup) return warmup.title;
  if (exerciseId.startsWith("chart:")) {
    const chart = getChart(exerciseId.split(":")[1] ?? "");
    return chart ? `${chart.title} (song)` : exerciseId;
  }
  if (exerciseId.startsWith("run:")) return `Scale run ${exerciseId.slice(4).split(":").slice(0, 2).join(" ")}`;
  if (exerciseId.startsWith("material:")) return "Practised progression";
  if (exerciseId.startsWith("explore:")) return `Explore: ${exerciseId.slice(8)}`;
  return exerciseId;
}

function compileForDescription(exerciseId: string): ExerciseDefinition | null {
  const spec = getExerciseSpec(exerciseId);
  if (!spec) return null;
  const compiled = compileExercise(spec);
  return compiled.ok ? compiled.exercise : null;
}

function formatDate(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

interface SectionProps {
  progress: ProgressFile;
  onMessage: (text: string | null) => void;
}

function ContinueCard({ progress, onMessage }: SectionProps): JSX.Element {
  const runtime = useStudioRuntime();
  const routines = useMemo(() => resumableRoutines(progress.routineState, runtime.stores.adapter), [progress, runtime]);
  const last = useMemo(() => continueModel(progress, exerciseTitle), [progress]);

  const openTarget = (target: ContinueTarget): void => {
    if (target.kind === "concept") {
      requestConcept(target.conceptId);
      runtime.navigate.openEntry("learn");
      return;
    }
    if (target.kind === "chart") {
      const opened = openArrangementInPractice(runtime, target.chartId, target.arrangementId);
      onMessage(opened.ok ? null : opened.message);
      return;
    }
    const opened = openExerciseInPractice(runtime, target.exerciseId, {
      mode: target.mode,
      tempoBpm: target.tempoBpm,
      transposeTo: target.transposeTo,
      assistance: target.assistance,
      loopRegion: target.loopRegion ? { ...target.loopRegion, label: "the difficult change" } : undefined
    });
    onMessage(opened.ok ? null : opened.message);
  };

  if (routines.length === 0 && !last) {
    return (
      <section className="pls-mp-card pls-mp-card--wide" aria-labelledby="pls-mp-continue">
        <h2 id="pls-mp-continue" className="pls-mp-card__title">
          Continue
        </h2>
        <p className="pls-mp-card__text">Nothing to continue yet. Start the starter routine below or pick a suggestion.</p>
      </section>
    );
  }
  return (
    <section className="pls-mp-card pls-mp-card--wide" aria-labelledby="pls-mp-continue">
      <h2 id="pls-mp-continue" className="pls-mp-card__title">
        Continue
      </h2>
      <ul className="pls-mp-list">
        {routines.map((routine) => (
          <li key={routine.routineId} className="pls-mp-list__item">
            <span className="pls-mp-list__text">
              <span className="pls-mp-list__title">{routine.title}</span>
              <span className="pls-mp-list__reason">
                Item {routine.itemIndex + 1} of {routine.itemCount}: {routine.nextTitle} · paused {formatDate(routine.updatedAt)}
              </span>
            </span>
            <button
              type="button"
              className="pls-btn pls-btn--primary pls-btn--small"
              onClick={() => {
                const opened = startRoutine(runtime, routine.routineId);
                onMessage(opened.ok ? null : opened.message);
              }}
            >
              <Play size={14} aria-hidden="true" />
              <span>Resume routine</span>
            </button>
          </li>
        ))}
        {last ? (
          <li className="pls-mp-list__item">
            <span className="pls-mp-list__text">
              <span className="pls-mp-list__title">{last.title}</span>
              <span className="pls-mp-list__reason">
                Last practised {formatDate(last.attempt.completedAt ?? last.attempt.startedAt)} ({last.attempt.mode}). Suggested next: {last.label}
              </span>
            </span>
            {last.target ? (
              <button type="button" className="pls-btn pls-btn--small" onClick={() => (last.target ? openTarget(last.target) : undefined)}>
                <Play size={14} aria-hidden="true" />
                <span>{last.target.kind === "concept" ? "Review the idea" : "Continue"}</span>
              </button>
            ) : null}
          </li>
        ) : null}
      </ul>
    </section>
  );
}

function SuggestionsCard({ progress, onMessage }: SectionProps): JSX.Element {
  const runtime = useStudioRuntime();
  const describe = useMemo(() => occurrenceDescriber(compileForDescription), []);
  const rows = useMemo(() => suggestionRows(progress, Date.now(), contentBundle.exerciseSpecs, conceptTitle, { limit: 5, describeOccurrence: describe }), [progress, describe]);
  return (
    <section className="pls-mp-card" aria-labelledby="pls-mp-suggested">
      <h2 id="pls-mp-suggested" className="pls-mp-card__title">
        Suggested review
      </h2>
      <p className="pls-mp-card__text">Based only on your local history; each suggestion says why.</p>
      {rows.length === 0 ? <p className="pls-mp-card__text">No suggestions right now.</p> : null}
      <ul className="pls-mp-list">
        {rows.map((row) => (
          <li key={row.exerciseId} className="pls-mp-list__item">
            <span className="pls-mp-list__text">
              <span className="pls-mp-list__title">
                {row.title}
                {row.due ? <span className="pls-badge pls-mp-due">due</span> : null}
              </span>
              <span className="pls-mp-list__reason">{row.reason}</span>
              <span className="pls-mp-list__concept">{row.conceptTitle}</span>
            </span>
            <button
              type="button"
              className="pls-btn pls-btn--small"
              aria-label={`Start ${row.title}`}
              onClick={() => {
                const opened = openExerciseInPractice(runtime, row.exerciseId);
                onMessage(opened.ok ? null : opened.message);
              }}
            >
              <Play size={14} aria-hidden="true" />
              <span>Start</span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="pls-link-button" onClick={() => runtime.navigate.openEntry("learn")}>
        Choose something else in Learn
      </button>
    </section>
  );
}

function RoutinesCard({ progress, onMessage }: SectionProps): JSX.Element {
  const runtime = useStudioRuntime();
  const routines = useMemo(() => {
    const list = [...contentBundle.routines];
    return list.sort((a, b) => {
      const aStarter = /starter/i.test(a.title) || a.id.includes("starter") ? 0 : 1;
      const bStarter = /starter/i.test(b.title) || b.id.includes("starter") ? 0 : 1;
      return aStarter - bStarter;
    });
  }, []);
  return (
    <section className="pls-mp-card" aria-labelledby="pls-mp-routines">
      <h2 id="pls-mp-routines" className="pls-mp-card__title">
        Routines
      </h2>
      <p className="pls-mp-card__text">Short sessions with a warm-up, a scale, harmony and a song passage. Completing a routine is a habit, not a mastery score.</p>
      <ul className="pls-mp-list">
        {routines.map((routine) => {
          const saved = progress.routineState[routine.id];
          return (
            <li key={routine.id} className="pls-mp-list__item">
              <span className="pls-mp-list__text">
                <span className="pls-mp-list__title">{routine.title}</span>
                {routine.description ? <span className="pls-mp-list__reason">{routine.description}</span> : null}
                <span className="pls-mp-list__concept">{routine.items.length} items{routine.meta.status === "draft" ? " · draft content" : ""}</span>
              </span>
              <span className="pls-mp-row">
                <button
                  type="button"
                  className="pls-btn pls-btn--small pls-btn--primary"
                  onClick={() => {
                    const opened = startRoutine(runtime, routine.id, { fromStart: saved === undefined });
                    onMessage(opened.ok ? null : opened.message);
                  }}
                >
                  <ListChecks size={14} aria-hidden="true" />
                  <span>{saved ? "Resume" : "Start"}</span>
                </button>
                {saved ? (
                  <button
                    type="button"
                    className="pls-btn pls-btn--small pls-btn--ghost"
                    onClick={() => {
                      const opened = startRoutine(runtime, routine.id, { fromStart: true });
                      onMessage(opened.ok ? null : opened.message);
                    }}
                  >
                    Start over
                  </button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function EvidenceTable({ rows }: { rows: EvidenceRow[] }): JSX.Element {
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (rows.length === 0) {
    return <p className="pls-mp-card__text">No evidence yet. Reading, listening and playing each add their own kind of evidence.</p>;
  }
  const toggle = (conceptId: string): void => {
    const next = new Set(open);
    if (next.has(conceptId)) next.delete(conceptId);
    else next.add(conceptId);
    setOpen(next);
  };
  return (
    <div className="pls-mp-table-wrap">
      <table className="pls-mp-table">
        <caption className="pls-sr-only">Evidence by concept; each column is a separate kind of evidence.</caption>
        <thead>
          <tr>
            <th scope="col">Concept</th>
            {EVIDENCE_COLUMNS.map((column) => (
              <th key={column.kind} scope="col" title={column.description}>
                {column.label}
              </th>
            ))}
            <th scope="col">Last</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const expanded = open.has(row.conceptId);
            return (
              <Fragment key={row.conceptId}>
                <tr>
                  <th scope="row">
                    <button type="button" className="pls-link-button" aria-expanded={expanded} onClick={() => toggle(row.conceptId)} title="Show keys, tempos and hint levels">
                      {row.title}
                    </button>
                  </th>
                  {EVIDENCE_COLUMNS.map((column) => (
                    <td key={column.kind} className={clsx(row.counts[column.kind] === 0 && "pls-mp-table__zero")}>
                      {row.counts[column.kind]}
                    </td>
                  ))}
                  <td>{formatDate(row.lastAt)}</td>
                </tr>
                {expanded
                  ? row.combos.map((combo) => (
                      <tr key={`${row.conceptId}|${combo.comboId}`} className="pls-mp-table__sub">
                        <th scope="row">{combo.label}</th>
                        {EVIDENCE_COLUMNS.map((column) => (
                          <td key={column.kind} className={clsx(combo.counts[column.kind] === 0 && "pls-mp-table__zero")}>
                            {combo.counts[column.kind]}
                          </td>
                        ))}
                        <td />
                      </tr>
                    ))
                  : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ProgressCard({ progress }: { progress: ProgressFile }): JSX.Element {
  const rows = useMemo(() => evidenceRows(progress, conceptTitle), [progress]);
  const describe = useMemo(() => occurrenceDescriber(compileForDescription), []);
  const transitions = useMemo(() => transitionRows(progress, exerciseTitle, describe, 6), [progress, describe]);
  return (
    <section className="pls-mp-card pls-mp-card--wide" aria-labelledby="pls-mp-progress">
      <h2 id="pls-mp-progress" className="pls-mp-card__title">
        Progress by concept
      </h2>
      <p className="pls-mp-card__text">
        Counts per kind of evidence — kept apart on purpose, there is no single mastery number. Select a concept to see keys, tempos and hint levels.
      </p>
      <EvidenceTable rows={rows} />
      <h3 className="pls-mp-card__subtitle">Difficult changes</h3>
      {transitions.length === 0 ? (
        <p className="pls-mp-card__text">No difficult changes recorded.</p>
      ) : (
        <ul className="pls-mp-list">
          {transitions.map((row) => (
            <li key={row.key} className="pls-mp-list__item">
              <span className="pls-mp-list__text">
                <span className="pls-mp-list__title">{row.label}</span>
                <span className="pls-mp-list__reason">
                  {row.exerciseTitle} · {row.pitchMisses} pitch miss{row.pitchMisses === 1 ? "" : "es"} · {row.timingMisses} timing miss{row.timingMisses === 1 ? "" : "es"} over {row.attempts} attempt
                  {row.attempts === 1 ? "" : "s"}
                  {row.missingRoles ? ` · missing: ${row.missingRoles}` : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function MyPracticeView(): JSX.Element {
  const progress = useProgress();
  const [message, setMessage] = useState<string | null>(null);
  const scoringNote = useMemo(() => (progress.progress ? scoringVersionSummary(progress.progress, SCORING_VERSION) : null), [progress.progress]);
  const file = progress.progress;

  return (
    <div className="pls-mp">
      <header className="pls-mp__head">
        <h1 className="pls-mp__title">My Practice</h1>
        <p className="pls-mp-card__text">Everything here is stored only in this browser.</p>
      </header>
      {message ? (
        <p className="pls-mp-warning" role="status">
          {message}
        </p>
      ) : null}
      {file ? (
        <div className="pls-mp__grid">
          <ContinueCard progress={file} onMessage={setMessage} />
          <SuggestionsCard progress={file} onMessage={setMessage} />
          <RoutinesCard progress={file} onMessage={setMessage} />
          <ProgressCard progress={file} />
          <GoalsSection progress={progress} />
          <DataSection progress={progress} scoringNote={scoringNote} />
        </div>
      ) : (
        <div className="pls-mp__grid">
          <DataSection progress={progress} scoringNote={null} />
        </div>
      )}
    </div>
  );
}
