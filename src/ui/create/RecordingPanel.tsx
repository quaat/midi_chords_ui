"use client";

import { useCallback, useId, useMemo, useState } from "react";
import clsx from "clsx";
import { Circle, Download, FolderOpen, Pause, Pencil, Play, Repeat, RotateCcw, Save, Square, Trash2 } from "lucide-react";
import type { RecordingSummary } from "@/persistence";
import { describeBeats, formatClock, recordingTimeline } from "@/recording";
import { useSessionStore } from "@/state/useSessionStore";
import { beatsPerBar } from "@/timeline/clock";
import { downloadBlob } from "@/ui/create/ProjectMenu";
import { RecordingPreview } from "@/ui/create/RecordingPreview";
import type { StudioRuntimeCore, RecordingState } from "@/ui/runtime/runtimeCore";
import { useDevices, useMaterial, useRecording, useStudioRuntime, useTransportState, useUiState } from "@/ui/runtime/useStudioRuntime";
import { LiveText } from "@/ui/workspace/LiveText";

function isCapturing(state: RecordingState): boolean {
  return state.status === "recording" || state.status === "countIn";
}

/** Record, asking first when an unsaved take would be replaced. */
function startRecording(runtime: StudioRuntimeCore, state: RecordingState): void {
  if (state.take && state.dirty && typeof window !== "undefined" && !window.confirm("Discard the unsaved take and record a new one?")) {
    return;
  }
  void runtime.startRecording();
}

function exportRecording(runtime: StudioRuntimeCore, id?: string): string {
  const midi = runtime.exportRecordingMidi(id);
  if (!midi) {
    return "There is no take to export.";
  }
  const blob = midi.blob ?? (typeof Blob !== "undefined" ? new Blob([midi.bytes], { type: "audio/midi" }) : null);
  if (!blob) {
    return "Downloads are not available here.";
  }
  downloadBlob(blob, midi.fileName);
  return `Downloaded ${midi.fileName}.`;
}

/** Compact Record / Stop control for the Create stage bar (same state as the panel). */
export function RecordButton(): JSX.Element {
  const runtime = useStudioRuntime();
  const state = useRecording();
  const getClock = useCallback(() => formatClock(runtime.recorder.elapsedMs()), [runtime]);
  if (isCapturing(state)) {
    return (
      <button type="button" className="pls-btn pls-btn--small pls-btn--recording" onClick={() => runtime.stopRecording()} aria-label="Stop recording">
        <Square size={14} aria-hidden="true" />
        <span>{state.status === "countIn" ? "Count-in" : "Stop"}</span>
        <LiveText getText={getClock} fallback="0:00.0" className="pls-record__clock" />
      </button>
    );
  }
  return (
    <button type="button" className="pls-btn pls-btn--small pls-btn--record" onClick={() => startRecording(runtime, state)} aria-label="Record your playing">
      <Circle size={12} fill="currentColor" aria-hidden="true" />
      <span>Record</span>
    </button>
  );
}

