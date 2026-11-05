"use client";

import { useId, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Scissors, Search, Trash2 } from "lucide-react";
import type { ChartBar, ChartSection, ChordSpan, SongChart } from "@/model/contracts";
import {
  addBar,
  addSection,
  checkSpanSymbol,
  mergeSpans,
  removeBar,
  removeSection,
  renameSection,
  setMeter,
  setPerformanceOrder,
  setSectionRepeat,
  setSpanSymbol,
  setTempo,
  splitSpan
} from "@/charts/editor";
import type { ChartEditResult } from "@/charts/editor";
import type { SpanRef } from "@/ui/songs/ChartGrid";

export type ChartEdit = (chart: SongChart) => ChartEditResult;

function findSpan(chart: SongChart, ref: SpanRef): { section: ChartSection; bar: ChartBar; span: ChordSpan; barNumber: number } | null {
  for (const section of chart.sections) {
    const index = section.bars.findIndex((bar: ChartBar) => bar.id === ref.barId);
    if (index >= 0) {
      const bar = section.bars[index];
      const span = bar.spans.find((candidate: ChordSpan) => candidate.id === ref.spanId);
      return span ? { section, bar, span, barNumber: index + 1 } : null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Selected span: inspect (always) and edit (editable charts in edit mode)
// ---------------------------------------------------------------------------

export interface SpanEditorProps {
  chart: SongChart;
  selected: SpanRef;
  editing: boolean;
  onEdit: (edit: ChartEdit) => string | null;
  onInspect: (symbol: string) => void;
  onClose: () => void;
}

export function SpanEditor({ chart, selected, editing, onEdit, onInspect, onClose }: SpanEditorProps): JSX.Element | null {
  const found = findSpan(chart, selected);
  const inputId = useId();
  const [draft, setDraft] = useState<string>(found ? found.span.symbol : "");
  if (!found) return null;
  const { section, bar, span, barNumber } = found;
  const check = checkSpanSymbol(draft);
  const changed = draft.trim() !== span.symbol;
  const sorted = [...bar.spans].sort((a: ChordSpan, b: ChordSpan) => a.startBeat - b.startBeat);
  const isLast = sorted[sorted.length - 1] === span;

  const apply = (): void => {
    if (!changed) return;
    onEdit((c: SongChart) => setSpanSymbol(c, bar.id, span.id, draft));
  };

  return (
    <div className="pls-songs-span" role="group" aria-label={`Bar ${barNumber} of section ${section.label}`}>
      <p className="pls-songs-span__title">
        Section {section.label}, bar {barNumber}: <strong>{span.isRest ? "rest (NC)" : span.symbol}</strong>
        <span className="pls-learn-muted">
          {" "}
          · beat {span.startBeat + 1}, {span.durationBeats} beat{span.durationBeats === 1 ? "" : "s"}
          {span.romanNumeral ? ` · ${span.romanNumeral}` : ""}
        </span>
      </p>
      <div className="pls-learn-actions">
        {!span.isRest ? (
          <button type="button" className="pls-btn pls-btn--small" onClick={() => onInspect(span.symbol)}>
            <Search size={14} aria-hidden="true" /> Inspect chord
          </button>
        ) : null}
        <button type="button" className="pls-btn pls-btn--small pls-btn--ghost" onClick={onClose}>
          Close
        </button>
      </div>
      {editing ? (
        <>
          <div className="pls-songs-span__edit">
            <div className="pls-field">
              <label className="pls-field__label" htmlFor={inputId}>
                Chord symbol (NC for a rest)
              </label>
              <input
                id={inputId}
                className={`pls-input pls-input--symbol${check.ok ? "" : " pls-input--invalid"}`}
                value={draft}
                aria-invalid={!check.ok}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") apply();
                }}
              />
            </div>
            <button type="button" className="pls-btn pls-btn--small pls-btn--primary" disabled={!check.ok || !changed} onClick={apply}>
              Apply
            </button>
          </div>
          {!check.ok ? <p className="pls-error-text">{check.reason}</p> : null}
          <div className="pls-learn-actions">
            <button type="button" className="pls-btn pls-btn--small" onClick={() => onEdit((c: SongChart) => splitSpan(c, bar.id, span.id))}>
              <Scissors size={14} aria-hidden="true" /> Split
            </button>
            <button type="button" className="pls-btn pls-btn--small" disabled={isLast} onClick={() => onEdit((c: SongChart) => mergeSpans(c, bar.id, span.id))}>
              Merge with next
            </button>
            <button type="button" className="pls-btn pls-btn--small" onClick={() => onEdit((c: SongChart) => addBar(c, section.id, bar.id))}>
              <Plus size={14} aria-hidden="true" /> Bar after
            </button>
            <button type="button" className="pls-btn pls-btn--small pls-btn--danger" onClick={() => onEdit((c: SongChart) => removeBar(c, bar.id))}>
              <Trash2 size={14} aria-hidden="true" /> Remove bar
            </button>
          </div>
          <p className="pls-learn-muted">Edits apply to every pass of section {section.label}.</p>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sections, performance order, meter and tempo
// ---------------------------------------------------------------------------

export interface StructureEditorProps {
  chart: SongChart;
  onEdit: (edit: ChartEdit) => string | null;
}

const NUMERATORS: readonly number[] = [2, 3, 4, 5, 6, 7, 9, 12];
const DENOMINATORS: readonly number[] = [2, 4, 8];

function SectionRow({ section, onEdit, canRemove }: { section: ChartSection; onEdit: StructureEditorProps["onEdit"]; canRemove: boolean }): JSX.Element {
  const labelId = useId();
  const repeatId = useId();
  const [label, setLabel] = useState<string>(section.label);
  const commit = (): void => {
    if (label.trim() !== section.label) {
      const error = onEdit((c: SongChart) => renameSection(c, section.id, label));
      if (error) setLabel(section.label);
    }
  };
  return (
    <li className="pls-songs-structure__section">
      <div className="pls-field">
        <label className="pls-field__label" htmlFor={labelId}>
          Section label
        </label>
        <input
          id={labelId}
          className="pls-input"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
          }}
        />
      </div>
      <span className="pls-learn-muted">
        {section.bars.length} bar{section.bars.length === 1 ? "" : "s"}
      </span>
      <div className="pls-field">
        <label className="pls-field__label" htmlFor={repeatId}>
          Plays
        </label>
        <select id={repeatId} className="pls-select" value={section.repeat ?? 1} onChange={(event) => onEdit((c: SongChart) => setSectionRepeat(c, section.id, Number(event.target.value)))}>
          {[1, 2, 3, 4].map((count: number) => (
            <option key={count} value={count}>
              {count}×
            </option>
          ))}
        </select>
      </div>
      <button type="button" className="pls-btn pls-btn--small" onClick={() => onEdit((c: SongChart) => addBar(c, section.id))}>
        <Plus size={14} aria-hidden="true" /> Bar
      </button>
      <button type="button" className="pls-btn pls-btn--small pls-btn--danger" disabled={!canRemove} onClick={() => onEdit((c: SongChart) => removeSection(c, section.id))}>
        <Trash2 size={14} aria-hidden="true" /> Remove
      </button>
    </li>
  );
}

export function StructureEditor({ chart, onEdit }: StructureEditorProps): JSX.Element {
  const newLabelId = useId();
  const newBarsId = useId();
  const addOrderId = useId();
  const numId = useId();
  const denId = useId();
  const tempoId = useId();
  const [newLabel, setNewLabel] = useState<string>("");
  const [newBars, setNewBars] = useState<number>(4);
  const [orderAdd, setOrderAdd] = useState<string>(chart.sections[0] ? chart.sections[0].id : "");
  const [tempo, setTempoDraft] = useState<string>(String(chart.tempo.bpm));
  const order = chart.performanceOrder;
  const labelOf = (id: string): string => {
    const section = chart.sections.find((candidate: ChartSection) => candidate.id === id);
    return section ? section.label : id;
  };

  const moveOrder = (index: number, delta: number): void => {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    const item = next[index];
    next[index] = next[target];
    next[target] = item;
    onEdit((c: SongChart) => setPerformanceOrder(c, next));
  };

  const removeOrder = (index: number): void => {
    onEdit((c: SongChart) => setPerformanceOrder(c, order.filter((_: string, i: number) => i !== index)));
  };

  const addOrder = (): void => {
    const id = chart.sections.some((section: ChartSection) => section.id === orderAdd) ? orderAdd : chart.sections[0] ? chart.sections[0].id : "";
    if (id) onEdit((c: SongChart) => setPerformanceOrder(c, [...order, id]));
  };

  const commitTempo = (): void => {
    const value = Number(tempo);
    if (value === chart.tempo.bpm) return;
    const error = onEdit((c: SongChart) => setTempo(c, value));
    if (error) setTempoDraft(String(chart.tempo.bpm));
  };

  return (
    <div className="pls-songs-structure">
      <p className="pls-songs-structure__title">Sections</p>
      <ul className="pls-songs-structure__sections">
        {chart.sections.map((section: ChartSection) => (
          <SectionRow key={`${section.id}-${section.label}`} section={section} onEdit={onEdit} canRemove={chart.sections.length > 1} />
        ))}
      </ul>
      <div className="pls-learn-controls">
        <div className="pls-field">
          <label className="pls-field__label" htmlFor={newLabelId}>
            New section label
          </label>
          <input id={newLabelId} className="pls-input" value={newLabel} placeholder="B" onChange={(event) => setNewLabel(event.target.value)} />
        </div>
        <div className="pls-field">
          <label className="pls-field__label" htmlFor={newBarsId}>
            Bars
          </label>
          <select id={newBarsId} className="pls-select" value={newBars} onChange={(event) => setNewBars(Number(event.target.value))}>
            {[1, 2, 4, 8, 12, 16].map((count: number) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="pls-btn pls-btn--small"
          onClick={() => {
            const error = onEdit((c: SongChart) => addSection(c, newLabel.trim() || `Section ${c.sections.length + 1}`, { barCount: newBars }));
            if (!error) setNewLabel("");
          }}
        >
          <Plus size={14} aria-hidden="true" /> Add section
        </button>
      </div>

      <p className="pls-songs-structure__title">Performance order</p>
      <p className="pls-learn-muted">Repeats are written out here in order; repeat signs and endings are not supported.</p>
      <ol className="pls-songs-order">
        {order.map((id: string, index: number) => (
          <li key={`${id}-${index}`} className="pls-songs-order__item">
            <span className="pls-songs-order__label">{labelOf(id)}</span>
            <button type="button" className="pls-btn pls-btn--small pls-btn--icon" disabled={index === 0} onClick={() => moveOrder(index, -1)} aria-label={`Move ${labelOf(id)} earlier`}>
              <ArrowUp size={14} aria-hidden="true" />
            </button>
            <button type="button" className="pls-btn pls-btn--small pls-btn--icon" disabled={index === order.length - 1} onClick={() => moveOrder(index, 1)} aria-label={`Move ${labelOf(id)} later`}>
              <ArrowDown size={14} aria-hidden="true" />
            </button>
            <button type="button" className="pls-btn pls-btn--small pls-btn--icon pls-btn--danger" disabled={order.length === 1} onClick={() => removeOrder(index)} aria-label={`Remove ${labelOf(id)} from the order`}>
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ol>
      <div className="pls-learn-controls">
        <div className="pls-field">
          <label className="pls-field__label" htmlFor={addOrderId}>
            Add to the order
          </label>
          <select id={addOrderId} className="pls-select" value={orderAdd} onChange={(event) => setOrderAdd(event.target.value)}>
            {chart.sections.map((section: ChartSection) => (
              <option key={section.id} value={section.id}>
                {section.label}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="pls-btn pls-btn--small" onClick={addOrder}>
          <Plus size={14} aria-hidden="true" /> Add
        </button>
      </div>

      <p className="pls-songs-structure__title">Meter and tempo</p>
      <div className="pls-learn-controls">
        <div className="pls-field">
          <label className="pls-field__label" htmlFor={numId}>
            Beats per bar
          </label>
          <select
            id={numId}
            className="pls-select"
            value={chart.timeSignature.numerator}
            onChange={(event) => onEdit((c: SongChart) => setMeter(c, { numerator: Number(event.target.value), denominator: c.timeSignature.denominator }))}
          >
            {NUMERATORS.map((value: number) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div className="pls-field">
          <label className="pls-field__label" htmlFor={denId}>
            Beat unit
          </label>
          <select
            id={denId}
            className="pls-select"
            value={chart.timeSignature.denominator}
            onChange={(event) => onEdit((c: SongChart) => setMeter(c, { numerator: c.timeSignature.numerator, denominator: Number(event.target.value) }))}
          >
            {DENOMINATORS.map((value: number) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div className="pls-field">
          <label className="pls-field__label" htmlFor={tempoId}>
            Tempo (BPM)
          </label>
          <input
            id={tempoId}
            className="pls-input pls-input--tempo"
            inputMode="numeric"
            value={tempo}
            onChange={(event) => setTempoDraft(event.target.value)}
            onBlur={commitTempo}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitTempo();
            }}
          />
        </div>
      </div>
    </div>
  );
}
