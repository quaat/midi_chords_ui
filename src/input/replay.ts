/**
 * Replay of recorded learner input (plan E09 replay fixtures, E21 device evidence).
 *
 * ReplayInput feeds a recorded list of InputEvents (or raw MIDI log entries) to listeners
 * on an injected clock, preserving order and relative timing, optionally time-scaled.
 * Emitted timestamps are `startTimestampMs + (original - first) / speed`; with the defaults
 * (speed 1, startTimestampMs = first original timestamp) they equal the originals.
 *
 * Input logs are serialised as versioned JSON: { kind: "inputLog", version: 1, ... }.
 */

import type { InputEvent, InputEventType, InputSource } from "@/model/contracts";
import { parseMidiMessage } from "@/input/normalize";
import type { RawMidiLogEntry } from "@/input/midiInput";

export interface ReplayClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ReplayOptions {
  /** Playback speed factor (2 = twice as fast). Default 1. */
  speed?: number;
  /**
   * Source written on emitted events. Default "replay" so replayed input is never mistaken
   * for live input; "preserve" keeps each event's recorded source.
   */
  source?: InputSource | "preserve";
  /** Timestamp assigned to the first event. Default: its recorded timestamp. */
  startTimestampMs?: number;
  clock?: ReplayClock;
}

export type ReplayListener = (event: InputEvent) => void;

/** Clock that reads the globals lazily (so test fake timers installed later are honoured). */
export const defaultReplayClock: ReplayClock = {
  now(): number {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return performance.now();
    }
    return Date.now();
  },
  setTimeout(callback: () => void, ms: number): unknown {
    return globalThis.setTimeout(callback, ms);
  },
  clearTimeout(handle: unknown): void {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  }
};

/** Convert raw log entries to InputEvents (echo-flagged and unrecognised entries are dropped). */
export function rawToInputEvents(raw: RawMidiLogEntry[], source: InputSource = "midi"): InputEvent[] {
  const events: InputEvent[] = [];
  for (const entry of raw) {
    if (entry.echo === true) {
      continue;
    }
    const parsed = parseMidiMessage(entry.data, entry.timestampMs, { portId: entry.portId, portName: entry.portName ?? "" }, source);
    if (parsed) {
      events.push(parsed);
    }
  }
  return events;
}

interface ScheduledEvent {
  dueOffsetMs: number;
  event: InputEvent;
}

export class ReplayInput {
  private readonly schedule: ScheduledEvent[];
  private readonly clock: ReplayClock;
  private listeners = new Set<ReplayListener>();
  private doneListeners = new Set<() => void>();
  private cursor = 0;
  private startedAt = 0;
  private timer: unknown = null;
  private running = false;

  constructor(events: InputEvent[], options: ReplayOptions = {}) {
    const speed = options.speed !== undefined && options.speed > 0 && Number.isFinite(options.speed) ? options.speed : 1;
    this.clock = options.clock ?? defaultReplayClock;
    const sorted = events
      .map((event, index) => ({ event, index }))
      .sort((a, b) => a.event.timestampMs - b.event.timestampMs || a.index - b.index)
      .map((item) => item.event);
    const first = sorted.length > 0 ? sorted[0].timestampMs : 0;
    const start = options.startTimestampMs !== undefined ? options.startTimestampMs : first;
    const sourceOption = options.source ?? "replay";
    this.schedule = sorted.map((event) => {
      const dueOffsetMs = (event.timestampMs - first) / speed;
      const source: InputSource = sourceOption === "preserve" ? event.source : sourceOption;
      return { dueOffsetMs, event: { ...event, source, timestampMs: start + dueOffsetMs } };
    });
  }

  static fromRaw(raw: RawMidiLogEntry[], options: ReplayOptions = {}): ReplayInput {
    return new ReplayInput(rawToInputEvents(raw), options);
  }

  /** The events exactly as they will be emitted. */
  events(): InputEvent[] {
    return this.schedule.map((item) => ({ ...item.event }));
  }

  get length(): number {
    return this.schedule.length;
  }

