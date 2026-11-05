/**
 * The single place where the UI touches the voicing engine (src/voicing). Everything is wrapped
 * so a voicing failure degrades to the legacy close voicing instead of breaking playback/UI.
 */
import type { ChordDefinition, MusicalSequence, VoicingConstraints, VoicingInstance, VoicingRecipe } from "@/model/contracts";
import type { RecipeRealization } from "@/voicing";
import { VOICING_RECIPES, explainTransition, getRecipe, realizeAll, voiceSequence, voicingSummary } from "@/voicing";

export type { RecipeRealization };

export interface RecipeOption {
  id: string;
  name: string;
  family: VoicingRecipe["family"];
  description: string;
  reviewed: boolean;
}

export function listRecipes(): RecipeOption[] {
  try {
    return VOICING_RECIPES.map((recipe) => ({ id: recipe.id, name: recipe.name, family: recipe.family, description: recipe.description, reviewed: recipe.reviewed }));
  } catch {
    return [];
  }
}

export function recipeName(id: string | undefined | null): string {
  if (!id) {
    return "Default";
  }
  try {
    const recipe = getRecipe(id);
    return recipe ? recipe.name : id;
  } catch {
    return id;
  }
}

export interface RealizeAllOutcome {
  available: boolean;
  results: RecipeRealization[];
  error?: string;
}

/** Every recipe realised for a chord; `available: false` when the engine failed. */
export function realizeAllSafe(chord: ChordDefinition, constraints: VoicingConstraints = {}): RealizeAllOutcome {
  try {
    return { available: true, results: realizeAll(chord, constraints) };
  } catch (error) {
    return { available: false, results: [], error: error instanceof Error ? error.message : "The voicing engine failed." };
  }
}

export function voicingSummarySafe(voicing: VoicingInstance): string {
  try {
    return voicingSummary(voicing);
  } catch {
    return voicing.recipeId;
  }
}

export interface PlaybackVoicingResult {
  sequence: MusicalSequence;
  issues: string[];
}

/**
 * Concrete voicings for playback: events with a recipe (own or the sequence default) get a
 * `VoicingInstance`; events without any recipe keep the legacy fallback voicer used by
 * compileTimeline (so plain chord text sounds exactly like the classic studio).
 */
export function voiceSequenceForPlayback(sequence: MusicalSequence): PlaybackVoicingResult {
  const anyRecipe = sequence.defaultVoicingRecipeId !== undefined || sequence.events.some((event) => event.voicingRecipeId !== undefined);
  if (!anyRecipe) {
    return { sequence, issues: [] };
  }
  try {
    const defaultRecipeId = sequence.defaultVoicingRecipeId ?? "close-rp";
    const result = voiceSequence(sequence, { defaultRecipeId });
    const explicit = new Set(sequence.events.filter((event) => event.voicingRecipeId !== undefined || sequence.defaultVoicingRecipeId !== undefined).map((event) => event.id));
    const events = result.sequence.events.map((event) => {
      if (explicit.has(event.id)) {
        return event;
      }
      const copy = { ...event };
      delete copy.voicing;
      return copy;
    });
    const symbolOf = new Map(sequence.events.map((event) => [event.id, event.symbol]));
    const issues = result.issues.filter((issue) => explicit.has(issue.eventId)).map((issue) => `${symbolOf.get(issue.eventId) ?? issue.eventId}: ${issue.reason}`);
    return { sequence: { ...result.sequence, events }, issues };
  } catch (error) {
    return { sequence, issues: [`Voicings could not be applied (${error instanceof Error ? error.message : "engine error"}); the default close voicing is used.`] };
  }
}

/** Voice-leading summary between two voicings ("2 common tones, 3 semitones of motion ..."). */
export function transitionSummarySafe(from: VoicingInstance, to: VoicingInstance): string | null {
  try {
    return explainTransition(from, to).summary;
  } catch {
    return null;
  }
}
