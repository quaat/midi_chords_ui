/**
 * Pure song-chart editing operations (plan E30, E11). Every successful edit returns a NEW
 * chart with `version + 1`; the input is never mutated. Invalid edits return
 * `{ ok: false, reason }` and leave nothing half-applied.
 *
 * Also: chord-text import/export for representable material and the versioned JSON
 * envelope `{ schemaVersion: 1, kind: "songChart", chart }` shared with src/persistence.
 */
import type { ChartBar, ChartSection, ChordSpan, KeyContext, SongChart, TimeSignatureSpec } from "@/model/contracts";
import { tryChordFromSymbol } from "@/music/chords";
import { formatKey } from "@/music/scales";
import { parseChordSequence } from "@/parser/parseChordSequence";
import { validateChartShape } from "@/persistence/charts";
import { expandChart } from "@/charts/expand";
import { chartBeatsPerBar, chartErrors, isRestSymbol, meterProblem, round, spanFillProblem, validateChart } from "@/charts/validate";

export { validateChart } from "@/charts/validate";
export type { ChartIssue, ChartIssueCode } from "@/charts/validate";

export const CHART_JSON_SCHEMA_VERSION = 1;
const EPSILON = 1e-6;

export type ChartEditResult = { ok: true; chart: SongChart } | { ok: false; reason: string };

function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

function cloneChart(chart: SongChart): SongChart {
  return JSON.parse(JSON.stringify(chart)) as SongChart;
}

function done(chart: SongChart): ChartEditResult {
  return { ok: true, chart: { ...chart, version: chart.version + 1 } };
}

function allIds(chart: SongChart): Set<string> {
  const ids = new Set<string>();
  chart.sections.forEach((section) => {
    ids.add(section.id);
    section.bars.forEach((bar) => {
      ids.add(bar.id);
      bar.spans.forEach((span) => ids.add(span.id));
    });
  });
  return ids;
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

function findBar(chart: SongChart, barId: string): { section: ChartSection; bar: ChartBar; index: number } | null {
  for (const section of chart.sections) {
    const index = section.bars.findIndex((bar) => bar.id === barId);
    if (index >= 0) {
      return { section, bar: section.bars[index], index };
    }
  }
  return null;
}

function barLength(chart: SongChart, bar: ChartBar): number {
  return bar.beats ?? chartBeatsPerBar(chart);
}

function restBar(id: string, beats: number): ChartBar {
  return { id, spans: [{ id: `${id}-s1`, symbol: "NC", startBeat: 0, durationBeats: beats, isRest: true }] };
}

/** Normalise a user-entered symbol: rests become "NC"; chords must parse. */
export function checkSpanSymbol(symbol: string): { ok: true; symbol: string; isRest: boolean } | { ok: false; reason: string } {
  const trimmed = symbol.trim();
  if (!trimmed) {
    return { ok: false, reason: "Enter a chord symbol, or NC for a rest." };
  }
  if (isRestSymbol(trimmed)) {
    return { ok: true, symbol: "NC", isRest: true };
  }
  const parsed = tryChordFromSymbol(trimmed);
  if (!parsed.ok) {
    return { ok: false, reason: `"${trimmed}" is not a supported chord symbol: ${parsed.error}` };
  }
  return { ok: true, symbol: trimmed, isRest: false };
}

// ---------------------------------------------------------------------------
// Sections and order
// ---------------------------------------------------------------------------

export interface AddSectionOptions {
  id?: string;
  /** Number of empty (rest) bars to create. Default 1. */
  barCount?: number;
  /** Append the new section to the performance order. Default true. */
  appendToOrder?: boolean;
}

export function addSection(chart: SongChart, label: string, options: AddSectionOptions = {}): ChartEditResult {
  const barCount = options.barCount ?? 1;
  if (!Number.isInteger(barCount) || barCount < 1 || barCount > 64) {
    return fail(`A new section needs 1..64 bars (got ${barCount}).`);
  }
  const next = cloneChart(chart);
  const taken = allIds(next);
  const requested = options.id ?? (label.trim().replace(/\s+/g, "-") || "section");
  if (options.id !== undefined && taken.has(options.id)) {
    return fail(`Id "${options.id}" is already used in this chart.`);
  }
  const id = uniqueId(requested, taken);
  const bars: ChartBar[] = [];
  for (let index = 0; index < barCount; index += 1) {
    bars.push(restBar(uniqueId(`${id}-bar${index + 1}`, taken), chartBeatsPerBar(next)));
  }
  next.sections.push({ id, label: label.trim() || id, bars });
  if (options.appendToOrder !== false) {
    next.performanceOrder.push(id);
  }
  return done(next);
}

export function removeSection(chart: SongChart, sectionId: string): ChartEditResult {
  if (!chart.sections.some((section) => section.id === sectionId)) {
    return fail(`There is no section "${sectionId}".`);
  }
  if (chart.sections.length === 1) {
    return fail("A chart needs at least one section.");
  }
  const order = chart.performanceOrder.filter((id) => id !== sectionId);
  if (order.length === 0) {
    return fail(`Removing "${sectionId}" would leave the performance order empty; add another section to the order first.`);
  }
  const next = cloneChart(chart);
  next.sections = next.sections.filter((section) => section.id !== sectionId);
  next.performanceOrder = order;
  return done(next);
}

export function renameSection(chart: SongChart, sectionId: string, label: string): ChartEditResult {
  const trimmed = label.trim();
  if (!trimmed) {
    return fail("A section label cannot be empty.");
  }
  const next = cloneChart(chart);
  const section = next.sections.find((candidate) => candidate.id === sectionId);
  if (!section) {
    return fail(`There is no section "${sectionId}".`);
  }
  section.label = trimmed;
  return done(next);
}

export function setSectionRepeat(chart: SongChart, sectionId: string, repeat: number): ChartEditResult {
  const next = cloneChart(chart);
  const section = next.sections.find((candidate) => candidate.id === sectionId);
  if (!section) {
    return fail(`There is no section "${sectionId}".`);
  }
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 8) {
    return fail(`Repeat must be a whole number from 1 to 8 (got ${repeat}).`);
  }
  if (repeat === 1) {
    delete section.repeat;
  } else {
    section.repeat = repeat;
  }
  return done(next);
}

