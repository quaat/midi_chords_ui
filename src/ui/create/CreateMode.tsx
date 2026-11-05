"use client";

import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Redo2, Undo2, X } from "lucide-react";
import type { AccompanimentPatternId, ScaleId, SequenceEvent } from "@/model/contracts";
import type { ArpeggiateOctaves, ChordPathwayMode } from "@/types";
import { parsePitchClass, formatPitchClass } from "@/music/pitch";
import { LeadSheetView } from "@/ui/components/LeadSheetView";
import { ChordEditor } from "@/ui/components/ChordEditor";
import { TimelineView } from "@/ui/components/TimelineView";
import { BlockEditor } from "@/ui/create/BlockEditor";
import { EventList } from "@/ui/create/EventList";
import { ProjectMenu } from "@/ui/create/ProjectMenu";
import { canRedo, canUndo, deriveTextAndLost, previewPathways } from "@/ui/create/createState";
import { NotationView } from "@/ui/notation/NotationView";
import { notationEventsFromSequence, notationIndexOfEvent } from "@/ui/notation/notationAdapter";
import { DisplaySettings } from "@/ui/runtime/DisplaySettings";
import { OnboardingCard } from "@/ui/runtime/OnboardingCard";
import { useCurrentOccurrence, useEditor, useMaterial, usePlaybackOptions, useStudioRuntime, useTransportState } from "@/ui/runtime/useStudioRuntime";
import { listRecipes, recipeName } from "@/ui/runtime/voicingBridge";

type CreateView = "blocks" | "list" | "text" | "timeline" | "leadSheet" | "notation";

const VIEWS: { value: CreateView; label: string }[] = [
  { value: "blocks", label: "Blocks" },
  { value: "list", label: "List" },
  { value: "text", label: "Text" },
  { value: "timeline", label: "Timeline" },
  { value: "leadSheet", label: "Lead sheet" },
  { value: "notation", label: "Notation" }
];

const PATHWAY_MODES: { value: ChordPathwayMode; label: string }[] = [
  { value: "secondaryDominant", label: "Secondary dominant" },
  { value: "secondaryDominantFirstInversion", label: "Secondary dominant, third in bass" },
  { value: "secondaryDominantSecondInversion", label: "Secondary dominant, fifth in bass" },
  { value: "tritoneSubstitution", label: "Tritone substitution" },
  { value: "secondaryTwoFive", label: "Secondary ii–V" },
  { value: "secondaryTwoFiveTritoneSub", label: "Secondary ii–V with tritone substitution" }
];

const ACCOMPANIMENT_OPTIONS: { value: AccompanimentPatternId; label: string }[] = [
  { value: "none", label: "None" },
  { value: "sustained", label: "Sustained bass" },
  { value: "rootOnly", label: "Root on each beat" },
  { value: "bassAndChord", label: "Bass and chord" }
];

const TIME_SIGNATURES = ["4/4", "3/4", "2/4", "6/8", "5/4", "7/8", "12/8"];
const KEY_TONICS = ["C", "G", "D", "A", "E", "B", "F#", "F", "Bb", "Eb", "Ab", "Db", "Gb"];
const KEY_MODES: { value: ScaleId; label: string }[] = [
  { value: "major", label: "major" },
  { value: "naturalMinor", label: "minor" },
  { value: "dorian", label: "dorian" },
  { value: "mixolydian", label: "mixolydian" }
];

