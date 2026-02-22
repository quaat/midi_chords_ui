"use client";

import type { ResolvedEvent } from "@/types";

interface EventPreviewTableProps {
  events: ResolvedEvent[];
  activeEventIndex: number | null;
  selectedEventIndex: number | null;
  onSelectEvent: (index: number) => void;
}

export function EventPreviewTable({
  events,
  activeEventIndex,
  selectedEventIndex,
  onSelectEvent
}: EventPreviewTableProps): JSX.Element {
  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Parsed Events</h2>
        <span className="panel-subtitle">Resolved tones, measure lengths, and runtime.</span>
      </header>
      <div className="table-shell">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Symbol</th>
              <th>Tones</th>
              <th>Measures</th>
              <th>Seconds</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => {
              const isActive = activeEventIndex === event.index;
              const isSelected = selectedEventIndex === event.index;
              const rowClass = isActive ? "active" : isSelected ? "selected" : "";

              return (
                <tr key={`${event.line}-${event.index}`} className={rowClass} onClick={() => onSelectEvent(event.index)}>
                  <td>{event.index + 1}</td>
                  <td>{event.chordSymbol}</td>
                  <td>{event.isRest ? "Rest" : event.noteNames.join(" ")}</td>
                  <td>{event.durationMeasures}</td>
                  <td>{event.durationSeconds.toFixed(2)}</td>
                </tr>
              );
            })}
            {events.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty-cell">
                  No playable events yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
