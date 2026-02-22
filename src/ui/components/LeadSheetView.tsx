"use client";

import type { ResolvedEvent } from "@/types";

interface MeasureSlot {
  symbol: string;
  fraction: number;
}

function splitMeasures(events: ResolvedEvent[]): MeasureSlot[][] {
  const measures: MeasureSlot[][] = [];
  let cursor = 0;

  const ensureMeasure = (index: number): void => {
    while (measures.length <= index) {
      measures.push([]);
    }
  };

  events.forEach((event) => {
    let remaining = event.durationMeasures;
    while (remaining > 0) {
      const measureIndex = Math.floor(cursor);
      const within = cursor - measureIndex;
      const available = 1 - within;
      const used = Math.min(remaining, available);

      ensureMeasure(measureIndex);
      measures[measureIndex].push({
        symbol: event.chordSymbol,
        fraction: used
      });

      remaining -= used;
      cursor += used;
    }
  });

  return measures;
}

export function LeadSheetView({ events }: { events: ResolvedEvent[] }): JSX.Element {
  const measures = splitMeasures(events);

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Lead Sheet</h2>
        <span className="panel-subtitle">MVP chord-chart rendering (measure boxes + symbols).</span>
      </header>
      <div className="lead-grid" role="img" aria-label="Lead sheet chord grid">
        {measures.length === 0 ? <div className="empty-sheet">Add chords to render the lead sheet.</div> : null}
        {measures.map((measure, idx) => (
          <div key={`measure-${idx}`} className="measure-box">
            <div className="measure-number">{idx + 1}</div>
            <div className="measure-content">
              {measure.map((slot, slotIdx) => (
                <span key={`slot-${idx}-${slotIdx}`} style={{ flexGrow: Math.max(1, slot.fraction * 8) }}>
                  {slot.symbol}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
