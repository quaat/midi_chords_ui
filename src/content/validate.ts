/**
 * Content validation, manifest and publishing filter (plan E16).
 *
 * The validator is purely structural/data-level: it checks IDs, typed references,
 * prerequisite cycles, pitch ranges, chord-symbol plausibility, chart bar arithmetic,
 * policy/contract consistency and required metadata. Full chord parsing and voicing
 * realisation live in other modules and are validated there.
 */
import type {
  AnswerPolicy,
  ArrangementDefinition,
  ChordRole,
  ConceptDefinition,
  ContentMeta,
  ContentStatus,
  Demand,
  LearningPath,
  PracticeRoutine,
  SongChart,
  SpelledPitchClass,
  TimingPolicy,
} from "@/model/contracts";
import { KNOWN_PATTERN_IDS, KNOWN_VOICING_RECIPE_IDS } from "@/content/authoring";
import type { ContentBundle, ContentKind, ExerciseSpec, MelodySpec, WarmupSpec } from "@/content/authoring";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ValidationSeverity = "error" | "warning";

export type ValidationCode =
  | "duplicateId"
  | "danglingReference"
  | "wrongReferenceType"
  | "unpublishedReference"
  | "prerequisiteCycle"
  | "midiOutOfRange"
  | "chordSymbol"
  | "barDuration"
  | "spanLayout"
  | "performanceOrder"
  | "explicitNotesKey"
  | "missingMetadata"
  | "reviewMetadata"
  | "policyContract"
  | "unsatisfiable"
  | "timing"
  | "melody"
  | "unknownRecipe"
  | "unknownPattern"
  | "pathOrder"
  | "incompleteUnit"
  | "invalidValue";

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: ValidationCode;
  kind: ContentKind;
  id: string;
  message: string;
  /** Dotted location inside the item, e.g. "material.steps[2].notes[0].midi". */
  path?: string;
}

export const MIDI_MIN: number = 21;
export const MIDI_MAX: number = 108;

const STATUSES: ContentStatus[] = ["reviewed", "draft", "unavailable", "deferred"];
const DEMANDS: Demand[] = ["beginner", "intermediate", "advanced"];
const LETTER_SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * Plausibility check for chord symbols: root letter + optional accidental + a suffix made of
 * common quality/extension tokens + optional slash bass. Not a parser.
 */
