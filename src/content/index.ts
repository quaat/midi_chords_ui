/**
 * Shipped first-release content bundle and lookup/search helpers (plan E16, E31).
 * Everything is currently `draft`: nothing has had pianist review yet.
 */
import type {
  ArrangementDefinition,
  ConceptDefinition,
  ContentStatus,
  Demand,
  InputSource,
  LearningPath,
  PracticeRoutine,
  SongChart,
  Strand,
} from "@/model/contracts";
import { supportedInputsFor } from "@/content/authoring";
import type { ContentBundle, ContentKind, ExerciseSpec, MelodySpec, WarmupSpec } from "@/content/authoring";
import { concepts } from "@/content/concepts";
import { exerciseSpecs } from "@/content/exercises";
import { arrangements, charts } from "@/content/charts";
import { routines } from "@/content/routines";
import { paths } from "@/content/paths";
import { warmups } from "@/content/warmups";
import { melodies } from "@/content/melodies";
import { glossary } from "@/content/glossary";
import type { GlossaryEntry } from "@/content/glossary";
import { buildManifest, isPublishedStatus } from "@/content/validate";
import type { ContentManifest } from "@/content/validate";

export type { ContentBundle, ContentKind, ExerciseSpec, ExerciseMaterial, MelodySpec, WarmupSpec } from "@/content/authoring";
export { KNOWN_PATTERN_IDS, KNOWN_VOICING_RECIPE_IDS, supportedInputsFor } from "@/content/authoring";
export { buildManifest, publishedOnly, validateContent, formatIssue } from "@/content/validate";
export type { ContentManifest, ValidationIssue } from "@/content/validate";
export { glossary };
export type { GlossaryEntry };

export const contentBundle: ContentBundle = {
  concepts,
  paths,
  exerciseSpecs,
  charts,
  arrangements,
  routines,
  warmups,
  melodies,
};

export const contentManifest: ContentManifest = buildManifest(contentBundle);

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function getConcept(id: string): ConceptDefinition | undefined {
  return contentBundle.concepts.find((x: ConceptDefinition) => x.id === id);
}

export function getExerciseSpec(id: string): ExerciseSpec | undefined {
  return contentBundle.exerciseSpecs.find((x: ExerciseSpec) => x.id === id);
}

export function getChart(id: string): SongChart | undefined {
  return contentBundle.charts.find((x: SongChart) => x.id === id);
}

export function getArrangement(id: string): ArrangementDefinition | undefined {
  return contentBundle.arrangements.find((x: ArrangementDefinition) => x.id === id);
}

export function getArrangementsForChart(chartId: string): ArrangementDefinition[] {
  return contentBundle.arrangements.filter((x: ArrangementDefinition) => x.chartId === chartId);
}

export function getRoutine(id: string): PracticeRoutine | undefined {
  return contentBundle.routines.find((x: PracticeRoutine) => x.id === id);
}

export function getPath(id: string): LearningPath | undefined {
  return contentBundle.paths.find((x: LearningPath) => x.id === id);
}

export function getWarmup(id: string): WarmupSpec | undefined {
  return contentBundle.warmups.find((x: WarmupSpec) => x.id === id);
}

export function getMelody(id: string): MelodySpec | undefined {
  return contentBundle.melodies.find((x: MelodySpec) => x.id === id);
}

/** A concept's `exerciseIds` may name an exercise or a warm-up; resolve either. */
export type PlayableRef = { kind: "exercise"; spec: ExerciseSpec } | { kind: "warmup"; spec: WarmupSpec };

export function getPlayable(id: string): PlayableRef | undefined {
  const exercise = getExerciseSpec(id);
  if (exercise) return { kind: "exercise", spec: exercise };
  const warmup = getWarmup(id);
  if (warmup) return { kind: "warmup", spec: warmup };
  return undefined;
}

// ---------------------------------------------------------------------------
// Navigation between songs and concepts
// ---------------------------------------------------------------------------

/** Concepts applied in a chart: via concept applications or via exercises applied to it. */
export function conceptsForChart(chartId: string): ConceptDefinition[] {
  const ids = new Set<string>();
  for (const concept of contentBundle.concepts) {
    if (concept.applications.some((a) => a.chartId === chartId)) ids.add(concept.id);
  }
  for (const spec of contentBundle.exerciseSpecs) {
    if (spec.application?.chartId === chartId) for (const cid of spec.conceptIds) ids.add(cid);
  }
  return contentBundle.concepts.filter((c: ConceptDefinition) => ids.has(c.id) && isPublishedStatus(c.meta.status));
}