export function setPerformanceOrder(chart: SongChart, order: string[]): ChartEditResult {
  if (order.length === 0) {
    return fail("The performance order needs at least one section.");
  }
  const unknown = order.filter((id) => !chart.sections.some((section) => section.id === id));
  if (unknown.length > 0) {
    return fail(`Unknown section${unknown.length > 1 ? "s" : ""} in the order: ${unknown.map((id) => `"${id}"`).join(", ")}.`);
  }
  const next = cloneChart(chart);
  next.performanceOrder = [...order];
  return done(next);
}

// ---------------------------------------------------------------------------
// Bars and spans
// ---------------------------------------------------------------------------

/** Add a one-bar rest after `afterBarId` (or at the end of the section). */
export function addBar(chart: SongChart, sectionId: string, afterBarId?: string): ChartEditResult {
  const next = cloneChart(chart);
  const section = next.sections.find((candidate) => candidate.id === sectionId);
  if (!section) {
    return fail(`There is no section "${sectionId}".`);
  }
  let insertAt = section.bars.length;
  if (afterBarId !== undefined) {
    const index = section.bars.findIndex((bar) => bar.id === afterBarId);
    if (index < 0) {
      return fail(`Bar "${afterBarId}" is not in section "${section.label}".`);
    }
    insertAt = index + 1;
  }
  const taken = allIds(next);
  const id = uniqueId(`${section.id}-bar${section.bars.length + 1}`, taken);
  section.bars.splice(insertAt, 0, restBar(id, chartBeatsPerBar(next)));
  return done(next);
}

export function removeBar(chart: SongChart, barId: string): ChartEditResult {
  const next = cloneChart(chart);
  const found = findBar(next, barId);
  if (!found) {
    return fail(`There is no bar "${barId}".`);
  }
  if (found.section.bars.length === 1) {
    return fail(`Bar "${barId}" is the only bar of section "${found.section.label}"; remove the section instead.`);
  }
  found.section.bars.splice(found.index, 1);
  return done(next);
}