const CHORD_SYMBOL_RE: RegExp =
  /^[A-G](?:#|b|♯|♭)?(?:maj|min|dim|aug|sus|add|alt|omit|no|m|M|Δ|°|ø|o|\+|-|#|b|♯|♭|\d|\(|\)|,|\^)*(?:\/[A-G](?:#|b|♯|♭)?)?$/;

export function isPlausibleChordSymbol(symbol: string): boolean {
  return CHORD_SYMBOL_RE.test(symbol.trim());
}

export function isRestSymbol(symbol: string): boolean {
  const s = symbol.trim().toUpperCase();
  return s === "NC" || s === "N.C." || s === "REST";
}

export function isPublishedStatus(status: ContentStatus): boolean {
  return status === "reviewed" || status === "draft";
}

/** MIDI number of a spelled pitch class in a scientific-pitch octave (C4 = 60). */
export function spelledToMidi(pc: SpelledPitchClass, octave: number): number {
  return 12 * (octave + 1) + LETTER_SEMITONES[pc.letter] + pc.accidental;
}

// ---------------------------------------------------------------------------
// Index of everything in the bundle
// ---------------------------------------------------------------------------

interface IndexEntry {
  kind: ContentKind;
  status: ContentStatus;
}

type ContentIndex = Map<string, IndexEntry[]>;

function statusOf(kind: ContentKind, item: unknown): ContentStatus {
  if (kind === "exercise" || kind === "warmup" || kind === "melody") return (item as { status: ContentStatus }).status;
  return (item as { meta: ContentMeta }).meta.status;
}

function listItems(bundle: ContentBundle): { kind: ContentKind; id: string; status: ContentStatus }[] {
  const out: { kind: ContentKind; id: string; status: ContentStatus }[] = [];
  const add = (kind: ContentKind, items: { id: string }[]): void => {
    for (const item of items) out.push({ kind, id: item.id, status: statusOf(kind, item) });
  };
  add("concept", bundle.concepts);
  add("path", bundle.paths);
  add("exercise", bundle.exerciseSpecs);
  add("chart", bundle.charts);
  add("arrangement", bundle.arrangements);
  add("routine", bundle.routines);
  add("warmup", bundle.warmups);
  add("melody", bundle.melodies);
  return out;
}

function buildIndex(bundle: ContentBundle): ContentIndex {
  const index: ContentIndex = new Map();
  for (const item of listItems(bundle)) {
    const entries = index.get(item.id) ?? [];
    entries.push({ kind: item.kind, status: item.status });
    index.set(item.id, entries);
  }
  return index;
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

class Collector {
  readonly issues: ValidationIssue[] = [];
  constructor(private readonly index: ContentIndex) {}

  add(severity: ValidationSeverity, code: ValidationCode, kind: ContentKind, id: string, message: string, path?: string): void {
    const issue: ValidationIssue = { severity, code, kind, id, message };
    if (path !== undefined) issue.path = path;
    this.issues.push(issue);
  }

  error(code: ValidationCode, kind: ContentKind, id: string, message: string, path?: string): void {
    this.add("error", code, kind, id, message, path);
  }

  warn(code: ValidationCode, kind: ContentKind, id: string, message: string, path?: string): void {
    this.add("warning", code, kind, id, message, path);
  }

  /** Check that `targetId` exists as one of `expected` kinds. */
  ref(kind: ContentKind, id: string, fromStatus: ContentStatus, path: string, targetId: string, expected: ContentKind[]): void {
    const entries = this.index.get(targetId) ?? [];
    const match = entries.find((e: IndexEntry) => expected.includes(e.kind));
    if (match) {
      if (isPublishedStatus(fromStatus) && !isPublishedStatus(match.status)) {
        this.warn("unpublishedReference", kind, id, `references ${match.kind} "${targetId}" whose status is "${match.status}"`, path);
      }
      return;
    }
    if (entries.length > 0) {
      this.error(
        "wrongReferenceType",
        kind,
        id,
        `"${targetId}" is a ${entries.map((e: IndexEntry) => e.kind).join("/")}, but a ${expected.join(" or ")} is required`,
        path,
      );
      return;
    }
    this.error("danglingReference", kind, id, `references missing ${expected.join(" or ")} "${targetId}"`, path);
  }

  midi(kind: ContentKind, id: string, path: string, midi: number): void {
    if (!Number.isInteger(midi) || midi < MIDI_MIN || midi > MIDI_MAX) {
      this.error("midiOutOfRange", kind, id, `MIDI pitch ${midi} is outside ${MIDI_MIN}..${MIDI_MAX}`, path);
    }
  }

  register(kind: ContentKind, id: string, path: string, register: { low: number; high: number } | undefined): void {
    if (!register) return;
    this.midi(kind, id, `${path}.low`, register.low);
    this.midi(kind, id, `${path}.high`, register.high);
    if (register.low > register.high) this.error("invalidValue", kind, id, `register low ${register.low} is above high ${register.high}`, path);
  }

  chord(kind: ContentKind, id: string, path: string, symbol: string, allowRest: boolean): void {
    if (allowRest && isRestSymbol(symbol)) return;
    if (!isPlausibleChordSymbol(symbol)) this.error("chordSymbol", kind, id, `"${symbol}" is not a plausible chord symbol`, path);
  }

  meta(kind: ContentKind, id: string, meta: ContentMeta | undefined): void {
    if (!meta) {
      this.error("missingMetadata", kind, id, "meta is required");
      return;
    }
    this.versionStatus(kind, id, meta.version, meta.status, "meta");
    this.review(kind, id, meta.status, meta.author, meta.reviewer, "meta");
  }

  versionStatus(kind: ContentKind, id: string, version: number, status: ContentStatus, path: string): void {
    if (!Number.isInteger(version) || version < 1) this.error("missingMetadata", kind, id, `version must be an integer ≥ 1 (got ${version})`, `${path}.version`);
    if (!STATUSES.includes(status)) this.error("missingMetadata", kind, id, `status "${String(status)}" is not valid`, `${path}.status`);
  }

  review(kind: ContentKind, id: string, status: ContentStatus, author: string | undefined, reviewer: string | undefined, path: string): void {
    if (status === "reviewed") {
      if (!nonEmpty(author)) this.error("reviewMetadata", kind, id, "reviewed items need an author", `${path}.author`);
      if (!nonEmpty(reviewer)) this.error("reviewMetadata", kind, id, "reviewed items need a reviewer", `${path}.reviewer`);
    } else if (status === "draft" && !nonEmpty(author)) {
      this.warn("reviewMetadata", kind, id, "draft has no author", `${path}.author`);
    }
  }

  text(kind: ContentKind, id: string, path: string, value: string | undefined): void {
    if (!nonEmpty(value)) this.error("missingMetadata", kind, id, `${path} is required`, path);
  }
}

function nonEmpty(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function checkUnique(c: Collector, kind: ContentKind, items: { id: string }[]): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (!nonEmpty(item.id)) {
      c.error("missingMetadata", kind, String(item.id), "id is required");
      continue;
    }
    if (seen.has(item.id)) c.error("duplicateId", kind, item.id, `duplicate ${kind} id "${item.id}"`);
    seen.add(item.id);
  }
}

function checkUniqueLocal(c: Collector, kind: ContentKind, ownerId: string, label: string, ids: string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) c.error("duplicateId", kind, ownerId, `duplicate ${label} id "${id}"`);
    seen.add(id);
  }
}

function checkDemand(c: Collector, kind: ContentKind, id: string, demand: Demand, path: string): void {
  if (!DEMANDS.includes(demand)) c.error("missingMetadata", kind, id, `demand "${String(demand)}" is not valid`, path);
}

function checkTiming(c: Collector, kind: ContentKind, id: string, timing: TimingPolicy, policy: AnswerPolicy): void {
  if (timing.mode !== "step" && timing.mode !== "timed") {
    c.error("timing", kind, id, `timing.mode "${String(timing.mode)}" is not valid`, "timing.mode");
    return;
  }
  const unscored = policy.kind === "free" || policy.kind === "listen";
  if (timing.mode === "timed" && !unscored && !(typeof timing.onsetWindowMs === "number" && timing.onsetWindowMs > 0)) {
    c.error("timing", kind, id, "timed exercises need a positive onsetWindowMs", "timing.onsetWindowMs");
  }
  if (timing.countInBeats !== undefined && timing.countInBeats < 0) c.error("timing", kind, id, "countInBeats must be ≥ 0", "timing.countInBeats");
  if (timing.assemblyWindowMs !== undefined && timing.assemblyWindowMs < 0) {
    c.error("timing", kind, id, "assemblyWindowMs must be ≥ 0", "timing.assemblyWindowMs");
  }
}

function checkPolicyContract(c: Collector, spec: ExerciseSpec): void {
  const policy = spec.policy;
  if (policy.kind === "free" && spec.contract !== "exploreReflect") {
    c.error("policyContract", "exercise", spec.id, `policy "free" requires contract "exploreReflect" (got "${spec.contract}")`, "policy");
  }
  if (spec.contract === "reproduce" && policy.kind === "free") {
    c.error("policyContract", "exercise", spec.id, 'contract "reproduce" cannot use policy "free"', "contract");
  }
  if (spec.contract === "reproduce" && policy.kind === "listen") {
    c.warn("policyContract", "exercise", spec.id, 'contract "reproduce" with policy "listen" has nothing to reproduce', "contract");
  }
}

function rolesOfPolicy(policy: AnswerPolicy): { required: ChordRole[]; optional: ChordRole[] } | undefined {
  if (policy.kind !== "roles") return undefined;
  return { required: policy.requiredRoles, optional: policy.optionalRoles ?? [] };
}

