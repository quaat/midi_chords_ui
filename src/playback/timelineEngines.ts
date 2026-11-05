/**
 * Output adapters for the timeline transport (plan E10).
 *
 * The transport hands every adapter note on/off events stamped with a PERFORMANCE-CLOCK time
 * (`performance.now()` ms), never more than one lookahead window (~150 ms) in the future.
 * Each adapter translates that time into its own clock at call time:
 * - Tone.js: `Tone.now()` (Web Audio `currentTime`) + (atMs - performance.now()) / 1000.
 * - Web MIDI: a relative `setTimeout` delay guarded by a generation token.
 *
 * Retrigger safety: adapters reference-count sounding notes per (channel, pitch), so an older
 * noteOff can never silence a newer noteOn of the same pitch, and a retrigger sends a noteOff
 * before the new noteOn. `allNotesOff` cancels everything still pending and silences output.
 */
import * as Tone from "tone";
import type { SchedulerClock } from "@/timeline/clock";
import { defaultSchedulerClock, perfMsToAudioSeconds } from "@/timeline/clock";
import { DEFAULT_METRONOME_CHANNEL } from "@/playback/metronome";

export { DEFAULT_METRONOME_CHANNEL };

export interface TimelineEngine {
  prepare(): Promise<void>;
  /** `channel` is 1-based (1..16). `atMs` is on the performance clock. */
  noteOn(midi: number, velocity: number, channel: number, atMs: number): void;
  noteOff(midi: number, channel: number, atMs: number): void;
  /** Cancel pending work and silence `channel` (all channels when omitted). */
  allNotesOff(channel?: number): void;
  /** Release adapter resources (optional). */
  dispose?(): void;
}

function clampChannel(channel: number): number {
  if (!Number.isFinite(channel)) {
    return 0;
  }
  return Math.min(15, Math.max(0, Math.round(channel) - 1));
}

function noteKey(channelIndex: number, midi: number): string {
  return `${channelIndex}:${midi}`;
}

// ---------------------------------------------------------------------------
// Silent engine (tests, headless)
// ---------------------------------------------------------------------------

export type EngineCallType = "prepare" | "noteOn" | "noteOff" | "allNotesOff";

export interface EngineCall {
  type: EngineCallType;
  midi?: number;
  velocity?: number;
  channel?: number;
  /** Requested performance-clock time. */
  atMs?: number;
  /** Performance-clock time at which the adapter was called. */
  calledAtMs: number;
}

/** Records every call; produces no sound. */
export class SilentTimelineEngine implements TimelineEngine {
  readonly calls: EngineCall[] = [];
  private readonly now: () => number;

  constructor(now?: () => number) {
    this.now =
      now ??
      ((): number => (typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now()));
  }

  prepare(): Promise<void> {
    this.calls.push({ type: "prepare", calledAtMs: this.now() });
    return Promise.resolve();
  }

  noteOn(midi: number, velocity: number, channel: number, atMs: number): void {
    this.calls.push({ type: "noteOn", midi, velocity, channel, atMs, calledAtMs: this.now() });
  }

  noteOff(midi: number, channel: number, atMs: number): void {
    this.calls.push({ type: "noteOff", midi, channel, atMs, calledAtMs: this.now() });
  }

  allNotesOff(channel?: number): void {
    const call: EngineCall = { type: "allNotesOff", calledAtMs: this.now() };
    if (channel !== undefined) {
      call.channel = channel;
    }
    this.calls.push(call);
  }

  noteOns(): EngineCall[] {
    return this.calls.filter((call) => call.type === "noteOn");
  }

  noteOffs(): EngineCall[] {
    return this.calls.filter((call) => call.type === "noteOff");
  }