/** Replace a bar's spans; they must fill the bar exactly and use supported symbols. */
export function setSpans(chart: SongChart, barId: string, spans: ChordSpan[]): ChartEditResult {
  const next = cloneChart(chart);
  const found = findBar(next, barId);
  if (!found) {
    return fail(`There is no bar "${barId}".`);
  }
  const length = barLength(next, found.bar);
  const problem = spanFillProblem(spans, length);
  if (problem) {
    return fail(`Bar "${barId}" ${problem}.`);
  }
  const otherIds = allIds(next);
  found.bar.spans.forEach((span) => otherIds.delete(span.id));
  const seen = new Set<string>();
  const cleaned: ChordSpan[] = [];
  for (const span of [...spans].sort((a, b) => a.startBeat - b.startBeat)) {
    if (otherIds.has(span.id) || seen.has(span.id)) {
      return fail(`Span id "${span.id}" is already used.`);
    }
    seen.add(span.id);
    const symbol = span.isRest === true ? { ok: true as const, symbol: "NC", isRest: true } : checkSpanSymbol(span.symbol);
    if (!symbol.ok) {
      return fail(`Bar "${barId}": ${symbol.reason}`);
    }
    const copy: ChordSpan = { ...span, symbol: symbol.symbol };
    if (symbol.isRest) {
      copy.isRest = true;
    } else {
      delete copy.isRest;
    }
    cleaned.push(copy);
  }
  found.bar.spans = cleaned;
  return done(next);
}

/** Split a span into two halves with the same symbol (the second gets a new id). */
export function splitSpan(chart: SongChart, barId: string, spanId: string): ChartEditResult {
  const next = cloneChart(chart);
  const found = findBar(next, barId);
  if (!found) {
    return fail(`There is no bar "${barId}".`);
  }
  const index = found.bar.spans.findIndex((span) => span.id === spanId);
  if (index < 0) {
    return fail(`Bar "${barId}" has no span "${spanId}".`);
  }
  const span = found.bar.spans[index];
  const half = span.durationBeats / 2;
  if (half < 0.25 - EPSILON) {
    return fail(`"${span.symbol}" lasts ${span.durationBeats} beats; spans shorter than a sixteenth note are not supported.`);
  }
  const taken = allIds(next);
  const second: ChordSpan = { ...span, id: uniqueId(`${spanId}b`, taken), startBeat: round(span.startBeat + half), durationBeats: round(half) };
  found.bar.spans.splice(index, 1, { ...span, durationBeats: round(half) }, second);
  return done(next);
}

/** Merge a span with the following span in the same bar (the first span's symbol is kept). */
export function mergeSpans(chart: SongChart, barId: string, spanId: string): ChartEditResult {
  const next = cloneChart(chart);
  const found = findBar(next, barId);
  if (!found) {
    return fail(`There is no bar "${barId}".`);
  }
  const sorted = [...found.bar.spans].sort((a, b) => a.startBeat - b.startBeat);
  const index = sorted.findIndex((span) => span.id === spanId);
  if (index < 0) {
    return fail(`Bar "${barId}" has no span "${spanId}".`);
  }
  if (index === sorted.length - 1) {
    return fail(`"${sorted[index].symbol}" is the last span of bar "${barId}"; there is nothing after it to merge.`);
  }
  const merged: ChordSpan = { ...sorted[index], durationBeats: round(sorted[index].durationBeats + sorted[index + 1].durationBeats) };
  sorted.splice(index, 2, merged);
  found.bar.spans = sorted;
  return done(next);
}

/** Change a span's symbol ("NC" for a rest). The Roman numeral is cleared (it no longer applies). */
export function setSpanSymbol(chart: SongChart, barId: string, spanId: string, symbol: string): ChartEditResult {
  const checked = checkSpanSymbol(symbol);
  if (!checked.ok) {
    return fail(checked.reason);
  }
  const next = cloneChart(chart);
  const found = findBar(next, barId);
  if (!found) {
    return fail(`There is no bar "${barId}".`);
  }
  const span = found.bar.spans.find((candidate) => candidate.id === spanId);
  if (!span) {
    return fail(`Bar "${barId}" has no span "${spanId}".`);
  }
  span.symbol = checked.symbol;
  if (checked.isRest) {
    span.isRest = true;
  } else {
    delete span.isRest;
  }
  delete span.romanNumeral;
  return done(next);
}