function checkExercise(c: Collector, spec: ExerciseSpec, knownExerciseIds: Set<string>): void {
  const kind: ContentKind = "exercise";
  const id = spec.id;
  c.versionStatus(kind, id, spec.version, spec.status, "spec");
  c.review(kind, id, spec.status, spec.author, spec.reviewer, "spec");
  c.text(kind, id, "title", spec.title);
  c.text(kind, id, "objective", spec.objective);
  checkDemand(c, kind, id, spec.demand, "demand");
  if (!(spec.tempoBpm > 0)) c.error("invalidValue", kind, id, "tempoBpm must be > 0", "tempoBpm");
  checkTimeSignature(c, kind, id, spec.timeSignature, "timeSignature");
  if (spec.conceptIds.length === 0) c.warn("incompleteUnit", kind, id, "exercise is not linked to any concept", "conceptIds");
  spec.conceptIds.forEach((ref: string, i: number) => c.ref(kind, id, spec.status, `conceptIds[${i}]`, ref, ["concept"]));
  spec.prerequisites.forEach((ref: string, i: number) => {
    if (ref === id) c.error("prerequisiteCycle", kind, id, "exercise lists itself as a prerequisite", `prerequisites[${i}]`);
    c.ref(kind, id, spec.status, `prerequisites[${i}]`, ref, ["concept", "exercise"]);
  });
  if (spec.application?.chartId) c.ref(kind, id, spec.status, "application.chartId", spec.application.chartId, ["chart"]);
  if (spec.application?.conceptId) c.ref(kind, id, spec.status, "application.conceptId", spec.application.conceptId, ["concept"]);
  if (spec.melodyId) c.ref(kind, id, spec.status, "melodyId", spec.melodyId, ["melody"]);
  if (spec.variantOf) {
    if (!knownExerciseIds.has(spec.variantOf)) c.error("danglingReference", kind, id, `variantOf references missing exercise "${spec.variantOf}"`, "variantOf");
  }

  checkPolicyContract(c, spec);
  checkTiming(c, kind, id, spec.timing, spec.policy);

  const unscored = spec.policy.kind === "free" || spec.policy.kind === "listen";
  if (spec.hintLadder.length === 0 && !unscored) c.error("incompleteUnit", kind, id, "hintLadder needs at least one rung", "hintLadder");
  else if (spec.hintLadder.length < 3) c.warn("incompleteUnit", kind, id, `hintLadder has ${spec.hintLadder.length} rung(s); 3 are recommended`, "hintLadder");

  const roles = rolesOfPolicy(spec.policy);
  if (roles) {
    if (roles.required.length === 0) c.error("unsatisfiable", kind, id, "roles policy needs at least one required role", "policy.requiredRoles");
    for (const role of roles.required) {
      if (roles.optional.includes(role)) c.warn("unsatisfiable", kind, id, `role "${role}" is both required and optional`, "policy");
    }
  }

  const material = spec.material;
  switch (material.kind) {
    case "chordSequence": {
      if (material.symbols.length === 0) c.error("unsatisfiable", kind, id, "chordSequence has no symbols", "material.symbols");
      material.symbols.forEach((s: string, i: number) => c.chord(kind, id, `material.symbols[${i}]`, s, true));
      if (material.durationsBeats) {
        if (material.durationsBeats.length !== material.symbols.length) {
          c.error("invalidValue", kind, id, `durationsBeats has ${material.durationsBeats.length} entries for ${material.symbols.length} symbols`, "material.durationsBeats");
        }
        material.durationsBeats.forEach((d: number, i: number) => {
          if (!(d > 0)) c.error("invalidValue", kind, id, "durations must be > 0", `material.durationsBeats[${i}]`);
        });
      }
      if (material.voicingRecipeId && !KNOWN_VOICING_RECIPE_IDS.includes(material.voicingRecipeId)) {
        c.warn("unknownRecipe", kind, id, `voicing recipe "${material.voicingRecipeId}" is not in KNOWN_VOICING_RECIPE_IDS`, "material.voicingRecipeId");
      }
      if (spec.policy.kind === "exactVoicing" && !material.voicingRecipeId) {
        c.error("unsatisfiable", kind, id, "exactVoicing over chord symbols needs a voicingRecipeId to define the exact notes", "material.voicingRecipeId");
      }
      break;
    }
    case "explicitNotes": {
      if (material.steps.length === 0) c.error("unsatisfiable", kind, id, "explicitNotes has no steps", "material.steps");
      let soundingSteps = 0;
      material.steps.forEach((step, i: number) => {
        const p = `material.steps[${i}]`;
        if (!(step.durationBeats > 0)) c.error("invalidValue", kind, id, "durationBeats must be > 0", `${p}.durationBeats`);
        if (step.chordSymbol !== undefined) c.chord(kind, id, `${p}.chordSymbol`, step.chordSymbol, true);
        step.notes.forEach((n, j: number) => c.midi(kind, id, `${p}.notes[${j}].midi`, n.midi));
        const midis = step.notes.map((n) => n.midi);
        if (new Set<number>(midis).size !== midis.length) c.error("unsatisfiable", kind, id, "a step repeats the same MIDI pitch", p);
        if (step.notes.length > 0) {
          soundingSteps++;
          if (roles) {
            const present = new Set<ChordRole>();
            for (const n of step.notes) if (n.role) present.add(n.role);
            for (const role of roles.required) {
              if (!present.has(role)) c.error("unsatisfiable", kind, id, `required role "${role}" is absent from the authored notes`, p);
            }
          }
        }
      });
      if (soundingSteps === 0 && !unscored) c.error("unsatisfiable", kind, id, "explicitNotes contains only rests", "material.steps");
      break;
    }
    case "scaleRun": {
      if (!KNOWN_PATTERN_IDS.includes(material.patternId)) {
        c.warn("unknownPattern", kind, id, `pattern "${material.patternId}" is not in KNOWN_PATTERN_IDS`, "material.patternId");
      }
      if (!Number.isInteger(material.octaves) || material.octaves < 1) c.error("invalidValue", kind, id, "octaves must be an integer ≥ 1", "material.octaves");
      const low = spelledToMidi(material.tonic, material.startOctave);
      c.midi(kind, id, "material.startOctave", low);
      c.midi(kind, id, "material.octaves", low + 12 * material.octaves);
      if (roles) c.error("unsatisfiable", kind, id, "a roles policy cannot be satisfied by a single-note scale run", "policy");
      break;
    }
    case "singleNotes": {
      if (material.prompts.length === 0) c.error("unsatisfiable", kind, id, "singleNotes has no prompts", "material.prompts");
      material.prompts.forEach((p, i: number) => c.midi(kind, id, `material.prompts[${i}].midi`, p.midi));
      if (roles) c.error("unsatisfiable", kind, id, "a roles policy cannot be satisfied by single notes", "policy");
      break;
    }
    default:
      c.error("invalidValue", kind, id, "unknown material kind", "material.kind");
  }
}

