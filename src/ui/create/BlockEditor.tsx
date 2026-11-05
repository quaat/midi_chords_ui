"use client";

import { useEffect, useId, useState } from "react";
import type { FormEvent } from "react";
import clsx from "clsx";
import { ArrowLeft, ArrowRight, Plus, Trash2 } from "lucide-react";
import type { MusicalSequence, SequenceEvent } from "@/model/contracts";
import { beatsPerBar } from "@/music/legacy";
import type { CreateAction } from "@/ui/create/createState";
import { tryChordFromSymbol } from "@/music/chords";
import { listRecipes, recipeName } from "@/ui/runtime/voicingBridge";

export interface BlockEditorProps {
  sequence: MusicalSequence;
  selectedEventId: string | null;
  currentEventId: string | null;
  dispatch: (action: CreateAction) => void;
  /** Select a block and move the playhead to it. */
  onSelect: (event: SequenceEvent) => void;
}

const DURATION_CHOICES = [0.5, 1, 2, 3, 4, 6, 8, 12, 16];

/** "1 bar", "2 bars", "3 beats", "1½ bars" ... */
export function formatDuration(beats: number, sequence: MusicalSequence): string {
  const bar = beatsPerBar(sequence.timeSignature);
  const bars = beats / bar;
  if (bar > 0 && Math.abs(bars - Math.round(bars)) < 1e-6 && bars >= 1) {
    return `${Math.round(bars)} bar${Math.round(bars) === 1 ? "" : "s"}`;
  }
  return `${beats} beat${beats === 1 ? "" : "s"}`;
}

function symbolError(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return "Enter a chord symbol or NC.";
  if (/^N\.?C\.?$/i.test(trimmed)) return null;
  const parsed = tryChordFromSymbol(trimmed);
  return parsed.ok ? null : parsed.error;
}