  get emittedCount(): number {
    return this.cursor;
  }

  isRunning(): boolean {
    return this.running;
  }

  onEvent(listener: ReplayListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onDone(listener: () => void): () => void {
    this.doneListeners.add(listener);
    return () => {
      this.doneListeners.delete(listener);
    };
  }

  /** Start (or restart) from the beginning. Events due at offset 0 are emitted synchronously. */
  start(): void {
    this.stop();
    this.cursor = 0;
    this.running = true;
    this.startedAt = this.clock.now();
    this.pump();
  }

  stop(): void {
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
    this.running = false;
  }

  /** Emit everything immediately, ignoring the clock (for synchronous tests/analysis). */
  flush(): void {
    this.stop();
    while (this.cursor < this.schedule.length) {
      this.emit(this.schedule[this.cursor].event);
      this.cursor += 1;
    }
    this.finish();
  }

  private pump(): void {
    this.timer = null;
    if (!this.running) {
      return;
    }
    const elapsed = this.clock.now() - this.startedAt;
    while (this.cursor < this.schedule.length && this.schedule[this.cursor].dueOffsetMs <= elapsed) {
      const item = this.schedule[this.cursor];
      this.cursor += 1;
      this.emit(item.event);
      if (!this.running) {
        return;
      }
    }
    if (this.cursor >= this.schedule.length) {
      this.running = false;
      this.finish();
      return;
    }
    const delay = Math.max(0, this.schedule[this.cursor].dueOffsetMs - elapsed);
    this.timer = this.clock.setTimeout(() => this.pump(), delay);
  }

  private emit(event: InputEvent): void {
    const copy: InputEvent = { ...event };
    this.listeners.forEach((listener) => listener(copy));
  }

  private finish(): void {
    this.doneListeners.forEach((listener) => listener());
  }
}

// ---------------------------------------------------------------------------
// Versioned input-log JSON
// ---------------------------------------------------------------------------

export const INPUT_LOG_KIND = "inputLog";
export const INPUT_LOG_VERSION = 1;

export interface InputLogFile {
  kind: "inputLog";
  version: 1;
  createdAt: string;
  description?: string;
  device?: { name?: string; manufacturer?: string; portId?: string };
  /** Calibration estimate in effect while recording (already applied to `events`). */
  latencyOffsetMs?: number;
  events: InputEvent[];
  /** Raw, unadjusted MIDI bytes when available (preferred for re-calibration). */
  raw?: RawMidiLogEntry[];
}

export interface InputLogInput {
  events: InputEvent[];
  raw?: RawMidiLogEntry[];
  createdAt?: string;
  description?: string;
  device?: { name?: string; manufacturer?: string; portId?: string };
  latencyOffsetMs?: number;
}

export type ParseInputLogResult = { ok: true; log: InputLogFile } | { ok: false; error: string };

const SOURCES: readonly InputSource[] = ["midi", "computerKeyboard", "touch", "replay"];
const TYPES: readonly InputEventType[] = ["noteOn", "noteOff", "sustain", "sostenuto", "soft", "allNotesOff", "connection"];

export function createInputLog(input: InputLogInput): InputLogFile {
  const log: InputLogFile = {
    kind: "inputLog",
    version: 1,
    createdAt: input.createdAt ?? new Date().toISOString(),
    events: input.events.map((event) => ({ ...event }))
  };
  if (input.description !== undefined) {
    log.description = input.description;
  }
  if (input.device !== undefined) {
    log.device = { ...input.device };
  }
  if (input.latencyOffsetMs !== undefined) {
    log.latencyOffsetMs = input.latencyOffsetMs;
  }
  if (input.raw !== undefined) {
    log.raw = input.raw.map((entry) => ({ ...entry, data: entry.data.slice() }));
  }
  return log;
}

export function serializeInputLog(input: InputLogInput | InputLogFile, space = 0): string {
  return JSON.stringify(createInputLog(input), null, space);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalNumber(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function optionalString(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  return value === undefined || typeof value === "string";
}

function validateEvent(value: unknown, index: number): string | null {
  if (!isRecord(value)) {
    return `events[${index}] is not an object`;
  }
  const source = value["source"];
  const type = value["type"];
  const timestampMs = value["timestampMs"];
  const connected = value["connected"];
  if (typeof source !== "string" || !(SOURCES as readonly string[]).includes(source)) {
    return `events[${index}].source is invalid`;
  }
  if (typeof type !== "string" || !(TYPES as readonly string[]).includes(type)) {
    return `events[${index}].type is invalid`;
  }
  if (typeof timestampMs !== "number" || !Number.isFinite(timestampMs)) {
    return `events[${index}].timestampMs must be a finite number`;
  }
  for (const key of ["channel", "midi", "velocity", "value"]) {
    if (!optionalNumber(value, key)) {
      return `events[${index}].${key} must be a number`;
    }
  }
  for (const key of ["portId", "portName"]) {
    if (!optionalString(value, key)) {
      return `events[${index}].${key} must be a string`;
    }
  }
  if (connected !== undefined && typeof connected !== "boolean") {
    return `events[${index}].connected must be a boolean`;
  }
  return null;
}

function isByte(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255;
}

function validateRaw(value: unknown, index: number): string | null {
  if (!isRecord(value)) {
    return `raw[${index}] is not an object`;
  }
  const data = value["data"];
  const timestampMs = value["timestampMs"];
  if (!Array.isArray(data) || !data.every(isByte)) {
    return `raw[${index}].data must be an array of bytes`;
  }
  if (typeof timestampMs !== "number" || !Number.isFinite(timestampMs)) {
    return `raw[${index}].timestampMs must be a finite number`;
  }
  if (typeof value["portId"] !== "string") {
    return `raw[${index}].portId must be a string`;
  }
  if (value["echo"] !== undefined && typeof value["echo"] !== "boolean") {
    return `raw[${index}].echo must be a boolean`;
  }
  return null;
}

export function parseInputLog(text: string): ParseInputLogResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "Input log is not valid JSON." };
  }
  if (!isRecord(parsed)) {
    return { ok: false, error: "Input log must be a JSON object." };
  }
  if (parsed["kind"] !== INPUT_LOG_KIND) {
    return { ok: false, error: `Expected kind "${INPUT_LOG_KIND}".` };
  }
  const version = parsed["version"];
  if (version !== INPUT_LOG_VERSION) {
    return { ok: false, error: `Unsupported input log version ${String(version)} (expected ${INPUT_LOG_VERSION}).` };
  }
  const events: unknown = parsed["events"];
  if (!Array.isArray(events)) {
    return { ok: false, error: "Input log events must be an array." };
  }
  for (let i = 0; i < events.length; i += 1) {
    const problem = validateEvent(events[i], i);
    if (problem) {
      return { ok: false, error: problem };
    }
  }
  const raw: unknown = parsed["raw"];
  if (raw !== undefined) {
    if (!Array.isArray(raw)) {
      return { ok: false, error: "Input log raw must be an array." };
    }
    for (let i = 0; i < raw.length; i += 1) {
      const problem = validateRaw(raw[i], i);
      if (problem) {
        return { ok: false, error: problem };
      }
    }
  }
  const latency: unknown = parsed["latencyOffsetMs"];
  if (latency !== undefined && (typeof latency !== "number" || !Number.isFinite(latency))) {
    return { ok: false, error: "latencyOffsetMs must be a number." };
  }
  const createdAt: unknown = parsed["createdAt"];
  const description: unknown = parsed["description"];
  const device: unknown = parsed["device"];
  const input: InputLogInput = {
    events: events as InputEvent[],
    createdAt: typeof createdAt === "string" ? createdAt : ""
  };
  if (Array.isArray(raw)) {
    input.raw = raw as RawMidiLogEntry[];
  }
  if (typeof description === "string") {
    input.description = description;
  }
  if (isRecord(device)) {
    input.device = device as InputLogInput["device"];
  }
  if (typeof latency === "number") {
    input.latencyOffsetMs = latency;
  }
  return { ok: true, log: createInputLog(input) };
}