/** Charts where a concept is applied (directly or through one of its exercises). */
export function chartsForConcept(conceptId: string): SongChart[] {
  const ids = new Set<string>();
  const concept = getConcept(conceptId);
  if (concept) for (const a of concept.applications) if (a.chartId) ids.add(a.chartId);
  for (const spec of contentBundle.exerciseSpecs) {
    if (spec.conceptIds.includes(conceptId) && spec.application?.chartId) ids.add(spec.application.chartId);
  }
  return contentBundle.charts.filter((c: SongChart) => ids.has(c.id) && isPublishedStatus(c.meta.status));
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchFilters {
  demand?: Demand;
  strand?: Strand;
  /** Status or statuses to include; default: reviewed and draft (published) only. */
  status?: ContentStatus | ContentStatus[];
  /** The learner's available input; "none" = reading/listening only. */
  inputAvailable?: InputSource | "none";
  /** Restrict to some kinds. */
  kinds?: ContentKind[];
}

export interface SearchResult {
  kind: ContentKind;
  id: string;
  title: string;
  summary: string;
  status: ContentStatus;
  demand: Demand[];
  strand?: Strand;
  score: number;
  /** Which fields matched (for display: "title", "tags", "glossary" ...). */
  matchedOn: string[];
}

interface SearchDoc {
  kind: ContentKind;
  id: string;
  title: string;
  summary: string;
  status: ContentStatus;
  demand: Demand[];
  strand?: Strand;
  fields: { name: string; weight: number; text: string }[];
  /** Whether the item can be used with this input. */
  usableWith: (input: InputSource | "none") => boolean;
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/♭/g, "b")
    .replace(/♯/g, "#")
    .replace(/[–—]/g, "-");
}

function uniqueDemands(list: Demand[]): Demand[] {
  const order: Demand[] = ["beginner", "intermediate", "advanced"];
  return order.filter((d: Demand) => list.includes(d));
}

