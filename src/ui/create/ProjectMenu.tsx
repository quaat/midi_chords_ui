"use client";

import { useId, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Copy, Download, FilePlus, FolderOpen, Save, Trash2, Upload } from "lucide-react";
import type { ProjectSummary } from "@/persistence";
import { isDirty } from "@/ui/create/createState";
import { useEditor, useStudioRuntime, useUiState } from "@/ui/runtime/useStudioRuntime";

/** Trigger a browser download for a Blob. */
export function downloadBlob(blob: Blob, fileName: string): void {
  if (typeof document === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeFileName(name: string, extension: string): string {
  const base = name.replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-") || "progression";
  return `${base}.${extension}`;
}

/** New / open / save / save as / duplicate / export & import JSON / export MIDI. */
export function ProjectMenu(): JSX.Element {
  const runtime = useStudioRuntime();
  const [editor, dispatch] = useEditor();
  const ui = useUiState();
  const nameId = useId();
  const saveAsId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showOpen, setShowOpen] = useState(false);
  const [saveAsName, setSaveAsName] = useState<string | null>(null);
  const dirty = isDirty(editor);

  const projects = useMemo<{ list: ProjectSummary[]; error: string | null }>(() => {
    if (!showOpen || !ui.storesReady) {
      return { list: [], error: null };
    }
    const result = runtime.stores.projects.list();
    return result.ok ? { list: result.value, error: null } : { list: [], error: result.error.message };
    // projectListVersion invalidates the list after saves/imports/deletes.
  }, [runtime, showOpen, ui.storesReady, ui.projectListVersion]);

  const confirmDiscard = (): boolean => {
    if (!dirty || typeof window === "undefined") {
      return true;
    }
    return window.confirm("Discard unsaved changes to this progression?");
  };

  const onImport = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    if (!confirmDiscard()) {
      return;
    }
    file
      .text()
      .then((text) => setMessage(runtime.importProjectJson(text).message))
      .catch(() => setMessage("The file could not be read."));
  };

  return (
    <section className="pls-panel" aria-label="Project">
      <h2 className="pls-panel__title">Project{dirty ? <span className="pls-project__dirty"> · unsaved changes</span> : null}</h2>
      <div className="pls-field">
        <label className="pls-field__label" htmlFor={nameId}>
          Name
        </label>
        <input
          id={nameId}
          key={editor.project.name}
          className="pls-input"
          defaultValue={editor.project.name}
          onBlur={(event) => dispatch({ type: "renameProject", name: event.target.value })}
        />
      </div>
      <div className="pls-project__buttons">
        <button
          type="button"
          className="pls-btn pls-btn--small"
          onClick={() => {
            if (confirmDiscard()) {
              dispatch({ type: "newProject", sequenceId: `seq-${Date.now().toString(36)}` });
              setMessage("New progression.");
            }
          }}
        >
          <FilePlus size={14} aria-hidden="true" /> New
        </button>
        <button type="button" className="pls-btn pls-btn--small" aria-expanded={showOpen} onClick={() => setShowOpen(!showOpen)}>
          <FolderOpen size={14} aria-hidden="true" /> Open
        </button>
        <button type="button" className="pls-btn pls-btn--small pls-btn--primary" onClick={() => setMessage(runtime.saveProject().message)}>
          <Save size={14} aria-hidden="true" /> Save
        </button>
        <button type="button" className="pls-btn pls-btn--small" onClick={() => setSaveAsName(saveAsName === null ? `${editor.project.name} (copy)` : null)}>
          <Save size={14} aria-hidden="true" /> Save as…
        </button>
        <button type="button" className="pls-btn pls-btn--small" disabled={editor.project.id === null} onClick={() => setMessage(runtime.duplicateProject().message)}>
          <Copy size={14} aria-hidden="true" /> Duplicate
        </button>
      </div>
      {saveAsName !== null ? (
        <form
          className="pls-project__saveas"
          onSubmit={(event) => {
            event.preventDefault();
            setMessage(runtime.saveProject({ asNew: true, name: saveAsName }).message);
            setSaveAsName(null);
          }}
        >
          <label className="pls-field__label" htmlFor={saveAsId}>
            Save as
          </label>
          <input id={saveAsId} className="pls-input" value={saveAsName} onChange={(event) => setSaveAsName(event.target.value)} />
          <button type="submit" className="pls-btn pls-btn--small">
            Save copy
          </button>
        </form>
      ) : null}
      {showOpen ? (
        <div className="pls-project__open">
          {projects.error ? <p className="pls-error-text">{projects.error}</p> : null}
          {projects.list.length === 0 && !projects.error ? <p className="pls-inspector__note">No saved projects yet.</p> : null}
          <ul className="pls-project__list">
            {projects.list.map((summary) => (
              <li key={summary.id}>
                <button
                  type="button"
                  className="pls-link-button"
                  disabled={summary.problem !== undefined}
                  title={summary.problem ? `Cannot open (${summary.problem})` : `Saved ${summary.updatedAt}`}
                  onClick={() => {
                    if (confirmDiscard()) {
                      setMessage(runtime.openSavedProject(summary.id).message);
                      setShowOpen(false);
                    }
                  }}
                >
                  {summary.name}
                </button>
                <span className="pls-project__date">{summary.updatedAt.slice(0, 10)}</span>
                <button
                  type="button"
                  className="pls-btn pls-btn--small pls-btn--ghost pls-btn--icon"
                  aria-label={`Delete ${summary.name}`}
                  onClick={() => {
                    if (typeof window === "undefined" || window.confirm(`Delete “${summary.name}”? This cannot be undone.`)) {
                      setMessage(runtime.deleteProject(summary.id).message);
                    }
                  }}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="pls-project__buttons">
        <button
          type="button"
          className="pls-btn pls-btn--small"
          onClick={() => {
            const json = runtime.exportProjectJson();
            if (typeof Blob !== "undefined") {
              downloadBlob(new Blob([json], { type: "application/json" }), safeFileName(editor.project.name, "json"));
            }
          }}
        >
          <Download size={14} aria-hidden="true" /> Export JSON
        </button>
        <button type="button" className="pls-btn pls-btn--small" onClick={() => fileRef.current?.click()}>
          <Upload size={14} aria-hidden="true" /> Import JSON
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="pls-sr-only" tabIndex={-1} aria-hidden="true" onChange={onImport} />
        <button
          type="button"
          className="pls-btn pls-btn--small"
          onClick={() => {
            const midi = runtime.exportMidi();
            const blob = midi.blob ?? (typeof Blob !== "undefined" ? new Blob([midi.bytes], { type: "audio/midi" }) : null);
            if (blob) {
              downloadBlob(blob, midi.fileName);
            }
          }}
        >
          <Download size={14} aria-hidden="true" /> Export MIDI
        </button>
      </div>
      {message ? (
        <p className="pls-project__message" role="status">
          {message}
        </p>
      ) : null}
      {ui.storageMessage ? <p className="pls-project__message pls-error-text">{ui.storageMessage}</p> : null}
    </section>
  );
}