/** Create stage: editable progression plus legacy timeline/lead-sheet/notation sub-views. */
export function CreateStage(): JSX.Element {
  const runtime = useStudioRuntime();
  const [editor, dispatch] = useEditor();
  const position = useCurrentOccurrence();
  const material = useMaterial();
  const [view, setView] = useState<CreateView>("blocks");
  const sequence = editor.present.sequence;
  const currentEventId = material.sourceKind === "project" && position.current ? position.current.eventId : null;
  const textAndLost = useMemo(() => deriveTextAndLost(editor), [editor]);
  const legacyEvents = useMemo(() => notationEventsFromSequence(sequence, null), [sequence]);

  // Create always edits and plays the editor document.
  useEffect(() => {
    runtime.ensureEditorMaterial();
  }, [runtime]);

  const select = (event: SequenceEvent): void => {
    dispatch({ type: "select", eventId: event.id });
    if (material.sourceKind === "project") {
      runtime.transport.seek(event.startBeat);
    }
  };
  const selectById = (eventId: string): void => {
    const event = sequence.events.find((candidate) => candidate.id === eventId);
    if (event) {
      select(event);
    }
  };
  const ordered = useMemo(() => [...sequence.events].sort((a, b) => a.startBeat - b.startBeat || a.index - b.index), [sequence]);
  const secondsPerBeat = 60 / sequence.tempo.bpm;

  let body: JSX.Element;
  if (view === "list") {
    body = <EventList sequence={sequence} selectedEventId={editor.selectedEventId} currentEventId={currentEventId} onSelect={selectById} />;
  } else if (view === "text") {
    body = (
      <div className="pls-create__text">
        <ChordEditor
          value={editor.present.text}
          onChange={(text) => dispatch({ type: "setText", text })}
          errors={editor.present.parseErrors}
          onCursorLineChange={(line) => {
            const event = sequence.events.find((candidate) => candidate.sourceLine === line);
            if (event) {
              dispatch({ type: "select", eventId: event.id });
            }
          }}
        />
        {textAndLost.lost.length > 0 ? (
          <div className="pls-create__lost" role="note">
            <p className="pls-create__lost-title">Text cannot represent:</p>
            <ul>
              {textAndLost.lost.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="pls-inspector__note">These are kept in the project (save or export JSON); editing the text replaces them where chords change.</p>
          </div>
        ) : null}
      </div>
    );
  } else if (view === "timeline") {
    body = (
      <TimelineView
        events={legacyEvents}
        activeEventIndex={notationIndexOfEvent(sequence, currentEventId)}
        selectedEventIndex={notationIndexOfEvent(sequence, editor.selectedEventId)}
        onSelectEvent={(index) => {
          const event = ordered[index];
          if (event) {
            select(event);
          }
        }}
        progressSeconds={position.current && currentEventId ? position.current.startBeat * secondsPerBeat : 0}
        totalSeconds={sequence.totalBeats * secondsPerBeat}
      />
    );
  } else if (view === "leadSheet") {
    body = <LeadSheetView events={legacyEvents} />;
  } else if (view === "notation") {
    body = <NotationView sequence={sequence} activeEventId={currentEventId} />;
  } else {
    body = <BlockEditor sequence={sequence} selectedEventId={editor.selectedEventId} currentEventId={currentEventId} dispatch={dispatch} onSelect={select} />;
  }

  const undoLabel = editor.past.length > 0 ? editor.present.label : "";
  const redoLabel = editor.future.length > 0 ? editor.future[0].label : "";

  return (
    <div className="pls-create">
      <div className="pls-create__bar">
        <div className="pls-segmented" role="tablist" aria-label="Progression views">
          {VIEWS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={view === option.value}
              className={clsx("pls-segmented__option", view === option.value && "pls-segmented__option--active")}
              onClick={() => {
                if (view === "text") {
                  dispatch({ type: "commitText" });
                }
                setView(option.value);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="pls-create__history">
          <button type="button" className="pls-btn pls-btn--small" disabled={!canUndo(editor)} onClick={() => dispatch({ type: "undo" })} title={undoLabel ? `Undo: ${undoLabel}` : "Undo"}>
            <Undo2 size={14} aria-hidden="true" /> Undo
          </button>
          <button type="button" className="pls-btn pls-btn--small" disabled={!canRedo(editor)} onClick={() => dispatch({ type: "redo" })} title={redoLabel ? `Redo: ${redoLabel}` : "Redo"}>
            <Redo2 size={14} aria-hidden="true" /> Redo
          </button>
        </div>
      </div>
      {editor.notice ? (
        <p className="pls-create__notice" role="status">
          {editor.notice}
          <button type="button" className="pls-btn pls-btn--ghost pls-btn--icon" aria-label="Dismiss" onClick={() => dispatch({ type: "clearNotice" })}>
            <X size={14} aria-hidden="true" />
          </button>
        </p>
      ) : null}
      {material.sourceKind !== "project" ? (
        <p className="pls-create__notice">
          The transport is playing “{material.title ?? "practice material"}”.{" "}
          <button type="button" className="pls-btn pls-btn--small" onClick={() => runtime.loadEditorSequence()}>
            Play this progression instead
          </button>
        </p>
      ) : null}
      <div className="pls-create__body">{body}</div>
      {material.warnings.length > 0 && material.sourceKind === "project" ? (
        <details className="pls-create__warnings">
          <summary>{material.warnings.length} playback note(s)</summary>
          <ul>
            {material.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** Alias kept for the mode-slot naming in the plan. */
export const CreateMode = CreateStage;

function ProgressionSettings(): JSX.Element {
  const [editor, dispatch] = useEditor();
  const tempoId = useId();
  const tsId = useId();
  const keyId = useId();
  const modeId = useId();
  const measuresId = useId();
  const sequence = editor.present.sequence;
  const ts = `${sequence.timeSignature.numerator}/${sequence.timeSignature.denominator}`;
  const keyTonic = sequence.key ? formatPitchClass(sequence.key.tonic) : "";
  return (
    <section className="pls-panel" aria-label="Progression settings">
      <h2 className="pls-panel__title">Progression</h2>
      <div className="pls-create__grid">
        <div className="pls-field">
          <label className="pls-field__label" htmlFor={tempoId}>
            Tempo (BPM)
          </label>
          <input
            id={tempoId}
            key={sequence.tempo.bpm}
            type="number"
            min={20}
            max={300}
            className="pls-input pls-input--tempo"
            defaultValue={sequence.tempo.bpm}
            onBlur={(event) => dispatch({ type: "setTempo", bpm: Number(event.target.value) })}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                dispatch({ type: "setTempo", bpm: Number((event.target as HTMLInputElement).value) });
              }
            }}
          />
        </div>
        <div className="pls-field">
          <label className="pls-field__label" htmlFor={tsId}>
            Time signature
          </label>
          <select
            id={tsId}
            className="pls-select"
            value={ts}
            onChange={(event) => {
              const [numerator, denominator] = event.target.value.split("/").map(Number);
              dispatch({ type: "setTimeSignature", timeSignature: { numerator, denominator } });
            }}
          >
            {(TIME_SIGNATURES.includes(ts) ? TIME_SIGNATURES : [ts, ...TIME_SIGNATURES]).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div className="pls-field">
          <label className="pls-field__label" htmlFor={keyId}>
            Key
          </label>
          <select
            id={keyId}
            className="pls-select"
            value={keyTonic}
            onChange={(event) => {
              const tonic = parsePitchClass(event.target.value);
              dispatch({ type: "setKey", key: tonic ? { tonic, mode: sequence.key ? sequence.key.mode : "major" } : null });
            }}
          >
            <option value="">Not set</option>
            {(keyTonic === "" || KEY_TONICS.includes(keyTonic) ? KEY_TONICS : [keyTonic, ...KEY_TONICS]).map((tonic) => (
              <option key={tonic} value={tonic}>
                {tonic}
              </option>
            ))}
          </select>
        </div>
        {sequence.key ? (
          <div className="pls-field">
            <label className="pls-field__label" htmlFor={modeId}>
              Mode
            </label>
            <select
              id={modeId}
              className="pls-select"
              value={sequence.key.mode}
              onChange={(event) => {
                const key = sequence.key;
                if (key) {
                  dispatch({ type: "setKey", key: { tonic: key.tonic, mode: event.target.value as ScaleId } });
                }
              }}
            >
              {(KEY_MODES.some((m) => m.value === sequence.key?.mode) ? KEY_MODES : [{ value: sequence.key.mode, label: sequence.key.mode }, ...KEY_MODES]).map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="pls-field">
          <label className="pls-field__label" htmlFor={measuresId}>
            Default length (bars, text lines)
          </label>
          <select
            id={measuresId}
            className="pls-select"
            value={String(editor.defaultChordMeasures)}
            onChange={(event) => dispatch({ type: "setDefaultChordMeasures", measures: Number(event.target.value) })}
          >
            {[0.5, 1, 2, 4].map((value) => (
              <option key={value} value={String(value)}>
                {value}
              </option>
            ))}
          </select>
        </div>
      </div>
    </section>
  );
}

function PlaybackSettings(): JSX.Element {
  const runtime = useStudioRuntime();
  const [editor, dispatch] = useEditor();
  const playback = usePlaybackOptions();
  const status = useTransportState();
  const arpId = useId();
  const accId = useId();
  const recipeId = useId();
  const recipes = listRecipes();
  const sequence = editor.present.sequence;
  return (
    <section className="pls-panel" aria-label="Playback">
      <h2 className="pls-panel__title">Playback</h2>
      <div className="pls-create__grid">
        <div className="pls-field">
          <label className="pls-field__label" htmlFor={arpId}>
            Arpeggiate
          </label>
          <select
            id={arpId}
            className="pls-select"
            value={String(playback.arpeggiate)}
            onChange={(event) => runtime.setPlaybackOptions({ arpeggiate: Number(event.target.value) as ArpeggiateOctaves })}
          >
            <option value="0">Block chords</option>
            <option value="1">1 octave</option>
            <option value="2">2 octaves</option>
            <option value="3">3 octaves</option>
          </select>
        </div>
        <div className="pls-field">
          <label className="pls-field__label" htmlFor={accId}>
            Accompaniment
          </label>
          <select
            id={accId}
            className="pls-select"
            value={playback.accompaniment}
            onChange={(event) => runtime.setPlaybackOptions({ accompaniment: event.target.value as AccompanimentPatternId })}
          >
            {ACCOMPANIMENT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        {recipes.length > 0 ? (
          <div className="pls-field">
            <label className="pls-field__label" htmlFor={recipeId}>
              Voicing for all chords
            </label>
            <select
              id={recipeId}
              className="pls-select"
              value={sequence.defaultVoicingRecipeId ?? ""}
              onChange={(event) => dispatch({ type: "setVoicingRecipe", eventId: "all", recipeId: event.target.value === "" ? null : event.target.value })}
            >
              <option value="">Classic close voicing</option>
              {recipes.map((recipe) => (
                <option key={recipe.id} value={recipe.id}>
                  {recipe.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
      <label className="pls-check">
        <input type="checkbox" checked={status.metronomeEnabled} onChange={(event) => runtime.transport.setMetronome(event.target.checked)} />
        <span>Metronome</span>
      </label>
      {sequence.defaultVoicingRecipeId ? (
        <p className="pls-inspector__note">
          All chords use {recipeName(sequence.defaultVoicingRecipeId)}; chords it cannot voice fall back to close position (see playback notes).
        </p>
      ) : null}
    </section>
  );
}

function PathwaysPanel(): JSX.Element {
  const [editor, dispatch] = useEditor();
  const modeId = useId();
  const turnId = useId();
  const [mode, setMode] = useState<ChordPathwayMode>("secondaryDominant");
  const [turnaround, setTurnaround] = useState("");
  const preview = useMemo(() => previewPathways(editor.present.text, mode, turnaround, editor.defaultChordMeasures), [editor.present.text, mode, turnaround, editor.defaultChordMeasures]);
  return (
    <section className="pls-panel" aria-label="Chord pathways">
      <h2 className="pls-panel__title">Chord pathways</h2>
      <p className="pls-inspector__note">Insert approach chords before each chord. Undo restores your original text.</p>
      <div className="pls-field">
        <label className="pls-field__label" htmlFor={modeId}>
          Pathway
        </label>
        <select id={modeId} className="pls-select" value={mode} onChange={(event) => setMode(event.target.value as ChordPathwayMode)}>
          {PATHWAY_MODES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="pls-field">
        <label className="pls-field__label" htmlFor={turnId}>
          Turnaround chord (optional)
        </label>
        <input id={turnId} className="pls-input" value={turnaround} placeholder="e.g. G7" onChange={(event) => setTurnaround(event.target.value)} spellCheck={false} />
      </div>
      {preview.ok ? <pre className="pls-pathways__preview">{preview.text}</pre> : <p className="pls-inspector__note">{preview.reason}</p>}
      {preview.warnings.length > 0 ? (
        <ul className="pls-pathways__warnings">
          {preview.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      <button type="button" className="pls-btn pls-btn--small" disabled={!preview.ok || !preview.changed} onClick={() => dispatch({ type: "applyPathways", mode, turnaround })}>
        Apply to progression
      </button>
      {editor.pathwayWarnings.length > 0 && editor.lastOp === "applyPathways" ? <p className="pls-inspector__note">Applied with {editor.pathwayWarnings.length} warning(s).</p> : null}
    </section>
  );
}

/** Create context panel: project menu, progression/playback settings, pathways, classic link. */
export function CreateContextPanel(): JSX.Element {
  return (
    <>
      <OnboardingCard />
      <ProjectMenu />
      <ProgressionSettings />
      <PlaybackSettings />
      <PathwaysPanel />
      <DisplaySettings />
      <p className="pls-create__classic">
        <Link href="/legacy" className="pls-link">
          Classic studio
        </Link>{" "}
        — the previous chord-to-MIDI editor.
      </p>
    </>
  );
}
