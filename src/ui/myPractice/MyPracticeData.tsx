"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Plus, Trash2, Upload } from "lucide-react";
import type { ProgressImportMode } from "@/persistence";
import { useStudioRuntime, useUiState } from "@/ui/runtime/useStudioRuntime";
import { notifyProgressChanged } from "@/ui/myPractice/progressStore";
import type { ProgressApi } from "@/ui/myPractice/useProgress";

function downloadText(text: string, fileName: string): boolean {
  if (typeof document === "undefined" || typeof URL === "undefined" || typeof Blob === "undefined") {
    return false;
  }
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Learner-selected goals (free text; never used to score anything). */
export function GoalsSection({ progress }: { progress: ProgressApi }): JSX.Element {
  const saved = progress.progress ? progress.progress.goals : [];
  const [draft, setDraft] = useState<string[]>(saved);
  const [adding, setAdding] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const savedKey = saved.join("\u0000");
  useEffect(() => {
    setDraft(savedKey === "" ? [] : savedKey.split("\u0000"));
  }, [savedKey]);

  const save = (goals: string[]): void => {
    const result = progress.store.setGoals(goals);
    setMessage(result.ok ? "Goals saved." : `Not saved: ${result.error.message}`);
    notifyProgressChanged();
  };

  return (
    <section className="pls-mp-card" aria-labelledby="pls-mp-goals">
      <h2 id="pls-mp-goals" className="pls-mp-card__title">
        Goals
      </h2>
      <p className="pls-mp-card__text">Your own goals, in your words. They guide what you choose; they are not scored.</p>
      {draft.length > 0 ? (
        <ul className="pls-mp-goals">
          {draft.map((goal, index) => (
            <li key={index} className="pls-mp-goals__item">
              <input
                className="pls-input pls-mp-goals__input"
                value={goal}
                aria-label={`Goal ${index + 1}`}
                onChange={(event) => setDraft(draft.map((value, i) => (i === index ? event.target.value : value)))}
              />
              <button type="button" className="pls-btn pls-btn--icon pls-btn--small" aria-label={`Remove goal ${index + 1}`} onClick={() => save(draft.filter((_, i) => i !== index))}>
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="pls-mp-card__text">No goals yet — for example “Play the ii–V–I shells in three keys”.</p>
      )}
      <form
        className="pls-mp-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (adding.trim() === "") {
            return;
          }
          save([...draft, adding.trim()]);
          setAdding("");
        }}
      >
        <input className="pls-input pls-mp-goals__input" value={adding} placeholder="Add a goal" aria-label="New goal" onChange={(event) => setAdding(event.target.value)} />
        <button type="submit" className="pls-btn pls-btn--small">
          <Plus size={14} aria-hidden="true" />
          <span>Add</span>
        </button>
        <button type="button" className="pls-btn pls-btn--small pls-btn--ghost" onClick={() => save(draft)} disabled={draft.join("\u0000") === savedKey}>
          Save edits
        </button>
      </form>
      {message ? (
        <p className="pls-mp-card__text" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}

/** Export / import / reset and storage status, with a recovery path when data cannot be read. */
export function DataSection({ progress, scoringNote }: { progress: ProgressApi; scoringNote: string | null }): JSX.Element {
  const runtime = useStudioRuntime();
  const ui = useUiState();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importMode, setImportMode] = useState<ProgressImportMode>("merge");
  const [confirmReset, setConfirmReset] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  let status: { available: boolean; reason?: string; quotaExceeded?: boolean; backend: string } = { available: false, backend: "memory" };
  try {
    status = runtime.stores.currentStatus();
  } catch {
    // keep the fallback
  }

  const exportProgress = (): void => {
    const result = progress.store.exportJson();
    if (!result.ok) {
      setMessage(`Export failed: ${result.error.message}`);
      return;
    }
    setMessage(downloadText(result.value, `practice-progress-${today()}.json`) ? "Progress exported." : "Downloads are not available here.");
  };

  const exportRaw = (): void => {
    const raw = progress.store.readRaw();
    if (raw === null) {
      setMessage("There is no stored progress text to save.");
      return;
    }
    setMessage(downloadText(raw, `practice-progress-unreadable-${today()}.json`) ? "The stored text was downloaded unchanged." : "Downloads are not available here.");
  };

  const importFile = (file: File): void => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      const result = progress.store.importJson(text, importMode);
      notifyProgressChanged();
      if (result.ok) {
        setMessage(`Imported (${importMode === "replace" ? "replaced" : "merged"}).${result.warnings.length > 0 ? ` ${result.warnings.join(" ")}` : ""}`);
      } else {
        setMessage(`Import failed: ${result.error.message}${result.error.details.length > 0 ? ` (${result.error.details.slice(0, 3).join("; ")})` : ""}`);
      }
    };
    reader.onerror = () => setMessage("The file could not be read.");
    reader.readAsText(file);
  };

  const reset = (): void => {
    const result = progress.store.reset();
    notifyProgressChanged();
    setConfirmReset(false);
    setMessage(result.ok ? "Local progress was reset." : `Reset failed: ${result.error.message}`);
  };

  return (
    <section className="pls-mp-card" aria-labelledby="pls-mp-data">
      <h2 id="pls-mp-data" className="pls-mp-card__title">
        Your data
      </h2>
      <p className="pls-mp-card__text">
        Progress stays in this browser ({status.available ? "saved across reloads" : "not saved — kept only until this page closes"}). Export it to keep a copy or move it to another device.
      </p>
      {!status.available || ui.storageMessage ? (
        <p className="pls-mp-warning" role="status">
          {ui.storageMessage ?? status.reason ?? "Saving is not available in this browser."} Export your progress before closing the page; you can import it again later.
        </p>
      ) : null}
      {status.quotaExceeded ? <p className="pls-mp-warning">Storage is full. Export your progress, then reset or remove old projects.</p> : null}
      {progress.error ? (
        <div className="pls-mp-warning" role="alert">
          <p>Your saved progress could not be read: {progress.error}</p>
          <p>Nothing was changed. Download the stored text to keep it, then import a good export (Replace) or reset.</p>
          <button type="button" className="pls-btn pls-btn--small" onClick={exportRaw}>
            Download the stored text
          </button>
        </div>
      ) : null}
      {scoringNote ? <p className="pls-mp-card__text">{scoringNote}</p> : null}
      <div className="pls-mp-row">
        <button type="button" className="pls-btn pls-btn--small" onClick={exportProgress} disabled={progress.progress === null}>
          <Download size={14} aria-hidden="true" />
          <span>Export progress</span>
        </button>
        <label className="pls-field pls-field--inline">
          <span className="pls-field__label">Import as</span>
          <select className="pls-select" value={importMode} onChange={(event) => setImportMode(event.target.value === "replace" ? "replace" : "merge")}>
            <option value="merge">Merge with current</option>
            <option value="replace">Replace current</option>
          </select>
        </label>
        <button type="button" className="pls-btn pls-btn--small" onClick={() => fileRef.current?.click()}>
          <Upload size={14} aria-hidden="true" />
          <span>Import…</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="pls-sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const file = event.target.files && event.target.files.length > 0 ? event.target.files[0] : null;
            if (file) {
              importFile(file);
            }
            event.target.value = "";
          }}
        />
      </div>
      <div className="pls-mp-row">
        {confirmReset ? (
          <>
            <span className="pls-mp-card__text">Delete all local progress? Export first if you want to keep it.</span>
            <button type="button" className="pls-btn pls-btn--small pls-btn--danger" onClick={reset}>
              Yes, reset progress
            </button>
            <button type="button" className="pls-btn pls-btn--small pls-btn--ghost" onClick={() => setConfirmReset(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="pls-btn pls-btn--small pls-btn--ghost" onClick={() => setConfirmReset(true)}>
            <Trash2 size={14} aria-hidden="true" />
            <span>Reset progress…</span>
          </button>
        )}
      </div>
      {message ? (
        <p className="pls-mp-card__text" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