export function setRomanNumeral(chart: SongChart, barId: string, spanId: string, romanNumeral: string | undefined): ChartEditResult {
  const next = cloneChart(chart);
  const found = findBar(next, barId);
  const span = found ? found.bar.spans.find((candidate) => candidate.id === spanId) : undefined;
  if (!span) {
    return fail(`Bar "${barId}" has no span "${spanId}".`);
  }
  if (romanNumeral === undefined || romanNumeral.trim() === "") {
    delete span.romanNumeral;
  } else {
    span.romanNumeral = romanNumeral.trim();
  }
  return done(next);
}

// ---------------------------------------------------------------------------
// Meter, tempo, key
// ---------------------------------------------------------------------------

/**
 * Change the meter. Single-span full bars are stretched/shrunk to the new bar length;
 * multi-span bars must already fit the new length exactly, otherwise the change is refused
 * with the affected bars listed. Pickup bars (bar.beats) keep their length if it still fits.
 */
export function setMeter(chart: SongChart, timeSignature: TimeSignatureSpec): ChartEditResult {
  const problem = meterProblem(timeSignature.numerator, timeSignature.denominator);
  if (problem) {
    return fail(problem);
  }
  const next = cloneChart(chart);
  const oldLength = chartBeatsPerBar(chart);
  next.timeSignature = { numerator: timeSignature.numerator, denominator: timeSignature.denominator };
  const newLength = chartBeatsPerBar(next);
  const blocked: string[] = [];
  next.sections.forEach((section) => {
    section.bars.forEach((bar) => {
      if (bar.beats !== undefined && bar.beats < oldLength - EPSILON) {
        if (bar.beats > newLength + EPSILON) {
          blocked.push(`${bar.id} (pickup of ${bar.beats} beats is longer than the new bar)`);
        }
        return;
      }
      delete bar.beats;
      if (bar.spans.length === 1) {
        bar.spans[0].startBeat = 0;
        bar.spans[0].durationBeats = newLength;
        return;
      }
      if (spanFillProblem(bar.spans, newLength)) {
        blocked.push(bar.id);
      }
    });
  });
  if (blocked.length > 0) {
    return fail(`Changing to ${timeSignature.numerator}/${timeSignature.denominator} would leave these bars with the wrong number of beats: ${blocked.join(", ")}. Edit their chord spans first.`);
  }
  return done(next);
}

export function setTempo(chart: SongChart, bpm: number): ChartEditResult {
  if (!Number.isFinite(bpm) || bpm < 20 || bpm > 400) {
    return fail(`Tempo must be between 20 and 400 BPM (got ${bpm}).`);
  }
  const next = cloneChart(chart);
  next.tempo = { bpm };
  return done(next);
}

/** Set (or clear) the key context. Symbols are not changed; use transposeChart to move them. */
export function setKey(chart: SongChart, key: KeyContext | undefined): ChartEditResult {
  const next = cloneChart(chart);
  if (key === undefined) {
    delete next.key;
  } else {
    next.key = { tonic: { letter: key.tonic.letter, accidental: key.tonic.accidental }, mode: key.mode };
  }
  return done(next);
}

export function setTitle(chart: SongChart, title: string): ChartEditResult {
  const trimmed = title.trim();
  if (!trimmed) {
    return fail("A chart title cannot be empty.");
  }
  const next = cloneChart(chart);
  next.title = trimmed;
  return done(next);
}

// ---------------------------------------------------------------------------
// Chord text
// ---------------------------------------------------------------------------

export interface ChartFromTextOptions {
  title: string;
  timeSignature: TimeSignatureSpec;
  tempo: number;
  /** Measures for lines without "| n". */
  defaultMeasures: number;
  id?: string;
  key?: KeyContext;
  origin?: SongChart["provenance"]["origin"];
}

export type ChartFromTextResult = { ok: true; chart: SongChart; notes: string[] } | { ok: false; reason: string; errors: string[] };

/**
 * Build a one-section chart from legacy chord text (`Symbol | measures`, one chord per line).
 * Whole-measure lines become that many bars of the chord (each bar re-states the symbol);
 * fractional lines become spans inside a bar as long as they do not cross a bar line, and
 * the last bar must be complete. Pickups, sections and repeats cannot be expressed in chord
 * text.
 */
