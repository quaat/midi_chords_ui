"use client";

/**
 * Learn catalogue (plan E31): search + filters, three entry routes with a tiny self-selection
 * flow, concept pages, path overviews, exercise details and the harmonisation lab.
 * Opening a page never loads material or resets the saved project; only explicit actions do.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowLeft, BookOpen, ListChecks, Search } from "lucide-react";
import type { Demand, ProgressEvidence, Strand } from "@/model/contracts";
import { getConcept, getPath, getPlayable, getRoutine, glossary } from "@/content";
import type { GlossaryEntry, SearchResult } from "@/content";
import { useStudioRuntime, useUiState } from "@/ui/runtime/useStudioRuntime";
import { consumeConceptRequest } from "@/ui/practice/practiceRequests";
import { consumeLearnRequest, subscribeLearnRequests } from "@/ui/learn/learnRequests";
import type { LearnRequest } from "@/ui/learn/learnRequests";
import {
  DEFAULT_LEARN_FILTERS,
  DEMAND_LABELS,
  EMPTY_SELF_ASSESSMENT,
  ENTRY_ROUTES,
  INPUT_FILTER_LABELS,
  KIND_LABELS,
  RECOMMENDATION_CAVEAT,
  SELF_QUESTIONS,
  STATUS_LABELS,
  STRAND_LABELS,
  STRAND_ORDER,
  buildCatalogue,
  recommendRoute,
  routeById,
  unitMarker
} from "@/ui/learn/learnLogic";
import type { EntryRoute, InputFilter, LearnFilters, SelfAnswer, SelfAssessment, UnitKind } from "@/ui/learn/learnLogic";
import { openChartInSongs } from "@/ui/learn/learnActions";
import { ConceptPage } from "@/ui/learn/ConceptPage";
import { ExerciseCard } from "@/ui/learn/ExerciseCard";
import { PathOverview } from "@/ui/learn/PathOverview";
import type { PathUnit } from "@/ui/learn/PathOverview";
import { HarmonisationLab } from "@/ui/learn/HarmonisationLab";

type Selection =
  | { kind: "concept"; id: string }
  | { kind: "path"; id: string }
  | { kind: "exercise"; id: string }
  | { kind: "routine"; id: string }
  | { kind: "lab"; id: "scale" | "melody" };

const INPUT_FILTERS: readonly InputFilter[] = ["any", "none", "computerKeyboard", "midi"];
const DEMANDS: readonly Demand[] = ["beginner", "intermediate", "advanced"];
const ANSWERS: readonly { value: SelfAnswer; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "Not yet" },
  { value: "unsure", label: "Not sure" }
];

function sameSelection(a: Selection | null, b: Selection | null): boolean {
  return a !== null && b !== null && a.kind === b.kind && a.id === b.id;
}

function selectionFromRequest(request: LearnRequest): Selection {
  return request.kind === "path" ? { kind: "path", id: request.id } : { kind: "concept", id: request.id };
}

// ---------------------------------------------------------------------------
// Entry routes + self-selection
// ---------------------------------------------------------------------------

function EntryRoutes({ onOpenPath, activePathId }: { onOpenPath: (pathId: string) => void; activePathId: string | null }): JSX.Element {
  const [open, setOpen] = useState<boolean>(false);
  const [answers, setAnswers] = useState<SelfAssessment>(EMPTY_SELF_ASSESSMENT);
  const recommendation = recommendRoute(answers);
  const recommended: EntryRoute | null = recommendation ? routeById(recommendation.routeId) : null;

  return (
    <section className="pls-learn-routes" aria-label="Where to start">
      <div className="pls-learn-routes__cards">
        {ENTRY_ROUTES.map((route: EntryRoute) => {
          const path = getPath(route.pathId);
          return (
            <button
              key={route.id}
              type="button"
              className={clsx("pls-learn-route", activePathId === route.pathId && "pls-learn-route--active", recommended && recommended.id === route.id && "pls-learn-route--recommended")}
              onClick={() => onOpenPath(route.pathId)}
              aria-current={activePathId === route.pathId ? "page" : undefined}
            >
              <span className="pls-learn-route__title">{route.title}</span>
              <span className="pls-learn-route__blurb">{route.blurb}</span>
              <span className="pls-learn-route__meta">
                {path ? path.title : route.pathId} · {DEMAND_LABELS[route.demand]}
                {recommended && recommended.id === route.id ? " · suggested" : ""}
              </span>
            </button>
          );
        })}
      </div>
      <div className="pls-learn-self">
        <button type="button" className="pls-btn pls-btn--small pls-btn--ghost" aria-expanded={open} onClick={() => setOpen((value: boolean) => !value)}>
          {open ? "Hide the questions" : "Not sure where to start? Answer three questions"}
        </button>
        {open ? (
          <div className="pls-learn-self__body">
            {SELF_QUESTIONS.map((item) => (
              <fieldset key={item.key} className="pls-learn-self__q">
                <legend>{item.question}</legend>
                <div className="pls-segmented" role="group">
                  {ANSWERS.map((answer) => (
                    <button
                      key={answer.value}
                      type="button"
                      className={clsx("pls-segmented__option", answers[item.key] === answer.value && "pls-segmented__option--active")}
                      aria-pressed={answers[item.key] === answer.value}
                      onClick={() => setAnswers((current: SelfAssessment) => ({ ...current, [item.key]: answer.value }))}
                    >
                      {answer.label}
                    </button>
                  ))}
                </div>
              </fieldset>
            ))}
            {recommendation && recommended ? (
              <div className="pls-learn-self__result" role="status">
                <p>
                  Suggested route: <strong>{recommended.title}</strong> ({getPath(recommendation.pathId)?.title ?? recommendation.pathId})
                </p>
                <ul className="pls-learn-list">
                  {recommendation.reasons.map((reason: string) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                <p className="pls-learn-muted">{RECOMMENDATION_CAVEAT}</p>
                <div className="pls-learn-actions">
                  <button type="button" className="pls-btn pls-btn--small pls-btn--primary" onClick={() => onOpenPath(recommendation.pathId)}>
                    Open this route
                  </button>
                  {ENTRY_ROUTES.filter((route: EntryRoute) => route.id !== recommended.id).map((route: EntryRoute) => (
                    <button key={route.id} type="button" className="pls-btn pls-btn--small" onClick={() => onOpenPath(route.pathId)}>
                      Choose instead: {route.title}
                    </button>
                  ))}
                  <button type="button" className="pls-btn pls-btn--small pls-btn--ghost" onClick={() => setAnswers(EMPTY_SELF_ASSESSMENT)}>
                    Start over
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Filters + results
// ---------------------------------------------------------------------------

function CatalogueColumn({ filters, onFilters, selection, onSelect }: { filters: LearnFilters; onFilters: (next: LearnFilters) => void; selection: Selection | null; onSelect: (result: SearchResult) => void }): JSX.Element {
  const searchId = useId();
  const demandId = useId();
  const strandId = useId();
  const inputId = useId();
  const view = useMemo(() => buildCatalogue(filters), [filters]);

  const isSelected = (result: SearchResult): boolean => {
    if (!selection) return false;
    if (result.kind === "warmup") return selection.kind === "exercise" && selection.id === result.id;
    return selection.kind === result.kind && selection.id === result.id;
  };

  return (
    <aside className="pls-learn__catalogue" aria-label="Catalogue">
      <div className="pls-learn-search">
        <label className="pls-sr-only" htmlFor={searchId}>
          Search concepts, exercises and songs
        </label>
        <Search size={16} aria-hidden="true" className="pls-learn-search__icon" />
        <input
          id={searchId}
          type="search"
          className="pls-input pls-learn-search__input"
          placeholder="Search: dorian, inversion, ii–V–I …"
          value={filters.query}
          onChange={(event) => onFilters({ ...filters, query: event.target.value })}
        />
      </div>
      <div className="pls-learn-filters">
        <div className="pls-field">
          <label className="pls-field__label" htmlFor={demandId}>
            Level
          </label>
          <select id={demandId} className="pls-select" value={filters.demand} onChange={(event) => onFilters({ ...filters, demand: event.target.value as Demand | "all" })}>
            <option value="all">All levels</option>
            {DEMANDS.map((demand: Demand) => (
              <option key={demand} value={demand}>
                {DEMAND_LABELS[demand]}
              </option>
            ))}
          </select>
        </div>
        <div className="pls-field">
          <label className="pls-field__label" htmlFor={strandId}>
            Topic
          </label>
          <select id={strandId} className="pls-select" value={filters.strand} onChange={(event) => onFilters({ ...filters, strand: event.target.value as Strand | "all" })}>
            <option value="all">All topics</option>
            {STRAND_ORDER.map((strand: Strand) => (
              <option key={strand} value={strand}>
                {STRAND_LABELS[strand]}
              </option>
            ))}
          </select>
        </div>
        <div className="pls-field">
          <label className="pls-field__label" htmlFor={inputId}>
            I can play with
          </label>
          <select id={inputId} className="pls-select" value={filters.input} onChange={(event) => onFilters({ ...filters, input: event.target.value as InputFilter })}>
            {INPUT_FILTERS.map((input: InputFilter) => (
              <option key={input} value={input}>
                {INPUT_FILTER_LABELS[input]}
              </option>
            ))}
          </select>
        </div>
        <label className="pls-check">
          <input type="checkbox" checked={filters.showDrafts} onChange={(event) => onFilters({ ...filters, showDrafts: event.target.checked })} />
          Show drafts (not yet reviewed by a pianist)
        </label>
      </div>
      <p className="pls-learn-muted" role="status">
        {view.total} result{view.total === 1 ? "" : "s"}
        {view.hiddenDrafts > 0 ? ` · ${view.hiddenDrafts} draft${view.hiddenDrafts === 1 ? "" : "s"} hidden` : ""}
      </p>
      <nav className="pls-learn-results" aria-label="Results">
        {view.groups.map((group) => (
          <div key={group.key} className="pls-learn-group">
            <p className="pls-learn-group__title">{group.label}</p>
            <ul className="pls-learn-group__list">
              {group.items.map((result: SearchResult) => (
                <li key={`${result.kind}-${result.id}`}>
                  <button
                    type="button"
                    className={clsx("pls-learn-result", isSelected(result) && "pls-learn-result--active")}
                    aria-current={isSelected(result) ? "page" : undefined}
                    onClick={() => onSelect(result)}
                  >
                    <span className="pls-learn-result__title">{result.title}</span>
                    <span className="pls-learn-result__meta">
                      <span className="pls-learn-result__kind">{KIND_LABELS[result.kind] ?? result.kind}</span>
                      {result.demand.length > 0 ? <span>{result.demand.map((demand: Demand) => DEMAND_LABELS[demand]).join(" / ")}</span> : null}
                      {result.status !== "reviewed" ? <span className="pls-learn-result__draft">{STATUS_LABELS[result.status]}</span> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {view.total === 0 ? <p className="pls-learn-muted">Nothing matches. Try another word or clear a filter.</p> : null}
      </nav>
      {view.comingLater.length > 0 ? (
        <details className="pls-learn-details pls-learn-later">
          <summary>Coming later ({view.comingLater.length})</summary>
          <p className="pls-learn-muted">Planned topics; they are not lessons yet.</p>
          <ul className="pls-learn-list">
            {view.comingLater.map((result: SearchResult) => (
              <li key={`${result.kind}-${result.id}`}>
                {result.title} <span className="pls-learn-muted">({KIND_LABELS[result.kind] ?? result.kind})</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Small detail pages
// ---------------------------------------------------------------------------

function RoutineDetail({ routineId, onOpenUnit }: { routineId: string; onOpenUnit: (unit: PathUnit) => void }): JSX.Element {
  const runtime = useStudioRuntime();
  const routine = getRoutine(routineId);
  if (!routine) return <p className="pls-learn-muted">This routine is not available.</p>;
  return (
    <article className="pls-learn-page" aria-labelledby="pls-learn-routine-title">
      <header className="pls-learn-page__head">
        <h2 id="pls-learn-routine-title" className="pls-learn-page__title">
          {routine.title}
        </h2>
        <div className="pls-learn-badges">
          <span className="pls-badge">Routine</span>
          {routine.meta.status !== "reviewed" ? <span className="pls-badge pls-learn-badge--draft">{STATUS_LABELS[routine.meta.status]}</span> : null}
        </div>
        {routine.description ? <p className="pls-learn-page__summary">{routine.description}</p> : null}
        <div className="pls-learn-actions">
          <button type="button" className="pls-btn pls-btn--primary" onClick={() => runtime.navigate.openEntry("myPractice")}>
            <ListChecks size={16} aria-hidden="true" /> Run it in My Practice
          </button>
        </div>
      </header>
      <ol className="pls-learn-units">
        {routine.items.map((item, index: number) => {
          const playable = getPlayable(item.refId);
          const concept = getConcept(item.refId);
          const title = playable ? playable.spec.title : concept ? concept.title : item.refId;
          const unitKind: UnitKind = item.kind === "concept" ? "concept" : item.kind === "chart" ? "chart" : "exercise";
          return (
            <li key={item.id} className="pls-learn-unit">
              <button type="button" className="pls-learn-unit__button" onClick={() => onOpenUnit({ kind: unitKind, id: item.refId })}>
                <span className="pls-learn-unit__index">{index + 1}</span>
                <span className="pls-learn-unit__title">{title}</span>
                <span className="pls-learn-muted">
                  {item.settings.tempoBpm ? `${item.settings.tempoBpm} BPM` : ""}
                  {item.settings.repeats ? ` · ×${item.settings.repeats}` : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </article>
  );
}

function Welcome(): JSX.Element {
  const [filter, setFilter] = useState<string>("");
  const terms = glossary.filter((entry: GlossaryEntry) => filter.trim() === "" || entry.term.toLowerCase().includes(filter.trim().toLowerCase()));
  const glossaryId = useId();
  return (
    <article className="pls-learn-page">
      <header className="pls-learn-page__head">
        <h2 className="pls-learn-page__title">
          <BookOpen size={20} aria-hidden="true" /> Learn
        </h2>
        <p className="pls-learn-page__summary">
          Pick a route above, or search the catalogue. Every concept page explains an idea, lets you hear it, sends it to Practice and links to a song where it is used. Opening pages never changes your
          saved project.
        </p>
      </header>
      <details className="pls-learn-details">
        <summary>Glossary ({glossary.length} terms)</summary>
        <div className="pls-field">
          <label className="pls-field__label" htmlFor={glossaryId}>
            Find a term
          </label>
          <input id={glossaryId} className="pls-input" value={filter} onChange={(event) => setFilter(event.target.value)} />
        </div>
        <dl className="pls-learn-glossary-list">
          {terms.map((entry: GlossaryEntry) => (
            <div key={entry.term} className="pls-learn-glossary-list__row">
              <dt>{entry.term}</dt>
              <dd>{entry.definition}</dd>
            </div>
          ))}
        </dl>
      </details>
    </article>
  );
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export function LearnView(): JSX.Element {
  const runtime = useStudioRuntime();
  const ui = useUiState();
  const [filters, setFilters] = useState<LearnFilters>(DEFAULT_LEARN_FILTERS);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [back, setBack] = useState<Selection[]>([]);
  const [evidence, setEvidence] = useState<ProgressEvidence[]>([]);
  const [evidenceVersion, setEvidenceVersion] = useState<number>(0);

  const selectionRef = useRef<Selection | null>(null);
  selectionRef.current = selection;

  const open = useCallback((next: Selection) => {
    const current = selectionRef.current;
    if (current && !sameSelection(current, next)) {
      setBack((stack: Selection[]) => [...stack.slice(-19), current]);
    }
    selectionRef.current = next;
    setSelection(next);
  }, []);

  // Requests from Practice review ("Review the idea") and from Songs.
  useEffect(() => {
    const fromPractice = consumeConceptRequest();
    const fromLearn = consumeLearnRequest();
    if (fromPractice && getConcept(fromPractice)) open({ kind: "concept", id: fromPractice });
    else if (fromLearn) open(selectionFromRequest(fromLearn));
    return subscribeLearnRequests((request: LearnRequest) => {
      consumeLearnRequest();
      open(selectionFromRequest(request));
    });
  }, [open]);

  // Progress evidence for markers (cheap: one localStorage read).
  useEffect(() => {
    try {
      const loaded = runtime.stores.progress.load();
      setEvidence(loaded.ok ? loaded.value.evidence : []);
    } catch {
      setEvidence([]);
    }
  }, [runtime, ui.storesReady, evidenceVersion]);

  const refreshEvidence = useCallback(() => setEvidenceVersion((value: number) => value + 1), []);

  const openConcept = useCallback((id: string) => open({ kind: "concept", id }), [open]);
  const openExercise = useCallback((id: string) => open({ kind: "exercise", id }), [open]);
  const openLab = useCallback((focus: "scale" | "melody") => open({ kind: "lab", id: focus }), [open]);

  const openUnit = useCallback(
    (unit: PathUnit) => {
      switch (unit.kind) {
        case "concept":
          open({ kind: "concept", id: unit.id });
          return;
        case "exercise":
          open({ kind: "exercise", id: unit.id });
          return;
        case "routine":
          open({ kind: "routine", id: unit.id });
          return;
        case "chart":
          openChartInSongs(runtime, unit.id);
          return;
      }
    },
    [open, runtime]
  );

  const onSelectResult = useCallback(
    (result: SearchResult) => {
      switch (result.kind) {
        case "concept":
          open({ kind: "concept", id: result.id });
          return;
        case "path":
          open({ kind: "path", id: result.id });
          return;
        case "exercise":
        case "warmup":
          open({ kind: "exercise", id: result.id });
          return;
        case "routine":
          open({ kind: "routine", id: result.id });
          return;
        case "chart":
          openChartInSongs(runtime, result.id);
          return;
        default:
          return;
      }
    },
    [open, runtime]
  );

  const goBack = (): void => {
    const previous = back[back.length - 1];
    setBack((stack: Selection[]) => stack.slice(0, -1));
    selectionRef.current = previous ?? null;
    setSelection(previous ?? null);
  };

  let main: JSX.Element;
  if (!selection) {
    main = <Welcome />;
  } else if (selection.kind === "concept") {
    const concept = getConcept(selection.id);
    main = concept ? (
      <ConceptPage key={concept.id} concept={concept} evidence={evidence} onOpenConcept={openConcept} onOpenExercise={openExercise} onOpenLab={openLab} onEvidenceRecorded={refreshEvidence} />
    ) : (
      <p className="pls-learn-muted">This concept is not available.</p>
    );
  } else if (selection.kind === "path") {
    const path = getPath(selection.id);
    main = path ? <PathOverview path={path} evidence={evidence} onOpenUnit={openUnit} /> : <p className="pls-learn-muted">This path is not available.</p>;
  } else if (selection.kind === "exercise") {
    main = (
      <article className="pls-learn-page">
        <ExerciseCard key={selection.id} exerciseId={selection.id} detailed marker={unitMarker(evidence, "exercise", selection.id)} onOpenConcept={openConcept} />
      </article>
    );
  } else if (selection.kind === "routine") {
    main = <RoutineDetail routineId={selection.id} onOpenUnit={openUnit} />;
  } else {
    main = <HarmonisationLab key={selection.id} focus={selection.id} onBack={goBack} onOpenConcept={openConcept} />;
  }

  return (
    <div className="pls-learn">
      <EntryRoutes onOpenPath={(pathId: string) => open({ kind: "path", id: pathId })} activePathId={selection && selection.kind === "path" ? selection.id : null} />
      <div className="pls-learn__body">
        <CatalogueColumn filters={filters} onFilters={setFilters} selection={selection} onSelect={onSelectResult} />
        <div className="pls-learn__main">
          {back.length > 0 ? (
            <button type="button" className="pls-btn pls-btn--small pls-btn--ghost pls-learn__back" onClick={goBack}>
              <ArrowLeft size={14} aria-hidden="true" /> Back
            </button>
          ) : null}
          {main}
        </div>
      </div>
    </div>
  );
}
