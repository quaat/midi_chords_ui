/**
 * Songs view logic (plan E30): chart list merging with provenance badges, arrangement choice
 * for content and user charts, expected-task summaries, an undo/redo history over the
 * src/charts editor ops, working copies, grid rows and cursor labels. React-free and tested.
 */
import type { AccompanimentPatternId, ArrangementDefinition, ChordRole, SongChart } from "@/model/contracts";
import { getArrangement } from "@/content";
import type { ChartCursor, ChartExpansion, ExpandedBar } from "@/charts/expand";
import type { ArrangementTask, CompiledArrangement } from "@/charts/arrangement";
import type { ChartEditResult, ChartFromTextOptions } from "@/charts/editor";
import type { ChartSummary } from "@/persistence/charts";
import { policyExplanation, policyLabel, roleList } from "@/ui/learn/learnLogic";

export { policyExplanation, policyLabel };

// ---------------------------------------------------------------------------
// Chart list
// ---------------------------------------------------------------------------

export type ChartSource = "content" | "user";

export interface ChartListItem {
  id: string;
  title: string;
  source: ChartSource;
  badges: string[];
  /** Content charts can only be duplicated, never deleted. */
  canDelete: boolean;
  /** Set when a saved chart cannot be opened. */
  problem?: string;
}

export function contentBadges(chart: SongChart): string[] {
  const badges: string[] = [];
  if (chart.provenance.origin === "original") badges.push("original");
  else if (chart.provenance.origin === "cleared") badges.push("cleared");
  else badges.push("import");
  if (chart.meta.status === "draft") badges.push("draft");
  return badges;
}

export function userBadges(summary: Pick<ChartSummary, "origin" | "problem">): string[] {
  if (summary.problem) return ["cannot open"];
  if (summary.origin === "userImport") return ["local import"];
  return ["my copy", "local"];
}

/** Content charts first (bundle order), then the user's saved charts (store order). */
export function mergeChartLists(content: readonly SongChart[], user: readonly ChartSummary[]): ChartListItem[] {
  const items: ChartListItem[] = content.map((chart: SongChart) => ({
    id: chart.id,
    title: chart.title,
    source: "content" as ChartSource,
    badges: contentBadges(chart),
    canDelete: false
  }));
  user.forEach((summary: ChartSummary) => {
    const item: ChartListItem = { id: summary.id, title: summary.title, source: "user", badges: userBadges(summary), canDelete: true };
    if (summary.problem) item.problem = summary.problem;
    items.push(item);
  });
  return items;
}

// ---------------------------------------------------------------------------
// Ids, new charts, copies
// ---------------------------------------------------------------------------

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "chart";
}

/** `base`, or `base-2`, `base-3` ... not in `taken`. */
export function uniqueChartId(base: string, taken: readonly string[]): string {
  const set = new Set<string>(taken);
  if (!set.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!set.has(candidate)) return candidate;
  }
}

export const DEFAULT_CHORD_TEXT_TEMPO = 90;

/** Options for `chartFromChordText`: 4/4, 90 BPM, one bar per line, a fresh local id. */
export function chordTextImportOptions(title: string, taken: readonly string[]): ChartFromTextOptions {
  const cleanTitle = title.trim() || "Untitled chart";
  return {
    title: cleanTitle,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: DEFAULT_CHORD_TEXT_TEMPO,
    defaultMeasures: 1,
    id: uniqueChartId(`my-${slugify(cleanTitle)}`, taken),
    origin: "userImport"
  };
}

/** A new local chart: one section "A" of four empty (NC) 4/4 bars. */
export function blankChart(title: string, taken: readonly string[]): SongChart {
  const cleanTitle = title.trim() || "Untitled chart";
  const id = uniqueChartId(`my-${slugify(cleanTitle)}`, taken);
  const bars = [1, 2, 3, 4].map((n: number) => ({
    id: `bar${n}`,
    spans: [{ id: `bar${n}-s1`, symbol: "NC", startBeat: 0, durationBeats: 4, isRest: true }]
  }));
  return {
    id,
    version: 1,
    title: cleanTitle,
    timeSignature: { numerator: 4, denominator: 4 },
    tempo: { bpm: DEFAULT_CHORD_TEXT_TEMPO },
    sections: [{ id: "A", label: "A", bars }],
    performanceOrder: ["A"],
    provenance: { origin: "userImport", note: "Created locally in this browser." },
    arrangementIds: [],
    meta: { version: 1, status: "draft" }
  };
}

function cloneChart(chart: SongChart): SongChart {
  return JSON.parse(JSON.stringify(chart)) as SongChart;
}

