"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { ListChecks, Play } from "lucide-react";
import type { ExerciseSpec } from "@/content";
import { contentBundle, getConcept } from "@/content";
import { isPublishedStatus } from "@/content/validate";
import { useSessionStore } from "@/state/useSessionStore";
import { useDevices, useMaterial, useStudioRuntime } from "@/ui/runtime/useStudioRuntime";
import { ASSISTANCE_LEVELS } from "@/ui/practice/assistance";
import { CalibrationSection } from "@/ui/practice/CalibrationSection";
import { openExerciseInPractice, openMaterialInPractice } from "@/ui/practice/openExercise";
import type { PracticeController, PracticeControllerState } from "@/ui/practice/practiceController";
import { PRACTICE_MODE_DESCRIPTIONS, PRACTICE_MODE_LABELS } from "@/ui/practice/practiceRequests";
import { usePracticeSession, useRoutineState } from "@/ui/practice/PracticeSession";
import { startRoutine } from "@/ui/practice/RoutineRunner";
import { RoutineStrip } from "@/ui/practice/RoutineStrip";

const STARTER_COUNT = 5;
const FOUNDATION_STRANDS = ["keyboardReadingRhythm", "harmonyVoicing", "scalesModes"];

/** A few starter exercises: published beginner items, foundations (keyboard/reading) first. */
export function starterExercises(specs: readonly ExerciseSpec[], limit: number = STARTER_COUNT): ExerciseSpec[] {
  const rank = (spec: ExerciseSpec): number => {
    const concept = spec.conceptIds.length > 0 ? getConcept(spec.conceptIds[0]) : undefined;
    const strand = concept ? FOUNDATION_STRANDS.indexOf(concept.strand) : -1;
    return strand < 0 ? FOUNDATION_STRANDS.length : strand;
  };
  return specs
    .map((spec, index) => ({ spec, index }))
    .filter((entry) => entry.spec.demand === "beginner" && isPublishedStatus(entry.spec.status) && entry.spec.policy.kind !== "listen")
    .sort((a, b) => rank(a.spec) - rank(b.spec) || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.spec);
}

