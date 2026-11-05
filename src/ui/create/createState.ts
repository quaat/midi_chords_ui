/**
 * Create-mode editor state (plan E11): one undoable document = chord text + MusicalSequence.
 *
 * Pure and React-free. Every document-changing operation pushes the previous document onto a
 * bounded undo history (HISTORY_LIMIT) and gives the new sequence a strictly increasing
 * `version` (undo/redo included), so anything compiled from an older version can detect that it
 * is stale. Selection, notices and project bookkeeping are not part of the history.
 *
 * Text vs blocks
 * - `setText` keeps the learner's raw text (comments included) and parses it with the legacy
 *   adapter; parse errors are kept and valid lines still become events.
 * - Block operations regenerate the text from the sequence via `sequenceToText`.
 * - `deriveTextAndLost` lists what the chord-text format cannot carry (per-chord voicings ...).
 */
import type { KeyContext, MusicalSequence, ProjectFile, SequenceEvent, TimeSignatureSpec } from "@/model/contracts";
import type { ChordPathwayMode, ParseError } from "@/types";
import type { TextExportResult } from "@/music/legacy";
import { beatsPerBar, sequenceFromParsedText, sequenceToText } from "@/music/legacy";
import { tryChordFromSymbol } from "@/music/chords";
import { parseChordSequence } from "@/parser/parseChordSequence";
import { injectChordPathways, pathwayEventsToText } from "@/theory/pathways";

export const HISTORY_LIMIT = 100;
export const DEFAULT_TEMPO_BPM = 90;
export const DEFAULT_TIME_SIGNATURE: TimeSignatureSpec = { numerator: 4, denominator: 4 };
export const DEFAULT_NEW_PROJECT_TEXT = "C | 1\nAm | 1\nF | 1\nG | 1";
export const MIN_EVENT_BEATS = 0.25;
export const MAX_EVENT_BEATS = 64;

export interface CreateDoc {
  /** Chord text as the learner wrote it (or as regenerated after a block edit). */
  text: string;
  sequence: MusicalSequence;
  parseErrors: ParseError[];
  /** Short name of the operation that produced this document ("Edit text", "Remove G7" ...). */
  label: string;
}

export interface CreateProjectInfo {
  /** Saved project id; null for an unsaved document. */
  id: string | null;
  name: string;
  /** Sequence version that was last saved/loaded; null when never saved. */
  savedVersion: number | null;
  createdAt?: string;
}

export interface CreateState {
  present: CreateDoc;
  past: CreateDoc[];
  future: CreateDoc[];
  /** Highest sequence version handed out so far. */
  versionCounter: number;
  /** Last history-producing operation (typing bursts coalesce while this is "setText"). */
  lastOp: string | null;
  selectedEventId: string | null;
  defaultChordMeasures: number;
  project: CreateProjectInfo;
  /** One user-facing message from the last operation (invalid symbol, nothing changed ...). */
  notice: string | null;
  /** Warnings reported by the last Chord Pathways application. */
  pathwayWarnings: string[];
}

export type CreateAction =
  | { type: "setText"; text: string; coalesce?: boolean }
  | { type: "commitText" }
  | { type: "setSymbol"; eventId: string; symbol: string }
  | { type: "setDuration"; eventId: string; beats: number }
  | { type: "insertAfter"; eventId: string | null; symbol: string; durationBeats?: number; voicingRecipeId?: string }
  | { type: "remove"; eventId: string }
  | { type: "move"; eventId: string; delta: number }
  | { type: "setVoicingRecipe"; eventId: string | "all"; recipeId: string | null }
  | { type: "setTempo"; bpm: number }
  | { type: "setTimeSignature"; timeSignature: TimeSignatureSpec }
  | { type: "setKey"; key: KeyContext | null }
  | { type: "applyPathways"; mode: ChordPathwayMode; turnaround?: string }
  | { type: "loadProject"; project: ProjectFile }
  | { type: "newProject"; sequenceId: string; name?: string; text?: string }
  | { type: "loadSequence"; sequence: MusicalSequence; name?: string }
  | { type: "select"; eventId: string | null }
  | { type: "markSaved"; projectId: string; name: string; createdAt?: string }
  | { type: "renameProject"; name: string }
  | { type: "setDefaultChordMeasures"; measures: number }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "clearNotice" };

