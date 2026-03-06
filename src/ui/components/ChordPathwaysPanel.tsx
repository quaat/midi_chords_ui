"use client";

import { useMemo, useState } from "react";
import type { ChordPathwayMode, ParsedLineEvent } from "@/types";
import { injectChordPathways, pathwayEventsToText } from "@/theory/pathways";

interface ChordPathwaysPanelProps {
  sourceEvents: ParsedLineEvent[];
  hasParseErrors: boolean;
  defaultTurnaroundMeasures: number;
  onApplyExpandedText: (text: string) => void;
}

const MODE_OPTIONS: Array<{ value: ChordPathwayMode; label: string }> = [
  { value: "secondaryDominant", label: "Secondary dominant" },
  { value: "secondaryDominantFirstInversion", label: "Secondary dominant, third in bass" },
  { value: "secondaryDominantSecondInversion", label: "Secondary dominant, fifth in bass" },
  { value: "tritoneSubstitution", label: "Tritone substitution" },
  { value: "secondaryTwoFive", label: "Secondary ii-V" },
  { value: "secondaryTwoFiveTritoneSub", label: "Secondary ii-V with tritone substitution" }
];

export function ChordPathwaysPanel({
  sourceEvents,
  hasParseErrors,
  defaultTurnaroundMeasures,
  onApplyExpandedText
}: ChordPathwaysPanelProps): JSX.Element {
  const [mode, setMode] = useState<ChordPathwayMode>("secondaryDominant");
  const [turnaroundChord, setTurnaroundChord] = useState("");

  const expansion = useMemo(() => {
    if (hasParseErrors) {
      return { events: sourceEvents, warnings: [] };
    }

    return injectChordPathways(sourceEvents, {
      mode,
      turnaroundChord: turnaroundChord.trim() || undefined,
      turnaroundDurationMeasures: defaultTurnaroundMeasures
    });
  }, [defaultTurnaroundMeasures, hasParseErrors, mode, sourceEvents, turnaroundChord]);

  const previewText = useMemo(() => {
    if (hasParseErrors) {
      return "";
    }
    return pathwayEventsToText(expansion);
  }, [expansion, hasParseErrors]);

  const canApply = !hasParseErrors && previewText.length > 0;

  return (
    <section className="panel pathways-panel" aria-label="Chord Pathways">
      <header className="panel-header">
        <h2>Chord Pathways</h2>
        <span className="panel-subtitle">Inject deterministic harmonic approach chords between adjacent entered chords.</span>
      </header>

      <div className="pathways-controls">
        <label className="field">
          <span>Pathway Mode</span>
          <select value={mode} onChange={(event) => setMode(event.target.value as ChordPathwayMode)}>
            {MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Turnaround Chord (optional)</span>
          <input
            type="text"
            value={turnaroundChord}
            onChange={(event) => setTurnaroundChord(event.target.value)}
            placeholder="G13sus4"
          />
        </label>
      </div>

      {hasParseErrors ? (
        <div className="pathways-status error">Fix parse errors to enable Chord Pathways replacement.</div>
      ) : (
        <>
          <div className="pathways-status">Previewed events: {expansion.events.length}</div>
          {expansion.warnings.length > 0 ? (
            <ul className="pathways-warning-list">
              {expansion.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
          <label className="field">
            <span>Expanded Preview</span>
            <textarea className="pathways-preview" readOnly value={previewText} aria-label="Expanded progression preview" />
          </label>
        </>
      )}

      <div className="pathways-actions">
        <button className="action-btn" disabled={!canApply} onClick={() => onApplyExpandedText(previewText)}>
          Replace Editor With Expanded Progression
        </button>
      </div>
    </section>
  );
}