function Chooser(): JSX.Element {
  const runtime = useStudioRuntime();
  const material = useMaterial();
  const [message, setMessage] = useState<string | null>(null);
  const starters = useMemo(() => starterExercises(contentBundle.exerciseSpecs), []);
  const starterRoutine = contentBundle.routines.length > 0 ? contentBundle.routines[0] : null;
  return (
    <section className="pls-panel" aria-label="Choose something to practise">
      <h2 className="pls-panel__title">Start practising</h2>
      <ul className="pls-starters">
        {starters.map((spec) => (
          <li key={spec.id} className="pls-starters__item">
            <span className="pls-starters__text">
              <span className="pls-starters__title">{spec.title}</span>
              <span className="pls-starters__objective">{spec.objective}</span>
            </span>
            <button
              type="button"
              className="pls-btn pls-btn--small"
              onClick={() => {
                const opened = openExerciseInPractice(runtime, spec.id);
                setMessage(opened.ok ? null : opened.message);
              }}
              aria-label={`Start ${spec.title}`}
            >
              <Play size={14} aria-hidden="true" />
              <span>Start</span>
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="pls-btn"
        disabled={!material.timeline}
        onClick={() => {
          if (!material.timeline) {
            return;
          }
          const opened = openMaterialInPractice(runtime, material.timeline, material.title, material.sequence);
          setMessage(opened.ok ? null : opened.message);
        }}
      >
        <Play size={16} aria-hidden="true" />
        <span>Practise the current progression</span>
      </button>
      {starterRoutine ? (
        <button
          type="button"
          className="pls-btn pls-btn--ghost"
          onClick={() => {
            const opened = startRoutine(runtime, starterRoutine.id);
            setMessage(opened.ok ? null : opened.message);
          }}
        >
          <ListChecks size={16} aria-hidden="true" />
          <span>{starterRoutine.title}</span>
        </button>
      ) : null}
      {message ? (
        <p className="pls-error-text" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}

interface SettingsProps {
  controller: PracticeController;
  state: PracticeControllerState;
}

function ModeSection({ controller, state }: SettingsProps): JSX.Element {
  const running = state.status === "running" && state.mode !== "step";
  return (
    <section className="pls-panel" aria-label="Practice mode">
      <h2 className="pls-panel__title">Mode</h2>
      <div className="pls-segmented" role="radiogroup" aria-label="Practice mode">
        {(["listen", "step", "timed", "free"] as const).map((mode) => {
          const allowed = state.allowedModes.includes(mode);
          const checked = state.mode === mode;
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={!allowed || running}
              title={allowed ? PRACTICE_MODE_DESCRIPTIONS[mode] : "Not offered for this exercise's answer policy"}
              className={clsx("pls-segmented__option", checked && "pls-segmented__option--active")}
              onClick={() => controller.setMode(mode)}
            >
              {PRACTICE_MODE_LABELS[mode]}
            </button>
          );
        })}
      </div>
      <p className="pls-panel__text">{PRACTICE_MODE_DESCRIPTIONS[state.mode]}</p>
      <label className="pls-field">
        <span className="pls-field__label">Visual hints</span>
        <select className="pls-select" value={state.assistance} disabled={running} onChange={(event) => controller.setAssistance(event.target.value as PracticeControllerState["assistance"])}>
          {ASSISTANCE_LEVELS.map((level) => (
            <option key={level.value} value={level.value}>
              {level.label} — {level.description}
            </option>
          ))}
        </select>
      </label>
      {state.mode === "step" ? (
        <label className="pls-check">
          <input type="checkbox" checked={state.autoAdvance} onChange={(event) => controller.setAutoAdvance(event.target.checked)} />
          <span>Move on automatically after a correct answer</span>
        </label>
      ) : null}
    </section>
  );
}

/** Number input that commits on blur/Enter, so typing "6" on the way to "60" is not applied. */
function TempoInput({ value, disabled, onCommit }: { value: number; disabled: boolean; onCommit: (bpm: number) => void }): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (): void => {
    if (draft === null) {
      return;
    }
    const bpm = Number(draft);
    setDraft(null);
    if (draft.trim() !== "" && Number.isFinite(bpm) && bpm > 0) {
      onCommit(bpm);
    }
  };
  return (
    <input
      className="pls-input pls-input--tempo"
      type="number"
      min={20}
      max={300}
      value={draft ?? String(value)}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          commit();
        }
      }}
    />
  );
}

function TempoSection({ controller, state }: SettingsProps): JSX.Element {
  const running = state.status === "running" && state.mode !== "step";
  const authored = state.exercise ? Math.round(state.exercise.timeline.tempo.bpm) : null;
  return (
    <section className="pls-panel" aria-label="Tempo and loop">
      <h2 className="pls-panel__title">Tempo and loop</h2>
      <div className="pls-practice-controls__row">
        <label className="pls-field">
          <span className="pls-field__label">Tempo (BPM)</span>
          <TempoInput value={state.tempoBpm} disabled={running} onCommit={(bpm) => controller.setTempo(bpm)} />
        </label>
        <label className="pls-field">
          <span className="pls-field__label">Count-in</span>
          <select className="pls-select" value={state.countInBeats} disabled={running} onChange={(event) => controller.setCountIn(Number(event.target.value))}>
            {[0, 2, 3, 4, 8].map((beats) => (
              <option key={beats} value={beats}>
                {beats === 0 ? "None" : `${beats} beats`}
              </option>
            ))}
          </select>
        </label>
      </div>
      {authored !== null && authored !== state.tempoBpm ? (
        <button type="button" className="pls-link-button" onClick={() => controller.setTempo(authored)} disabled={running}>
          Back to the written tempo ({authored} BPM)
        </button>
      ) : null}
      <label className="pls-check">
        <input type="checkbox" checked={state.metronome} disabled={running} onChange={(event) => controller.setMetronome(event.target.checked)} />
        <span>Metronome click</span>
      </label>
      <fieldset className="pls-practice-fieldset">
        <legend className="pls-field__label">Practise</legend>
        <label className="pls-check">
          <input type="radio" name="pls-loop" checked={!state.loopEnabled} disabled={running} onChange={() => controller.setLoopEnabled(false)} />
          <span>The whole exercise</span>
        </label>
        <label className="pls-check">
          <input type="radio" name="pls-loop" checked={state.loopEnabled} disabled={running || !state.loopRegion} onChange={() => controller.setLoopEnabled(true)} />
          <span>{state.loopRegion ? `Only: ${state.loopRegion.label ?? "the selected bars"}` : "A selected change (choose “Loop the change” in a review)"}</span>
        </label>
      </fieldset>
    </section>
  );
}

function InputStatus(): JSX.Element {
  const devices = useDevices();
  const inputSource = useSessionStore((s) => s.inputSource);
  const sourceText: Record<string, string> = {
    midi: "MIDI keyboard",
    computerKeyboard: "Computer keyboard",
    touch: "On-screen piano (touch/mouse)",
    none: "Listening only — nothing can be scored"
  };
  return (
    <section className="pls-panel" aria-label="Input status">
      <h2 className="pls-panel__title">Input</h2>
      <p className="pls-panel__text">
        <strong>{sourceText[inputSource] ?? inputSource}</strong>
        {inputSource === "midi" ? ` · MIDI access: ${devices.permission}` : ""}
      </p>
      {inputSource === "midi" && devices.permission !== "granted" ? <p className="pls-panel__text">{devices.permissionMessage}</p> : null}
      <p className="pls-panel__text">{devices.lastInput ? `Last input: ${devices.lastInput}` : "No input received yet."}</p>
    </section>
  );
}

function NotesSection({ state }: { state: PracticeControllerState }): JSX.Element | null {
  const notes = state.extras && state.extras.notes ? state.extras.notes.filter((line) => line.trim() !== "") : [];
  const objective = state.exercise ? state.exercise.objective : "";
  if (notes.length === 0 && objective === "") {
    return null;
  }
  return (
    <section className="pls-panel" aria-label="About this exercise">
      <h2 className="pls-panel__title">About this exercise</h2>
      {objective ? <p className="pls-panel__text">{objective}</p> : null}
      {notes.map((line, index) => (
        <p key={`${index}-${line}`} className="pls-panel__text">
          {line}
        </p>
      ))}
    </section>
  );
}

/** Context panel: chooser without a request; settings, calibration, input and routine with one. */
export function PracticeContextPanel(): JSX.Element {
  const { controller, state } = usePracticeSession();
  const { active } = useRoutineState();
  if (!state.exercise) {
    return (
      <>
        {active ? <RoutineStrip practice={state} /> : null}
        <Chooser />
      </>
    );
  }
  return (
    <>
      {active ? <RoutineStrip practice={state} /> : null}
      <ModeSection controller={controller} state={state} />
      <TempoSection controller={controller} state={state} />
      <NotesSection state={state} />
      <CalibrationSection />
      <InputStatus />
    </>
  );
}
