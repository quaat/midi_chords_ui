"use client";

import { useId } from "react";
import clsx from "clsx";
import { Ban, Keyboard, Plug } from "lucide-react";
import type { InputSourceSelection } from "@/state/sessionStore";

export type MidiPermissionState = "unknown" | "prompt" | "granted" | "denied" | "unsupported";

export interface MidiPortInfo {
  id: string;
  name: string;
  manufacturer?: string;
  connected?: boolean;
}

export interface DevicePanelProps {
  inputSource: InputSourceSelection;
  onInputSourceChange: (source: InputSourceSelection) => void;
  midiPermission: MidiPermissionState;
  /** Called by the "Connect MIDI" button (must run from a user gesture). */
  onRequestMidiAccess?: () => void;
  midiInputs: MidiPortInfo[];
  selectedInputId: string | null;
  onSelectInput: (id: string | null) => void;
  midiOutputs?: MidiPortInfo[];
  selectedOutputId?: string | null;
  onSelectOutput?: (id: string | null) => void;
  /** Hear what you play through the app's sound. */
  monitoring: boolean;
  onMonitoringChange: (enabled: boolean) => void;
  /** All notes off on every output, clears held state. */
  onPanic: () => void;
  statusMessage?: string;
  /** e.g. "C4 · velocity 80" — low frequency, not per frame. */
  lastInput?: string;
  className?: string;
}

const SOURCES: { value: InputSourceSelection; label: string; hint: string }[] = [
  { value: "midi", label: "MIDI keyboard", hint: "Scored pitch and timing" },
  { value: "computerKeyboard", label: "Computer keyboard", hint: "Letter keys play notes" },
  { value: "touch", label: "On-screen piano", hint: "Mouse or touch" },
  { value: "none", label: "Listen only", hint: "No automatic scoring" }
];

const PERMISSION_TEXT: Record<MidiPermissionState, string> = {
  unknown: "MIDI status unknown",
  prompt: "MIDI not connected yet",
  granted: "MIDI access granted",
  denied: "MIDI access was blocked in this browser",
  unsupported: "This browser does not support Web MIDI"
};

export function DevicePanel({
  inputSource,
  onInputSourceChange,
  midiPermission,
  onRequestMidiAccess,
  midiInputs,
  selectedInputId,
  onSelectInput,
  midiOutputs,
  selectedOutputId,
  onSelectOutput,
  monitoring,
  onMonitoringChange,
  onPanic,
  statusMessage,
  lastInput,
  className
}: DevicePanelProps): JSX.Element {
  const groupName = useId();
  const inputId = useId();
  const outputId = useId();
  const monitorId = useId();
  const midiSelected = inputSource === "midi";

  return (
    <section className={clsx("pls-panel", "pls-devices", className)} aria-label="Input and devices">
      <h2 className="pls-panel__title">
        <Keyboard size={16} aria-hidden="true" /> Input
      </h2>
      <fieldset className="pls-devices__sources">
        <legend className="pls-sr-only">Input source</legend>
        {SOURCES.map((source) => (
          <label key={source.value} className={clsx("pls-radio", inputSource === source.value && "pls-radio--checked")}>
            <input
              type="radio"
              name={groupName}
              value={source.value}
              checked={inputSource === source.value}
              onChange={() => onInputSourceChange(source.value)}
            />
            <span className="pls-radio__label">{source.label}</span>
            <span className="pls-radio__hint">{source.hint}</span>
          </label>
        ))}
      </fieldset>

      {midiSelected ? (
        <div className="pls-devices__midi">
          <p className={clsx("pls-status", midiPermission === "granted" ? "pls-status--ok" : midiPermission === "denied" || midiPermission === "unsupported" ? "pls-status--error" : "pls-status--idle")}>
            <span className="pls-status__dot" aria-hidden="true" />
            {PERMISSION_TEXT[midiPermission]}
          </p>
          {midiPermission !== "granted" && midiPermission !== "unsupported" && onRequestMidiAccess ? (
            <button type="button" className="pls-btn" onClick={onRequestMidiAccess}>
              <Plug size={16} aria-hidden="true" /> Connect MIDI
            </button>
          ) : null}
          {midiPermission === "granted" ? (
            <>
              <div className="pls-field">
                <label htmlFor={inputId} className="pls-field__label">
                  MIDI input
                </label>
                <select
                  id={inputId}
                  className="pls-select"
                  value={selectedInputId ?? ""}
                  onChange={(event) => onSelectInput(event.target.value === "" ? null : event.target.value)}
                >
                  <option value="">{midiInputs.length === 0 ? "No inputs found" : "All inputs"}</option>
                  {midiInputs.map((port) => (
                    <option key={port.id} value={port.id}>
                      {port.name}
                      {port.connected === false ? " (disconnected)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              {midiOutputs && onSelectOutput ? (
                <div className="pls-field">
                  <label htmlFor={outputId} className="pls-field__label">
                    MIDI output
                  </label>
                  <select
                    id={outputId}
                    className="pls-select"
                    value={selectedOutputId ?? ""}
                    onChange={(event) => onSelectOutput(event.target.value === "" ? null : event.target.value)}
                  >
                    <option value="">Built-in sound</option>
                    {midiOutputs.map((port) => (
                      <option key={port.id} value={port.id}>
                        {port.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      <div className="pls-devices__row">
        <label htmlFor={monitorId} className="pls-check">
          <input id={monitorId} type="checkbox" checked={monitoring} onChange={(event) => onMonitoringChange(event.target.checked)} />
          <span>Hear what I play</span>
        </label>
        <button type="button" className="pls-btn pls-btn--danger" onClick={onPanic} title="Stop all sounding notes">
          <Ban size={16} aria-hidden="true" /> Panic
        </button>
      </div>
      {lastInput ? <p className="pls-devices__last">Last input: {lastInput}</p> : null}
      {statusMessage ? (
        <p className="pls-devices__message" role="status">
          {statusMessage}
        </p>
      ) : null}
    </section>
  );
}
