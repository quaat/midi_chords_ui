"use client";

import { useEffect, useState } from "react";
import type { PerformanceTimeline, TransportSnapshot } from "@/model/contracts";
import { occurrenceIndexAt, sortedOccurrences } from "@/ui/stage/stageMath";

export interface CurrentStepState {
  /** Index into the timeline's occurrences (sorted by start); -1 when none. */
  index: number;
  /** Whether the position is inside that occurrence (false = upcoming / count-in / gap). */
  sounding: boolean;
}

/**
 * Polls the transport snapshot each animation frame but only updates React state when the
 * current occurrence changes — so React re-renders once per chord, never per frame.
 */
export function useCurrentStep(
  timeline: PerformanceTimeline | null,
  getSnapshot: (() => TransportSnapshot) | null | undefined,
  enabled: boolean = true
): CurrentStepState {
  const [state, setState] = useState<CurrentStepState>({ index: -1, sounding: false });

  useEffect(() => {
    if (!enabled || !getSnapshot || typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      setState((prev) => (prev.index === -1 && !prev.sounding ? prev : { index: -1, sounding: false }));
      return undefined;
    }
    let frame = 0;
    let cancelled = false;
    const tick = (): void => {
      if (cancelled) {
        return;
      }
      const snapshot = getSnapshot();
      const index = occurrenceIndexAt(timeline, snapshot.positionBeats);
      const occ = timeline && index >= 0 ? sortedOccurrences(timeline)[index] : undefined;
      const sounding = !!occ && snapshot.positionBeats >= occ.startBeat && snapshot.positionBeats < occ.startBeat + occ.durationBeats;
      setState((prev) => (prev.index === index && prev.sounding === sounding ? prev : { index, sounding }));
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [timeline, getSnapshot, enabled]);

  return state;
}
