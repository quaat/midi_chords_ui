import type { ConceptDefinition } from "@/model/contracts";
import { concepts } from "@/content/concepts";

export interface GlossaryEntry {
  term: string;
  definition: string;
  /** Concepts that define or use this term (first one is the defining concept). */
  conceptIds: string[];
}

/**
 * Aggregate glossary terms from concept pages. Terms are merged case-insensitively; the first
 * definition encountered wins and later concepts are added to `conceptIds`.
 */
export function buildGlossary(concepts: ConceptDefinition[]): GlossaryEntry[] {
  const byKey = new Map<string, GlossaryEntry>();
  for (const concept of concepts) {
    for (const item of concept.glossary ?? []) {
      const key = item.term.trim().toLowerCase();
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.conceptIds.includes(concept.id)) existing.conceptIds.push(concept.id);
      } else {
        byKey.set(key, { term: item.term.trim(), definition: item.definition, conceptIds: [concept.id] });
      }
    }
  }
  return Array.from(byKey.values()).sort((a: GlossaryEntry, b: GlossaryEntry) => a.term.localeCompare(b.term));
}

/** Case-insensitive term lookup. */
export function findGlossaryTerm(glossary: GlossaryEntry[], term: string): GlossaryEntry | undefined {
  const key = term.trim().toLowerCase();
  return glossary.find((entry: GlossaryEntry) => entry.term.toLowerCase() === key);
}

/** The shipped glossary, aggregated from every concept page (including drafts). */
export const glossary: GlossaryEntry[] = buildGlossary(concepts);
