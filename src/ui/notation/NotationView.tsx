"use client";

import { useMemo } from "react";
import type { MusicalSequence } from "@/model/contracts";
import { compileTimelineWithDiagnostics } from "@/timeline/compile";
import { SheetMusicView } from "@/ui/components/SheetMusicView";
import { NOTATION_RELATIONSHIP_LABEL, notationEventsFromSequence, notationIndexOfEvent, notationSettings } from "@/ui/notation/notationAdapter";
import { voiceSequenceForPlayback } from "@/ui/runtime/voicingBridge";

export interface NotationViewProps {
  sequence: MusicalSequence;
  /** Event to mark with the score cursor (current playback event). */
  activeEventId?: string | null;
}

/** Legacy OSMD notation of the harmonic reduction (one block chord per event). */
export function NotationView({ sequence, activeEventId = null }: NotationViewProps): JSX.Element {
  const events = useMemo(() => {
    const voiced = voiceSequenceForPlayback(sequence);
    const block = compileTimelineWithDiagnostics(voiced.sequence, { arpeggiate: 0, accompaniment: "none", includeVoicingBass: false }).timeline;
    return notationEventsFromSequence(sequence, block);
  }, [sequence]);
  const settings = useMemo(() => notationSettings(sequence), [sequence]);
  const activeIndex = notationIndexOfEvent(sequence, activeEventId);
  return (
    <div className="pls-notation">
      <p className="pls-notation__label" role="note">
        {NOTATION_RELATIONSHIP_LABEL}
      </p>
      <SheetMusicView events={events} settings={settings} hasParseErrors={false} activeEventIndex={activeIndex} />
    </div>
  );
}