function SelectedBlock({ event, sequence, dispatch }: { event: SequenceEvent; sequence: MusicalSequence; dispatch: (action: CreateAction) => void }): JSX.Element {
  const symbolId = useId();
  const durationId = useId();
  const recipeId = useId();
  const [symbol, setSymbol] = useState(event.symbol);
  useEffect(() => setSymbol(event.symbol), [event.symbol, event.id]);
  const error = symbolError(symbol);
  const recipes = listRecipes();
  const durations = DURATION_CHOICES.includes(event.durationBeats) ? DURATION_CHOICES : [...DURATION_CHOICES, event.durationBeats].sort((a, b) => a - b);
  const index = sequence.events.findIndex((candidate) => candidate.id === event.id);

  const commitSymbol = (): void => {
    if (error === null && symbol.trim() !== event.symbol) {
      dispatch({ type: "setSymbol", eventId: event.id, symbol });
    }
  };

  return (
    <div className="pls-block-editor" role="group" aria-label={`Edit ${event.symbol}`}>
      <form
        className="pls-field"
        onSubmit={(formEvent: FormEvent<HTMLFormElement>) => {
          formEvent.preventDefault();
          commitSymbol();
        }}
      >
        <label className="pls-field__label" htmlFor={symbolId}>
          Chord
        </label>
        <input
          id={symbolId}
          className={clsx("pls-input", error !== null && "pls-input--invalid")}
          value={symbol}
          onChange={(changeEvent) => setSymbol(changeEvent.target.value)}
          onBlur={commitSymbol}
          aria-invalid={error !== null}
          spellCheck={false}
          autoComplete="off"
        />
        {error !== null ? <span className="pls-error-text">{error}</span> : null}
      </form>
      <div className="pls-field">
        <label className="pls-field__label" htmlFor={durationId}>
          Length
        </label>
        <select
          id={durationId}
          className="pls-select"
          value={String(event.durationBeats)}
          onChange={(changeEvent) => dispatch({ type: "setDuration", eventId: event.id, beats: Number(changeEvent.target.value) })}
        >
          {durations.map((beats) => (
            <option key={beats} value={String(beats)}>
              {formatDuration(beats, sequence)}
            </option>
          ))}
        </select>
      </div>
      {event.kind === "chord" && recipes.length > 0 ? (
        <div className="pls-field">
          <label className="pls-field__label" htmlFor={recipeId}>
            Voicing
          </label>
          <select
            id={recipeId}
            className="pls-select"
            value={event.voicingRecipeId ?? ""}
            onChange={(changeEvent) => dispatch({ type: "setVoicingRecipe", eventId: event.id, recipeId: changeEvent.target.value === "" ? null : changeEvent.target.value })}
          >
            <option value="">{sequence.defaultVoicingRecipeId ? `Progression default (${recipeName(sequence.defaultVoicingRecipeId)})` : "Progression default (classic close)"}</option>
            {recipes.map((recipe) => (
              <option key={recipe.id} value={recipe.id}>
                {recipe.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="pls-block-editor__actions">
        <button type="button" className="pls-btn pls-btn--small" disabled={index <= 0} onClick={() => dispatch({ type: "move", eventId: event.id, delta: -1 })} aria-label="Move earlier">
          <ArrowLeft size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="pls-btn pls-btn--small"
          disabled={index >= sequence.events.length - 1}
          onClick={() => dispatch({ type: "move", eventId: event.id, delta: 1 })}
          aria-label="Move later"
        >
          <ArrowRight size={14} aria-hidden="true" />
        </button>
        <button type="button" className="pls-btn pls-btn--small" onClick={() => dispatch({ type: "insertAfter", eventId: event.id, symbol: event.symbol })}>
          <Plus size={14} aria-hidden="true" /> Duplicate after
        </button>
        <button type="button" className="pls-btn pls-btn--small pls-btn--danger" onClick={() => dispatch({ type: "remove", eventId: event.id })}>
          <Trash2 size={14} aria-hidden="true" /> Remove
        </button>
      </div>
    </div>
  );
}

/** Compact editable progression: one block per event; click to select and seek. */
export function BlockEditor({ sequence, selectedEventId, currentEventId, dispatch, onSelect }: BlockEditorProps): JSX.Element {
  const addId = useId();
  const [newSymbol, setNewSymbol] = useState("");
  const addError = newSymbol.trim() === "" ? null : symbolError(newSymbol);
  const selected = sequence.events.find((event) => event.id === selectedEventId) ?? null;
  const bar = beatsPerBar(sequence.timeSignature);
  return (
    <div className="pls-blocks">
      <ol className="pls-blocks__list" aria-label="Progression">
        {sequence.events.map((event) => (
          <li key={event.id} className="pls-blocks__item" style={{ flexGrow: Math.max(1, event.durationBeats / Math.max(1, bar)) }}>
            <button
              type="button"
              className={clsx(
                "pls-block",
                event.kind === "rest" && "pls-block--rest",
                event.id === selectedEventId && "pls-block--selected",
                event.id === currentEventId && "pls-block--current"
              )}
              aria-pressed={event.id === selectedEventId}
              aria-current={event.id === currentEventId ? "step" : undefined}
              onClick={() => onSelect(event)}
            >
              <span className="pls-block__symbol">{event.symbol}</span>
              <span className="pls-block__length">{formatDuration(event.durationBeats, sequence)}</span>
              {event.voicingRecipeId ? <span className="pls-block__recipe">{recipeName(event.voicingRecipeId)}</span> : null}
            </button>
          </li>
        ))}
        <li className="pls-blocks__item pls-blocks__item--add">
          <form
            className="pls-blocks__add"
            onSubmit={(formEvent: FormEvent<HTMLFormElement>) => {
              formEvent.preventDefault();
              if (newSymbol.trim() !== "" && addError === null) {
                dispatch({ type: "insertAfter", eventId: selectedEventId, symbol: newSymbol });
                setNewSymbol("");
              }
            }}
          >
            <label className="pls-sr-only" htmlFor={addId}>
              Add a chord
            </label>
            <input
              id={addId}
              className={clsx("pls-input", addError !== null && "pls-input--invalid")}
              placeholder="Add chord…"
              value={newSymbol}
              onChange={(changeEvent) => setNewSymbol(changeEvent.target.value)}
              aria-invalid={addError !== null}
              spellCheck={false}
              autoComplete="off"
            />
            <button type="submit" className="pls-btn pls-btn--small" disabled={newSymbol.trim() === "" || addError !== null}>
              <Plus size={14} aria-hidden="true" /> Add
            </button>
          </form>
          {addError !== null ? <span className="pls-error-text">{addError}</span> : null}
        </li>
      </ol>
      {sequence.events.length === 0 ? <p className="pls-inspector__note">The progression is empty. Add a chord or type in the Text tab.</p> : null}
      {selected ? <SelectedBlock key={selected.id} event={selected} sequence={sequence} dispatch={dispatch} /> : <p className="pls-inspector__note">Select a block to change its chord, length or voicing.</p>}
    </div>
  );
}