/**
 * A local copy of a chart (duplicate or "Save as mine"). Arrangement ids are kept so the
 * content arrangements still apply; provenance records where it came from.
 */
export function copyChart(chart: SongChart, taken: readonly string[], titleSuffix: string = "(my copy)"): SongChart {
  const copy = cloneChart(chart);
  const title = `${chart.title} ${titleSuffix}`.trim();
  copy.id = uniqueChartId(`${slugify(chart.title)}-mine`, taken);
  copy.title = title;
  copy.version = 1;
  const origin = chart.provenance.origin;
  copy.provenance = {
    origin,
    note: `Local copy of “${chart.title}” (${chart.id} v${chart.version}); stays in this browser.${chart.provenance.note ? ` Original note: ${chart.provenance.note}` : ""}`
  };
  if (chart.provenance.author !== undefined) copy.provenance.author = chart.provenance.author;
  copy.meta = { ...copy.meta, status: "draft" };
  return copy;
}

/** Give an imported chart a fresh id when its id is already used. */
export function withFreeId(chart: SongChart, taken: readonly string[]): SongChart {
  if (!taken.includes(chart.id)) return chart;
  return { ...chart, id: uniqueChartId(chart.id, taken) };
}

// ---------------------------------------------------------------------------
// Arrangements
// ---------------------------------------------------------------------------

/**
 * Arrangements offered for a chart: the content arrangements it names (re-bound to this
 * chart's id, so copies keep them), otherwise three generic presets.
 */
export function arrangementsForChart(chart: SongChart): ArrangementDefinition[] {
  const named: ArrangementDefinition[] = [];
  chart.arrangementIds.forEach((id: string) => {
    const found = getArrangement(id);
    if (found) named.push({ ...found, chartId: chart.id });
  });
  if (named.length > 0) return named;
  return defaultArrangements(chart.id);
}

export function defaultArrangements(chartId: string): ArrangementDefinition[] {
  const meta = { version: 1, status: "draft" as const };
  return [
    {
      id: `${chartId}~roots`,
      chartId,
      name: "Simple: bass notes",
      description: "Play the root (or the written slash bass) of each chord with the left hand while the accompaniment sustains the chords.",
      demand: "beginner",
      learnerPart: { kind: "roots", hand: "left", register: { low: 36, high: 55 } },
      accompaniment: { pattern: "sustained", register: { low: 55, high: 76 } },
      policy: { kind: "pitchClass" },
      meta
    },
    {
      id: `${chartId}~triads`,
      chartId,
      name: "Richer: right-hand triads",
      description: "Play the triad of each chord in the right hand, any inversion, over roots in the accompaniment.",
      demand: "intermediate",
      learnerPart: { kind: "blockTriads", hand: "right", register: { low: 57, high: 76 } },
      accompaniment: { pattern: "rootOnly", register: { low: 36, high: 52 } },
      policy: { kind: "roles", requiredRoles: ["root", "third", "fifth"], octaveFree: true },
      meta
    },
    {
      id: `${chartId}~chart-only`,
      chartId,
      name: "Chart only: comp freely",
      description: "Read the symbols and comp however you like. Nothing is scored.",
      demand: "intermediate",
      learnerPart: { kind: "chartOnly" },
      accompaniment: { pattern: "rootOnly", register: { low: 36, high: 52 } },
      policy: { kind: "free" },
      meta
    }
  ];
}

export function accompanimentLabel(pattern: AccompanimentPatternId): string {
  switch (pattern) {
    case "sustained":
      return "sustained chords";
    case "bassAndChord":
      return "bass and chord";
    case "rootOnly":
      return "roots";
    case "none":
      return "nothing";
  }
}

export function learnerPartLabel(arrangement: ArrangementDefinition): string {
  const part = arrangement.learnerPart;
  const hand = part.hand === "left" ? "left hand" : part.hand === "right" ? "right hand" : part.hand === "both" ? "both hands" : "either hand";
  switch (part.kind) {
    case "roots":
      return `bass notes (${hand})`;
    case "blockTriads":
      return `block triads (${hand})`;
    case "voicingRecipe":
      return `${part.voicingRecipeId ?? "voicing"} voicings (${hand})`;
    case "explicit":
      return `authored notes (${hand})`;
    case "chartOnly":
      return "anything you like from the chart";
  }
}

// ---------------------------------------------------------------------------
// Expected tasks
// ---------------------------------------------------------------------------