function checkTimeSignature(c: Collector, kind: ContentKind, id: string, ts: { numerator: number; denominator: number }, path: string): void {
  if (!(Number.isInteger(ts.numerator) && ts.numerator > 0) || ![1, 2, 4, 8, 16].includes(ts.denominator)) {
    c.error("invalidValue", kind, id, `time signature ${ts.numerator}/${ts.denominator} is not valid`, path);
  }
}

function checkConcept(c: Collector, concept: ConceptDefinition): void {
  const kind: ContentKind = "concept";
  const id = concept.id;
  const status = concept.meta?.status ?? "draft";
  c.meta(kind, id, concept.meta);
  c.text(kind, id, "title", concept.title);
  c.text(kind, id, "summary", concept.summary);
  if (concept.explanation.length === 0 || !concept.explanation.every((p: string) => nonEmpty(p))) {
    c.error("missingMetadata", kind, id, "explanation needs at least one non-empty paragraph", "explanation");
  }
  if (concept.demand.length === 0) c.error("missingMetadata", kind, id, "demand needs at least one level", "demand");
  concept.demand.forEach((d: Demand, i: number) => checkDemand(c, kind, id, d, `demand[${i}]`));

  concept.prerequisites.forEach((ref: string, i: number) => {
    if (ref === id) c.error("prerequisiteCycle", kind, id, "concept lists itself as a prerequisite", `prerequisites[${i}]`);
    c.ref(kind, id, status, `prerequisites[${i}]`, ref, ["concept"]);
  });
  concept.exerciseIds.forEach((ref: string, i: number) => c.ref(kind, id, status, `exerciseIds[${i}]`, ref, ["exercise", "warmup"]));
  concept.related.forEach((ref: string, i: number) => c.ref(kind, id, status, `related[${i}]`, ref, ["concept"]));
  concept.applications.forEach((app, i: number) => {
    const p = `applications[${i}]`;
    if (!app.chartId && !app.exerciseId && !app.conceptId) c.error("danglingReference", kind, id, "application has no target", p);
    if (app.chartId) c.ref(kind, id, status, `${p}.chartId`, app.chartId, ["chart"]);
    if (app.exerciseId) c.ref(kind, id, status, `${p}.exerciseId`, app.exerciseId, ["exercise", "warmup"]);
    if (app.conceptId) c.ref(kind, id, status, `${p}.conceptId`, app.conceptId, ["concept"]);
  });

  const exampleIds = concept.examples.map((e) => e.id);
  checkUniqueLocal(c, kind, id, "example", exampleIds);
  concept.examples.forEach((ex, i: number) => {
    const p = `examples[${i}]`;
    (ex.symbols ?? []).forEach((s: string, j: number) => c.chord(kind, id, `${p}.symbols[${j}]`, s, true));
    (ex.midi ?? []).forEach((m: number, j: number) => c.midi(kind, id, `${p}.midi[${j}]`, m));
    if (ex.compareWith !== undefined && !exampleIds.includes(ex.compareWith)) {
      c.error("danglingReference", kind, id, `compareWith references missing example "${ex.compareWith}"`, `${p}.compareWith`);
    }
    if (!ex.symbols && !ex.midi && !ex.scale) c.warn("incompleteUnit", kind, id, "example has nothing to play", p);
  });

  if (isPublishedStatus(status)) {
    // E16: each shipped unit supports read / listen / play / variation / application.
    if (concept.examples.length === 0) c.warn("incompleteUnit", kind, id, "published concept has no audible example", "examples");
    if (concept.exerciseIds.length === 0) c.warn("incompleteUnit", kind, id, "published concept has no playable task", "exerciseIds");
    if (concept.applications.length === 0) c.warn("incompleteUnit", kind, id, "published concept has no musical application", "applications");
  }
}

function checkPath(c: Collector, path: LearningPath): void {
  const kind: ContentKind = "path";
  const id = path.id;
  const status = path.meta?.status ?? "draft";
  c.meta(kind, id, path.meta);
  c.text(kind, id, "title", path.title);
  c.text(kind, id, "description", path.description);
  checkDemand(c, kind, id, path.entry, "entry");
  if (path.units.length === 0) c.error("incompleteUnit", kind, id, "path has no units", "units");
  const seen = new Set<string>();
  path.units.forEach((unit, i: number) => {
    const key = `${unit.kind}:${unit.id}`;
    if (seen.has(key)) c.warn("duplicateId", kind, id, `unit ${key} appears more than once`, `units[${i}]`);
    seen.add(key);
    c.ref(kind, id, status, `units[${i}]`, unit.id, [unit.kind]);
  });
}

