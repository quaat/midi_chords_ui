/**
 * Runtime actions shared by the Learn pages (no React). Opening a page never loads material;
 * only these explicit actions ("Hear", "Show on piano", "Practise" ...) touch the runtime.
 */
import type { AssistanceLevel, ChordDefinition, SpelledPitchClass } from "@/model/contracts";
import type { EntryView } from "@/state/sessionStore";
import type { StudioRuntimeCore } from "@/ui/runtime/runtimeCore";
import type { AuditionNote } from "@/ui/runtime/runtimeHelpers";
import { openExerciseInPractice, openRunInPractice } from "@/ui/practice/openExercise";
import { requestChart } from "@/ui/songs/songsRequests";
import type { LearnTarget } from "@/ui/learn/learnLogic";

/**
 * A message for a failed action (`{ ok: false, message }` from the Practice entry points,
 * `{ ok: false, reason }` from compilers, or a thrown error), else null.
 */
export function outcomeMessage(result: unknown): string | null {
  if (result !== null && typeof result === "object" && "ok" in result && (result as { ok: unknown }).ok === false) {
    const record = result as { message?: unknown; reason?: unknown };
    if (typeof record.message === "string" && record.message !== "") return record.message;
    if (typeof record.reason === "string" && record.reason !== "") return record.reason;
    return "This could not be opened in Practice.";
  }
  return null;
}

export function runSafely(action: () => unknown): string | null {
  try {
    return outcomeMessage(action());
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function hear(runtime: StudioRuntimeCore, notes: AuditionNote[]): string | null {
  if (notes.length === 0) return "There is nothing to play for this example.";
  return runSafely(() => runtime.audition.playNotes(notes));
}

/**
 * Highlight notes on the shared piano. Explore's target layer is only drawn while the
 * workspace mode is Explore, so the mode is switched to Explore while staying in this view
 * (the stage keeps showing the page; the piano below shows the notes).
 */
export function showOnPiano(runtime: StudioRuntimeCore, targets: LearnTarget[], chord: ChordDefinition | null, caption: string, view: EntryView): void {
  runtime.setExploreTargets(
    targets.map((target: LearnTarget) => (target.degreeLabel !== undefined ? { midi: target.midi, noteName: target.noteName, degreeLabel: target.degreeLabel } : { midi: target.midi, noteName: target.noteName })),
    chord,
    caption
  );
  const session = runtime.session.getState();
  if (session.mode !== "explore" || session.entryView !== view) {
    // One update (mode + view): `setMode` alone would also leave this view for the workspace.
    runtime.session.setState({ mode: "explore", entryView: view });
  }
}

export function practiseExercise(
  runtime: StudioRuntimeCore,
  specId: string,
  options: { mode?: "step" | "timed"; transposeTo?: SpelledPitchClass; assistance?: AssistanceLevel } = {}
): string | null {
  return runSafely(() => openExerciseInPractice(runtime, specId, options));
}

export function practiseRun(
  runtime: StudioRuntimeCore,
  config: { tonic: SpelledPitchClass; scaleId: "dorian" | "naturalMinor" | "major"; patternId: string; startOctave: number; octaves: number; hand: "left" | "right" }
): string | null {
  return runSafely(() => openRunInPractice(runtime, config));
}

/** Open a chart in the Songs view (optionally an arrangement/section). */
export function openChartInSongs(runtime: StudioRuntimeCore, chartId: string, options: { arrangementId?: string; sectionId?: string } = {}): void {
  requestChart(chartId, options);
  runtime.navigate.openEntry("songs");
}
