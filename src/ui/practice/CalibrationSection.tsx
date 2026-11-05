"use client";

import { useEffect, useState } from "react";
import { useStudioRuntime, useUiState } from "@/ui/runtime/useStudioRuntime";

export const LATENCY_MIN_MS = -200;
export const LATENCY_MAX_MS = 200;

function clampOffset(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(LATENCY_MIN_MS, Math.min(LATENCY_MAX_MS, Math.round(value)));
}

/** Latency calibration (plan E14): visible, resettable, and explicitly an estimate. */
export function CalibrationSection(): JSX.Element {
  const runtime = useStudioRuntime();
  const ui = useUiState();
  const [offset, setOffset] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    try {
      const prefs = runtime.stores.preferences.get();
      if (prefs.ok) {
        setOffset(clampOffset(prefs.value.latencyOffsetMs));
      }
    } catch {
      // Keep 0 when preferences cannot be read.
    }
  }, [runtime, ui.storesReady]);

  const save = (value: number): void => {
    const next = clampOffset(value);
    setOffset(next);
    const result = runtime.updatePreferences({ latencyOffsetMs: next });
    setMessage(result.ok ? (next === 0 ? "No adjustment applied." : `Saved: MIDI input is treated as ${Math.abs(next)} ms ${next > 0 ? "late" : "early"}.`) : result.message);
  };

  return (
    <section className="pls-panel" aria-label="Timing calibration">
      <h2 className="pls-panel__title">Calibration</h2>
      <p className="pls-panel__text">
        If timed results feel consistently late (or early) although you play with the click, adjust the input delay. This is an estimate:
        event arrival is not the same as key motion, and only MIDI input is adjusted.
      </p>
      <label className="pls-field">
        <span className="pls-field__label">
          Input delay: {offset > 0 ? "+" : ""}
          {offset} ms
        </span>
        <input
          type="range"
          className="pls-range"
          min={LATENCY_MIN_MS}
          max={LATENCY_MAX_MS}
          step={5}
          value={offset}
          onChange={(event) => setOffset(clampOffset(Number(event.target.value)))}
          onMouseUp={() => save(offset)}
          onTouchEnd={() => save(offset)}
          onKeyUp={() => save(offset)}
          aria-valuetext={`${offset} milliseconds`}
        />
      </label>
      <div className="pls-practice-controls__row">
        <button type="button" className="pls-btn pls-btn--small" onClick={() => save(offset)}>
          Save
        </button>
        <button type="button" className="pls-btn pls-btn--small pls-btn--ghost" onClick={() => save(0)} disabled={offset === 0}>
          Reset to 0
        </button>
      </div>
      {message ? (
        <p className="pls-panel__text" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