function checkPathOrder(c: Collector, path: LearningPath, bundle: ContentBundle): void {
  const position = new Map<string, number>();
  path.units.forEach((u, i: number) => {
    if (!position.has(u.id)) position.set(u.id, i);
  });
  path.units.forEach((u, i: number) => {
    let prereqs: string[] = [];
    if (u.kind === "concept") prereqs = bundle.concepts.find((x) => x.id === u.id)?.prerequisites ?? [];
    if (u.kind === "exercise") prereqs = bundle.exerciseSpecs.find((x) => x.id === u.id)?.prerequisites ?? [];
    for (const pre of prereqs) {
      const at = position.get(pre);
      // Entry routes may assume knowledge that is not in the path; only flag wrong ordering.
      if (at !== undefined && at > i) {
        c.warn("pathOrder", "path", path.id, `"${u.id}" appears before its prerequisite "${pre}"`, `units[${i}]`);
      }
    }
  });
}

function meterBeats(ts: { numerator: number; denominator: number }): number {
  return (ts.numerator * 4) / ts.denominator;
}

function checkChart(c: Collector, chart: SongChart, bundle: ContentBundle): void {
  const kind: ContentKind = "chart";
  const id = chart.id;
  const status = chart.meta?.status ?? "draft";
  c.meta(kind, id, chart.meta);
  c.text(kind, id, "title", chart.title);
  if (!Number.isInteger(chart.version) || chart.version < 1) c.error("missingMetadata", kind, id, "version must be an integer ≥ 1", "version");
  checkTimeSignature(c, kind, id, chart.timeSignature, "timeSignature");
  if (!(chart.tempo.bpm > 0)) c.error("invalidValue", kind, id, "tempo must be > 0", "tempo.bpm");
  if (!chart.provenance || !["original", "userImport", "cleared"].includes(chart.provenance.origin)) {
    c.error("missingMetadata", kind, id, "provenance.origin is required", "provenance");
  }
  if (chart.sections.length === 0) c.error("incompleteUnit", kind, id, "chart has no sections", "sections");

  checkUniqueLocal(c, kind, id, "section", chart.sections.map((s) => s.id));
  const barIds: string[] = [];
  const spanIds: string[] = [];
  const meter = meterBeats(chart.timeSignature);
  const firstSectionId = chart.performanceOrder[0];

  chart.sections.forEach((section, si: number) => {
    const sp = `sections[${si}]`;
    if (section.repeat !== undefined && (!Number.isInteger(section.repeat) || section.repeat < 1)) {
      c.error("invalidValue", kind, id, "repeat must be an integer ≥ 1", `${sp}.repeat`);
    }
    if (section.bars.length === 0) c.error("incompleteUnit", kind, id, `section "${section.id}" has no bars`, `${sp}.bars`);
    section.bars.forEach((bar, bi: number) => {
      const bp = `${sp}.bars[${bi}]`;
      barIds.push(bar.id);
      const expected = bar.beats ?? meter;
      if (bar.beats !== undefined && bar.beats !== meter) {
        const isOpeningBar = section.id === firstSectionId && bi === 0;
        if (!isOpeningBar) c.warn("barDuration", kind, id, `bar "${bar.id}" is ${bar.beats} beats but is not the opening pickup bar`, `${bp}.beats`);
        else if (chart.pickupBeats !== undefined && chart.pickupBeats !== bar.beats) {
          c.warn("barDuration", kind, id, `pickup bar is ${bar.beats} beats but pickupBeats is ${chart.pickupBeats}`, `${bp}.beats`);
        }
      }
      if (bar.spans.length === 0) c.error("barDuration", kind, id, `bar "${bar.id}" has no spans`, `${bp}.spans`);
      let cursor = 0;
      let total = 0;
      bar.spans.forEach((span, ki: number) => {
        const kp = `${bp}.spans[${ki}]`;
        spanIds.push(span.id);
        if (!(span.durationBeats > 0)) c.error("barDuration", kind, id, `span "${span.id}" needs a positive duration`, `${kp}.durationBeats`);
        if (Math.abs(span.startBeat - cursor) > 1e-9) {
          c.error("spanLayout", kind, id, `span "${span.id}" starts at beat ${span.startBeat}, expected ${cursor} (gap or overlap)`, `${kp}.startBeat`);
        }
        cursor = span.startBeat + span.durationBeats;
        total += span.durationBeats;
        c.chord(kind, id, `${kp}.symbol`, span.symbol, span.isRest === true || isRestSymbol(span.symbol));
      });
      if (Math.abs(total - expected) > 1e-9) {
        c.error("barDuration", kind, id, `bar "${bar.id}" spans total ${total} beats, expected ${expected}`, bp);
      }
    });
  });
  checkUniqueLocal(c, kind, id, "bar", barIds);
  checkUniqueLocal(c, kind, id, "span", spanIds);

  if (chart.performanceOrder.length === 0) c.error("performanceOrder", kind, id, "performanceOrder is empty", "performanceOrder");
  const sectionIds = new Set<string>(chart.sections.map((s) => s.id));
  chart.performanceOrder.forEach((sid: string, i: number) => {
    if (!sectionIds.has(sid)) c.error("performanceOrder", kind, id, `performanceOrder references missing section "${sid}"`, `performanceOrder[${i}]`);
  });

  chart.arrangementIds.forEach((aid: string, i: number) => {
    c.ref(kind, id, status, `arrangementIds[${i}]`, aid, ["arrangement"]);
    const arrangement = bundle.arrangements.find((a: ArrangementDefinition) => a.id === aid);
    if (arrangement && arrangement.chartId !== id) {
      c.error("wrongReferenceType", kind, id, `arrangement "${aid}" belongs to chart "${arrangement.chartId}"`, `arrangementIds[${i}]`);
    }
  });
}