function buildSearchDocs(bundle: ContentBundle): SearchDoc[] {
  const docs: SearchDoc[] = [];
  const conceptById = new Map<string, ConceptDefinition>(bundle.concepts.map((c: ConceptDefinition) => [c.id, c]));
  const always = (): boolean => true;

  for (const c of bundle.concepts) {
    docs.push({
      kind: "concept",
      id: c.id,
      title: c.title,
      summary: c.summary,
      status: c.meta.status,
      demand: c.demand,
      strand: c.strand,
      fields: [
        { name: "title", weight: 3, text: c.title },
        { name: "tags", weight: 2, text: c.tags.join(" ") },
        { name: "glossary", weight: 2, text: (c.glossary ?? []).map((g) => `${g.term} ${g.definition}`).join(" ") },
        { name: "summary", weight: 1, text: c.summary },
      ],
      usableWith: always,
    });
  }
  for (const e of bundle.exerciseSpecs) {
    const firstConcept = conceptById.get(e.conceptIds[0] ?? "");
    const conceptTitles = e.conceptIds.map((id: string) => conceptById.get(id)?.title ?? id).join(" ");
    const inputs = supportedInputsFor(e);
    docs.push({
      kind: "exercise",
      id: e.id,
      title: e.title,
      summary: e.objective,
      status: e.status,
      demand: [e.demand],
      strand: firstConcept?.strand,
      fields: [
        { name: "title", weight: 3, text: e.title },
        { name: "tags", weight: 2, text: [...(e.tags ?? []), conceptTitles].join(" ") },
        { name: "summary", weight: 1, text: e.objective },
      ],
      usableWith: (input: InputSource | "none"): boolean => (input === "none" ? e.policy.kind === "listen" : inputs.includes(input)),
    });
  }
  for (const w of bundle.warmups) {
    docs.push({
      kind: "warmup",
      id: w.id,
      title: w.title,
      summary: w.objective,
      status: w.status,
      demand: [w.demand],
      strand: "technique",
      fields: [
        { name: "title", weight: 3, text: w.title },
        { name: "tags", weight: 2, text: "warm-up technique" },
        { name: "summary", weight: 1, text: w.objective },
      ],
      usableWith: (input: InputSource | "none"): boolean => input !== "none",
    });
  }
  for (const ch of bundle.charts) {
    const arr = bundle.arrangements.filter((a: ArrangementDefinition) => a.chartId === ch.id);
    const symbols = ch.sections.flatMap((s) => s.bars.flatMap((b) => b.spans.map((sp) => sp.symbol)));
    const keyText = ch.key ? `${ch.key.tonic.letter} ${ch.key.mode}` : "";
    docs.push({
      kind: "chart",
      id: ch.id,
      title: ch.title,
      summary: `${ch.sections.length} sections, order ${ch.performanceOrder.join(" ")}`,
      status: ch.meta.status,
      demand: uniqueDemands(arr.map((a: ArrangementDefinition) => a.demand)),
      strand: "songsApplication",
      fields: [
        { name: "title", weight: 3, text: ch.title },
        { name: "tags", weight: 2, text: `song chart ${keyText} ${arr.map((a: ArrangementDefinition) => a.name).join(" ")}` },
        { name: "summary", weight: 1, text: symbols.join(" ") },
      ],
      usableWith: always,
    });
  }
  for (const p of bundle.paths) {
    docs.push({
      kind: "path",
      id: p.id,
      title: p.title,
      summary: p.description,
      status: p.meta.status,
      demand: [p.entry],
      fields: [
        { name: "title", weight: 3, text: p.title },
        { name: "summary", weight: 1, text: p.description },
      ],
      usableWith: always,
    });
  }
  for (const r of bundle.routines) {
    const demands: Demand[] = [];
    for (const item of r.items) {
      const e = bundle.exerciseSpecs.find((x: ExerciseSpec) => x.id === item.refId);
      if (e) demands.push(e.demand);
      const w = bundle.warmups.find((x: WarmupSpec) => x.id === item.refId);
      if (w) demands.push(w.demand);
    }
    docs.push({
      kind: "routine",
      id: r.id,
      title: r.title,
      summary: r.description ?? "",
      status: r.meta.status,
      demand: uniqueDemands(demands),
      fields: [
        { name: "title", weight: 3, text: r.title },
        { name: "tags", weight: 2, text: "routine practice session" },
        { name: "summary", weight: 1, text: r.description ?? "" },
      ],
      usableWith: (input: InputSource | "none"): boolean => input !== "none",
    });
  }
  return docs;
}

/**
 * Simple case-insensitive search: every whitespace-separated query term must appear in at
 * least one field (title, summary, tags, glossary). Empty query lists everything matching the
 * filters. By default only reviewed and draft items are returned; results carry `status` so
 * callers can flag drafts visibly.
 */
export function searchContent(query: string, filters: SearchFilters = {}, bundle: ContentBundle = contentBundle): SearchResult[] {
  const terms = normalise(query).split(/\s+/).filter((t: string) => t.length > 0);
  const statuses: ContentStatus[] =
    filters.status === undefined ? ["reviewed", "draft"] : Array.isArray(filters.status) ? filters.status : [filters.status];
  const results: SearchResult[] = [];

  for (const doc of buildSearchDocs(bundle)) {
    if (!statuses.includes(doc.status)) continue;
    if (filters.kinds && !filters.kinds.includes(doc.kind)) continue;
    if (filters.demand && !doc.demand.includes(filters.demand)) continue;
    if (filters.strand && doc.strand !== filters.strand) continue;
    if (filters.inputAvailable !== undefined && !doc.usableWith(filters.inputAvailable)) continue;

    let score = 0;
    const matched = new Set<string>();
    let allTermsMatch = true;
    for (const term of terms) {
      let termMatched = false;
      for (const field of doc.fields) {
        if (normalise(field.text).includes(term)) {
          termMatched = true;
          score += field.weight;
          matched.add(field.name);
        }
      }
      if (!termMatched) {
        allTermsMatch = false;
        break;
      }
    }
    if (!allTermsMatch) continue;
    const result: SearchResult = {
      kind: doc.kind,
      id: doc.id,
      title: doc.title,
      summary: doc.summary,
      status: doc.status,
      demand: doc.demand,
      score,
      matchedOn: Array.from(matched),
    };
    if (doc.strand !== undefined) result.strand = doc.strand;
    results.push(result);
  }
  return results.sort((a: SearchResult, b: SearchResult) => b.score - a.score || a.title.localeCompare(b.title));
}