export interface InitialCreateOptions {
  text: string;
  sequenceId?: string;
  name?: string;
  tempoBpm?: number;
  timeSignature?: TimeSignatureSpec;
  defaultChordMeasures?: number;
}

const REST_PATTERN = /^N\.?C\.?$/i;

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function parseText(text: string, base: MusicalSequence, defaultChordMeasures: number): { sequence: MusicalSequence; errors: ParseError[] } {
  const parsed = sequenceFromParsedText(text, {
    defaultChordMeasures,
    tempoBpm: base.tempo.bpm,
    timeSignature: base.timeSignature,
    id: base.id
  });
  const sequence = parsed.sequence;
  if (base.title !== undefined) {
    sequence.title = base.title;
  }
  if (base.key) {
    sequence.key = base.key;
  }
  if (base.defaultVoicingRecipeId !== undefined) {
    sequence.defaultVoicingRecipeId = base.defaultVoicingRecipeId;
  }
  // Keep per-chord recipes where the same chord is still in the same place.
  sequence.events = sequence.events.map((event) => {
    const before = base.events[event.index];
    if (before && before.symbol === event.symbol && before.voicingRecipeId !== undefined) {
      return { ...event, voicingRecipeId: before.voicingRecipeId };
    }
    return event;
  });
  return { sequence, errors: parsed.errors };
}

/** Re-index events in order and lay them out back-to-back from beat 0. */
export function reflowEvents(events: readonly SequenceEvent[]): { events: SequenceEvent[]; totalBeats: number } {
  let beat = 0;
  const out = events.map((event, index) => {
    const next: SequenceEvent = { ...event, index, startBeat: round(beat) };
    beat += event.durationBeats;
    return next;
  });
  return { events: out, totalBeats: round(beat) };
}

function withEvents(sequence: MusicalSequence, events: readonly SequenceEvent[]): MusicalSequence {
  const flowed = reflowEvents(events);
  return { ...sequence, events: flowed.events, totalBeats: flowed.totalBeats };
}

function docFromSequence(sequence: MusicalSequence, label: string): CreateDoc {
  return { text: sequenceToText(sequence).text, sequence, parseErrors: [], label };
}

/** Next unused "ev-N" id. */
export function nextEventId(events: readonly SequenceEvent[]): string {
  let max = 0;
  events.forEach((event) => {
    const match = /^ev-(\d+)$/.exec(event.id);
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  });
  let candidate = max + 1;
  const ids = new Set(events.map((event) => event.id));
  while (ids.has(`ev-${candidate}`)) {
    candidate += 1;
  }
  return `ev-${candidate}`;
}

function buildEvent(id: string, symbol: string, durationBeats: number): { event: SequenceEvent | null; error: string | null } {
  const trimmed = symbol.trim();
  if (trimmed === "") {
    return { event: null, error: "Enter a chord symbol (or NC for a rest)." };
  }
  if (REST_PATTERN.test(trimmed)) {
    return { event: { id, index: 0, kind: "rest", symbol: "NC", startBeat: 0, durationBeats }, error: null };
  }
  const parsed = tryChordFromSymbol(trimmed);
  if (!parsed.ok) {
    return { event: null, error: `"${trimmed}" is not a chord symbol this app can read: ${parsed.error}` };
  }
  return { event: { id, index: 0, kind: "chord", symbol: trimmed, chord: parsed.chord, startBeat: 0, durationBeats }, error: null };
}

function clampBeats(beats: number): number {
  if (!Number.isFinite(beats)) {
    return 1;
  }
  return round(Math.min(MAX_EVENT_BEATS, Math.max(MIN_EVENT_BEATS, beats)));
}