function checkArrangement(c: Collector, arrangement: ArrangementDefinition, bundle: ContentBundle): void {
  const kind: ContentKind = "arrangement";
  const id = arrangement.id;
  const status = arrangement.meta?.status ?? "draft";
  c.meta(kind, id, arrangement.meta);
  c.text(kind, id, "name", arrangement.name);
  c.text(kind, id, "description", arrangement.description);
  checkDemand(c, kind, id, arrangement.demand, "demand");
  c.ref(kind, id, status, "chartId", arrangement.chartId, ["chart"]);
  const chart = bundle.charts.find((x: SongChart) => x.id === arrangement.chartId);
  if (chart && !chart.arrangementIds.includes(id)) c.warn("danglingReference", kind, id, `chart "${chart.id}" does not list this arrangement`, "chartId");

  const learner = arrangement.learnerPart;
  c.register(kind, id, "learnerPart.register", learner.register);
  c.register(kind, id, "accompaniment.register", arrangement.accompaniment.register);
  if (learner.kind === "chartOnly" && arrangement.policy.kind !== "free") {
    c.error("policyContract", kind, id, 'a chart-only learner part must use policy "free" (a symbol alone defines no exact targets)', "policy");
  }
  if (arrangement.policy.kind === "free" && learner.kind !== "chartOnly") {
    c.error("policyContract", kind, id, 'policy "free" means chart-only; set learnerPart.kind to "chartOnly"', "learnerPart.kind");
  }
  if (learner.kind === "voicingRecipe") {
    if (!learner.voicingRecipeId) c.error("unsatisfiable", kind, id, "voicingRecipe learner part needs voicingRecipeId", "learnerPart.voicingRecipeId");
    else if (!KNOWN_VOICING_RECIPE_IDS.includes(learner.voicingRecipeId)) {
      c.warn("unknownRecipe", kind, id, `voicing recipe "${learner.voicingRecipeId}" is not in KNOWN_VOICING_RECIPE_IDS`, "learnerPart.voicingRecipeId");
    }
  }
  if (learner.kind === "explicit" && !learner.explicitNotes) {
    c.error("unsatisfiable", kind, id, "explicit learner part needs explicitNotes", "learnerPart.explicitNotes");
  }
  if (arrangement.policy.kind === "exactVoicing" && learner.kind !== "explicit" && learner.kind !== "voicingRecipe") {
    c.error("unsatisfiable", kind, id, "exactVoicing needs explicit notes or a voicing recipe", "policy");
  }
  if (learner.explicitNotes) {
    const spanIds = new Set<string>();
    if (chart) for (const section of chart.sections) for (const bar of section.bars) for (const span of bar.spans) spanIds.add(span.id);
    for (const key of Object.keys(learner.explicitNotes)) {
      if (chart && !spanIds.has(key)) c.error("explicitNotesKey", kind, id, `explicitNotes key "${key}" is not a span of chart "${chart.id}"`, `learnerPart.explicitNotes.${key}`);
      learner.explicitNotes[key].forEach((n, i: number) => c.midi(kind, id, `learnerPart.explicitNotes.${key}[${i}].midi`, n.midi));
    }
  }
}

function checkRoutine(c: Collector, routine: PracticeRoutine, bundle: ContentBundle): void {
  const kind: ContentKind = "routine";
  const id = routine.id;
  const status = routine.meta?.status ?? "draft";
  c.meta(kind, id, routine.meta);
  c.text(kind, id, "title", routine.title);
  if (!Number.isInteger(routine.version) || routine.version < 1) c.error("missingMetadata", kind, id, "version must be an integer ≥ 1", "version");
  if (routine.items.length === 0) c.error("incompleteUnit", kind, id, "routine has no items", "items");
  checkUniqueLocal(c, kind, id, "routine item", routine.items.map((item) => item.id));
  const target: Record<string, ContentKind> = { exercise: "exercise", chart: "chart", concept: "concept", warmup: "warmup" };
  routine.items.forEach((item, i: number) => {
    const p = `items[${i}]`;
    const expected = target[item.kind];
    if (!expected) {
      c.error("invalidValue", kind, id, `unknown item kind "${String(item.kind)}"`, `${p}.kind`);
      return;
    }
    c.ref(kind, id, status, `${p}.refId`, item.refId, [expected]);
    const s = item.settings;
    if (s.tempoBpm !== undefined && !(s.tempoBpm > 0)) c.error("invalidValue", kind, id, "tempoBpm must be > 0", `${p}.settings.tempoBpm`);
    if (s.repeats !== undefined && (!Number.isInteger(s.repeats) || s.repeats < 1)) c.error("invalidValue", kind, id, "repeats must be an integer ≥ 1", `${p}.settings.repeats`);
    c.register(kind, id, `${p}.settings.range`, s.range);
    if (s.sectionId !== undefined) {
      if (item.kind !== "chart") c.warn("invalidValue", kind, id, "sectionId only applies to chart items", `${p}.settings.sectionId`);
      const chart = bundle.charts.find((x: SongChart) => x.id === item.refId);
      if (chart && !chart.sections.some((sec) => sec.id === s.sectionId)) {
        c.error("danglingReference", kind, id, `section "${s.sectionId}" does not exist in chart "${chart.id}"`, `${p}.settings.sectionId`);
      }
    }
  });
}

