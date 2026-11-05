"use client";

import { useEffect, useMemo, useRef } from "react";
import clsx from "clsx";
import { chartCursor } from "@/charts/expand";
import type { ChartExpansion, ChartOccurrence, ExpandedBar } from "@/charts/expand";
import { useStudioRuntime } from "@/ui/runtime/useStudioRuntime";
import { cursorLabel, gridRows } from "@/ui/songs/songsLogic";
import type { GridRow } from "@/ui/songs/songsLogic";

export interface SpanRef {
  barId: string;
  spanId: string;
}

export interface ChartGridProps {
  expansion: ChartExpansion;
  /** Timelines compiled from this chart version start with this id prefix (`<chartId>@<version>:`). */
  timelinePrefix: string;
  editing: boolean;
  showNumerals: boolean;
  selected: SpanRef | null;
  onSpanClick: (ref: SpanRef, occurrence: ChartOccurrence) => void;
  onBarClick: (bar: ExpandedBar) => void;
}

const ACTIVE_CLASS = "pls-cgrid__bar--active";

/**
 * Bar grid in performance order. Repeated section passes are separate rows ("pass 2"); spans
 * are sized by duration. The active bar/beat cursor follows the transport through a rAF poll
 * written straight to the DOM (no React state per frame).
 */
export function ChartGrid({ expansion, timelinePrefix, editing, showNumerals, selected, onSpanClick, onBarClick }: ChartGridProps): JSX.Element {
  const runtime = useStudioRuntime();
  const rows: GridRow[] = useMemo(() => gridRows(expansion), [expansion]);
  const occurrenceById = useMemo(() => {
    const map = new Map<string, ChartOccurrence>();
    expansion.occurrences.forEach((occurrence: ChartOccurrence) => map.set(occurrence.occurrenceId, occurrence));
    return map;
  }, [expansion]);
  const barRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const labelRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      return undefined;
    }
    let frame = 0;
    let lastBar = -2;
    let lastText = "";
    let lastFraction = -1;
    const elements = barRefs.current;
    const tick = (): void => {
      const snapshot = runtime.getTransportSnapshot();
      const mine = snapshot.timelineId !== null && snapshot.timelineId.startsWith(timelinePrefix);
      let barIndex = -1;
      let fraction = 0;
      let text = "Not loaded — press Play";
      if (mine) {
        const cursor = chartCursor(expansion, snapshot.positionBeats);
        text = cursorLabel(cursor, expansion);
        if (cursor.state === "playing") {
          barIndex = cursor.barIndex;
          const bar = expansion.bars[barIndex];
          fraction = bar && bar.beats > 0 ? Math.min(1, Math.max(0, cursor.beatInBar / bar.beats)) : 0;
        }
        if (snapshot.state === "stopped") text = `Stopped · ${text}`;
      }
      if (barIndex !== lastBar) {
        const previous = elements.get(lastBar);
        if (previous) {
          previous.classList.remove(ACTIVE_CLASS);
          previous.removeAttribute("aria-current");
        }
        const next = elements.get(barIndex);
        if (next) {
          next.classList.add(ACTIVE_CLASS);
          next.setAttribute("aria-current", "true");
        }
        lastBar = barIndex;
        lastFraction = -1;
      }
      const active = elements.get(barIndex);
      const rounded = Math.round(fraction * 100) / 100;
      if (active && rounded !== lastFraction) {
        active.style.setProperty("--pls-cgrid-progress", String(rounded));
        lastFraction = rounded;
      }
      if (text !== lastText && labelRef.current) {
        labelRef.current.textContent = text;
        lastText = text;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
      const previous = elements.get(lastBar);
      if (previous) {
        previous.classList.remove(ACTIVE_CLASS);
        previous.removeAttribute("aria-current");
      }
    };
  }, [runtime, expansion, timelinePrefix]);

  return (
    <div className="pls-cgrid">
      <p className="pls-cgrid__cursor">
        <span className="pls-learn-muted">Position: </span>
        <span ref={labelRef}>Not loaded — press Play</span>
      </p>
      {rows.map((row: GridRow) => (
        <div key={row.key} className="pls-cgrid__row">
          <div className="pls-cgrid__rowhead">
            <span className="pls-cgrid__section">{row.label}</span>
            {row.pass > 1 ? <span className="pls-cgrid__pass">pass {row.pass}</span> : null}
          </div>
          <div className="pls-cgrid__bars">
            {row.bars.map((bar: ExpandedBar) => (
              <div
                key={bar.barIndex}
                ref={(element: HTMLDivElement | null) => {
                  if (element) barRefs.current.set(bar.barIndex, element);
                  else barRefs.current.delete(bar.barIndex);
                }}
                className={clsx("pls-cgrid__bar", bar.isPickup && "pls-cgrid__bar--pickup")}
                style={{ flexGrow: bar.beats }}
              >
                <button
                  type="button"
                  className="pls-cgrid__barno"
                  onClick={() => onBarClick(bar)}
                  title={`Play from bar ${bar.barIndex + 1}`}
                  aria-label={`Go to bar ${bar.barIndex + 1}${bar.isPickup ? " (pickup)" : ""}`}
                >
                  {bar.barIndex + 1}
                  {bar.isPickup ? " pickup" : ""}
                </button>
                <div className="pls-cgrid__spans">
                  {bar.occurrenceIds.map((id: string) => {
                    const occurrence = occurrenceById.get(id);
                    if (!occurrence) return null;
                    const isSelected = selected !== null && selected.barId === occurrence.sourceBarId && selected.spanId === occurrence.spanId;
                    return (
                      <button
                        key={id}
                        type="button"
                        className={clsx("pls-cgrid__span", occurrence.isRest && "pls-cgrid__span--rest", isSelected && "pls-cgrid__span--selected", editing && "pls-cgrid__span--editing")}
                        style={{ flexGrow: occurrence.durationBeats }}
                        aria-pressed={isSelected}
                        onClick={() => onSpanClick({ barId: occurrence.sourceBarId, spanId: occurrence.spanId }, occurrence)}
                        title={`${occurrence.isRest ? "Rest" : occurrence.symbol} · ${occurrence.durationBeats} beat${occurrence.durationBeats === 1 ? "" : "s"}${editing ? " · edit" : " · play from here"}`}
                      >
                        <span className="pls-cgrid__symbol">{occurrence.isRest ? "NC" : occurrence.symbol}</span>
                        {showNumerals && occurrence.romanNumeral ? <span className="pls-cgrid__numeral">{occurrence.romanNumeral}</span> : null}
                      </button>
                    );
                  })}
                </div>
                <span className="pls-cgrid__progress" aria-hidden="true" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
