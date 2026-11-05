/**
 * Map an attempt's NextAction (src/practice/feedback.ts `chooseNextAction`) to one concrete UI
 * action the review panel can run. Pure.
 */
import type { AssistanceLevel, NextAction, SpelledPitchClass } from "@/model/contracts";
import { reducedAssistance } from "@/ui/practice/assistance";

export type ReviewUiAction =
  | { type: "retryTimed"; label: string; tempoBpm: number }
  | { type: "loop"; label: string; startBeat: number; endBeat: number; occurrenceIds: string[] }
  | { type: "restartAssisted"; label: string; assistance: AssistanceLevel }
  | { type: "transpose"; label: string; tonic: SpelledPitchClass }
  | { type: "reviewConcept"; label: string; conceptId: string | null }
  | { type: "routineNext"; label: string }
  | { type: "again"; label: string };

export interface ReviewActionContext {
  assistance: AssistanceLevel;
  currentTempoBpm: number;
  routineActive: boolean;
  /** False when the material cannot be recompiled in another key (Explore payloads, charts). */
  canTranspose: boolean;
}

function numberFrom(payload: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = payload ? payload[key] : undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function tonicFrom(payload: Record<string, unknown> | undefined): SpelledPitchClass | null {
  const value = payload ? payload["tonic"] : undefined;
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as { letter?: unknown; accidental?: unknown };
  if (typeof candidate.letter !== "string" || typeof candidate.accidental !== "number") {
    return null;
  }
  if (!["C", "D", "E", "F", "G", "A", "B"].includes(candidate.letter)) {
    return null;
  }
  return { letter: candidate.letter as SpelledPitchClass["letter"], accidental: candidate.accidental as SpelledPitchClass["accidental"] };
}

function afterRoutine(context: ReviewActionContext): ReviewUiAction {
  return context.routineActive ? { type: "routineNext", label: "Continue to the next routine item" } : { type: "again", label: "Practise it again" };
}

export function reviewActionFor(action: NextAction | undefined, context: ReviewActionContext): ReviewUiAction {
  if (!action) {
    return afterRoutine(context);
  }
  const payload = action.payload;
  switch (action.kind) {
    case "retrySlower": {
      const tempo = numberFrom(payload, "tempoBpm") ?? Math.max(20, Math.round(context.currentTempoBpm * 0.8));
      return { type: "retryTimed", label: action.label, tempoBpm: tempo };
    }
    case "loopTransition": {
      const startBeat = numberFrom(payload, "startBeat");
      const endBeat = numberFrom(payload, "endBeat");
      if (startBeat === undefined || endBeat === undefined || endBeat <= startBeat) {
        return { type: "again", label: "Practise it again" };
      }
      const raw = payload ? payload["occurrenceIds"] : undefined;
      const occurrenceIds = Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
      return { type: "loop", label: action.label, startBeat, endBeat, occurrenceIds };
    }
    case "reduceHints": {
      const next = reducedAssistance(context.assistance);
      return { type: "restartAssisted", label: next === context.assistance ? "Try it again without hints" : action.label, assistance: next };
    }
    case "transpose": {
      const tonic = tonicFrom(payload);
      if (!tonic || !context.canTranspose) {
        return afterRoutine(context);
      }
      return { type: "transpose", label: action.label, tonic };
    }
    case "reviewConcept": {
      const conceptId = payload && typeof payload["conceptId"] === "string" ? (payload["conceptId"] as string) : null;
      return { type: "reviewConcept", label: action.label, conceptId };
    }
    case "continue":
    default:
      return afterRoutine(context);
  }
}
