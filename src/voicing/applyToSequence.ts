/**
 * Fill a MusicalSequence's chord events with concrete voicings (plan E06 integration).
 *
 * - Recipe per event: options.perEvent[event.id] ?? event.voicingRecipeId ?? options.defaultRecipeId.
 * - Continuity: each chord is ranked against the previous sounding voicing (greedy, left to
 *   right; use rankSequence for a global search). Rests keep `voicing` undefined and carry
 *   the previous voicing forward for continuity.
 * - Fallback: when the requested recipe does not support an event's chord (typically a triad
 *   under a shell, guide-tone or rootless recipe, which need a seventh), the event is voiced
 *   with "close-rp" instead and an issue is reported — one unsuitable chord does not fail the
 *   whole sequence. Constraint failures (range, locks, span) are NOT papered over: the event is
 *   left without a voicing and the reason is reported.
 * - The sequence `version` is unchanged (voicing is derived material); events are copied, the
 *   input is not mutated.
 */
import type { MusicalSequence, SequenceEvent, VoicingConstraints, VoicingInstance } from "@/model/contracts";
import { formatSpelledNote } from "@/music/pitch";
import { realizeVoicing, recipeSupport } from "@/voicing/engine";
import { getRecipe } from "@/voicing/recipes";

export const FALLBACK_RECIPE_ID = "close-rp";

export interface VoiceSequenceOptions {
  defaultRecipeId: string;
  constraints?: VoicingConstraints;
  /** Recipe overrides keyed by event id. */
  perEvent?: Record<string, string>;
}

export interface VoiceSequenceIssue {
  eventId: string;
  reason: string;
}

export interface VoiceSequenceResult {
  sequence: MusicalSequence;
  issues: VoiceSequenceIssue[];
}

export function voiceSequence(sequence: MusicalSequence, options: VoiceSequenceOptions): VoiceSequenceResult {
  const issues: VoiceSequenceIssue[] = [];
  const base: VoicingConstraints = { ...(options.constraints ?? {}) };
  let previous: VoicingInstance | undefined = base.previous;
  const events: SequenceEvent[] = sequence.events.map((event) => {
    const copy: SequenceEvent = { ...event };
    if (event.kind === "rest") {
      return copy;
    }
    const chord = event.chord;
    if (!chord) {
      issues.push({ eventId: event.id, reason: `"${event.symbol}" has no parsed chord; nothing to voice.` });
      return copy;
    }
    const perEvent = options.perEvent ? options.perEvent[event.id] : undefined;
    let recipeId = perEvent ?? event.voicingRecipeId ?? options.defaultRecipeId;
    const support = recipeSupport(chord, recipeId);
    if (!support.ok) {
      issues.push({ eventId: event.id, reason: `${support.reason} Voiced with ${FALLBACK_RECIPE_ID} instead.` });
      recipeId = FALLBACK_RECIPE_ID;
    }
    const constraints: VoicingConstraints = { ...base };
    if (previous) {
      constraints.previous = previous;
    } else {
      delete constraints.previous;
    }
    const result = realizeVoicing(chord, recipeId, constraints);
    if (!result.ok) {
      issues.push({ eventId: event.id, reason: `${event.symbol}: ${result.reason}` });
      delete copy.voicing;
      return copy;
    }
    copy.voicing = result.voicing;
    previous = result.voicing;
    return copy;
  });
  return { sequence: { ...sequence, events }, issues };
}

/** One-line description for UI lists: "Dm9 · Rootless A · F3 (b3) A3 (5) C4 (b7) E4 (9) · bass D2". */
export function voicingSummary(voicing: VoicingInstance): string {
  const recipe = getRecipe(voicing.recipeId);
  const name = recipe ? recipe.name : voicing.recipeId;
  const notes = [...voicing.notes]
    .sort((a, b) => a.midi - b.midi)
    .map((note) => `${formatSpelledNote(note.spelled)} (${note.degree})`)
    .join(" ");
  const bass = voicing.accompanimentBass ? ` · bass ${formatSpelledNote(voicing.accompanimentBass.spelled)}` : "";
  return `${voicing.chord.symbol} · ${name} · ${notes}${bass}`;
}

/** Learner MIDI notes, ascending. The accompaniment bass is included only when asked for. */
export function voicingToMidi(voicing: VoicingInstance, options: { includeAccompanimentBass?: boolean } = {}): number[] {
  const midis = voicing.notes.map((note) => note.midi);
  if (options.includeAccompanimentBass && voicing.accompanimentBass) {
    midis.push(voicing.accompanimentBass.midi);
  }
  return midis.sort((a, b) => a - b);
}
