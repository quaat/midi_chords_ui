"use client";

import { useEffect, useId, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import clsx from "clsx";
import { Clock, Headphones, Pause, Play, Repeat, Square, Timer } from "lucide-react";
import type { TransportState } from "@/model/contracts";
import { LiveText } from "@/ui/workspace/LiveText";

export interface TransportControlsProps {
  state: TransportState;
  onPlayPause: () => void;
  onStop: () => void;
  tempoBpm: number;
  onTempoChange: (bpm: number) => void;
  minTempo?: number;
  maxTempo?: number;
  countIn: boolean;
  onCountInChange: (enabled: boolean) => void;
  loop: boolean;
  onLoopChange: (enabled: boolean) => void;
  metronome: boolean;
  onMetronomeChange: (enabled: boolean) => void;
  /** "Play it for me" demonstration; hidden when not provided. */
  onPlayForMe?: () => void;
  playForMeActive?: boolean;
  /** Polled per animation frame (e.g. () => formatBarBeat(transport.getSnapshot().positionBeats)). */
  getPositionLabel?: () => string;
  positionLabel?: string;
  disabled?: boolean;
  className?: string;
}

function clampTempo(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

interface ToggleProps {
  pressed: boolean;
  onChange: (value: boolean) => void;
  label: string;
  icon: JSX.Element;
  disabled?: boolean;
}

function Toggle({ pressed, onChange, label, icon, disabled }: ToggleProps): JSX.Element {
  return (
    <button
      type="button"
      className={clsx("pls-btn", "pls-toggle", pressed && "pls-toggle--on")}
      aria-pressed={pressed}
      onClick={() => onChange(!pressed)}
      disabled={disabled}
    >
      {icon}
      <span>{label}</span>
      <span className="pls-toggle__state" aria-hidden="true">
        {pressed ? "On" : "Off"}
      </span>
    </button>
  );
}

export function TransportControls({
  state,
  onPlayPause,
  onStop,
  tempoBpm,
  onTempoChange,
  minTempo = 20,
  maxTempo = 300,
  countIn,
  onCountInChange,
  loop,
  onLoopChange,
  metronome,
  onMetronomeChange,
  onPlayForMe,
  playForMeActive = false,
  getPositionLabel,
  positionLabel = "",
  disabled = false,
  className
}: TransportControlsProps): JSX.Element {
  const tempoId = useId();
  const [draft, setDraft] = useState<string>(String(tempoBpm));
  useEffect(() => {
    setDraft(String(tempoBpm));
  }, [tempoBpm]);

  const running = state === "playing" || state === "countingIn";

  const commitTempo = (): void => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || draft.trim() === "") {
      setDraft(String(tempoBpm));
      return;
    }
    const next = clampTempo(parsed, minTempo, maxTempo);
    setDraft(String(next));
    if (next !== tempoBpm) {
      onTempoChange(next);
    }
  };

  const handleTempoKey = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitTempo();
    } else if (event.key === "Escape") {
      setDraft(String(tempoBpm));
    }
  };

  return (
    <div className={clsx("pls-transport", className)} role="toolbar" aria-label="Transport">
      <div className="pls-transport__primary">
        <button
          type="button"
          className={clsx("pls-btn", "pls-btn--primary", "pls-transport__play")}
          onClick={onPlayPause}
          disabled={disabled}
        >
          {running ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
          <span>{running ? "Pause" : state === "paused" ? "Resume" : "Play"}</span>
        </button>
        <button type="button" className="pls-btn" onClick={onStop} disabled={disabled || state === "stopped"}>
          <Square size={16} aria-hidden="true" />
          <span>Stop</span>
        </button>
        {onPlayForMe ? (
          <button
            type="button"
            className={clsx("pls-btn", "pls-toggle", playForMeActive && "pls-toggle--on")}
            onClick={onPlayForMe}
            aria-pressed={playForMeActive}
            disabled={disabled}
          >
            <Headphones size={16} aria-hidden="true" />
            <span>Play it for me</span>
          </button>
        ) : null}
        <span className="pls-transport__position" aria-label="Position">
          {state === "countingIn" ? <span className="pls-badge">Count-in</span> : null}
          <LiveText getText={getPositionLabel} fallback={positionLabel} />
        </span>
      </div>
      <div className="pls-transport__secondary">
        <div className="pls-field pls-field--inline">
          <label htmlFor={tempoId} className="pls-field__label">
            Tempo
          </label>
          <input
            id={tempoId}
            className="pls-input pls-input--tempo"
            type="number"
            inputMode="numeric"
            min={minTempo}
            max={maxTempo}
            step={1}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitTempo}
            onKeyDown={handleTempoKey}
            disabled={disabled}
          />
          <span className="pls-field__suffix">BPM</span>
        </div>
        <Toggle pressed={countIn} onChange={onCountInChange} label="Count-in" icon={<Timer size={16} aria-hidden="true" />} disabled={disabled} />
        <Toggle pressed={loop} onChange={onLoopChange} label="Loop" icon={<Repeat size={16} aria-hidden="true" />} disabled={disabled} />
        <Toggle pressed={metronome} onChange={onMetronomeChange} label="Metronome" icon={<Clock size={16} aria-hidden="true" />} disabled={disabled} />
      </div>
    </div>
  );
}