/** Create context-panel section: record, play back / loop, save, export and manage saved takes. */
export function RecordingPanel(): JSX.Element {
  const runtime = useStudioRuntime();
  const state = useRecording();
  const material = useMaterial();
  const transport = useTransportState();
  const devices = useDevices();
  const ui = useUiState();
  const inputSource = useSessionStore((s) => s.inputSource);
  const nameId = useId();
  const fitId = useId();
  const [message, setMessage] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);

  const capturing = isCapturing(state);
  const take = state.take;
  const loaded = take !== null && material.sourceKind === "recording" && material.sourceId === take.id;
  const playing = loaded && (transport.state === "playing" || transport.state === "countingIn");
  const paused = loaded && transport.state === "paused";
  const looping = loaded && transport.loop !== null;
  const settings = runtime.recordingSettings();
  const barBeats = take ? beatsPerBar(take.timeSignature.numerator, take.timeSignature.denominator) : beatsPerBar(settings.timeSignature.numerator, settings.timeSignature.denominator);
  const timeline = useMemo(() => (take ? recordingTimeline(take, { fitToBars: state.fitToBars, notes: state.notes }).timeline : null), [take, state.fitToBars, state.notes]);
  const recordedBeats = take ? (take.durationMs * take.tempo.bpm) / 60000 : 0;
  const getClock = useCallback(() => formatClock(runtime.recorder.elapsedMs()), [runtime]);

  const saved = useMemo<{ list: RecordingSummary[]; error: string | null }>(() => {
    if (!showList || !ui.storesReady) {
      return { list: [], error: null };
    }
    const result = runtime.listRecordings();
    return result.ok ? { list: result.value, error: null } : { list: [], error: result.error.message };
    // listVersion invalidates the list after save/rename/delete.
  }, [runtime, showList, ui.storesReady, state.listVersion]);

  const midiUnavailable = inputSource === "midi" && (devices.permission === "unsupported" || devices.permission === "denied");

  let statusLabel: string;
  let statusClass = "";
  if (state.status === "countIn") {
    statusLabel = "Count-in";
    statusClass = "pls-record__badge--countin";
  } else if (state.status === "recording") {
    statusLabel = "Recording";
    statusClass = "pls-record__badge--recording";
  } else if (playing) {
    statusLabel = "Playing";
  } else if (paused) {
    statusLabel = "Paused";
  } else if (take) {
    statusLabel = "Take ready";
  } else {
    statusLabel = "Ready";
  }

  const confirmDiscard = (): boolean => {
    if (!take || !state.dirty || typeof window === "undefined") {
      return true;
    }
    return window.confirm("Discard the unsaved take?");
  };

  const openSaved = (id: string): void => {
    if (!confirmDiscard()) {
      return;
    }
    setMessage(runtime.loadSavedRecording(id).message);
  };

  return (
    <section className="pls-panel pls-record" aria-label="Recording">
      <h2 className="pls-panel__title">Record</h2>
      <div className="pls-record__status" role="status" aria-live="polite">
        <span className={clsx("pls-record__badge", statusClass)}>
          {state.status === "recording" ? <span className="pls-record__dot" aria-hidden="true" /> : null}
          {statusLabel}
        </span>
        {capturing ? <LiveText getText={getClock} fallback="0:00.0" className="pls-record__clock" /> : null}
        {capturing ? (
          <span>
            {state.noteCount} note{state.noteCount === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>
      <div className="pls-record__buttons">
        {capturing ? (
          <button type="button" className="pls-btn pls-btn--small pls-btn--recording" onClick={() => runtime.stopRecording()}>
            <Square size={14} aria-hidden="true" /> Stop recording
          </button>
        ) : (
          <button type="button" className="pls-btn pls-btn--small pls-btn--record" onClick={() => startRecording(runtime, state)}>
            <Circle size={12} fill="currentColor" aria-hidden="true" /> Record
          </button>
        )}
        {capturing ? (
          <button type="button" className="pls-btn pls-btn--small pls-btn--ghost" onClick={() => runtime.discardRecording()}>
            Cancel
          </button>
        ) : null}
      </div>
      <p className="pls-record__meta">
        {capturing
          ? `${Math.round(settings.tempoBpm)} BPM · ${settings.timeSignature.numerator}/${settings.timeSignature.denominator}. Play on your keyboard, the computer keys or the on-screen piano.`
          : `Records what you play (MIDI, computer keys or on-screen piano) at ${Math.round(settings.tempoBpm)} BPM, ${settings.timeSignature.numerator}/${settings.timeSignature.denominator}. Count-in and metronome follow the transport settings.`}
      </p>
      {midiUnavailable ? (
        <p className="pls-record__meta pls-error-text">{devices.permissionMessage} The on-screen piano and computer keys still record.</p>
      ) : null}
      {state.warnings.length > 0 ? (
        <ul className="pls-pathways__warnings">
          {state.warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      ) : null}

      {take && !capturing ? (
        <div className="pls-record__take">
          <div className="pls-field">
            <label className="pls-field__label" htmlFor={nameId}>
              Take name{state.dirty ? <span className="pls-project__dirty"> · unsaved</span> : null}
            </label>
            <input id={nameId} key={take.id + take.title} className="pls-input" defaultValue={take.title} onBlur={(event) => runtime.setRecordingTitle(event.target.value)} />
          </div>
          <p className="pls-record__meta">
            {state.notes.length} note{state.notes.length === 1 ? "" : "s"} · {Math.round(take.tempo.bpm)} BPM · {take.timeSignature.numerator}/{take.timeSignature.denominator} ·{" "}
            {timeline ? describeBeats(timeline.totalBeats, barBeats) : describeBeats(recordedBeats, barBeats)} · {formatClock(take.durationMs)}
            {timeline && Math.abs(timeline.totalBeats - recordedBeats) > 1e-6 ? ` (recorded ${describeBeats(recordedBeats, barBeats)})` : ""}
          </p>
          {timeline ? (
            <RecordingPreview className="pls-record__preview" notes={state.notes} totalBeats={timeline.totalBeats} tempoBpm={take.tempo.bpm} barBeats={barBeats} />
          ) : null}
          <label className="pls-check" htmlFor={fitId}>
            <input id={fitId} type="checkbox" checked={state.fitToBars} onChange={(event) => runtime.setRecordingFitToBars(event.target.checked)} />
            <span>Fit loop to whole bars</span>
          </label>
          <div className="pls-record__buttons" role="group" aria-label="Take playback">
            <button
              type="button"
              className="pls-btn pls-btn--small pls-btn--primary"
              onClick={() => (playing ? runtime.pauseRecordingPlayback() : void runtime.playRecording())}
            >
              {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />} {playing ? "Pause" : paused ? "Resume" : "Play"}
            </button>
            <button type="button" className="pls-btn pls-btn--small" disabled={!loaded || transport.state === "stopped"} onClick={() => runtime.stopRecordingPlayback()}>
              <Square size={14} aria-hidden="true" /> Stop
            </button>
            <button type="button" className="pls-btn pls-btn--small" onClick={() => void runtime.restartRecordingPlayback()} aria-label="Restart from the beginning">
              <RotateCcw size={14} aria-hidden="true" /> Restart
            </button>
            <button
              type="button"
              className={clsx("pls-btn", "pls-btn--small", "pls-toggle", looping && "pls-toggle--on")}
              aria-pressed={looping}
              onClick={() => runtime.setRecordingLoop(!looping)}
            >
              <Repeat size={14} aria-hidden="true" />
              <span>Loop</span>
              <span className="pls-toggle__state" aria-hidden="true">
                {looping ? "On" : "Off"}
              </span>
            </button>
          </div>
          <div className="pls-record__buttons" role="group" aria-label="Take actions">
            <button type="button" className="pls-btn pls-btn--small" onClick={() => setMessage(runtime.saveRecording().message)}>
              <Save size={14} aria-hidden="true" /> {state.savedId ? "Save changes" : "Save"}
            </button>
            <button type="button" className="pls-btn pls-btn--small" onClick={() => setMessage(exportRecording(runtime))}>
              <Download size={14} aria-hidden="true" /> Export MIDI
            </button>
            <button
              type="button"
              className="pls-btn pls-btn--small pls-btn--ghost pls-btn--danger"
              onClick={() => {
                if (confirmDiscard()) {
                  runtime.discardRecording();
                }
              }}
            >
              <Trash2 size={14} aria-hidden="true" /> Discard
            </button>
          </div>
        </div>
      ) : null}

      <div className="pls-record__buttons">
        <button type="button" className="pls-btn pls-btn--small" aria-expanded={showList} onClick={() => setShowList(!showList)} disabled={capturing}>
          <FolderOpen size={14} aria-hidden="true" /> Saved recordings
        </button>
      </div>
      {showList ? (
        <div className="pls-record__saved">
          {saved.error ? <p className="pls-error-text">{saved.error}</p> : null}
          {saved.list.length === 0 && !saved.error ? <p className="pls-inspector__note">No saved recordings yet.</p> : null}
          <ul className="pls-record__list">
            {saved.list.map((summary) => (
              <li key={summary.id}>
                {renaming && renaming.id === summary.id ? (
                  <form
                    className="pls-record__rename"
                    onSubmit={(event) => {
                      event.preventDefault();
                      setMessage(runtime.renameRecording(summary.id, renaming.value).message);
                      setRenaming(null);
                    }}
                  >
                    <input className="pls-input" value={renaming.value} aria-label="New name" onChange={(event) => setRenaming({ id: summary.id, value: event.target.value })} />
                    <button type="submit" className="pls-btn pls-btn--small">
                      Rename
                    </button>
                    <button type="button" className="pls-btn pls-btn--small pls-btn--ghost" onClick={() => setRenaming(null)}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <>
                    <button
                      type="button"
                      className="pls-link-button pls-record__item-title"
                      disabled={summary.problem !== undefined}
                      title={summary.problem ? `Cannot open (${summary.problem})` : `Saved ${summary.updatedAt}`}
                      onClick={() => openSaved(summary.id)}
                    >
                      {summary.title}
                      {take && take.id === summary.id ? " (open)" : ""}
                    </button>
                    <span className="pls-record__item-meta">
                      {summary.noteCount} notes · {formatClock(summary.durationMs)} · {summary.updatedAt.slice(0, 10)}
                    </span>
                    <button
                      type="button"
                      className="pls-btn pls-btn--small pls-btn--ghost pls-btn--icon"
                      aria-label={`Play ${summary.title}`}
                      disabled={summary.problem !== undefined}
                      onClick={() => {
                        if (!confirmDiscard()) {
                          return;
                        }
                        const opened = runtime.loadSavedRecording(summary.id);
                        setMessage(opened.message);
                        if (opened.ok) {
                          void runtime.playRecording();
                        }
                      }}
                    >
                      <Play size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="pls-btn pls-btn--small pls-btn--ghost pls-btn--icon"
                      aria-label={`Export ${summary.title} as MIDI`}
                      disabled={summary.problem !== undefined}
                      onClick={() => setMessage(exportRecording(runtime, summary.id))}
                    >
                      <Download size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="pls-btn pls-btn--small pls-btn--ghost pls-btn--icon"
                      aria-label={`Rename ${summary.title}`}
                      disabled={summary.problem !== undefined}
                      onClick={() => setRenaming({ id: summary.id, value: summary.title })}
                    >
                      <Pencil size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="pls-btn pls-btn--small pls-btn--ghost pls-btn--icon"
                      aria-label={`Delete ${summary.title}`}
                      onClick={() => {
                        if (typeof window === "undefined" || window.confirm(`Delete “${summary.title}”? This cannot be undone.`)) {
                          setMessage(runtime.deleteRecording(summary.id).message);
                        }
                      }}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {message ?? state.message ? (
        <p className="pls-project__message" role="status">
          {message ?? state.message}
        </p>
      ) : null}
    </section>
  );
}
