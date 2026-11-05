"use client";

import clsx from "clsx";
import { BookOpen, Check, Circle, ListChecks, Music, Play } from "lucide-react";
import type { LearningPath, ProgressEvidence } from "@/model/contracts";
import { getChart, getConcept, getPlayable, getRoutine } from "@/content";
import { DEMAND_LABELS, STATUS_LABELS, unitMarker } from "@/ui/learn/learnLogic";
import type { UnitKind } from "@/ui/learn/learnLogic";

export interface PathUnit {
  kind: UnitKind;
  id: string;
}

export interface PathOverviewProps {
  path: LearningPath;
  evidence: readonly ProgressEvidence[];
  onOpenUnit: (unit: PathUnit) => void;
}

const KIND_TEXT: Record<UnitKind, string> = {
  concept: "Read and listen",
  exercise: "Play",
  chart: "Song",
  routine: "Routine"
};

function unitTitle(unit: PathUnit): { title: string; status: string | null } {
  switch (unit.kind) {
    case "concept": {
      const concept = getConcept(unit.id);
      return { title: concept ? concept.title : unit.id, status: concept ? concept.meta.status : "unavailable" };
    }
    case "exercise": {
      const playable = getPlayable(unit.id);
      return { title: playable ? playable.spec.title : unit.id, status: playable ? playable.spec.status : "unavailable" };
    }
    case "chart": {
      const chart = getChart(unit.id);
      return { title: chart ? chart.title : unit.id, status: chart ? chart.meta.status : "unavailable" };
    }
    case "routine": {
      const routine = getRoutine(unit.id);
      return { title: routine ? routine.title : unit.id, status: routine ? routine.meta.status : "unavailable" };
    }
  }
}

function KindIcon({ kind }: { kind: UnitKind }): JSX.Element {
  switch (kind) {
    case "concept":
      return <BookOpen size={16} aria-hidden="true" />;
    case "exercise":
      return <Play size={16} aria-hidden="true" />;
    case "chart":
      return <Music size={16} aria-hidden="true" />;
    case "routine":
      return <ListChecks size={16} aria-hidden="true" />;
  }
}

/** Ordered units of a learning path with kind, status and evidence markers. */
export function PathOverview({ path, evidence, onOpenUnit }: PathOverviewProps): JSX.Element {
  const units: PathUnit[] = path.units.map((unit) => ({ kind: unit.kind, id: unit.id }));
  const firstOpen = units.find((unit: PathUnit) => !unitMarker(evidence, unit.kind, unit.id).done);
  const doneCount = units.filter((unit: PathUnit) => unitMarker(evidence, unit.kind, unit.id).done).length;

  return (
    <article className="pls-learn-page" aria-labelledby="pls-learn-path-title">
      <header className="pls-learn-page__head">
        <h2 id="pls-learn-path-title" className="pls-learn-page__title">
          {path.title}
        </h2>
        <div className="pls-learn-badges">
          <span className="pls-badge">Starts at {DEMAND_LABELS[path.entry].toLowerCase()}</span>
          {path.meta.status !== "reviewed" ? <span className="pls-badge pls-learn-badge--draft">{STATUS_LABELS[path.meta.status]}</span> : null}
          <span className="pls-badge">
            {doneCount} of {units.length} with progress
          </span>
        </div>
        <p className="pls-learn-page__summary">{path.description}</p>
        <div className="pls-learn-actions">
          {units.length > 0 ? (
            <button type="button" className="pls-btn pls-btn--primary" onClick={() => onOpenUnit(units[0])}>
              Start here
            </button>
          ) : null}
          {firstOpen && firstOpen !== units[0] ? (
            <button type="button" className="pls-btn" onClick={() => onOpenUnit(firstOpen)}>
              Continue: {unitTitle(firstOpen).title}
            </button>
          ) : null}
        </div>
      </header>
      <ol className="pls-learn-units">
        {units.map((unit: PathUnit, index: number) => {
          const info = unitTitle(unit);
          const marker = unitMarker(evidence, unit.kind, unit.id);
          return (
            <li key={`${unit.kind}-${unit.id}-${index}`} className={clsx("pls-learn-unit", marker.done && "pls-learn-unit--done")}>
              <button type="button" className="pls-learn-unit__button" onClick={() => onOpenUnit(unit)}>
                <span className="pls-learn-unit__index">{index + 1}</span>
                <span className="pls-learn-unit__kind" title={KIND_TEXT[unit.kind]}>
                  <KindIcon kind={unit.kind} />
                  <span className="pls-sr-only">{KIND_TEXT[unit.kind]}:</span>
                </span>
                <span className="pls-learn-unit__title">{info.title}</span>
                {info.status && info.status !== "reviewed" ? <span className="pls-badge pls-learn-badge--draft">{STATUS_LABELS[info.status as keyof typeof STATUS_LABELS] ?? info.status}</span> : null}
                <span className="pls-learn-unit__marker">
                  {marker.done ? <Check size={14} aria-hidden="true" /> : <Circle size={14} aria-hidden="true" />}
                  <span>{marker.label}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </article>
  );
}
