"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { BookOpen, Copy, Pencil, Play, Redo2, Save, Send, Square, Undo2 } from "lucide-react";
import type { ArrangementDefinition, SongChart } from "@/model/contracts";
import { conceptsForChart } from "@/content";
import { compileArrangement } from "@/charts/arrangement";
import type { CompileArrangementResult } from "@/charts/arrangement";
import { expandChart, sectionLoopRegion } from "@/charts/expand";
import type { ChartOccurrence, ExpandedBar } from "@/charts/expand";
import { setTitle } from "@/charts/editor";
import { transposeChartToKey } from "@/charts/transpose";
import { validateChart } from "@/charts/validate";
import type { ChartIssue } from "@/charts/validate";
import { formatPitchClass } from "@/music/pitch";
import { formatKey } from "@/music/scales";
import { useStudioRuntime } from "@/ui/runtime/useStudioRuntime";
import { openArrangementInPractice } from "@/ui/practice/openExercise";
import { requestLearnPage } from "@/ui/learn/learnRequests";
import { runSafely } from "@/ui/learn/learnActions";
import { DEMAND_LABELS } from "@/ui/learn/learnLogic";
import { ChartGrid } from "@/ui/songs/ChartGrid";
import type { SpanRef } from "@/ui/songs/ChartGrid";
import { SpanEditor, StructureEditor } from "@/ui/songs/ChartEditors";
import type { ChartEdit } from "@/ui/songs/ChartEditors";
import {
  TRANSPOSE_TONICS,
  accompanimentLabel,
  applyEdit,
  arrangementsForChart,
  canRedo,
  canUndo,
  copyChart,
  createHistory,
  expectedTasksSummary,
  learnerPartLabel,
  parseSectionChoice,
  policyExplanation,
  policyLabel,
  redo,
  sectionChoices,
  undo
} from "@/ui/songs/songsLogic";
import type { ChartHistory, ChartSource, SectionChoice } from "@/ui/songs/songsLogic";

const SAVE_DELAY_MS = 600;

export interface ChartWorkspaceProps {
  initialChart: SongChart;
  source: ChartSource;
  initialArrangementId?: string;
  initialSectionId?: string;
  /** Ids already used by content and saved charts (for copies). */
  takenIds: string[];
  /** A new local chart was saved (copy / "Save as mine"): select it. */
  onSavedNew: (chart: SongChart) => void;
  /** A user chart was saved (refresh the list). */
  onSaved: () => void;
  /** The shown chart changed (edit, undo, transposition). */
  onChartChange?: (chart: SongChart) => void;
}

function Message({ text, tone = "info" }: { text: string | null; tone?: "info" | "error" }): JSX.Element | null {
  if (!text) return null;
  return (
    <p className={tone === "error" ? "pls-error-text" : "pls-songs-note"} role={tone === "error" ? "alert" : "status"}>
      {text}
    </p>
  );
}

