"use client";

/**
 * Songs collection (plan E30): bundled original charts plus local charts, new/import/export/
 * duplicate/delete, and the chart workspace (arrangements, play-along, practice, editing).
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Copy, Download, FilePlus, Music, Trash2, Upload } from "lucide-react";
import type { SongChart } from "@/model/contracts";
import { contentBundle, getChart } from "@/content";
import { chartFromChordText } from "@/charts/editor";
import type { ChartSummary } from "@/persistence/charts";
import { useStudioRuntime, useUiState } from "@/ui/runtime/useStudioRuntime";
import { ChartWorkspace } from "@/ui/songs/ChartWorkspace";
import { consumeChartRequest, subscribeChartRequests } from "@/ui/songs/songsRequests";
import type { ChartRequest } from "@/ui/songs/songsRequests";
import { PROVENANCE_NOTES, blankChart, chordTextImportOptions, copyChart, mergeChartLists, withFreeId } from "@/ui/songs/songsLogic";
import type { ChartListItem, ChartSource } from "@/ui/songs/songsLogic";

interface Selected {
  id: string;
  source: ChartSource;
  arrangementId?: string;
  sectionId?: string;
  /** Bumped to remount the workspace (e.g. a new request for the same chart). */
  nonce: number;
}

function downloadText(fileName: string, text: string): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SongsView(): JSX.Element {
  const runtime = useStudioRuntime();
  const ui = useUiState();
  const titleId = useId();
  const textId = useId();
  const fileId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [listVersion, setListVersion] = useState<number>(0);
  const [userCharts, setUserCharts] = useState<ChartSummary[]>([]);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [newOpen, setNewOpen] = useState<boolean>(false);
  const [newTitle, setNewTitle] = useState<string>("");
  const [newText, setNewText] = useState<string>("Am | 1\nF | 1\nC | 1\nG | 1");
  const nonce = useRef<number>(0);
  const [liveChart, setLiveChart] = useState<SongChart | null>(null);
  // The chart store switches from memory to localStorage when the runtime starts.
  const storesReady = ui.storesReady;

  const refresh = useCallback(() => setListVersion((value: number) => value + 1), []);

  useEffect(() => {
    try {
      const listed = runtime.stores.charts.list();
      setUserCharts(listed.ok ? listed.value : []);
      if (!listed.ok) setMessage(listed.error.message);
    } catch (error) {
      setUserCharts([]);
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [runtime, storesReady, listVersion]);

  const items: ChartListItem[] = useMemo(() => mergeChartLists(contentBundle.charts, userCharts), [userCharts]);
  const takenIds: string[] = useMemo(() => items.map((item: ChartListItem) => item.id), [items]);

  const select = useCallback((id: string, source: ChartSource, extra: { arrangementId?: string; sectionId?: string } = {}) => {
    nonce.current += 1;
    const next: Selected = { id, source, nonce: nonce.current };
    if (extra.arrangementId !== undefined) next.arrangementId = extra.arrangementId;
    if (extra.sectionId !== undefined) next.sectionId = extra.sectionId;
    setSelected(next);
    setLiveChart(null);
    setErrors([]);
  }, []);

  const handleRequest = useCallback(
    (request: ChartRequest) => {
      const source: ChartSource = getChart(request.chartId) ? "content" : "user";
      select(request.chartId, source, { arrangementId: request.arrangementId, sectionId: request.sectionId });
    },
    [select]
  );

  // Requests from Learn / Practice review / My Practice.
  useEffect(() => {
    const pending = consumeChartRequest();
    if (pending) handleRequest(pending);
    return subscribeChartRequests((request: ChartRequest) => {
      consumeChartRequest();
      handleRequest(request);
    });
  }, [handleRequest]);

  // The chart being shown (content from the bundle, user charts from the store).
  const loaded = useMemo((): { chart: SongChart | null; problem: string | null } => {
    if (!selected) return { chart: null, problem: null };
    if (selected.source === "content") {
      const chart = getChart(selected.id);
      return chart ? { chart, problem: null } : { chart: null, problem: `The song "${selected.id}" is not available.` };
    }
    if (!storesReady) return { chart: null, problem: "Opening the charts saved in this browser…" };
    try {
      const result = runtime.stores.charts.get(selected.id);
      if (!result.ok) return { chart: null, problem: result.error.message };
      return result.value ? { chart: result.value, problem: null } : { chart: null, problem: `The chart "${selected.id}" is not saved in this browser.` };
    } catch (error) {
      return { chart: null, problem: error instanceof Error ? error.message : String(error) };
    }
  }, [selected, runtime, storesReady]);

  const saveNew = (chart: SongChart, note: string): void => {
    const saved = runtime.stores.charts.save(chart);
    if (!saved.ok) {
      setMessage(`Not saved: ${saved.error.message}`);
      setErrors(saved.error.details);
      return;
    }
    setMessage(note);
    refresh();
    select(chart.id, "user");
  };

  const createFromText = (): void => {
    const result = chartFromChordText(newText, chordTextImportOptions(newTitle, takenIds));
    if (!result.ok) {
      setMessage(result.reason);
      setErrors(result.errors);
      return;
    }
    setErrors(result.notes);
    saveNew(result.chart, `Created “${result.chart.title}” from chord text. It stays in this browser.`);
    setNewOpen(false);
  };

  const createBlank = (): void => {
    saveNew(blankChart(newTitle, takenIds), "Created a blank chart with four empty bars. Choose “Edit chords” to fill it in.");
    setNewOpen(false);
  };

  const importFile = (file: File): void => {
    void file
      .text()
      .then((text: string) => {
        const result = runtime.stores.charts.importChartJson(text);
        if (!result.ok) {
          setMessage(`Import failed: ${result.error.message}`);
          setErrors(result.error.details);
          return;
        }
        const chart = withFreeId(result.value, takenIds);
        setErrors(result.warnings);
        saveNew(chart, `Imported “${chart.title}”${chart.id !== result.value.id ? ` as ${chart.id} (the id was taken)` : ""}. It stays in this browser.`);
      })
      .catch((error: unknown) => setMessage(`Import failed: ${error instanceof Error ? error.message : String(error)}`));
  };

  const exportChart = (chart: SongChart): void => {
    downloadText(`${chart.id}.chart.json`, runtime.stores.charts.exportChartJson(chart));
  };

  const duplicate = (chart: SongChart): void => {
    saveNew(copyChart(chart, takenIds, "(copy)"), `Duplicated “${chart.title}”.`);
  };

  const remove = (item: ChartListItem): void => {
    if (!item.canDelete) return;
    if (typeof window !== "undefined" && !window.confirm(`Delete “${item.title}” from this browser? This cannot be undone.`)) return;
    const result = runtime.stores.charts.remove(item.id);
    if (!result.ok) {
      setMessage(result.error.message);
      return;
    }
    if (selected && selected.id === item.id) setSelected(null);
    setMessage(`Deleted “${item.title}”.`);
    refresh();
  };

  const onSavedNew = useCallback(
    (chart: SongChart) => {
      refresh();
      select(chart.id, "user");
      setMessage(`Saved “${chart.title}” in this browser.`);
    },
    [refresh, select]
  );

  const current = loaded.chart;
  /** What the workspace currently shows (edits, transposition) — used by Export/Duplicate. */
  const shown = liveChart ?? current;
  const currentItem = selected ? items.find((item: ChartListItem) => item.id === selected.id && item.source === selected.source) : undefined;

  return (
    <div className="pls-songs">
      <div className="pls-songs__body">
        <aside className="pls-songs__list" aria-label="Charts">
          <div className="pls-learn-actions">
            <button type="button" className={clsx("pls-btn", "pls-btn--small", newOpen && "pls-toggle--on")} aria-expanded={newOpen} onClick={() => setNewOpen((value: boolean) => !value)}>
              <FilePlus size={14} aria-hidden="true" /> New chart
            </button>
            <button type="button" className="pls-btn pls-btn--small" onClick={() => fileRef.current?.click()}>
              <Upload size={14} aria-hidden="true" /> Import JSON
            </button>
            <label className="pls-sr-only" htmlFor={fileId}>
              Chart JSON file
            </label>
            <input
              id={fileId}
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="pls-sr-only"
              tabIndex={-1}
              onChange={(event) => {
                const file = event.target.files && event.target.files[0];
                if (file) importFile(file);
                event.target.value = "";
              }}
            />
          </div>
          {newOpen ? (
            <div className="pls-songs-new">
              <div className="pls-field">
                <label className="pls-field__label" htmlFor={titleId}>
                  Title
                </label>
                <input id={titleId} className="pls-input" value={newTitle} placeholder="Untitled chart" onChange={(event) => setNewTitle(event.target.value)} />
              </div>
              <div className="pls-field">
                <label className="pls-field__label" htmlFor={textId}>
                  Chord text (one “Symbol | bars” per line)
                </label>
                <textarea id={textId} className="pls-input pls-songs-new__text" rows={5} value={newText} onChange={(event) => setNewText(event.target.value)} />
              </div>
              <div className="pls-learn-actions">
                <button type="button" className="pls-btn pls-btn--small pls-btn--primary" onClick={createFromText}>
                  Create from chord text
                </button>
                <button type="button" className="pls-btn pls-btn--small" onClick={createBlank}>
                  Blank 4-bar chart
                </button>
              </div>
            </div>
          ) : null}
          <ul className="pls-songs-items">
            {items.map((item: ChartListItem) => {
              const active = selected !== null && selected.id === item.id && selected.source === item.source;
              return (
                <li key={`${item.source}-${item.id}`} className={clsx("pls-songs-item", active && "pls-songs-item--active")}>
                  <button
                    type="button"
                    className="pls-songs-item__open"
                    aria-current={active ? "page" : undefined}
                    disabled={item.problem !== undefined}
                    onClick={() => select(item.id, item.source)}
                  >
                    <Music size={14} aria-hidden="true" />
                    <span className="pls-songs-item__title">{item.title}</span>
                  </button>
                  <span className="pls-songs-item__badges">
                    {item.badges.map((badge: string) => (
                      <span key={badge} className={clsx("pls-badge", badge === "draft" && "pls-learn-badge--draft")}>
                        {badge}
                      </span>
                    ))}
                  </span>
                  {item.canDelete ? (
                    <button type="button" className="pls-btn pls-btn--small pls-btn--icon pls-btn--ghost" onClick={() => remove(item)} aria-label={`Delete ${item.title}`}>
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {message ? (
            <p className="pls-songs-note" role="status">
              {message}
            </p>
          ) : null}
          {errors.length > 0 ? (
            <ul className="pls-learn-list">
              {errors.map((line: string, index: number) => (
                <li key={`${index}-${line}`} className="pls-learn-muted">
                  {line}
                </li>
              ))}
            </ul>
          ) : null}
        </aside>

        <div className="pls-songs__main">
          {current && selected ? (
            <>
              <div className="pls-learn-actions pls-songs__fileactions">
                <button type="button" className="pls-btn pls-btn--small" onClick={() => exportChart(shown ?? current)}>
                  <Download size={14} aria-hidden="true" /> Export JSON
                </button>
                <button type="button" className="pls-btn pls-btn--small" onClick={() => duplicate(shown ?? current)}>
                  <Copy size={14} aria-hidden="true" /> Duplicate
                </button>
                {currentItem && currentItem.canDelete ? (
                  <button type="button" className="pls-btn pls-btn--small pls-btn--danger" onClick={() => remove(currentItem)}>
                    <Trash2 size={14} aria-hidden="true" /> Delete
                  </button>
                ) : null}
              </div>
              <ChartWorkspace
                key={`${selected.source}:${selected.id}:${selected.nonce}`}
                initialChart={current}
                source={selected.source}
                initialArrangementId={selected.arrangementId}
                initialSectionId={selected.sectionId}
                takenIds={takenIds}
                onSavedNew={onSavedNew}
                onSaved={refresh}
                onChartChange={setLiveChart}
              />
            </>
          ) : loaded.problem ? (
            <p className="pls-error-text">{loaded.problem}</p>
          ) : (
            <div className="pls-songs-empty">
              <p className="pls-learn-page__title">Songs</p>
              <p className="pls-learn-muted">
                Choose a chart to hear it with accompaniment, loop a section, practise it in Practice or edit it. Start with Evening Loop (pop/folk in C) or Dorian Drift (a D Dorian vamp).
              </p>
            </div>
          )}
        </div>
      </div>

      <footer className="pls-songs__footer">
        <p className="pls-songs-ws__label">About these charts</p>
        <ul className="pls-learn-list">
          {PROVENANCE_NOTES.map((line: string) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </footer>
    </div>
  );
}
