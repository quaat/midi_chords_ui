"use client";

import { useState } from "react";
import clsx from "clsx";
import { Check, Pause, Pencil, Play, Plus, SkipForward } from "lucide-react";
import type { AssistanceLevel, RoutineItem, SpelledPitchClass } from "@/model/contracts";
import { getChart } from "@/content";
import { formatPitchClass } from "@/music/pitch";
import { useStudioRuntime } from "@/ui/runtime/useStudioRuntime";
import { ASSISTANCE_LEVELS } from "@/ui/practice/assistance";
import type { PracticeControllerState } from "@/ui/practice/practiceController";
import { useRoutineState } from "@/ui/practice/PracticeSession";
import {
  ROUTINE_KIND_LABELS,
  addChartSectionToRoutine,
  continueRoutine,
  isRoutineFinished,
  openRoutineItemAt,
  pauseRoutine,
  resetRoutineItem,
  resumeRoutine,
  routineItemTitle,
  skipRoutineItem,
  stopRoutine,
  updateRoutineItem
} from "@/ui/practice/RoutineRunner";

const KEY_CHOICES: SpelledPitchClass[] = [
  { letter: "C", accidental: 0 },
  { letter: "D", accidental: -1 },
  { letter: "D", accidental: 0 },
  { letter: "E", accidental: -1 },
  { letter: "E", accidental: 0 },
  { letter: "F", accidental: 0 },
  { letter: "F", accidental: 1 },
  { letter: "G", accidental: 0 },
  { letter: "A", accidental: -1 },
  { letter: "A", accidental: 0 },
  { letter: "B", accidental: -1 },
  { letter: "B", accidental: 0 }
];

function keyValue(pc: SpelledPitchClass | undefined): string {
  return pc ? `${pc.letter}${pc.accidental}` : "";
}

function settingsSummary(item: RoutineItem): string {
  const parts: string[] = [];
  if (item.settings.key) parts.push(formatPitchClass(item.settings.key, { unicode: true }));
  if (item.settings.tempoBpm) parts.push(`${item.settings.tempoBpm} BPM`);
  if (item.settings.assistance) parts.push(`${item.settings.assistance} hints`);
  if (item.settings.repeats) parts.push(`×${item.settings.repeats}`);
  return parts.join(" · ");
}

interface EditFormProps {
  item: RoutineItem;
  onDone: () => void;
}