export function chartFromChordText(text: string, options: ChartFromTextOptions): ChartFromTextResult {
  const meter = meterProblem(options.timeSignature.numerator, options.timeSignature.denominator);
  if (meter) {
    return { ok: false, reason: meter, errors: [meter] };
  }
  const parsed = parseChordSequence(text, options.defaultMeasures);
  if (parsed.errors.length > 0) {
    const errors = parsed.errors.map((error) => `Line ${error.line}: ${error.message}`);
    return { ok: false, reason: errors[0], errors };
  }
  if (parsed.events.length === 0) {
    return { ok: false, reason: "The chord text has no chords.", errors: ["The chord text has no chords."] };
  }
  const fullBar = (options.timeSignature.numerator * 4) / options.timeSignature.denominator;
  const notes: string[] = [];
  const bars: ChartBar[] = [];
  let current: ChordSpan[] = [];
  let position = 0;
  let spanCounter = 0;
  const closeBar = (): void => {
    const id = `bar${bars.length + 1}`;
    bars.push({ id, spans: current.map((span, index) => ({ ...span, id: `${id}-s${index + 1}` })) });
    current = [];
    position = 0;
  };
  for (const line of parsed.events) {
    const symbol = line.isRest ? "NC" : line.chordSymbol.trim();
    const beats = round(line.durationMeasures * fullBar);
    const makeSpan = (start: number, duration: number): ChordSpan => {
      spanCounter += 1;
      const span: ChordSpan = { id: `tmp${spanCounter}`, symbol, startBeat: round(start), durationBeats: round(duration) };
      if (line.isRest) span.isRest = true;
      return span;
    };
    if (position < EPSILON && beats >= fullBar - EPSILON) {
      const whole = beats / fullBar;
      if (Math.abs(whole - Math.round(whole)) > EPSILON) {
        const reason = `Line ${line.line}: "${line.raw.trim()}" lasts ${round(line.durationMeasures)} measures; chart bars cannot hold a chord across a bar line, so only whole measures or parts of one bar are supported.`;
        return { ok: false, reason, errors: [reason] };
      }
      const count = Math.round(whole);
      for (let index = 0; index < count; index += 1) {
        current.push(makeSpan(0, fullBar));
        closeBar();
      }
      if (count > 1) {
        notes.push(`Line ${line.line}: ${symbol} for ${count} measures became ${count} bars of ${symbol}.`);
      }
      continue;
    }
    if (position + beats > fullBar + EPSILON) {
      const reason = `Line ${line.line}: "${line.raw.trim()}" (${round(beats)} beats) starts at beat ${round(position)} and would cross the bar line at beat ${round(fullBar)}; chart bars cannot hold a chord across a bar line.`;
      return { ok: false, reason, errors: [reason] };
    }
    current.push(makeSpan(position, beats));
    position = round(position + beats);
    if (Math.abs(position - fullBar) < EPSILON) {
      closeBar();
    }
  }
  if (current.length > 0) {
    const reason = `The last bar is incomplete (${round(position)} of ${round(fullBar)} beats); add a chord or NC to fill it. Pickups cannot be written in chord text.`;
    return { ok: false, reason, errors: [reason] };
  }
  const chart: SongChart = {
    id: options.id ?? "chart-from-text",
    version: 1,
    title: options.title,
    timeSignature: { numerator: options.timeSignature.numerator, denominator: options.timeSignature.denominator },
    tempo: { bpm: options.tempo },
    sections: [{ id: "A", label: "A", bars }],
    performanceOrder: ["A"],
    provenance: { origin: options.origin ?? "userImport", note: "Imported from chord text." },
    arrangementIds: [],
    meta: { version: 1, status: "draft" }
  };
  if (options.key) {
    chart.key = options.key;
  }
  const symbolIssues = validateChart(chart).filter((issue) => issue.severity === "error");
  if (symbolIssues.length > 0) {
    return { ok: false, reason: symbolIssues[0].message, errors: symbolIssues.map((issue) => issue.message) };
  }
  return { ok: true, chart, notes };
}

function formatMeasures(value: number): string {
  return String(Math.round(value * 1e6) / 1e6);
}

/**
 * Export a chart as chord text in performance order (one line per span). Everything the
 * text format cannot carry is listed in `lost`.
 */