function emptySequence(id: string, tempoBpm: number, timeSignature: TimeSignatureSpec): MusicalSequence {
  return {
    id,
    version: 1,
    tempo: { bpm: tempoBpm },
    timeSignature: { numerator: timeSignature.numerator, denominator: timeSignature.denominator },
    events: [],
    totalBeats: 0
  };
}

export function createInitialCreateState(options: InitialCreateOptions): CreateState {
  const measures = options.defaultChordMeasures ?? 1;
  const base = emptySequence(options.sequenceId ?? "seq-create", options.tempoBpm ?? DEFAULT_TEMPO_BPM, options.timeSignature ?? DEFAULT_TIME_SIGNATURE);
  const parsed = parseText(options.text, base, measures);
  parsed.sequence.version = 1;
  return {
    present: { text: options.text, sequence: parsed.sequence, parseErrors: parsed.errors, label: "Open" },
    past: [],
    future: [],
    versionCounter: 1,
    lastOp: null,
    selectedEventId: null,
    defaultChordMeasures: measures,
    project: { id: null, name: options.name ?? "Untitled progression", savedVersion: null },
    notice: null,
    pathwayWarnings: []
  };
}

/** Push `doc` as the new present (history + version bump). */
function commit(state: CreateState, doc: CreateDoc, op: string, extra: Partial<CreateState> = {}): CreateState {
  const version = state.versionCounter + 1;
  const present: CreateDoc = { ...doc, sequence: { ...doc.sequence, version } };
  const past = [...state.past, state.present];
  while (past.length > HISTORY_LIMIT) {
    past.shift();
  }
  const selectedStillThere = state.selectedEventId !== null && present.sequence.events.some((event) => event.id === state.selectedEventId);
  return {
    ...state,
    present,
    past,
    future: [],
    versionCounter: version,
    lastOp: op,
    selectedEventId: selectedStillThere ? state.selectedEventId : null,
    notice: null,
    ...extra
  };
}

/** Replace the present without a history entry (typing coalescing). Still bumps the version. */
function replacePresent(state: CreateState, doc: CreateDoc, op: string): CreateState {
  const version = state.versionCounter + 1;
  return { ...state, present: { ...doc, sequence: { ...doc.sequence, version } }, versionCounter: version, lastOp: op, notice: null };
}

/** Start a fresh document (history cleared), e.g. when a project is opened. */
function resetTo(state: CreateState, doc: CreateDoc, project: CreateProjectInfo, minVersion: number): CreateState {
  const version = Math.max(state.versionCounter, minVersion) + 1;
  return {
    ...state,
    present: { ...doc, sequence: { ...doc.sequence, version } },
    past: [],
    future: [],
    versionCounter: version,
    lastOp: null,
    selectedEventId: null,
    project: { ...project, savedVersion: project.savedVersion === null ? null : version },
    notice: null,
    pathwayWarnings: []
  };
}

function findEvent(state: CreateState, eventId: string): SequenceEvent | undefined {
  return state.present.sequence.events.find((event) => event.id === eventId);
}

function withNotice(state: CreateState, notice: string): CreateState {
  return state.notice === notice ? state : { ...state, notice };
}

export interface PathwayPreview {
  ok: boolean;
  text: string;
  warnings: string[];
  /** Why nothing can be previewed (parse errors, no chords). */
  reason?: string;
  changed: boolean;
}

/** Preview what `applyPathways` would produce for `text` (pure; used by the panel and the reducer). */
export function previewPathways(text: string, mode: ChordPathwayMode, turnaround: string | undefined, defaultChordMeasures: number): PathwayPreview {
  const parsed = parseChordSequence(text, defaultChordMeasures);
  if (parsed.errors.length > 0) {
    return { ok: false, text: "", warnings: [], reason: "Fix the errors in the chord text before adding pathways.", changed: false };
  }
  if (parsed.events.length === 0) {
    return { ok: false, text: "", warnings: [], reason: "Add some chords first.", changed: false };
  }
  const turn = turnaround !== undefined && turnaround.trim() !== "" ? turnaround.trim() : undefined;
  const result = injectChordPathways(parsed.events, { mode, turnaroundChord: turn, turnaroundDurationMeasures: defaultChordMeasures });
  const expanded = pathwayEventsToText(result);
  const before = pathwayEventsToText({ events: parsed.events, warnings: [] });
  return { ok: true, text: expanded, warnings: result.warnings, changed: expanded !== before };
}

