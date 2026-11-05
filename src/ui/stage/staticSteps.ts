/** Pure conversion from timeline steps to the plain-DOM static step view model. */
import type { Hand, TimeSignatureSpec } from "@/model/contracts";
import type { SpellingPreference } from "@/ui/piano/pianoLabels";
import { midiToNoteName, prettyDegree, spelledToName } from "@/ui/piano/pianoLabels";
import { formatBarBeat } from "@/ui/stage/positionFormat";
import type { StepInfo } from "@/ui/stage/stageMath";

export interface StaticStepNote {
  midi: number;
  name: string;
  degree?: string;
  hand?: Hand;
}

export interface StaticStep {
  id: string;
  symbol: string;
  notes: StaticStepNote[];
  positionLabel?: string;
  /** Sounding now (vs. upcoming). */
  sounding?: boolean;
}

export function toStaticSteps(steps: readonly StepInfo[], timeSignature?: TimeSignatureSpec, spelling: SpellingPreference = "sharp"): StaticStep[] {
  return steps.map((step) => ({
    id: step.occurrence.occurrenceId,
    symbol: step.occurrence.symbol,
    sounding: step.sounding,
    positionLabel: formatBarBeat(step.occurrence.startBeat, timeSignature),
    notes: step.notes.map((note) => ({
      midi: note.midi,
      name: note.spelled ? spelledToName(note.spelled, { withOctave: true }) : midiToNoteName(note.midi, { preference: spelling, withOctave: true }),
      degree: note.degree ? prettyDegree(note.degree) : undefined,
      hand: note.hand
    }))
  }));
}
