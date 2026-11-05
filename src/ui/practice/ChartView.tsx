"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import type { PerformanceTimeline, TransportSnapshot } from "@/model/contracts";
import type { ChartExpansion } from "@/charts/expand";
import type { ChartBarView } from "@/ui/practice/chartModel";
import { barIndexAt, chartBarsFromExpansion, chartBarsFromTimeline } from "@/ui/practice/chartModel";

export interface ChartViewProps {
  timeline: PerformanceTimeline | null;
  expansion?: ChartExpansion | null;
  title?: string;
  /** Polled per animation frame; React state changes only when the bar or beat changes. */
  getSnapshot: () => TransportSnapshot;
  className?: string;
}

interface Cursor {
  bar: number;
  beat: number;
}

function useChartCursor(bars: readonly ChartBarView[], getSnapshot: () => TransportSnapshot): Cursor {
  const [cursor, setCursor] = useState<Cursor>({ bar: -1, beat: -1 });
  const barsRef = useRef(bars);
  barsRef.current = bars;
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      return undefined;
    }
    let frame = 0;
    let cancelled = false;
    let lastBar = -2;
    let lastBeat = -2;
    const tick = (): void => {
      if (cancelled) {
        return;
      }
      const snapshot = getSnapshot();
      const list = barsRef.current;
      const bar = barIndexAt(list, snapshot.positionBeats);
      const beat = bar >= 0 ? Math.floor(snapshot.positionBeats - list[bar].startBeat + 1e-6) : -1;
      if (bar !== lastBar || beat !== lastBeat) {
        lastBar = bar;
        lastBeat = beat;
        setCursor({ bar, beat });
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [getSnapshot]);
  return cursor;
}

/** Bar-based chord chart with a bar/beat cursor (plan "Practice views": chart-only playing). */
export function ChartView({ timeline, expansion, title, getSnapshot, className }: ChartViewProps): JSX.Element {
  const bars = useMemo<ChartBarView[]>(() => {
    if (expansion) {
      return chartBarsFromExpansion(expansion);
    }
    return timeline ? chartBarsFromTimeline(timeline) : [];
  }, [expansion, timeline]);
  const cursor = useChartCursor(bars, getSnapshot);

  if (bars.length === 0) {
    return <p className="pls-practice-empty">No chart to show yet: open a song, an exercise, or a progression.</p>;
  }
  const current = cursor.bar >= 0 ? bars[cursor.bar] : null;
  return (
    <section className={clsx("pls-chartview", className)} aria-label={title ? `Chord chart: ${title}` : "Chord chart"}>
      <p className="pls-sr-only" aria-live="polite">
        {current ? `Bar ${current.index + 1}` : ""}
      </p>
      <ol className="pls-chartview__grid">
        {bars.map((bar, index) => {
          const active = index === cursor.bar;
          return (
            <li key={`${bar.index}-${bar.startBeat}`} className={clsx("pls-chartview__bar", active && "pls-chartview__bar--current", bar.isPickup && "pls-chartview__bar--pickup")} aria-current={active ? "true" : undefined}>
              {bar.sectionLabel ? <span className="pls-chartview__section">{bar.sectionLabel}</span> : null}
              <span className="pls-chartview__barno">{bar.isPickup ? "pickup" : bar.index + 1}</span>
              <div className="pls-chartview__cells">
                {bar.cells.length === 0 ? <span className="pls-chartview__symbol pls-chartview__symbol--empty">·</span> : null}
                {bar.cells.map((cell, cellIndex) => (
                  <span
                    key={`${cell.occurrenceId ?? "x"}-${cellIndex}`}
                    className={clsx("pls-chartview__symbol", cell.continuation && "pls-chartview__symbol--held")}
                    title={cell.continuation ? `${cell.symbol} continues` : `${cell.symbol}, ${cell.beats} beat${cell.beats === 1 ? "" : "s"}`}
                  >
                    {cell.continuation ? "%" : cell.symbol}
                  </span>
                ))}
              </div>
              <span className="pls-chartview__beats" aria-hidden="true">
                {Array.from({ length: Math.max(1, Math.round(bar.beats)) }, (_, beat) => (
                  <span key={beat} className={clsx("pls-chartview__beat", active && beat === cursor.beat && "pls-chartview__beat--on")} />
                ))}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
