/**
 * Independent Standard MIDI File reader for tests. Written against the SMF 1.0 specification,
 * not against the app's writer: it validates chunk ids/lengths, variable-length deltas, running
 * status, meta/sysex lengths and that every track ends with End of Track.
 */

export interface SmfEvent {
  tick: number;
  delta: number;
  kind: "meta" | "channel" | "sysex";
  /** Status byte (channel events: with channel nibble; meta: 0xff). */
  status: number;
  /** Meta type for meta events. */
  metaType?: number;
  /** 1-based channel for channel events. */
  channel?: number;
  data: number[];
}

export interface SmfFile {
  format: number;
  trackCount: number;
  division: number;
  tracks: SmfEvent[][];
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...Array.from(bytes.subarray(start, start + length)));
}

function u32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) >>> 0) + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3];
}

function u16(bytes: Uint8Array, at: number): number {
  return (bytes[at] << 8) | bytes[at + 1];
}

export function parseSmf(bytes: Uint8Array): SmfFile {
  if (bytes.length < 14 || ascii(bytes, 0, 4) !== "MThd") {
    throw new Error("missing MThd");
  }
  const headerLength = u32(bytes, 4);
  if (headerLength !== 6) {
    throw new Error(`unexpected header length ${headerLength}`);
  }
  const format = u16(bytes, 8);
  const trackCount = u16(bytes, 10);
  const division = u16(bytes, 12);
  if (division & 0x8000) {
    throw new Error("SMPTE division not supported by this reader");
  }
  let pos = 8 + headerLength;
  const tracks: SmfEvent[][] = [];
  while (pos < bytes.length) {
    if (ascii(bytes, pos, 4) !== "MTrk") {
      throw new Error(`expected MTrk at ${pos}`);
    }
    const length = u32(bytes, pos + 4);
    const start = pos + 8;
    const end = start + length;
    if (end > bytes.length) {
      throw new Error("track length exceeds file");
    }
    tracks.push(parseTrack(bytes, start, end));
    pos = end;
  }
  if (tracks.length !== trackCount) {
    throw new Error(`header says ${trackCount} tracks, found ${tracks.length}`);
  }
  return { format, trackCount, division, tracks };
}

function parseTrack(bytes: Uint8Array, start: number, end: number): SmfEvent[] {
  const events: SmfEvent[] = [];
  let pos = start;
  let tick = 0;
  let running: number | null = null;
  const readVar = (): number => {
    let value = 0;
    for (let i = 0; i < 4; i += 1) {
      const byte = bytes[pos];
      pos += 1;
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) {
        return value;
      }
    }
    throw new Error("variable-length quantity too long");
  };
  while (pos < end) {
    const delta = readVar();
    tick += delta;
    let status = bytes[pos];
    if (status < 0x80) {
      if (running === null) {
        throw new Error(`data byte without running status at ${pos}`);
      }
      status = running;
    } else {
      pos += 1;
    }
    if (status === 0xff) {
      const metaType = bytes[pos];
      pos += 1;
      const length = readVar();
      const data = Array.from(bytes.subarray(pos, pos + length));
      pos += length;
      events.push({ tick, delta, kind: "meta", status, metaType, data });
      running = null;
      continue;
    }
    if (status === 0xf0 || status === 0xf7) {
      const length = readVar();
      const data = Array.from(bytes.subarray(pos, pos + length));
      pos += length;
      events.push({ tick, delta, kind: "sysex", status, data });
      running = null;
      continue;
    }
    const type = status & 0xf0;
    const size = type === 0xc0 || type === 0xd0 ? 1 : 2;
    const data = Array.from(bytes.subarray(pos, pos + size));
    pos += size;
    running = status;
    events.push({ tick, delta, kind: "channel", status, channel: (status & 0x0f) + 1, data });
  }
  if (pos !== end) {
    throw new Error("track data overran its chunk");
  }
  const last = events[events.length - 1];
  if (!last || last.kind !== "meta" || last.metaType !== 0x2f) {
    throw new Error("track does not end with End of Track");
  }
  return events;
}

export function noteEvents(track: SmfEvent[]): { tick: number; channel: number; midi: number; velocity: number; on: boolean }[] {
  return track
    .filter((event) => event.kind === "channel" && ((event.status & 0xf0) === 0x90 || (event.status & 0xf0) === 0x80))
    .map((event) => ({
      tick: event.tick,
      channel: event.channel ?? 0,
      midi: event.data[0],
      velocity: event.data[1],
      on: (event.status & 0xf0) === 0x90 && event.data[1] > 0
    }));
}

export function controllerEvents(track: SmfEvent[]): { tick: number; channel: number; controller: number; value: number }[] {
  return track
    .filter((event) => event.kind === "channel" && (event.status & 0xf0) === 0xb0)
    .map((event) => ({ tick: event.tick, channel: event.channel ?? 0, controller: event.data[0], value: event.data[1] }));
}

export function tempoMicros(track: SmfEvent[]): number | null {
  const meta = track.find((event) => event.kind === "meta" && event.metaType === 0x51);
  return meta ? (meta.data[0] << 16) | (meta.data[1] << 8) | meta.data[2] : null;
}

export function timeSignature(track: SmfEvent[]): { numerator: number; denominator: number } | null {
  const meta = track.find((event) => event.kind === "meta" && event.metaType === 0x58);
  return meta ? { numerator: meta.data[0], denominator: 2 ** meta.data[1] } : null;
}

export function trackName(track: SmfEvent[]): string | null {
  const meta = track.find((event) => event.kind === "meta" && event.metaType === 0x03);
  return meta ? String.fromCharCode(...meta.data) : null;
}