function setTextDoc(state: CreateState, text: string, label: string): CreateDoc {
  const parsed = parseText(text, state.present.sequence, state.defaultChordMeasures);
  return { text, sequence: parsed.sequence, parseErrors: parsed.errors, label };
}

export function createReducer(state: CreateState, action: CreateAction): CreateState {
  switch (action.type) {
    case "setText": {
      if (action.text === state.present.text) {
        return state;
      }
      const doc = setTextDoc(state, action.text, "Edit text");
      if (action.coalesce !== false && state.lastOp === "setText" && state.past.length > 0) {
        return replacePresent(state, doc, "setText");
      }
      return commit(state, doc, "setText");
    }
    case "commitText":
      return state.lastOp === "setText" ? { ...state, lastOp: null } : state;
    case "setSymbol": {
      const event = findEvent(state, action.eventId);
      if (!event) {
        return state;
      }
      const built = buildEvent(event.id, action.symbol, event.durationBeats);
      if (!built.event) {
        return withNotice(state, built.error ?? "Invalid chord symbol.");
      }
      if (built.event.symbol === event.symbol && built.event.kind === event.kind) {
        return state;
      }
      const replacement: SequenceEvent = { ...built.event, voicingRecipeId: event.voicingRecipeId };
      if (replacement.voicingRecipeId === undefined) {
        delete replacement.voicingRecipeId;
      }
      const events = state.present.sequence.events.map((existing) => (existing.id === event.id ? replacement : existing));
      return commit(state, docFromSequence(withEvents(state.present.sequence, events), `Change ${event.symbol} to ${replacement.symbol}`), "setSymbol");
    }
    case "setDuration": {
      const event = findEvent(state, action.eventId);
      if (!event) {
        return state;
      }
      const beats = clampBeats(action.beats);
      if (beats === event.durationBeats) {
        return state;
      }
      const events = state.present.sequence.events.map((existing) => (existing.id === event.id ? { ...existing, durationBeats: beats } : existing));
      return commit(state, docFromSequence(withEvents(state.present.sequence, events), `Duration of ${event.symbol}`), "setDuration");
    }
    case "insertAfter": {
      const events = state.present.sequence.events;
      const bar = beatsPerBar(state.present.sequence.timeSignature);
      const id = nextEventId(events);
      const built = buildEvent(id, action.symbol, clampBeats(action.durationBeats ?? bar * state.defaultChordMeasures));
      if (!built.event) {
        return withNotice(state, built.error ?? "Invalid chord symbol.");
      }
      const inserted: SequenceEvent = built.event;
      if (action.voicingRecipeId !== undefined && inserted.kind === "chord") {
        inserted.voicingRecipeId = action.voicingRecipeId;
      }
      const position = action.eventId === null ? events.length - 1 : events.findIndex((event) => event.id === action.eventId);
      const next = [...events];
      next.splice(position + 1, 0, inserted);
      const committed = commit(state, docFromSequence(withEvents(state.present.sequence, next), `Add ${inserted.symbol}`), "insertAfter");
      return { ...committed, selectedEventId: id };
    }
    case "remove": {
      const event = findEvent(state, action.eventId);
      if (!event) {
        return state;
      }
      const events = state.present.sequence.events.filter((existing) => existing.id !== event.id);
      return commit(state, docFromSequence(withEvents(state.present.sequence, events), `Remove ${event.symbol}`), "remove");
    }
    case "move": {
      const events = [...state.present.sequence.events];
      const from = events.findIndex((event) => event.id === action.eventId);
      if (from < 0) {
        return state;
      }
      const to = Math.max(0, Math.min(events.length - 1, from + Math.round(action.delta)));
      if (to === from) {
        return state;
      }
      const [moved] = events.splice(from, 1);
      events.splice(to, 0, moved);
      return commit(state, docFromSequence(withEvents(state.present.sequence, events), `Move ${moved.symbol}`), "move");
    }
    case "setVoicingRecipe": {
      const sequence = state.present.sequence;
      if (action.eventId === "all") {
        const next: MusicalSequence = { ...sequence };
        if (action.recipeId === null) {
          delete next.defaultVoicingRecipeId;
        } else {
          next.defaultVoicingRecipeId = action.recipeId;
        }
        next.events = sequence.events.map((event) => {
          const copy: SequenceEvent = { ...event };
          delete copy.voicingRecipeId;
          delete copy.voicing;
          return copy;
        });
        const unchanged =
          next.defaultVoicingRecipeId === sequence.defaultVoicingRecipeId && sequence.events.every((event) => event.voicingRecipeId === undefined && !event.voicing);
        if (unchanged) {
          return state;
        }
        return commit(state, { ...state.present, sequence: next, label: "Voicing for all chords" }, "setVoicingRecipe");
      }
      const event = findEvent(state, action.eventId);
      if (!event || event.kind !== "chord") {
        return state;
      }
      if ((event.voicingRecipeId ?? null) === action.recipeId && !event.voicing) {
        return state;
      }
      const events = sequence.events.map((existing) => {
        if (existing.id !== event.id) {
          return existing;
        }
        const copy: SequenceEvent = { ...existing };
        delete copy.voicing;
        if (action.recipeId === null) {
          delete copy.voicingRecipeId;
        } else {
          copy.voicingRecipeId = action.recipeId;
        }
        return copy;
      });
      // Text cannot carry recipes, so the text itself is unchanged.
      return commit(state, { ...state.present, sequence: { ...sequence, events }, label: `Voicing of ${event.symbol}` }, "setVoicingRecipe");
    }
    case "setTempo": {
      if (!Number.isFinite(action.bpm)) {
        return state;
      }
      const bpm = Math.round(Math.min(300, Math.max(20, action.bpm)));
      if (bpm === state.present.sequence.tempo.bpm) {
        return state;
      }
      return commit(state, { ...state.present, sequence: { ...state.present.sequence, tempo: { bpm } }, label: "Tempo" }, "setTempo");
    }
    case "setTimeSignature": {
      const { numerator, denominator } = action.timeSignature;
      if (!Number.isInteger(numerator) || numerator < 1 || numerator > 16 || ![2, 4, 8, 16].includes(denominator)) {
        return withNotice(state, "Choose a time signature between 1 and 16 beats over 2, 4, 8 or 16.");
      }
      const current = state.present.sequence.timeSignature;
      if (current.numerator === numerator && current.denominator === denominator) {
        return state;
      }
      const sequence: MusicalSequence = { ...state.present.sequence, timeSignature: { numerator, denominator } };
      // Durations stay in beats; the text (measures) is regenerated for the new bar length.
      return commit(state, { ...state.present, sequence, text: sequenceToText(sequence).text, parseErrors: [], label: "Time signature" }, "setTimeSignature");
    }
    case "setKey": {
      const sequence: MusicalSequence = { ...state.present.sequence };
      if (action.key === null) {
        if (!sequence.key) {
          return state;
        }
        delete sequence.key;
      } else {
        sequence.key = { tonic: { ...action.key.tonic }, mode: action.key.mode };
      }
      return commit(state, { ...state.present, sequence, label: "Key" }, "setKey");
    }
    case "applyPathways": {
      const preview = previewPathways(state.present.text, action.mode, action.turnaround, state.defaultChordMeasures);
      if (!preview.ok) {
        return withNotice(state, preview.reason ?? "Chord pathways could not be applied.");
      }
      if (!preview.changed) {
        return { ...withNotice(state, "No pathway chords could be added to this progression."), pathwayWarnings: preview.warnings };
      }
      const doc = setTextDoc(state, preview.text, "Chord pathways");
      return commit(state, doc, "applyPathways", { pathwayWarnings: preview.warnings });
    }
    case "loadProject": {
      const project = action.project;
      const sequence = project.sequence;
      let doc: CreateDoc;
      if (project.sourceText !== undefined) {
        const parsed = sequenceFromParsedText(project.sourceText, {
          defaultChordMeasures: state.defaultChordMeasures,
          tempoBpm: sequence.tempo.bpm,
          timeSignature: sequence.timeSignature,
          id: sequence.id
        });
        doc = { text: project.sourceText, sequence, parseErrors: parsed.errors, label: "Open project" };
      } else {
        doc = docFromSequence(sequence, "Open project");
      }
      return resetTo(state, doc, { id: project.id, name: project.name, savedVersion: 0, createdAt: project.createdAt }, sequence.version);
    }
    case "newProject": {
      const base = emptySequence(action.sequenceId, state.present.sequence.tempo.bpm, state.present.sequence.timeSignature);
      const text = action.text ?? DEFAULT_NEW_PROJECT_TEXT;
      const parsed = parseText(text, base, state.defaultChordMeasures);
      const doc: CreateDoc = { text, sequence: parsed.sequence, parseErrors: parsed.errors, label: "New project" };
      return resetTo(state, doc, { id: null, name: action.name ?? "Untitled progression", savedVersion: null }, 0);
    }
    case "loadSequence": {
      const doc = docFromSequence(action.sequence, "Open progression");
      return resetTo(state, doc, { id: null, name: action.name ?? action.sequence.title ?? "Untitled progression", savedVersion: null }, action.sequence.version);
    }
    case "select":
      return state.selectedEventId === action.eventId ? state : { ...state, selectedEventId: action.eventId };
    case "markSaved":
      return {
        ...state,
        project: { id: action.projectId, name: action.name, savedVersion: state.present.sequence.version, createdAt: action.createdAt ?? state.project.createdAt },
        notice: null
      };
    case "renameProject": {
      const name = action.name.trim();
      if (name === "" || name === state.project.name) {
        return state;
      }
      return { ...state, project: { ...state.project, name } };
    }
    case "setDefaultChordMeasures": {
      const measures = Number.isFinite(action.measures) ? Math.min(16, Math.max(0.25, action.measures)) : state.defaultChordMeasures;
      return measures === state.defaultChordMeasures ? state : { ...state, defaultChordMeasures: measures };
    }
    case "undo": {
      if (state.past.length === 0) {
        return state;
      }
      const previous = state.past[state.past.length - 1];
      const version = state.versionCounter + 1;
      return {
        ...state,
        present: { ...previous, sequence: { ...previous.sequence, version } },
        past: state.past.slice(0, -1),
        future: [state.present, ...state.future],
        versionCounter: version,
        lastOp: "undo",
        notice: null,
        pathwayWarnings: []
      };
    }
    case "redo": {
      if (state.future.length === 0) {
        return state;
      }
      const next = state.future[0];
      const version = state.versionCounter + 1;
      return {
        ...state,
        present: { ...next, sequence: { ...next.sequence, version } },
        past: [...state.past, state.present].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
        versionCounter: version,
        lastOp: "redo",
        notice: null
      };
    }
    case "clearNotice":
      return state.notice === null ? state : { ...state, notice: null };
    default:
      return state;
  }
}

/** Text export of the present sequence plus what the text cannot represent. */
export function deriveTextAndLost(state: CreateState): TextExportResult {
  return sequenceToText(state.present.sequence);
}

/** True when the present version differs from the last saved/loaded one. */
export function isDirty(state: CreateState): boolean {
  return state.project.savedVersion === null || state.project.savedVersion !== state.present.sequence.version;
}

export function canUndo(state: CreateState): boolean {
  return state.past.length > 0;
}

export function canRedo(state: CreateState): boolean {
  return state.future.length > 0;
}

/** Settings stored with a saved project (playback options live outside the sequence). */
export interface CreateProjectSettings {
  arpeggiate?: number;
  accompaniment?: string;
  defaultChordMeasures?: number;
}