function RoutineItemEditor({ item, onDone }: EditFormProps): JSX.Element {
  const runtime = useStudioRuntime();
  const [tempo, setTempo] = useState<string>(item.settings.tempoBpm ? String(item.settings.tempoBpm) : "");
  const [key, setKey] = useState<string>(keyValue(item.settings.key));
  const [assistance, setAssistance] = useState<string>(item.settings.assistance ?? "");
  return (
    <form
      className="pls-routine__edit"
      onSubmit={(event) => {
        event.preventDefault();
        const override: { tempoBpm?: number; key?: SpelledPitchClass; assistance?: AssistanceLevel } = {};
        const bpm = Number(tempo);
        if (tempo.trim() !== "" && Number.isFinite(bpm) && bpm >= 20 && bpm <= 300) override.tempoBpm = Math.round(bpm);
        const chosen = KEY_CHOICES.find((pc) => keyValue(pc) === key);
        if (chosen) override.key = chosen;
        if (assistance === "full" || assistance === "reduced" || assistance === "none") override.assistance = assistance;
        updateRoutineItem(runtime, item.id, override);
        onDone();
      }}
    >
      <label className="pls-field">
        <span className="pls-field__label">Tempo (BPM)</span>
        <input className="pls-input pls-input--tempo" type="number" min={20} max={300} value={tempo} onChange={(event) => setTempo(event.target.value)} />
      </label>
      {item.kind === "exercise" ? (
        <label className="pls-field">
          <span className="pls-field__label">Key</span>
          <select className="pls-select" value={key} onChange={(event) => setKey(event.target.value)}>
            <option value="">As written</option>
            {KEY_CHOICES.map((pc) => (
              <option key={keyValue(pc)} value={keyValue(pc)}>
                {formatPitchClass(pc, { unicode: true })}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="pls-field">
        <span className="pls-field__label">Hints</span>
        <select className="pls-select" value={assistance} onChange={(event) => setAssistance(event.target.value)}>
          <option value="">As written</option>
          {ASSISTANCE_LEVELS.map((level) => (
            <option key={level.value} value={level.value}>
              {level.label}
            </option>
          ))}
        </select>
      </label>
      <div className="pls-practice-controls__row">
        <button type="submit" className="pls-btn pls-btn--small pls-btn--primary">
          Save item
        </button>
        <button
          type="button"
          className="pls-btn pls-btn--small"
          onClick={() => {
            resetRoutineItem(runtime, item.id);
            onDone();
          }}
        >
          Reset to authored
        </button>
        <button type="button" className="pls-btn pls-btn--small pls-btn--ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
      <p className="pls-panel__text">Tempo changes are your choice and can be undone; a faster run is not proof of good technique.</p>
    </form>
  );
}

export interface RoutineStripProps {
  practice: PracticeControllerState;
}

/** The active routine: items with done/current markers, pause/skip/resume/edit, add a song section. */
export function RoutineStrip({ practice }: RoutineStripProps): JSX.Element | null {
  const runtime = useStudioRuntime();
  const { active } = useRoutineState();
  const [editing, setEditing] = useState<string | null>(null);
  const [sectionChoice, setSectionChoice] = useState<string>("");
  if (!active) {
    return null;
  }
  const finished = isRoutineFinished(active.items, active.cursor);
  const extras = practice.extras;
  const chart = extras && extras.chartId ? getChart(extras.chartId) : undefined;
  const sectionId = sectionChoice !== "" ? sectionChoice : extras && extras.sectionId ? extras.sectionId : chart && chart.sections.length > 0 ? chart.sections[0].id : "";

  return (
    <section className="pls-panel pls-routine" aria-label={`Routine: ${active.title}`}>
      <h2 className="pls-panel__title">{active.title}</h2>
      <ol className="pls-routine__items">
        {active.items.map((item, index) => {
          const done = active.cursor.completedItemIds.includes(item.id);
          const current = !finished && index === active.cursor.itemIndex;
          return (
            <li key={item.id} className={clsx("pls-routine__item", done && "pls-routine__item--done", current && "pls-routine__item--current")} aria-current={current ? "step" : undefined}>
              <span className="pls-routine__marker" aria-hidden="true">
                {done ? <Check size={14} /> : current ? "▶" : index + 1}
              </span>
              <span className="pls-routine__text">
                <span className="pls-routine__kind">{ROUTINE_KIND_LABELS[item.kind]}</span>
                <button type="button" className="pls-link-button pls-routine__name" onClick={() => openRoutineItemAt(runtime, index)}>
                  {routineItemTitle(item)}
                </button>
                <span className="pls-routine__settings">{settingsSummary(item)}</span>
                <span className="pls-sr-only">{done ? "(done)" : current ? "(current)" : "(to do)"}</span>
              </span>
              <button type="button" className="pls-btn pls-btn--icon pls-btn--small" aria-label={`Edit settings of ${routineItemTitle(item)}`} onClick={() => setEditing(editing === item.id ? null : item.id)}>
                <Pencil size={14} aria-hidden="true" />
              </button>
              {editing === item.id ? <RoutineItemEditor item={item} onDone={() => setEditing(null)} /> : null}
            </li>
          );
        })}
      </ol>
      {active.message ? (
        <p className="pls-panel__text" role="status">
          {active.message}
        </p>
      ) : null}
      <div className="pls-practice-controls__row">
        {finished ? null : active.paused ? (
          <button type="button" className="pls-btn pls-btn--small pls-btn--primary" onClick={() => resumeRoutine(runtime)}>
            <Play size={14} aria-hidden="true" />
            <span>Resume</span>
          </button>
        ) : (
          <>
            <button type="button" className="pls-btn pls-btn--small" onClick={() => continueRoutine(runtime)}>
              <Play size={14} aria-hidden="true" />
              <span>Open current item</span>
            </button>
            <button type="button" className="pls-btn pls-btn--small" onClick={() => pauseRoutine(runtime)}>
              <Pause size={14} aria-hidden="true" />
              <span>Pause</span>
            </button>
          </>
        )}
        {finished ? null : (
          <button type="button" className="pls-btn pls-btn--small pls-btn--ghost" onClick={() => skipRoutineItem(runtime)}>
            <SkipForward size={14} aria-hidden="true" />
            <span>Skip</span>
          </button>
        )}
        <button type="button" className="pls-btn pls-btn--small pls-btn--ghost" onClick={() => stopRoutine()}>
          Close routine
        </button>
      </div>
      {chart ? (
        <div className="pls-routine__add">
          {chart.sections.length > 1 ? (
            <label className="pls-field pls-field--inline">
              <span className="pls-field__label">Section</span>
              <select className="pls-select" value={sectionId} onChange={(event) => setSectionChoice(event.target.value)}>
                {chart.sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button type="button" className="pls-btn pls-btn--small" onClick={() => addChartSectionToRoutine(runtime, chart.id, sectionId, practice.tempoBpm)} disabled={sectionId === ""}>
            <Plus size={14} aria-hidden="true" />
            <span>Add current song section</span>
          </button>
        </div>
      ) : null}
    </section>
  );
}
