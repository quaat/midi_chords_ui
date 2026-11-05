"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { Eye, ListPlus, Send, Volume2 } from "lucide-react";
import type { ChordDefinition, VoicingInstance } from "@/model/contracts";
import { prettyDegree } from "@/ui/piano/pianoLabels";
import { inversionView, noteNameOf, targetsFromVoicing } from "@/ui/explore/exploreLogic";
import { chordPracticePayload } from "@/ui/runtime/practicePayload";
import { useExploreState, useStudioRuntime } from "@/ui/runtime/useStudioRuntime";
import { realizeAllSafe, transitionSummarySafe } from "@/ui/runtime/voicingBridge";

export interface VoicingCompareProps {
  chord: ChordDefinition;
}

interface Option {
  recipeId: string;
  name: string;
  reviewed: boolean;
  voicing: VoicingInstance;
}

function voicingMidi(voicing: VoicingInstance): number[] {
  const midi = voicing.notes.map((note) => note.midi);
  if (voicing.accompanimentBass) {
    midi.push(voicing.accompanimentBass.midi);
  }
  return midi;
}

/** A/B listening across every voicing recipe that can realise the chord. */
export function VoicingCompare({ chord }: VoicingCompareProps): JSX.Element {
  const runtime = useStudioRuntime();
  const [explore, setExplore] = useExploreState();
  const [message, setMessage] = useState<string | null>(null);
  const outcome = useMemo(() => realizeAllSafe(chord), [chord]);
  const options = useMemo<Option[]>(() => {
    const list: Option[] = [];
    outcome.results.forEach((entry) => {
      if (entry.result.ok) {
        list.push({ recipeId: entry.recipeId, name: entry.recipe.name, reviewed: entry.recipe.reviewed, voicing: entry.result.voicing });
      }
    });
    return list;
  }, [outcome]);
  const unavailable = outcome.results.filter((entry) => !entry.result.ok);

  if (!outcome.available) {
    const close = inversionView(chord, 0);
    return (
      <section className="pls-voicings" aria-label="Voicings">
        <h3 className="pls-voicings__title">Voicings</h3>
        <p className="pls-voicings__todo">TODO: the voicing engine is unavailable ({outcome.error}). Close position only:</p>
        <p>{close.targets.map((t) => `${t.noteName} (${t.degreeLabel ?? ""})`).join("  ")}</p>
      </section>
    );
  }

  const optionA = options.find((o) => o.recipeId === explore.voicingA) ?? options[0];
  const optionB = options.find((o) => o.recipeId === explore.voicingB) ?? options[1] ?? options[0];
  const transition = optionA && optionB && optionA !== optionB ? transitionSummarySafe(optionA.voicing, optionB.voicing) : null;

  const hear = (option: Option): void => runtime.audition.playChord(voicingMidi(option.voicing), 3);
  const show = (option: Option): void => runtime.setExploreTargets(targetsFromVoicing(option.voicing), chord, `${chord.symbol} · ${option.name}`);
  const sendToPractice = (option: Option): void => {
    const bass = option.voicing.accompanimentBass;
    runtime.navigate.openInPractice(
      chordPracticePayload(chord, option.voicing.notes, {
        recipeId: option.recipeId,
        recipeName: option.name,
        accompaniment: bass ? [bass] : []
      })
    );
  };
  const addToCreate = (option: Option): void => {
    runtime.editor.dispatch({ type: "insertAfter", eventId: null, symbol: chord.symbol, voicingRecipeId: option.recipeId });
    setMessage(`Added ${chord.symbol} (${option.name}) to the end of your progression in Create.`);
  };

  return (
    <section className="pls-voicings" aria-label="Voicings">
      <div className="pls-voicings__head">
        <h3 className="pls-voicings__title">Voicings ({options.length})</h3>
        {optionA && optionB ? (
          <div className="pls-voicings__ab" role="group" aria-label="A/B listening">
            <button type="button" className="pls-btn pls-btn--small" onClick={() => hear(optionA)}>
              <Volume2 size={14} aria-hidden="true" /> Hear A
            </button>
            <button type="button" className="pls-btn pls-btn--small" onClick={() => hear(optionB)}>
              <Volume2 size={14} aria-hidden="true" /> Hear B
            </button>
            <span className="pls-voicings__abtext">
              A: {optionA.name} · B: {optionB.name}
            </span>
          </div>
        ) : null}
      </div>
      {transition ? <p className="pls-voicings__transition">A → B: {transition}</p> : null}
      {message ? (
        <p className="pls-voicings__message" role="status">
          {message}{" "}
          <button type="button" className="pls-btn pls-btn--small pls-btn--ghost" onClick={() => runtime.session.dispatch({ type: "setMode", mode: "create" })}>
            Open Create
          </button>
        </p>
      ) : null}
      <ul className="pls-voicings__list">
        {options.map((option) => {
          const isA = optionA === option;
          const isB = optionB === option;
          const notes = [...option.voicing.notes].sort((a, b) => a.midi - b.midi);
          return (
            <li key={option.recipeId} className={clsx("pls-voicing-card", (isA || isB) && "pls-voicing-card--picked")}>
              <div className="pls-voicing-card__head">
                <span className="pls-voicing-card__name">{option.name}</span>
                {isA ? <span className="pls-badge">A</span> : null}
                {isB ? <span className="pls-badge">B</span> : null}
                {!option.reviewed ? <span className="pls-voicing-card__unreviewed">unreviewed</span> : null}
              </div>
              <p className="pls-voicing-card__notes">
                {notes.map((note) => (
                  <span key={note.voiceId} className="pls-voicing-card__note">
                    {noteNameOf(note, true)} <small>{prettyDegree(note.degree)}</small>
                  </span>
                ))}
                {option.voicing.accompanimentBass ? (
                  <span className="pls-voicing-card__note pls-voicing-card__note--bass">
                    bass {noteNameOf(option.voicing.accompanimentBass, true)}
                  </span>
                ) : null}
              </p>
              {option.voicing.omitted.length > 0 ? (
                <p className="pls-voicing-card__omitted">
                  Leaves out: {option.voicing.omitted.map((tone) => `${prettyDegree(tone.degree)} (${tone.reason})`).join("; ")}
                </p>
              ) : null}
              {option.voicing.explanation.length > 0 ? (
                <ul className="pls-voicing-card__why">
                  {option.voicing.explanation.slice(0, 3).map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
              ) : null}
              <div className="pls-voicing-card__actions">
                <button type="button" className="pls-btn pls-btn--small" onClick={() => hear(option)}>
                  <Volume2 size={14} aria-hidden="true" /> Hear
                </button>
                <button type="button" className="pls-btn pls-btn--small" onClick={() => show(option)}>
                  <Eye size={14} aria-hidden="true" /> Show on piano
                </button>
                <button type="button" className={clsx("pls-btn pls-btn--small", isA && "pls-toggle--on")} aria-pressed={isA} onClick={() => setExplore({ voicingA: option.recipeId })}>
                  Set A
                </button>
                <button type="button" className={clsx("pls-btn pls-btn--small", isB && "pls-toggle--on")} aria-pressed={isB} onClick={() => setExplore({ voicingB: option.recipeId })}>
                  Set B
                </button>
                <button type="button" className="pls-btn pls-btn--small" onClick={() => sendToPractice(option)}>
                  <Send size={14} aria-hidden="true" /> Send to Practice
                </button>
                <button type="button" className="pls-btn pls-btn--small" onClick={() => addToCreate(option)}>
                  <ListPlus size={14} aria-hidden="true" /> Add to Create
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {unavailable.length > 0 ? (
        <details className="pls-voicings__unavailable">
          <summary>Not available for {chord.symbol} ({unavailable.length})</summary>
          <ul>
            {unavailable.map((entry) => (
              <li key={entry.recipeId}>
                <strong>{entry.recipe.name}</strong>: {entry.result.ok ? "" : entry.result.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