export function chartToChordText(chart: SongChart): { text: string; lost: string[] } {
  const expansion = expandChart(chart);
  if (!expansion.ok) {
    return { text: "", lost: [`The chart cannot be exported: ${expansion.reason}`] };
  }
  const fullBar = chartBeatsPerBar(chart);
  const lost: string[] = [];
  lost.push(`Title "${chart.title}", tempo (${chart.tempo.bpm} BPM) and meter (${chart.timeSignature.numerator}/${chart.timeSignature.denominator}) are app settings, not part of chord text.`);
  if (chart.key) {
    lost.push(`Key (${formatKey(chart.key)}) is not stored in chord text.`);
  }
  const plainOrder = chart.sections.length === 1 && chart.performanceOrder.length === 1 && (chart.sections[0].repeat ?? 1) === 1;
  if (!plainOrder) {
    lost.push(
      `Sections (${chart.sections.map((section) => section.label || section.id).join(", ")}) and the performance order (${chart.performanceOrder.join(" ")}) are flattened into one list of chords.`
    );
  }
  const pickups = expansion.bars.filter((bar) => bar.isPickup);
  if (pickups.length > 0) {
    lost.push(`Pickup/short bars (${pickups.map((bar) => `${bar.sourceBarId}: ${bar.beats} beats`).join(", ")}) are written as fractional measures; chord text has no pickup, so bar lines after them shift.`);
  }
  const numerals = chart.sections.some((section) => section.bars.some((bar) => bar.spans.some((span) => span.romanNumeral !== undefined)));
  if (numerals) {
    lost.push("Roman-numeral analysis is not stored in chord text.");
  }
  if (chart.provenance.origin !== "userImport" || chart.provenance.author !== undefined || chart.provenance.note !== undefined) {
    lost.push(`Provenance (${chart.provenance.origin}${chart.provenance.author ? `, ${chart.provenance.author}` : ""}) is not stored in chord text.`);
  }
  if (chart.arrangementIds.length > 0) {
    lost.push(`Arrangements (${chart.arrangementIds.join(", ")}) are not part of chord text.`);
  }
  const lines = expansion.occurrences.map((occurrence) => `${occurrence.isRest ? "NC" : occurrence.symbol} | ${formatMeasures(occurrence.durationBeats / fullBar)}`);
  return { text: lines.join("\n"), lost };
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

export interface ChartJsonFile {
  schemaVersion: number;
  kind: "songChart";
  chart: SongChart;
}

export function chartToJson(chart: SongChart): string {
  const file: ChartJsonFile = { schemaVersion: CHART_JSON_SCHEMA_VERSION, kind: "songChart", chart };
  return JSON.stringify(file, null, 2);
}

export type ChartFromJsonResult = { ok: true; chart: SongChart; warnings: string[] } | { ok: false; reason: string; issues: string[] };

/** Parse the versioned chart envelope and validate the chart's shape and bar grid. */
export function chartFromJson(text: string): ChartFromJsonResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const reason = `Not valid JSON: ${error instanceof Error ? error.message : String(error)}`;
    return { ok: false, reason, issues: [reason] };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "A chart file must be a JSON object.", issues: ["A chart file must be a JSON object."] };
  }
  const file = raw as Record<string, unknown>;
  if (file.kind !== "songChart") {
    const reason = `This file is not a song chart (kind is ${JSON.stringify(file.kind ?? null)}, expected "songChart").`;
    return { ok: false, reason, issues: [reason] };
  }
  if (typeof file.schemaVersion !== "number" || !Number.isInteger(file.schemaVersion) || file.schemaVersion < 1) {
    const reason = "The chart file has no valid schemaVersion.";
    return { ok: false, reason, issues: [reason] };
  }
  if (file.schemaVersion > CHART_JSON_SCHEMA_VERSION) {
    const reason = `The chart file uses schema version ${file.schemaVersion}, newer than this app supports (${CHART_JSON_SCHEMA_VERSION}).`;
    return { ok: false, reason, issues: [reason] };
  }
  const shape = validateChartShape(file.chart);
  if (shape.length > 0) {
    return { ok: false, reason: `The chart is malformed: ${shape[0]}`, issues: shape };
  }
  const chart = file.chart as SongChart;
  const errors = chartErrors(chart);
  if (errors.length > 0) {
    return { ok: false, reason: errors[0].message, issues: errors.map((issue) => issue.message) };
  }
  const warnings = validateChart(chart)
    .filter((issue) => issue.severity === "warning")
    .map((issue) => issue.message);
  return { ok: true, chart, warnings };
}
