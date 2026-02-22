import type { RenderSequenceResult, SynthSettings } from "@/types";

interface TimedEvent {
  tick: number;
  priority: number;
  data: number[];
}

function encodeVarLen(value: number): number[] {
  let buffer = value & 0x7f;
  const out: number[] = [];
  while ((value >>= 7) > 0) {
    buffer <<= 8;
    buffer |= (value & 0x7f) | 0x80;
  }
  while (true) {
    out.push(buffer & 0xff);
    if (buffer & 0x80) {
      buffer >>= 8;
    } else {
      break;
    }
  }
  return out;
}

function numberToBytes(value: number, length: number): number[] {
  const out: number[] = [];
  for (let i = length - 1; i >= 0; i -= 1) {
    out.push((value >> (8 * i)) & 0xff);
  }
  return out;
}

function buildTrackChunk(events: TimedEvent[]): Uint8Array {
  const sorted = [...events].sort((a, b) => {
    if (a.tick !== b.tick) {
      return a.tick - b.tick;
    }
    return a.priority - b.priority;
  });

  let lastTick = 0;
  const bytes: number[] = [];
  sorted.forEach((event) => {
    const delta = event.tick - lastTick;
    bytes.push(...encodeVarLen(Math.max(0, delta)), ...event.data);
    lastTick = event.tick;
  });

  const header = [
    0x4d,
    0x54,
    0x72,
    0x6b,
    ...numberToBytes(bytes.length, 4)
  ];

  return new Uint8Array([...header, ...bytes]);
}

function buildHeaderChunk(ppq: number): Uint8Array {
  return new Uint8Array([
    0x4d,
    0x54,
    0x68,
    0x64,
    0x00,
    0x00,
    0x00,
    0x06,
    0x00,
    0x00,
    0x00,
    0x01,
    ...numberToBytes(ppq, 2)
  ]);
}

export interface MidiBuildResult {
  bytes: Uint8Array;
  blob: Blob;
}

export function buildMidiFile(sequence: RenderSequenceResult, settings: SynthSettings): MidiBuildResult {
  const events: TimedEvent[] = [];
  const channel = Math.min(15, Math.max(0, settings.midiChannel - 1));
  const velocity = Math.min(127, Math.max(1, settings.velocity));
  const program = Math.min(127, Math.max(0, settings.program - 1));

  const denominatorPow = Math.max(0, Math.round(Math.log2(settings.timeSignature.denominator)));
  const tempoMicros = Math.round(60_000_000 / settings.tempoBpm);

  events.push({
    tick: 0,
    priority: 0,
    data: [0xff, 0x58, 0x04, settings.timeSignature.numerator, denominatorPow, 24, 8]
  });
  events.push({
    tick: 0,
    priority: 1,
    data: [0xff, 0x51, 0x03, ...numberToBytes(tempoMicros, 3)]
  });
  events.push({
    tick: 0,
    priority: 2,
    data: [0xc0 | channel, program]
  });

  sequence.events.forEach((event) => {
    if (event.isRest || event.noteNumbers.length === 0) {
      return;
    }
    const endTick = event.startTick + event.durationTicks;

    event.noteNumbers.forEach((note, idx) => {
      events.push({
        tick: event.startTick,
        priority: 10 + idx,
        data: [0x90 | channel, note, velocity]
      });
    });

    event.noteNumbers.forEach((note, idx) => {
      events.push({
        tick: endTick,
        priority: 40 + idx,
        data: [0x80 | channel, note, 0]
      });
    });
  });

  events.push({
    tick: sequence.totalTicks,
    priority: 100,
    data: [0xff, 0x2f, 0x00]
  });

  const header = buildHeaderChunk(settings.ticksPerBeat);
  const track = buildTrackChunk(events);
  const bytes = new Uint8Array(header.length + track.length);
  bytes.set(header, 0);
  bytes.set(track, header.length);

  return {
    bytes,
    blob: new Blob([bytes], { type: "audio/midi" })
  };
}
