/**
 * Visual assistance levels (plan §4 "Reduce visual hints over time"). Pure mapping from an
 * AssistanceLevel to what the piano, stage and step list may show:
 * - full: target keys + labels;
 * - reduced: target keys only (no labels);
 * - none: nothing on the piano (and no learner lane / note names in the stage views).
 */
import type { AssistanceLevel, ChordDefinition, PerformedNote } from "@/model/contracts";
import type { PianoTarget } from "@/ui/piano/InteractivePiano";
import type { LabelMode } from "@/ui/piano/pianoLabels";
import { midiToNoteName, prettyDegree, spelledToName } from "@/ui/piano/pianoLabels";

export const ASSISTANCE_LEVELS: { value: AssistanceLevel; label: string; description: string }[] = [
  { value: "full", label: "Full hints", description: "Target keys with labels" },
  { value: "reduced", label: "Reduced", description: "Target keys, no labels" },
  { value: "none", label: "No hints", description: "Nothing highlighted: play from the prompt" }
];

export interface AssistanceView {
  showTargets: boolean;
  showLabels: boolean;
  /** Learner notes in the falling-notes/static views. */
  showLearnerLane: boolean;
  /** Note names in the step list (prompt text is always shown). */
  showNoteNames: boolean;
}

export function assistanceView(level: AssistanceLevel): AssistanceView {
  switch (level) {
    case "full":
      return { showTargets: true, showLabels: true, showLearnerLane: true, showNoteNames: true };
    case "reduced":
      return { showTargets: true, showLabels: false, showLearnerLane: true, showNoteNames: false };
    default:
      return { showTargets: false, showLabels: false, showLearnerLane: false, showNoteNames: false };
  }
}

/** One step less help (full → reduced → none). */
export function reducedAssistance(level: AssistanceLevel): AssistanceLevel {
  return level === "full" ? "reduced" : "none";
}

/** Label for one target under a label mode (null = no label). */
export function targetLabelFor(note: PerformedNote, labelMode: LabelMode): string | null {
  switch (labelMode) {
    case "noteNames":
      return note.spelled ? spelledToName(note.spelled) : midiToNoteName(note.midi);
    case "chordDegrees":
    case "scaleDegrees":
      return note.degree ? prettyDegree(note.degree) : null;
    case "fingers":
      return note.finger !== undefined ? String(note.finger) : null;
    default:
      return null;
  }
}

export interface PracticePianoOverride {
  owner: string;
  targets: PianoTarget[];
  labels: Map<number, string>;
  chord: ChordDefinition | null;
}

export const PRACTICE_OVERRIDE_OWNER = "practice";

/**
 * Piano target layer for the given notes. An empty label map is passed (not null) when labels
 * are hidden, so the piano does not compute its own labels for the targets.
 */
export function pianoOverrideFor(notes: readonly PerformedNote[], chord: ChordDefinition | null | undefined, level: AssistanceLevel, labelMode: LabelMode): PracticePianoOverride {
  const view = assistanceView(level);
  const labels = new Map<number, string>();
  const targets: PianoTarget[] = [];
  if (view.showTargets) {
    notes.forEach((note) => {
      const target: PianoTarget = { midi: note.midi };
      if (note.hand !== undefined) target.hand = note.hand;
      if (note.role !== undefined) target.role = note.role;
      targets.push(target);
      if (view.showLabels) {
        const label = targetLabelFor(note, labelMode);
        if (label !== null) {
          labels.set(note.midi, label);
        }
      }
    });
  }
  return { owner: PRACTICE_OVERRIDE_OWNER, targets, labels, chord: chord ?? null };
}
