"use client";

import type { ResolvedEvent } from "@/types";

interface TimelineViewProps {
  events: ResolvedEvent[];
  activeEventIndex: number | null;
  selectedEventIndex: number | null;
  onSelectEvent: (index: number) => void;
  progressSeconds: number;
  totalSeconds: number;
}

export function TimelineView({
  events,
  activeEventIndex,
  selectedEventIndex,
  onSelectEvent,
  progressSeconds,
  totalSeconds
}: TimelineViewProps): JSX.Element {
  const playheadPct = totalSeconds > 0 ? Math.min(100, (progressSeconds / totalSeconds) * 100) : 0;

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Timeline</h2>
        <span className="panel-subtitle">Chord blocks aligned to durations.</span>
      </header>
      <div className="timeline-shell">
        <div className="timeline-track">
          {events.map((event) => {
            const className =
              activeEventIndex === event.index
                ? "timeline-block active"
                : selectedEventIndex === event.index
                  ? "timeline-block selected"
                  : "timeline-block";
            return (
              <button
                key={`timeline-${event.index}`}
                className={className}
                style={{ flexGrow: Math.max(1, event.durationMeasures * 10) }}
                onClick={() => onSelectEvent(event.index)}
                title={`${event.chordSymbol} (${event.durationMeasures} measures)`}
              >
                {event.chordSymbol}
              </button>
            );
          })}
          <div className="timeline-playhead" style={{ left: `${playheadPct}%` }} aria-hidden />
        </div>
      </div>
    </section>
  );
}