function checkWarmup(c: Collector, w: WarmupSpec): void {
  const kind: ContentKind = "warmup";
  const id = w.id;
  c.versionStatus(kind, id, w.version, w.status, "spec");
  c.review(kind, id, w.status, w.author, w.reviewer, "spec");
  c.text(kind, id, "title", w.title);
  c.text(kind, id, "objective", w.objective);
  checkDemand(c, kind, id, w.demand, "demand");
  checkTimeSignature(c, kind, id, w.timeSignature, "timeSignature");
  if (!(w.tempoBpm > 0)) c.error("invalidValue", kind, id, "tempoBpm must be > 0", "tempoBpm");
  w.conceptIds.forEach((ref: string, i: number) => c.ref(kind, id, w.status, `conceptIds[${i}]`, ref, ["concept"]));
  if (w.steps.length === 0) c.error("unsatisfiable", kind, id, "warm-up has no steps", "steps");
  w.steps.forEach((step, i: number) => {
    if (!(step.durationBeats > 0)) c.error("invalidValue", kind, id, "durationBeats must be > 0", `steps[${i}].durationBeats`);
    step.notes.forEach((n, j: number) => c.midi(kind, id, `steps[${i}].notes[${j}].midi`, n.midi));
  });
  if (w.status === "reviewed" && !w.reviewed) c.error("reviewMetadata", kind, id, "a reviewed warm-up needs reviewed: true (pianist review)", "reviewed");
  if (w.guidance.kind !== "authoredGuidance" || w.guidance.text.length === 0) {
    c.error("missingMetadata", kind, id, "warm-ups need authored guidance text, marked as guidance", "guidance");
  }
  if (w.measuredObservations.includes("handSynchrony") && w.handAttribution.kind === "none") {
    c.error("unsatisfiable", kind, id, "handSynchrony needs an explicit hand-attribution assumption", "handAttribution");
  }
  if (w.hands === "both" && w.handAttribution.kind === "none") {
    c.warn("unsatisfiable", kind, id, "two-hand warm-up without a hand-attribution assumption; per-hand feedback will be omitted", "handAttribution");
  }
  if (!w.reviewed && w.steps.some((s) => s.notes.some((n) => n.finger !== undefined))) {
    c.warn("reviewMetadata", kind, id, "unreviewed warm-up carries finger numbers; they must not be displayed", "steps");
  }
}

function checkMelody(c: Collector, m: MelodySpec): void {
  const kind: ContentKind = "melody";
  const id = m.id;
  c.versionStatus(kind, id, m.version, m.status, "spec");
  c.review(kind, id, m.status, m.author, m.reviewer, "spec");
  c.text(kind, id, "title", m.title);
  checkTimeSignature(c, kind, id, m.timeSignature, "timeSignature");
  m.conceptIds.forEach((ref: string, i: number) => c.ref(kind, id, m.status, `conceptIds[${i}]`, ref, ["concept"]));
  if (m.notes.length === 0) c.error("melody", kind, id, "melody has no notes", "notes");
  let end = 0;
  let prevStart = -Infinity;
  m.notes.forEach((n, i: number) => {
    c.midi(kind, id, `notes[${i}].midi`, n.midi);
    if (!(n.durationBeats > 0) || n.startBeat < 0) c.error("melody", kind, id, "note needs startBeat ≥ 0 and positive duration", `notes[${i}]`);
    if (n.startBeat < prevStart) c.error("melody", kind, id, "notes must be in start order", `notes[${i}].startBeat`);
    prevStart = n.startBeat;
    end = Math.max(end, n.startBeat + n.durationBeats);
  });
  if (!(m.harmonicRhythmBeats > 0)) {
    c.error("melody", kind, id, "harmonicRhythmBeats must be > 0", "harmonicRhythmBeats");
    return;
  }
  const slots = Math.ceil(end / m.harmonicRhythmBeats - 1e-9);
  m.palette.forEach((s: string, i: number) => c.chord(kind, id, `palette[${i}]`, s, false));
  if (m.solutions.length < 2) c.warn("melody", kind, id, `melody has ${m.solutions.length} solution(s); at least two are expected`, "solutions");
  checkUniqueLocal(c, kind, id, "solution", m.solutions.map((s) => s.id));
  m.solutions.forEach((sol, i: number) => {
    const p = `solutions[${i}]`;
    if (sol.chords.length !== slots) c.error("melody", kind, id, `solution "${sol.id}" has ${sol.chords.length} chords for ${slots} harmonic-rhythm slots`, `${p}.chords`);
    sol.chords.forEach((ch: string, j: number) => {
      if (!m.palette.includes(ch)) c.error("melody", kind, id, `solution "${sol.id}" uses "${ch}", which is not in the palette`, `${p}.chords[${j}]`);
    });
    if (sol.explanation.length === 0) c.warn("melody", kind, id, `solution "${sol.id}" has no explanation`, `${p}.explanation`);
  });
  if (m.assumptions.length === 0) c.warn("melody", kind, id, "style assumptions should be stated", "assumptions");
}

/** Find prerequisite cycles across concepts and exercises (DFS, each cycle reported once). */
export function findPrerequisiteCycles(bundle: ContentBundle): string[][] {
  const edges = new Map<string, string[]>();
  for (const concept of bundle.concepts) edges.set(concept.id, concept.prerequisites.filter((p: string) => p !== concept.id));
  for (const spec of bundle.exerciseSpecs) edges.set(spec.id, spec.prerequisites.filter((p: string) => p !== spec.id));
  const state = new Map<string, 1 | 2>(); // 1 = on stack, 2 = done
  const stack: string[] = [];
  const cycles: string[][] = [];
  const seenCycles = new Set<string>();

  const visit = (node: string): void => {
    state.set(node, 1);
    stack.push(node);
    for (const next of edges.get(node) ?? []) {
      if (!edges.has(next)) continue;
      const s = state.get(next);
      if (s === 1) {
        const cycle = stack.slice(stack.indexOf(next));
        const minIndex = cycle.indexOf([...cycle].sort()[0]);
        const canonical = [...cycle.slice(minIndex), ...cycle.slice(0, minIndex)];
        const key = canonical.join(">");
        if (!seenCycles.has(key)) {
          seenCycles.add(key);
          cycles.push([...canonical, canonical[0]]);
        }
      } else if (s === undefined) {
        visit(next);
      }
    }
    stack.pop();
    state.set(node, 2);
  };

  for (const node of edges.keys()) if (!state.has(node)) visit(node);
  return cycles;
}