  clear(): void {
    this.calls.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Web MIDI
// ---------------------------------------------------------------------------

/** The subset of `MIDIOutput` the adapter needs. */
export interface MidiOutputLike {
  send(data: number[], timestamp?: number): void;
}

/**
 * Web MIDI adapter. Messages are sent from `setTimeout` callbacks at their due time (relative
 * delays, no absolute MIDI timestamps), so `allNotesOff` can cancel anything not yet sent.
 * Each timer carries the generation it was scheduled in; a callback from an older generation is
 * dropped even if clearing failed.
 */
export class WebMidiTimelineEngine implements TimelineEngine {
  private output: MidiOutputLike | null;
  private readonly clock: SchedulerClock;
  private generation = 0;
  /** Pending timer handle → 0-based channel it will send on. */
  private readonly timers = new Map<unknown, number>();
  /** Sounding (sent) note-ons per channel:pitch. */
  private readonly sounding = new Map<string, number>();
  private readonly usedChannels = new Set<number>();

  constructor(output: MidiOutputLike | null = null, clock?: SchedulerClock) {
    this.output = output;
    this.clock = clock ?? defaultSchedulerClock();
  }

  prepare(): Promise<void> {
    return Promise.resolve();
  }

  /** Switch output: silences the previous output first so nothing is left hanging. */
  setOutput(output: MidiOutputLike | null): void {
    this.allNotesOff();
    this.output = output;
  }

  getOutput(): MidiOutputLike | null {
    return this.output;
  }

  /** Number of pending (not yet sent) timers — exposed for diagnostics/tests. */
  pendingCount(): number {
    return this.timers.size;
  }

  noteOn(midi: number, velocity: number, channel: number, atMs: number): void {
    if (!this.output) {
      return;
    }
    const ch = clampChannel(channel);
    const vel = Math.min(127, Math.max(1, Math.round(velocity)));
    this.usedChannels.add(ch);
    this.schedule(atMs, ch, () => this.fireOn(midi, vel, ch));
  }

  noteOff(midi: number, channel: number, atMs: number): void {
    if (!this.output) {
      return;
    }
    const ch = clampChannel(channel);
    this.schedule(atMs, ch, () => this.fireOff(midi, ch));
  }

  allNotesOff(channel?: number): void {
    const target = channel === undefined ? null : clampChannel(channel);
    if (target === null) {
      // Invalidate every callback scheduled so far, even ones that could not be cleared.
      this.generation += 1;
    }
    [...this.timers.entries()].forEach(([handle, ch]) => {
      if (target === null || ch === target) {
        this.clock.clearTimeout(handle);
        this.timers.delete(handle);
      }
    });

    const output = this.output;
    const channels = new Set<number>();
    [...this.sounding.keys()].forEach((key) => {
      const [chText, midiText] = key.split(":");
      const ch = Number(chText);
      if (target !== null && ch !== target) {
        return;
      }
      this.sounding.delete(key);
      if (output) {
        output.send([0x80 | ch, Number(midiText), 0]);
      }
      channels.add(ch);
    });
    if (!output) {
      return;
    }
    if (target !== null) {
      channels.add(target);
    } else {
      this.usedChannels.forEach((ch) => channels.add(ch));
    }
    channels.forEach((ch) => output.send([0xb0 | ch, 123, 0]));
  }

  /** Hard panic: all-notes-off and all-sound-off on all 16 channels. */
  panic(): void {
    this.allNotesOff();
    if (!this.output) {
      return;
    }
    for (let ch = 0; ch < 16; ch += 1) {
      this.output.send([0xb0 | ch, 123, 0]);
      this.output.send([0xb0 | ch, 120, 0]);
    }
  }

  dispose(): void {
    this.allNotesOff();
    this.output = null;
  }

  private schedule(atMs: number, ch: number, action: () => void): void {
    const generation = this.generation;
    const delay = Math.max(0, atMs - this.clock.now());
    let handle: unknown = null;
    handle = this.clock.setTimeout(() => {
      this.timers.delete(handle);
      if (generation !== this.generation) {
        return;
      }
      action();
    }, delay);
    this.timers.set(handle, ch);
  }

  private fireOn(midi: number, velocity: number, ch: number): void {
    const output = this.output;
    if (!output) {
      return;
    }
    const key = noteKey(ch, midi);
    const count = this.sounding.get(key) ?? 0;
    if (count > 0) {
      // Retrigger: rearticulate cleanly before the new attack.
      output.send([0x80 | ch, midi, 0]);
    }
    output.send([0x90 | ch, midi, velocity]);
    this.sounding.set(key, count + 1);
  }

  private fireOff(midi: number, ch: number): void {
    const output = this.output;
    if (!output) {
      return;
    }
    const key = noteKey(ch, midi);
    const count = this.sounding.get(key) ?? 0;
    if (count <= 0) {
      return;
    }
    if (count === 1) {
      this.sounding.delete(key);
      output.send([0x80 | ch, midi, 0]);
      return;
    }
    // An older note-off while a newer attack of the same pitch is sounding: ignore it.
    this.sounding.set(key, count - 1);
  }
}

// ---------------------------------------------------------------------------
// Tone.js
// ---------------------------------------------------------------------------

interface ToneVoiceBank {
  gain: Tone.Gain;
  synth: Tone.PolySynth;
  click: Tone.Synth;
}

export interface ToneTimelineEngineOptions {
  /** Notes on this channel play the metronome click voice. Default 10. */
  metronomeChannel?: number;
  clock?: SchedulerClock;
}

/**
 * Tone.js adapter (immediate synth fallback; no sample loading).
 *
 * Tone cannot cancel attacks already scheduled on the audio clock, so `allNotesOff` retires the
 * whole voice bank: its gain is faded to 0, voices are released, and the bank is disposed shortly
 * after (longer than one lookahead window). The next note creates a fresh bank.
 */
export class ToneTimelineEngine implements TimelineEngine {
  private bank: ToneVoiceBank | null = null;
  private readonly clock: SchedulerClock;
  private readonly metronomeChannel: number;
  private readonly sounding = new Map<string, number>();
  private readonly disposeTimers = new Set<unknown>();
  private started = false;

  constructor(options: ToneTimelineEngineOptions = {}) {
    this.clock = options.clock ?? defaultSchedulerClock();
    this.metronomeChannel = options.metronomeChannel ?? DEFAULT_METRONOME_CHANNEL;
  }

  async prepare(): Promise<void> {
    if (!this.started) {
      await Tone.start();
      this.started = true;
    }
    this.ensureBank();
  }

  noteOn(midi: number, velocity: number, channel: number, atMs: number): void {
    const bank = this.ensureBank();
    if (!bank) {
      return;
    }
    const time = this.toAudioTime(atMs);
    const level = Math.min(1, Math.max(0, velocity / 127));
    try {
      if (Math.round(channel) === this.metronomeChannel) {
        const frequency = velocity >= 100 ? 1760 : 1320;
        bank.click.triggerAttackRelease(frequency, 0.03, time, level);
        return;
      }
      const frequency = Tone.Frequency(midi, "midi").toFrequency();
      const key = noteKey(clampChannel(channel), midi);
      const count = this.sounding.get(key) ?? 0;
      if (count > 0) {
        bank.synth.triggerRelease(frequency, time);
      }
      bank.synth.triggerAttack(frequency, time, level);
      this.sounding.set(key, count + 1);
    } catch {
      // Never let an audio error break the transport's scheduling loop.
    }
  }

  noteOff(midi: number, channel: number, atMs: number): void {
    const bank = this.bank;
    if (!bank || Math.round(channel) === this.metronomeChannel) {
      return;
    }
    const key = noteKey(clampChannel(channel), midi);
    const count = this.sounding.get(key) ?? 0;
    if (count <= 0) {
      return;
    }
    if (count > 1) {
      this.sounding.set(key, count - 1);
      return;
    }
    this.sounding.delete(key);
    try {
      bank.synth.triggerRelease(Tone.Frequency(midi, "midi").toFrequency(), this.toAudioTime(atMs));
    } catch {
      // ignore
    }
  }

  allNotesOff(): void {
    // Channel-selective silencing is not possible on a shared Tone bank; silence everything.
    this.sounding.clear();
    const bank = this.bank;
    this.bank = null;
    if (!bank) {
      return;
    }
    try {
      bank.gain.gain.rampTo(0, 0.02);
      bank.synth.releaseAll();
    } catch {
      // ignore
    }
    let handle: unknown = null;
    handle = this.clock.setTimeout(() => {
      this.disposeTimers.delete(handle);
      this.disposeBank(bank);
    }, 400);
    this.disposeTimers.add(handle);
  }

  dispose(): void {
    this.allNotesOff();
    this.disposeTimers.forEach((handle) => this.clock.clearTimeout(handle));
    this.disposeTimers.clear();
  }

  private toAudioTime(atMs: number): number {
    return perfMsToAudioSeconds(atMs, this.clock.now(), Tone.now());
  }

  private ensureBank(): ToneVoiceBank | null {
    if (this.bank) {
      return this.bank;
    }
    if (!this.started) {
      return null;
    }
    const gain = new Tone.Gain(1).toDestination();
    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 1.2 }
    });
    synth.connect(gain);
    const click = new Tone.Synth({
      oscillator: { type: "square" },
      envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.01 }
    });
    click.connect(gain);
    this.bank = { gain, synth, click };
    return this.bank;
  }

  private disposeBank(bank: ToneVoiceBank): void {
    try {
      bank.synth.dispose();
      bank.click.dispose();
      bank.gain.dispose();
    } catch {
      // ignore
    }
  }
}