/** One chart: header, arrangement, play-along, practice, grid and editing. */
export function ChartWorkspace({ initialChart, source, initialArrangementId, initialSectionId, takenIds, onSavedNew, onSaved, onChartChange }: ChartWorkspaceProps): JSX.Element {
  const runtime = useStudioRuntime();
  const titleId = useId();
  const transposeId = useId();
  const loopId = useId();
  const [history, setHistory] = useState<ChartHistory>(() => createHistory(initialChart));
  const historyRef = useRef<ChartHistory>(history);
  historyRef.current = history;
  const [workingCopy, setWorkingCopy] = useState<boolean>(false);
  const [arrangementId, setArrangementId] = useState<string>(initialArrangementId ?? "");
  const [loopValue, setLoopValue] = useState<string>("");
  const [countIn, setCountIn] = useState<boolean>(true);
  const [metronome, setMetronome] = useState<boolean>(false);
  const [muteMine, setMuteMine] = useState<boolean>(false);
  const [editing, setEditing] = useState<boolean>(false);
  const [showNumerals, setShowNumerals] = useState<boolean>(false);
  const [selected, setSelected] = useState<SpanRef | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [transposeTo, setTransposeTo] = useState<string>("");
  const [titleDraft, setTitleDraft] = useState<string>(initialChart.title);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<SongChart | null>(null);

  const chart = history.present;
  const editable = source === "user" || workingCopy;
  const beatsPerBar = Math.max(1, Math.round((chart.timeSignature.numerator * 4) / chart.timeSignature.denominator));

  // --- persistence (user charts only; content working copies stay unsaved until "Save as mine")
  const flushSave = useCallback((): void => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const pending = pendingSave.current;
    pendingSave.current = null;
    if (!pending) return;
    const saved = runtime.stores.charts.save(pending);
    if (!saved.ok) setMessage(`Not saved: ${saved.error.message}`);
    else onSaved();
  }, [runtime, onSaved]);

  const scheduleSave = useCallback(
    (next: SongChart): void => {
      if (source !== "user") return;
      pendingSave.current = next;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => flushSave(), SAVE_DELAY_MS);
    },
    [source, flushSave]
  );

  // Save pending edits when the workspace closes — unless the chart was deleted meanwhile.
  const flushRef = useRef(flushSave);
  flushRef.current = flushSave;
  useEffect(
    () => () => {
      const pending = pendingSave.current;
      if (pending) {
        const existing = runtime.stores.charts.get(pending.id);
        if (existing.ok && existing.value === null) {
          pendingSave.current = null;
          if (saveTimer.current) clearTimeout(saveTimer.current);
          return;
        }
      }
      flushRef.current();
    },
    [runtime]
  );

  // --- editing
  const commit = useCallback(
    (next: ChartHistory): void => {
      historyRef.current = next;
      setHistory(next);
      if (source === "content") setWorkingCopy(true);
      scheduleSave(next.present);
      if (onChartChange) onChartChange(next.present);
    },
    [source, scheduleSave, onChartChange]
  );

  const edit = useCallback(
    (op: ChartEdit): string | null => {
      const outcome = applyEdit(historyRef.current, op(historyRef.current.present));
      if (outcome.error) {
        setEditError(outcome.error);
        return outcome.error;
      }
      setEditError(null);
      commit(outcome.history);
      return null;
    },
    [commit]
  );

  const doUndo = (): void => {
    const next = undo(historyRef.current);
    if (next !== historyRef.current) commit(next);
  };
  const doRedo = (): void => {
    const next = redo(historyRef.current);
    if (next !== historyRef.current) commit(next);
  };

  const transpose = (): void => {
    if (!transposeTo) return;
    const result = transposeChartToKey(historyRef.current.present, transposeTo);
    if (!result.ok) {
      setEditError(result.reason);
      return;
    }
    setEditError(null);
    commit(applyEdit(historyRef.current, result).history);
    setTransposeTo("");
    setMessage(source === "content" ? "Transposed in a working copy (modified copy). Save it as yours to keep it." : null);
  };

  const commitTitle = (): void => {
    if (titleDraft.trim() === chart.title) return;
    const error = edit((c: SongChart) => setTitle(c, titleDraft));
    if (error) setTitleDraft(chart.title);
  };

  const saveAsMine = (): void => {
    flushSave();
    const copy = copyChart(historyRef.current.present, takenIds);
    const saved = runtime.stores.charts.save(copy);
    if (!saved.ok) {
      setMessage(`Not saved: ${saved.error.message}`);
      return;
    }
    onSavedNew(copy);
  };

  // --- arrangements and compilation
  const arrangements: ArrangementDefinition[] = useMemo(() => arrangementsForChart(chart), [chart]);
  const arrangement: ArrangementDefinition = arrangements.find((candidate) => candidate.id === arrangementId) ?? arrangements[0];
  const compiled: CompileArrangementResult = useMemo(() => compileArrangement(chart, arrangement, { countInBeats: beatsPerBar }), [chart, arrangement, beatsPerBar]);
  const expanded = useMemo(() => expandChart(chart), [chart]);
  const issues: ChartIssue[] = useMemo(() => validateChart(chart), [chart]);
  const choices: SectionChoice[] = useMemo(() => (expanded.ok ? sectionChoices(expanded) : []), [expanded]);
  const summary = useMemo(() => (compiled.ok ? expectedTasksSummary(compiled.expectedTasks, arrangement) : null), [compiled, arrangement]);
  const concepts = useMemo(() => conceptsForChart(chart.id), [chart.id]);
  const timelinePrefix = `${chart.id}@${chart.version}:`;

  // Apply the requested section once the expansion is known.
  const initialSectionApplied = useRef<boolean>(false);
  useEffect(() => {
    if (initialSectionApplied.current || !initialSectionId) return;
    initialSectionApplied.current = true;
    const choice = choices.find((candidate) => candidate.sectionId === initialSectionId);
    if (choice) setLoopValue(choice.value);
  }, [choices, initialSectionId]);

  const loopRegion = (): { startBeat: number; endBeat: number } | null => {
    const parsed = parseSectionChoice(loopValue);
    if (!parsed || !expanded.ok) return null;
    const region = sectionLoopRegion(expanded, parsed.sectionId, parsed.orderIndex);
    return region ? { startBeat: region.startBeat, endBeat: region.endBeat } : null;
  };

  const isLoaded = (): boolean => {
    const timeline = runtime.transport.getTimeline();
    return timeline !== null && timeline.id.startsWith(timelinePrefix);
  };

  /** Load the compiled arrangement into the main transport with this view's settings. */
  const install = (): boolean => {
    if (!compiled.ok) {
      setMessage(compiled.reason);
      return false;
    }
    runtime.audition.stop();
    runtime.loadTimeline(compiled.timeline, {
      sourceKind: "chart",
      sourceId: chart.id,
      title: chart.title,
      sequence: compiled.sequence,
      version: chart.version,
      warnings: compiled.warnings
    });
    runtime.transport.setCountIn(countIn ? beatsPerBar : 0);
    runtime.transport.setMetronome(metronome);
    runtime.transport.setPartMuted("learner", muteMine && compiled.learnerKind !== "chartOnly");
    runtime.transport.setPartMuted("accompaniment", false);
    runtime.transport.setLoop(loopRegion());
    return true;
  };

  // Keep a loaded chart in sync with edits / arrangement changes (same source: position is kept).
  const installRef = useRef(install);
  installRef.current = install;
  const lastCompiled = useRef<CompileArrangementResult | null>(null);
  useEffect(() => {
    if (lastCompiled.current === null) {
      lastCompiled.current = compiled;
      return;
    }
    if (lastCompiled.current === compiled) return;
    lastCompiled.current = compiled;
    const material = runtime.materialStore.getState();
    if (compiled.ok && material.sourceKind === "chart" && material.sourceId === chart.id) {
      installRef.current();
    }
  }, [compiled, runtime, chart.id]);

  const play = (): void => {
    try {
      if (!install()) return;
      setMessage(null);
      const region = loopRegion();
      void runtime.transport.play(region ? region.startBeat : 0);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const seekTo = (beat: number): void => {
    if (!isLoaded() && !install()) return;
    runtime.transport.seek(beat);
  };

  const onBarClick = (bar: ExpandedBar): void => seekTo(bar.startBeat);
  const onSpanClick = (ref: SpanRef, occurrence: ChartOccurrence): void => {
    setSelected(ref);
    if (!editing) seekTo(occurrence.startBeat);
  };

  const changeLoop = (value: string): void => {
    setLoopValue(value);
    if (isLoaded()) {
      const parsed = parseSectionChoice(value);
      const region = parsed && expanded.ok ? sectionLoopRegion(expanded, parsed.sectionId, parsed.orderIndex) : null;
      runtime.transport.setLoop(region ? { startBeat: region.startBeat, endBeat: region.endBeat } : null);
    }
  };

  const toggleCountIn = (value: boolean): void => {
    setCountIn(value);
    if (isLoaded()) runtime.transport.setCountIn(value ? beatsPerBar : 0);
  };
  const toggleMetronome = (value: boolean): void => {
    setMetronome(value);
    if (isLoaded()) runtime.transport.setMetronome(value);
  };
  const toggleMute = (value: boolean): void => {
    setMuteMine(value);
    if (isLoaded()) runtime.transport.setPartMuted("learner", value);
  };

  const practise = (): void => {
    const parsed = parseSectionChoice(loopValue);
    const options: { mode: "step"; chart: SongChart; arrangement: ArrangementDefinition; sectionId?: string; countInBeats: number; metronome: boolean } = {
      mode: "step",
      chart,
      arrangement,
      countInBeats: countIn ? beatsPerBar : 0,
      metronome
    };
    if (parsed) options.sectionId = parsed.sectionId;
    setMessage(runSafely(() => openArrangementInPractice(runtime, chart.id, arrangement.id, options)));
  };

  const openInCreate = (): void => {
    if (!compiled.ok) {
      setMessage(compiled.reason);
      return;
    }
    runtime.navigate.openInCreate(compiled.sequence, chart.title);
  };

  const openConcept = (conceptId: string): void => {
    requestLearnPage({ kind: "concept", id: conceptId });
    runtime.navigate.openEntry("learn");
  };

  const chartOnly = arrangement.learnerPart.kind === "chartOnly";
  const errors = issues.filter((issue: ChartIssue) => issue.severity === "error");
  const warnings = issues.filter((issue: ChartIssue) => issue.severity === "warning");
  const loopParsed = parseSectionChoice(loopValue);

  return (
    <section className="pls-songs-ws" aria-labelledby={titleId}>
      <header className="pls-songs-ws__head">
        {editable ? (
          <div className="pls-field">
            <label className="pls-field__label" htmlFor={titleId}>
              Title
            </label>
            <input
              id={titleId}
              className="pls-input pls-songs-ws__title-input"
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={commitTitle}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitTitle();
              }}
            />
          </div>
        ) : (
          <h2 id={titleId} className="pls-songs-ws__title">
            {chart.title}
          </h2>
        )}
        <div className="pls-learn-badges">
          <span className="pls-badge">{source === "content" ? "Bundled" : chart.provenance.origin === "userImport" ? "Local import" : "My copy"}</span>
          {chart.provenance.origin === "original" ? <span className="pls-badge">original</span> : null}
          {workingCopy ? <span className="pls-badge pls-learn-badge--draft">modified copy — not saved</span> : null}
          <span className="pls-badge">{chart.key ? formatKey(chart.key) : "no key"}</span>
          <span className="pls-badge">
            {chart.timeSignature.numerator}/{chart.timeSignature.denominator}
          </span>
          <span className="pls-badge">{chart.tempo.bpm} BPM</span>
        </div>
        {chart.provenance.note ? <p className="pls-learn-muted">{chart.provenance.note}</p> : null}
        <div className="pls-learn-actions">
          {chart.key ? (
            <>
              <label className="pls-field__label" htmlFor={transposeId}>
                Transpose to
              </label>
              <select id={transposeId} className="pls-select" value={transposeTo} onChange={(event) => setTransposeTo(event.target.value)}>
                <option value="">Key…</option>
                {TRANSPOSE_TONICS.map((tonic: string) => (
                  <option key={tonic} value={tonic}>
                    {tonic.replace("b", "♭").replace("#", "♯")}
                  </option>
                ))}
              </select>
              <button type="button" className="pls-btn pls-btn--small" disabled={!transposeTo} onClick={transpose}>
                Transpose
              </button>
            </>
          ) : null}
          {source === "content" && !workingCopy ? (
            <button type="button" className="pls-btn pls-btn--small" onClick={() => setWorkingCopy(true)}>
              <Pencil size={14} aria-hidden="true" /> Edit a working copy
            </button>
          ) : null}
          {source === "content" && workingCopy ? (
            <button type="button" className="pls-btn pls-btn--small pls-btn--primary" onClick={saveAsMine}>
              <Save size={14} aria-hidden="true" /> Save as mine
            </button>
          ) : null}
          {editable ? (
            <button type="button" className={clsx("pls-btn", "pls-btn--small", editing && "pls-toggle--on")} aria-pressed={editing} onClick={() => setEditing((value: boolean) => !value)}>
              <Pencil size={14} aria-hidden="true" /> {editing ? "Editing" : "Edit chords"}
            </button>
          ) : null}
          {editable ? (
            <>
              <button type="button" className="pls-btn pls-btn--small pls-btn--icon" disabled={!canUndo(history)} onClick={doUndo} aria-label="Undo">
                <Undo2 size={14} aria-hidden="true" />
              </button>
              <button type="button" className="pls-btn pls-btn--small pls-btn--icon" disabled={!canRedo(history)} onClick={doRedo} aria-label="Redo">
                <Redo2 size={14} aria-hidden="true" />
              </button>
            </>
          ) : null}
          {source === "user" ? (
            <button type="button" className="pls-btn pls-btn--small pls-btn--ghost" onClick={saveAsMine}>
              <Copy size={14} aria-hidden="true" /> Save a copy
            </button>
          ) : null}
        </div>
      </header>

      <div className="pls-songs-ws__grid">
        <fieldset className="pls-songs-arr">
          <legend className="pls-songs-ws__label">Arrangement</legend>
          {arrangements.map((candidate: ArrangementDefinition) => (
            <label key={candidate.id} className={clsx("pls-songs-arr__option", candidate.id === arrangement.id && "pls-songs-arr__option--active")}>
              <input type="radio" name={`${titleId}-arr`} checked={candidate.id === arrangement.id} onChange={() => setArrangementId(candidate.id)} />
              <span className="pls-songs-arr__body">
                <span className="pls-songs-arr__name">{candidate.name}</span>
                <span className="pls-songs-arr__meta">
                  {DEMAND_LABELS[candidate.demand]} · {policyLabel(candidate.policy)}
                </span>
              </span>
            </label>
          ))}
          <p className="pls-learn-muted">{arrangement.description}</p>
          <p className="pls-songs-note">
            <strong>{policyLabel(arrangement.policy)}:</strong> {policyExplanation(arrangement.policy)} You play {learnerPartLabel(arrangement)}; the accompaniment plays {accompanimentLabel(arrangement.accompaniment.pattern)}.
          </p>
          {summary ? (
            <div className="pls-songs-tasks" aria-live="polite">
              <p className="pls-songs-tasks__headline">{summary.headline}</p>
              <ul className="pls-learn-list">
                {summary.details.map((line: string) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {!compiled.ok ? <Message text={compiled.reason} tone="error" /> : null}
        </fieldset>

        <div className="pls-songs-play">
          <p className="pls-songs-ws__label">Play along</p>
          <div className="pls-field">
            <label className="pls-field__label" htmlFor={loopId}>
              Loop
            </label>
            <select id={loopId} className="pls-select" value={loopValue} onChange={(event) => changeLoop(event.target.value)}>
              <option value="">Whole song (no loop)</option>
              {choices.map((choice: SectionChoice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </div>
          <label className="pls-check">
            <input type="checkbox" checked={countIn} onChange={(event) => toggleCountIn(event.target.checked)} />
            Count-in ({beatsPerBar} beats)
          </label>
          <label className="pls-check">
            <input type="checkbox" checked={metronome} onChange={(event) => toggleMetronome(event.target.checked)} />
            Metronome
          </label>
          <label className={clsx("pls-check", chartOnly && "pls-songs-disabled")}>
            <input type="checkbox" checked={muteMine && !chartOnly} disabled={chartOnly} onChange={(event) => toggleMute(event.target.checked)} />
            Mute my part {chartOnly ? "(chart only has no part to mute)" : ""}
          </label>
          <div className="pls-learn-actions">
            <button type="button" className="pls-btn pls-btn--primary" onClick={play} disabled={!compiled.ok}>
              <Play size={16} aria-hidden="true" /> Play with accompaniment
            </button>
            <button type="button" className="pls-btn" onClick={() => runtime.transport.stop()}>
              <Square size={16} aria-hidden="true" /> Stop
            </button>
          </div>
          <div className="pls-learn-actions">
            <button type="button" className="pls-btn pls-btn--small" onClick={practise} disabled={!compiled.ok}>
              <Play size={14} aria-hidden="true" /> {loopParsed ? "Practise this section" : "Practise the whole song"}
            </button>
            <button type="button" className="pls-btn pls-btn--small" onClick={openInCreate} disabled={!compiled.ok}>
              <Send size={14} aria-hidden="true" /> Open in Create
            </button>
          </div>
          {concepts.length > 0 ? (
            <p className="pls-learn-inline-links">
              <span className="pls-learn-muted">Learn:</span>{" "}
              {concepts.map((concept) => (
                <button key={concept.id} type="button" className="pls-link-button" onClick={() => openConcept(concept.id)}>
                  <BookOpen size={12} aria-hidden="true" /> {concept.title}
                </button>
              ))}
            </p>
          ) : null}
          <Message text={message} />
        </div>
      </div>

      <div className="pls-songs-ws__gridhead">
        <p className="pls-songs-ws__label">Chart</p>
        <label className="pls-check">
          <input type="checkbox" checked={showNumerals} onChange={(event) => setShowNumerals(event.target.checked)} />
          Show Roman numerals (optional analysis)
        </label>
        <span className="pls-learn-muted">{editing ? "Click a chord to edit it." : "Click a chord to play from there and inspect it."}</span>
      </div>
      {expanded.ok ? (
        <ChartGrid
          expansion={expanded}
          timelinePrefix={timelinePrefix}
          editing={editing && editable}
          showNumerals={showNumerals}
          selected={selected}
          onSpanClick={onSpanClick}
          onBarClick={onBarClick}
        />
      ) : (
        <Message text={expanded.reason} tone="error" />
      )}

      {selected ? (
        <SpanEditor
          key={`${selected.barId}:${selected.spanId}:${chart.version}`}
          chart={chart}
          selected={selected}
          editing={editing && editable}
          onEdit={edit}
          onInspect={(symbol: string) => runtime.navigate.openInExplore(symbol)}
          onClose={() => setSelected(null)}
        />
      ) : null}
      <Message text={editError} tone="error" />
      {errors.length > 0 || warnings.length > 0 ? (
        <ul className="pls-learn-list pls-songs-issues" aria-label="Chart diagnostics">
          {errors.map((issue: ChartIssue, index: number) => (
            <li key={`e-${index}`} className="pls-error-text">
              {issue.message}
            </li>
          ))}
          {warnings.map((issue: ChartIssue, index: number) => (
            <li key={`w-${index}`} className="pls-learn-muted">
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}

      {editing && editable ? <StructureEditor key={chart.version} chart={chart} onEdit={edit} /> : null}
      {chart.key && source === "content" && !workingCopy ? (
        <p className="pls-learn-muted">
          Bundled charts are read-only; transposing or editing makes a working copy in {formatPitchClass(chart.key.tonic, { unicode: true })} or any key, which you can save as your own.
        </p>
      ) : null}
    </section>
  );
}