export function validateContent(bundle: ContentBundle): ValidationIssue[] {
  const c = new Collector(buildIndex(bundle));

  checkUnique(c, "concept", bundle.concepts);
  checkUnique(c, "path", bundle.paths);
  checkUnique(c, "exercise", bundle.exerciseSpecs);
  checkUnique(c, "chart", bundle.charts);
  checkUnique(c, "arrangement", bundle.arrangements);
  checkUnique(c, "routine", bundle.routines);
  checkUnique(c, "warmup", bundle.warmups);
  checkUnique(c, "melody", bundle.melodies);

  const exerciseIds = new Set<string>(bundle.exerciseSpecs.map((e: ExerciseSpec) => e.id));
  for (const concept of bundle.concepts) checkConcept(c, concept);
  for (const spec of bundle.exerciseSpecs) checkExercise(c, spec, exerciseIds);
  for (const path of bundle.paths) {
    checkPath(c, path);
    checkPathOrder(c, path, bundle);
  }
  for (const chart of bundle.charts) checkChart(c, chart, bundle);
  for (const arrangement of bundle.arrangements) checkArrangement(c, arrangement, bundle);
  for (const routine of bundle.routines) checkRoutine(c, routine, bundle);
  for (const warmup of bundle.warmups) checkWarmup(c, warmup);
  for (const melody of bundle.melodies) checkMelody(c, melody);

  for (const cycle of findPrerequisiteCycles(bundle)) {
    const first = cycle[0];
    const kind: ContentKind = exerciseIds.has(first) ? "exercise" : "concept";
    c.error("prerequisiteCycle", kind, first, `prerequisite cycle: ${cycle.join(" → ")}`, "prerequisites");
  }

  return c.issues;
}

export function formatIssue(issue: ValidationIssue): string {
  const where = issue.path ? ` (${issue.path})` : "";
  return `[${issue.severity}] ${issue.kind} "${issue.id}"${where}: ${issue.code} — ${issue.message}`;
}

// ---------------------------------------------------------------------------
// Manifest and publishing filter
// ---------------------------------------------------------------------------

export interface ManifestEntry {
  kind: ContentKind;
  id: string;
  title: string;
  status: ContentStatus;
}

/** Lists of `${kind}:${id}` keys by status, plus the full entry list. */
export interface ContentManifest {
  reviewed: string[];
  draft: string[];
  unavailable: string[];
  deferred: string[];
  entries: ManifestEntry[];
}

export function manifestKey(kind: ContentKind, id: string): string {
  return `${kind}:${id}`;
}

export function buildManifest(bundle: ContentBundle): ContentManifest {
  const manifest: ContentManifest = { reviewed: [], draft: [], unavailable: [], deferred: [], entries: [] };
  const push = (kind: ContentKind, id: string, title: string, status: ContentStatus): void => {
    manifest.entries.push({ kind, id, title, status });
    manifest[status].push(manifestKey(kind, id));
  };
  for (const x of bundle.concepts) push("concept", x.id, x.title, x.meta.status);
  for (const x of bundle.paths) push("path", x.id, x.title, x.meta.status);
  for (const x of bundle.exerciseSpecs) push("exercise", x.id, x.title, x.status);
  for (const x of bundle.charts) push("chart", x.id, x.title, x.meta.status);
  for (const x of bundle.arrangements) push("arrangement", x.id, x.name, x.meta.status);
  for (const x of bundle.routines) push("routine", x.id, x.title, x.meta.status);
  for (const x of bundle.warmups) push("warmup", x.id, x.title, x.status);
  for (const x of bundle.melodies) push("melody", x.id, x.title, x.status);
  return manifest;
}

/**
 * Keep only reviewed and draft items (callers must flag drafts visibly). Unavailable and
 * deferred items are removed, and references to removed items are pruned so the result
 * contains no dangling links.
 */
export function publishedOnly(bundle: ContentBundle): ContentBundle {
  const concepts = bundle.concepts.filter((x) => isPublishedStatus(x.meta.status));
  const exerciseSpecs = bundle.exerciseSpecs.filter((x) => isPublishedStatus(x.status));
  const charts0 = bundle.charts.filter((x) => isPublishedStatus(x.meta.status));
  const chartIds0 = new Set<string>(charts0.map((x) => x.id));
  const arrangements = bundle.arrangements.filter((x) => isPublishedStatus(x.meta.status) && chartIds0.has(x.chartId));
  const warmups = bundle.warmups.filter((x) => isPublishedStatus(x.status));
  const melodies = bundle.melodies.filter((x) => isPublishedStatus(x.status));

  const ids: Record<ContentKind, Set<string>> = {
    concept: new Set<string>(concepts.map((x) => x.id)),
    exercise: new Set<string>(exerciseSpecs.map((x) => x.id)),
    chart: chartIds0,
    arrangement: new Set<string>(arrangements.map((x) => x.id)),
    warmup: new Set<string>(warmups.map((x) => x.id)),
    melody: new Set<string>(melodies.map((x) => x.id)),
    routine: new Set<string>(),
    path: new Set<string>(),
  };

  const routines = bundle.routines
    .filter((x) => isPublishedStatus(x.meta.status))
    .map((r: PracticeRoutine): PracticeRoutine => ({ ...r, items: r.items.filter((item) => ids[item.kind].has(item.refId)) }));
  for (const r of routines) ids.routine.add(r.id);

  const paths = bundle.paths
    .filter((x) => isPublishedStatus(x.meta.status))
    .map((p: LearningPath): LearningPath => ({ ...p, units: p.units.filter((u) => ids[u.kind].has(u.id)) }));

  const playable = (id: string): boolean => ids.exercise.has(id) || ids.warmup.has(id);
  return {
    concepts: concepts.map((x: ConceptDefinition): ConceptDefinition => ({
      ...x,
      prerequisites: x.prerequisites.filter((id: string) => ids.concept.has(id)),
      related: x.related.filter((id: string) => ids.concept.has(id)),
      exerciseIds: x.exerciseIds.filter(playable),
      applications: x.applications.filter(
        (a) =>
          (a.chartId === undefined || ids.chart.has(a.chartId)) &&
          (a.exerciseId === undefined || playable(a.exerciseId)) &&
          (a.conceptId === undefined || ids.concept.has(a.conceptId)),
      ),
    })),
    paths,
    exerciseSpecs,
    charts: charts0.map((x: SongChart): SongChart => ({ ...x, arrangementIds: x.arrangementIds.filter((id: string) => ids.arrangement.has(id)) })),
    arrangements,
    routines,
    warmups,
    melodies,
  };
}
