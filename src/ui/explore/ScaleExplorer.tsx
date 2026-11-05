"use client";

import { useEffect, useId, useMemo } from "react";
import clsx from "clsx";
import { Eye, ListPlus, Send, Volume2 } from "lucide-react";
import type { ScaleId } from "@/model/contracts";
import { SCALE_IDS, getScale } from "@/music/scales";
import { chordTones } from "@/music/chords";
import type { ScaleRow } from "@/ui/explore/exploreLogic";
import { TONIC_CHOICES, diatonicTriadRows, scaleComparisonView, scaleDisplayName, scaleRunNotes } from "@/ui/explore/exploreLogic";
import { runPracticePayload } from "@/ui/runtime/practicePayload";
import { runAuditionNotes } from "@/ui/runtime/runtimeHelpers";
import { useExploreState, useStudioRuntime } from "@/ui/runtime/useStudioRuntime";

const COMPARABLE: readonly ScaleId[] = SCALE_IDS.filter((id) => id !== "chromatic");

function ScaleRowList({ rows, title }: { rows: ScaleRow[]; title: string }): JSX.Element {
  return (
    <div className="pls-scale__col">
      <p className="pls-scale__name">{title}</p>
      <ol className="pls-scale__rows">
        {rows.map((row) => (
          <li key={`${row.label}-${row.midi}`} className={clsx("pls-scale__row", row.differs && "pls-scale__row--differs")}>
            <span className="pls-scale__degree">{row.pretty}</span>
            <span>{row.noteName}</span>
            {row.differs ? <span className="pls-scale__flag">differs</span> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Tonic + two scales over the same tonic, their differing degrees, runs and diatonic triads. */
export function ScaleExplorer(): JSX.Element {
  const runtime = useStudioRuntime();
  const [explore, setExplore] = useExploreState();
  const tonicId = useId();
  const aId = useId();
  const bId = useId();
  const view = useMemo(() => scaleComparisonView(explore.tonic, explore.scaleA, explore.scaleB), [explore.tonic, explore.scaleA, explore.scaleB]);
  const triads = useMemo(() => diatonicTriadRows(explore.tonic, explore.scaleA), [explore.tonic, explore.scaleA]);

  const showDifferences = (): void => {
    runtime.setExploreTargets(view.targets, null, `${view.nameA} vs ${view.nameB}: differing degrees`);
  };

  useEffect(() => {
    if (view.ok) {
      runtime.setExploreTargets(view.targets, null, `${view.nameA} vs ${view.nameB}: differing degrees`);
    }
  }, [runtime, view]);

  const hearRun = (scaleId: ScaleId): void => {
    runtime.audition.playNotes(runAuditionNotes(scaleRunNotes(explore.tonic, scaleId).map((note) => note.midi), 0.5));
  };

  const showRun = (scaleId: ScaleId): void => {
    const notes = scaleRunNotes(explore.tonic, scaleId);
    runtime.setExploreTargets(
      notes.map((note) => ({ midi: note.midi, noteName: note.noteName.replace(/-?\d+$/, ""), degreeLabel: note.degree })),
      null,
      scaleDisplayName(explore.tonic, scaleId)
    );
  };

  const sendRun = (scaleId: ScaleId): void => {
    const notes = scaleRunNotes(explore.tonic, scaleId);
    runtime.navigate.openInPractice(
      runPracticePayload(`${explore.tonic}-${scaleId}`, notes.map((note) => ({ midi: note.midi, spelled: note.spelled, degree: note.degree, hand: "right" as const })), {
        title: `${scaleDisplayName(explore.tonic, scaleId)} run`
      })
    );
  };

  return (
    <div className="pls-scale">
      <div className="pls-scale__controls">
        <div className="pls-field">
          <label className="pls-field__label" htmlFor={tonicId}>
            Tonic
          </label>
          <select id={tonicId} className="pls-select" value={explore.tonic} onChange={(event) => setExplore({ tonic: event.target.value })}>
            {TONIC_CHOICES.map((tonic) => (
              <option key={tonic} value={tonic}>
                {tonic}
              </option>
            ))}
          </select>
        </div>
        <div className="pls-field">
          <label className="pls-field__label" htmlFor={aId}>
            Scale A
          </label>
          <select id={aId} className="pls-select" value={explore.scaleA} onChange={(event) => setExplore({ scaleA: event.target.value as ScaleId })}>
            {COMPARABLE.map((id) => (
              <option key={id} value={id}>
                {getScale(id).name}
              </option>
            ))}
          </select>
        </div>
        <div className="pls-field">
          <label className="pls-field__label" htmlFor={bId}>
            Scale B (same tonic)
          </label>
          <select id={bId} className="pls-select" value={explore.scaleB} onChange={(event) => setExplore({ scaleB: event.target.value as ScaleId })}>
            {COMPARABLE.map((id) => (
              <option key={id} value={id}>
                {getScale(id).name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {view.ok ? (
        <>
          <p className="pls-scale__summary">{view.summary}</p>
          <div className="pls-scale__compare">
            <ScaleRowList rows={view.rowsA} title={`A · ${view.nameA}`} />
            <ScaleRowList rows={view.rowsB} title={`B · ${view.nameB}`} />
          </div>
          <div className="pls-scale__actions">
            <button type="button" className="pls-btn pls-btn--small" onClick={() => hearRun(explore.scaleA)}>
              <Volume2 size={14} aria-hidden="true" /> Hear A
            </button>
            <button type="button" className="pls-btn pls-btn--small" onClick={() => hearRun(explore.scaleB)}>
              <Volume2 size={14} aria-hidden="true" /> Hear B
            </button>
            <button type="button" className="pls-btn pls-btn--small" onClick={showDifferences}>
              <Eye size={14} aria-hidden="true" /> Show differences
            </button>
            <button type="button" className="pls-btn pls-btn--small" onClick={() => showRun(explore.scaleA)}>
              <Eye size={14} aria-hidden="true" /> Show A
            </button>
            <button type="button" className="pls-btn pls-btn--small" onClick={() => showRun(explore.scaleB)}>
              <Eye size={14} aria-hidden="true" /> Show B
            </button>
            <button type="button" className="pls-btn pls-btn--small" onClick={() => sendRun(explore.scaleA)}>
              <Send size={14} aria-hidden="true" /> Send run A to Practice
            </button>
          </div>
        </>
      ) : (
        <p className="pls-error-text">{view.error}</p>
      )}

      <section className="pls-scale__triads" aria-label="Diatonic triads">
        <h3 className="pls-voicings__title">Diatonic triads in {scaleDisplayName(explore.tonic, explore.scaleA)}</h3>
        {triads.ok ? (
          <ul className="pls-triads">
            {triads.rows.map((row) => (
              <li key={row.degree} className="pls-triads__item">
                <span className="pls-triads__numeral">{row.numeral}</span>
                <button type="button" className="pls-btn pls-btn--small pls-btn--ghost" onClick={() => runtime.navigate.openInExplore(row.symbol)} title="Inspect this chord">
                  {row.symbol}
                </button>
                <button
                  type="button"
                  className="pls-btn pls-btn--small pls-btn--icon"
                  aria-label={`Hear ${row.symbol}`}
                  onClick={() => runtime.audition.playChord(chordTones(row.chord, 4).map((tone) => tone.midi), 2)}
                >
                  <Volume2 size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="pls-btn pls-btn--small pls-btn--icon"
                  aria-label={`Add ${row.symbol} to Create`}
                  title="Send to Create"
                  onClick={() => runtime.editor.dispatch({ type: "insertAfter", eventId: null, symbol: row.symbol })}
                >
                  <ListPlus size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pls-inspector__note">{triads.reason}</p>
        )}
      </section>
    </div>
  );
}
