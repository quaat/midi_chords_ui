"use client";

import clsx from "clsx";
import type { MusicalSequence } from "@/model/contracts";
import { formatPositionLabel } from "@/ui/runtime/runtimeHelpers";
import { recipeName } from "@/ui/runtime/voicingBridge";

export interface EventListProps {
  sequence: MusicalSequence;
  selectedEventId: string | null;
  currentEventId: string | null;
  onSelect: (eventId: string) => void;
}

/** Tabular view of the progression (start, length, voicing) — keyboard/screen-reader friendly. */
export function EventList({ sequence, selectedEventId, currentEventId, onSelect }: EventListProps): JSX.Element {
  return (
    <table className="pls-event-list">
      <caption className="pls-sr-only">Chord events</caption>
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">Chord</th>
          <th scope="col">Starts</th>
          <th scope="col">Beats</th>
          <th scope="col">Voicing</th>
        </tr>
      </thead>
      <tbody>
        {sequence.events.map((event) => (
          <tr
            key={event.id}
            className={clsx(event.id === selectedEventId && "pls-event-list__row--selected", event.id === currentEventId && "pls-event-list__row--current")}
            aria-selected={event.id === selectedEventId}
          >
            <td>{event.index + 1}</td>
            <td>
              <button type="button" className="pls-link-button" onClick={() => onSelect(event.id)}>
                {event.symbol}
              </button>
            </td>
            <td>{formatPositionLabel(event.startBeat, sequence.timeSignature)}</td>
            <td>{event.durationBeats}</td>
            <td>{event.kind === "rest" ? "—" : event.voicingRecipeId ? recipeName(event.voicingRecipeId) : sequence.defaultVoicingRecipeId ? `${recipeName(sequence.defaultVoicingRecipeId)} (all)` : "Classic close"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