export interface ExpectedTaskSummary {
  /** "This arrangement asks for: 16 chords, required roles root, 3 and 5, accompaniment plays roots" */
  headline: string;
  details: string[];
  chordCount: number;
  scoredCount: number;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Summarise what an arrangement actually asks the learner to play (from compileArrangement). */
export function expectedTasksSummary(tasks: readonly ArrangementTask[], arrangement: ArrangementDefinition): ExpectedTaskSummary {
  const chords = tasks.filter((task: ArrangementTask) => !task.isRest);
  const scored = chords.filter((task: ArrangementTask) => task.assessed).length;
  const rests = tasks.length - chords.length;
  const accompaniment = `accompaniment plays ${accompanimentLabel(arrangement.accompaniment.pattern)}`;
  const policy = arrangement.policy;
  let ask = "";
  switch (policy.kind) {
    case "exactVoicing":
      ask = `${plural(chords.length, "chord")}, exact notes`;
      break;
    case "roles": {
      const optional = policy.optionalRoles && policy.optionalRoles.length > 0 ? `, optional ${roleList(policy.optionalRoles)}` : "";
      ask = `${plural(chords.length, "chord")}, required roles ${roleList(policy.requiredRoles)}${optional}${policy.octaveFree ? " (any inversion)" : ""}`;
      break;
    }
    case "pitchClass":
      ask = `${plural(chords.length, "chord")}, ${arrangement.learnerPart.kind === "roots" ? "the bass note of each" : "the notes shown"} in any octave`;
      break;
    case "listen":
      ask = `listening to ${plural(chords.length, "chord")}, nothing scored`;
      break;
    case "free":
      ask = `${plural(chords.length, "chord symbol")} to comp from, nothing scored`;
      break;
  }
  const details: string[] = [];
  details.push(`You play: ${learnerPartLabel(arrangement)}.`);
  details.push(scored > 0 ? `${plural(scored, "chord")} are checked; ${policyExplanation(policy)}` : "Nothing is checked: silence is never a missed note.");
  if (rests > 0) details.push(`${plural(rests, "rest")} (NC): nothing to play.`);
  const roles = new Set<ChordRole>();
  chords.forEach((task: ArrangementTask) => task.targets.forEach((note) => {
    if (note.role) roles.add(note.role);
  }));
  if (roles.size > 0 && policy.kind !== "roles") details.push(`Shown notes cover: ${roleList(Array.from(roles))}.`);
  return { headline: `This arrangement asks for: ${ask}, ${accompaniment}`, details, chordCount: chords.length, scoredCount: scored };
}

export function summaryFromCompiled(compiled: CompiledArrangement, arrangement: ArrangementDefinition): ExpectedTaskSummary {
  return expectedTasksSummary(compiled.expectedTasks, arrangement);
}

// ---------------------------------------------------------------------------
// Undo / redo over editor ops
// ---------------------------------------------------------------------------

export const UNDO_LIMIT = 50;

export interface ChartHistory {
  past: SongChart[];
  present: SongChart;
  future: SongChart[];
}

export function createHistory(chart: SongChart): ChartHistory {
  return { past: [], present: chart, future: [] };
}

/** Replace the present with a new chart (keeps at most UNDO_LIMIT undo steps). */
export function pushChart(history: ChartHistory, chart: SongChart): ChartHistory {
  const past = [...history.past, history.present];
  while (past.length > UNDO_LIMIT) past.shift();
  return { past, present: chart, future: [] };
}

/** Apply an editor-op result: success pushes the new chart, failure keeps the history. */
export function applyEdit(history: ChartHistory, result: ChartEditResult): { history: ChartHistory; error: string | null } {
  if (!result.ok) return { history, error: result.reason };
  return { history: pushChart(history, result.chart), error: null };
}

export function canUndo(history: ChartHistory): boolean {
  return history.past.length > 0;
}

export function canRedo(history: ChartHistory): boolean {
  return history.future.length > 0;
}

export function undo(history: ChartHistory): ChartHistory {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1];
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}

export function redo(history: ChartHistory): ChartHistory {
  if (history.future.length === 0) return history;
  const next = history.future[0];
  return { past: [...history.past, history.present], present: next, future: history.future.slice(1) };
}

// ---------------------------------------------------------------------------
// Grid rows, section choices and the cursor label
// ---------------------------------------------------------------------------

export interface GridRow {
  key: string;
  sectionId: string;
  label: string;
  orderIndex: number;
  repeatIndex: number;
  /** 1-based performance pass of this section (repeats and order entries count). */
  pass: number;
  bars: ExpandedBar[];
  startBeat: number;
  endBeat: number;
}

/** One row per performed section pass, in performance order. */
export function gridRows(expansion: ChartExpansion): GridRow[] {
  const rows: GridRow[] = [];
  const passes = new Map<string, number>();
  expansion.bars.forEach((bar: ExpandedBar) => {
    const last = rows[rows.length - 1];
    if (last && last.orderIndex === bar.orderIndex && last.repeatIndex === bar.repeatIndex) {
      last.bars.push(bar);
      last.endBeat = bar.startBeat + bar.beats;
      return;
    }
    const pass = (passes.get(bar.sectionId) ?? 0) + 1;
    passes.set(bar.sectionId, pass);
    rows.push({
      key: `${bar.orderIndex}.${bar.repeatIndex}`,
      sectionId: bar.sectionId,
      label: bar.sectionLabel,
      orderIndex: bar.orderIndex,
      repeatIndex: bar.repeatIndex,
      pass,
      bars: [bar],
      startBeat: bar.startBeat,
      endBeat: bar.startBeat + bar.beats
    });
  });
  return rows;
}

export interface SectionChoice {
  /** `${sectionId}#${orderIndex}` */
  value: string;
  sectionId: string;
  orderIndex: number;
  label: string;
  startBeat: number;
  endBeat: number;
}

/** Loop choices: every performance of every section, labelled with pass and bar numbers. */
export function sectionChoices(expansion: ChartExpansion): SectionChoice[] {
  const passes = new Map<string, number>();
  return expansion.sections.map((section) => {
    const pass = (passes.get(section.sectionId) ?? 0) + 1;
    passes.set(section.sectionId, pass);
    const first = section.firstBarIndex + 1;
    const last = section.firstBarIndex + section.barCount;
    return {
      value: `${section.sectionId}#${section.orderIndex}`,
      sectionId: section.sectionId,
      orderIndex: section.orderIndex,
      label: `${section.label}${pass > 1 ? ` (pass ${pass})` : ""} · bars ${first}${last > first ? `–${last}` : ""}`,
      startBeat: section.startBeat,
      endBeat: section.endBeat
    };
  });
}

export function parseSectionChoice(value: string): { sectionId: string; orderIndex: number } | null {
  const index = value.lastIndexOf("#");
  if (index <= 0) return null;
  const orderIndex = Number(value.slice(index + 1));
  if (!Number.isInteger(orderIndex) || orderIndex < 0) return null;
  return { sectionId: value.slice(0, index), orderIndex };
}

function formatBeat(value: number): string {
  return String(Math.floor(value + 1e-6) + 1);
}

/** "Bar 3 · beat 2 · A pass 2 · Am", "Count-in · 2 beats", "Pickup · beat 1 · NC", "End". */
export function cursorLabel(cursor: ChartCursor, expansion: ChartExpansion): string {
  if (cursor.state === "countIn") {
    const remaining = Math.max(1, Math.ceil(-cursor.beatInBar - 1e-6));
    return `Count-in · ${plural(remaining, "beat")} to go`;
  }
  if (cursor.state === "ended") return "End";
  const bar = expansion.bars[cursor.barIndex];
  if (!bar) return "";
  const rows = gridRows(expansion);
  const row = rows.find((candidate) => candidate.orderIndex === bar.orderIndex && candidate.repeatIndex === bar.repeatIndex);
  const section = `${bar.sectionLabel}${row && row.pass > 1 ? ` pass ${row.pass}` : ""}`;
  const where = cursor.isPickup ? `Pickup (bar ${cursor.barIndex + 1})` : `Bar ${cursor.barIndex + 1}`;
  const symbol = cursor.occurrence ? ` · ${cursor.occurrence.isRest ? "rest" : cursor.occurrence.symbol}` : "";
  return `${where} · beat ${formatBeat(cursor.beatInBar)} · ${section}${symbol}`;
}

// ---------------------------------------------------------------------------
// Keys for transposition
// ---------------------------------------------------------------------------

export const TRANSPOSE_TONICS: readonly string[] = ["C", "Db", "D", "Eb", "E", "F", "F#", "Gb", "G", "Ab", "A", "Bb", "B"];

export const PROVENANCE_NOTES: readonly string[] = [
  "Bundled songs are original compositions written for this app; their arrangements are original too.",
  "Charts you import or create stay in this browser (local storage). Nothing is uploaded or shared.",
  "Supported formats: chart JSON (schema version 1, kind \"songChart\") and chord text (one “Symbol | measures” line per chord).",
  "Not supported: repeat signs, first/second endings and codas (write the performance order out instead), and audio, PDF or score import."
];
