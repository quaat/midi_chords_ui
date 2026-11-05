import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Transport } from "@/playback/transport";
import type { TransportOptions, TransportStatus } from "@/playback/transport";
import { SilentTimelineEngine, WebMidiTimelineEngine } from "@/playback/timelineEngines";
import type { EngineCall, TimelineEngine } from "@/playback/timelineEngines";
import { compileTimeline } from "@/timeline/compile";
import type { CompileTimelineOptions } from "@/timeline/compile";
import type { PerformedNote, SequenceEvent } from "@/model/contracts";
import { chordEvent, fakeClock, makeSequence } from "./fixtures";

const TWO_CHORDS: SequenceEvent[] = [chordEvent("e1", 0, "C", 0, 4), chordEvent("e2", 1, "F", 4, 4)];

function setup(events: SequenceEvent[] = TWO_CHORDS, compileOptions: CompileTimelineOptions = {}, options: TransportOptions = {}) {
  const engine = new SilentTimelineEngine();
  const transport = new Transport(engine, { clock: fakeClock(), ...options });
  const timeline = compileTimeline(makeSequence(events, 120), compileOptions);
  transport.load(timeline);
  return { engine, transport, timeline, t0: performance.now() };
}

function ons(engine: SilentTimelineEngine, channel?: number): EngineCall[] {
  return engine.noteOns().filter((call) => channel === undefined || call.channel === channel);
}

describe("Transport — scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedules notes within the lookahead window only", async () => {
    const { engine, transport, t0 } = setup();
    await transport.play();
    expect(ons(engine).map((call) => call.midi)).toEqual([60, 64, 67]);
    expect(ons(engine).every((call) => call.atMs === t0)).toBe(true);

    vi.advanceTimersByTime(1800);
    expect(ons(engine)).toHaveLength(3);
    vi.advanceTimersByTime(100);
    expect(ons(engine)).toHaveLength(6);
    const second = ons(engine).slice(3);
    expect(second.every((call) => call.atMs === t0 + 2000)).toBe(true);
    engine.calls
      .filter((call) => call.type === "noteOn" || call.type === "noteOff")
      .forEach((call) => {
        expect((call.atMs ?? 0) - call.calledAtMs).toBeLessThanOrEqual(150 + 1e-6);
      });
    transport.dispose();
  });

  it("reports the exact compiled PerformedNote objects with their part (audio and visuals share one list)", async () => {
    const { transport, timeline } = setup(TWO_CHORDS, { accompaniment: "sustained" });
    const reported: PerformedNote[] = [];
    transport.onNoteOn((note) => reported.push(note));
    await transport.play();
    vi.advanceTimersByTime(4100);
    expect(reported).toHaveLength(timeline.notes.length);
    reported.forEach((note) => {
      expect(timeline.notes.includes(note)).toBe(true);
    });
    expect(new Set(reported.map((note) => note.part))).toEqual(new Set(["learner", "accompaniment"]));
    expect(transport.getPlayableNotes().every((note) => timeline.notes.includes(note))).toBe(true);
    transport.dispose();
  });

  it("routes parts to channels", async () => {
    const { engine, transport } = setup(TWO_CHORDS, { accompaniment: "rootOnly" });
    await transport.play();
    expect(ons(engine, 1).map((call) => call.midi)).toEqual([60, 64, 67]);
    expect(ons(engine, 2).map((call) => call.midi)).toEqual([36]);
    transport.dispose();
  });

  it("does not schedule a muted learner part but keeps accompaniment", async () => {
    const { engine, transport } = setup(TWO_CHORDS, { accompaniment: "rootOnly" });
    transport.setPartMuted("learner", true);
    await transport.play();
    vi.advanceTimersByTime(4100);
    expect(ons(engine, 1)).toHaveLength(0);
    expect(ons(engine, 2).map((call) => call.midi)).toEqual([36, 41]);
    expect(transport.getSnapshot().mutedParts).toEqual(["learner"]);
    transport.dispose();
  });

  it("muting while playing silences and continues without that part", async () => {
    const { engine, transport } = setup(TWO_CHORDS, { accompaniment: "rootOnly" });
    await transport.play();
    vi.advanceTimersByTime(500);
    engine.clear();
    transport.setPartMuted("learner", true);
    expect(engine.calls[0].type).toBe("allNotesOff");
    vi.advanceTimersByTime(3600);
    expect(ons(engine, 1)).toHaveLength(0);
    expect(transport.getSnapshot().state).toBe("stopped");
    transport.dispose();
  });

  it("retriggers a repeated pitch between adjacent events (noteOff before noteOn)", async () => {
    const { engine, transport, t0 } = setup([chordEvent("a", 0, "C", 0, 2), chordEvent("b", 1, "C", 2, 2)]);
    await transport.play();
    vi.advanceTimersByTime(1000);
    const at = t0 + 1000;
    const calls = engine.calls.filter((call) => call.midi === 60 && call.atMs === at);
    expect(calls.map((call) => call.type)).toEqual(["noteOff", "noteOn"]);
    transport.dispose();
  });

  it("generates metronome clicks when enabled and the timeline has none", async () => {
    const { engine, transport } = setup([chordEvent("a", 0, "C", 0, 4)]);
    transport.setMetronome(true);
    await transport.play();
    vi.advanceTimersByTime(2100);
    const clicks = ons(engine, 10);
    expect(clicks.map((call) => call.velocity)).toEqual([120, 80, 80, 80]);
    transport.dispose();
  });

  it("follows compiled metronome notes by default and can switch them off", async () => {
    const { engine, transport } = setup([chordEvent("a", 0, "C", 0, 4)], { metronome: true });
    expect(transport.getSnapshot().metronomeEnabled).toBe(true);
    transport.setMetronome(false);
    await transport.play();
    vi.advanceTimersByTime(2100);
    expect(ons(engine, 10)).toHaveLength(0);
    transport.dispose();
  });
});

describe("Transport — pause, stop, seek, generations", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pause sends allNotesOff, keeps position, leaves no timers, and resumes there", async () => {
    const { engine, transport, timeline } = setup();
    const offs: PerformedNote[] = [];
    transport.onNoteOff((note) => offs.push(note));
    await transport.play();
    vi.advanceTimersByTime(1000);
    engine.clear();
    transport.pause();
    expect(engine.calls.map((call) => call.type)).toContain("allNotesOff");
    expect(offs).toHaveLength(3);
    expect(offs.every((note) => timeline.notes.includes(note))).toBe(true);
    const snapshot = transport.getSnapshot();
    expect(snapshot.state).toBe("paused");
    expect(snapshot.positionBeats).toBeCloseTo(2, 6);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(transport.getSnapshot().positionBeats).toBeCloseTo(2, 6);
    expect(ons(engine)).toHaveLength(0);

    await transport.play();
    // The held C chord is chased (re-attacked) at the resume point.
    expect(ons(engine).map((call) => call.midi)).toEqual([60, 64, 67]);
    vi.advanceTimersByTime(1000);
    expect(ons(engine)).toHaveLength(6);
    transport.dispose();
  });

  it("stop resets to 0 and increments the generation", async () => {
    const { engine, transport } = setup();
    await transport.play();
    vi.advanceTimersByTime(700);
    const generation = transport.getSnapshot().generation;
    transport.stop();
    const snapshot = transport.getSnapshot();
    expect(snapshot.state).toBe("stopped");
    expect(snapshot.positionBeats).toBe(0);
    expect(snapshot.generation).toBeGreaterThan(generation);
    expect(engine.calls[engine.calls.length - 1].type).toBe("allNotesOff");
    expect(vi.getTimerCount()).toBe(0);
    transport.dispose();
  });

  it("seek while playing drops stale work and continues from the new beat", async () => {
    const { engine, transport, t0 } = setup();
    await transport.play();
    vi.advanceTimersByTime(100);
    const generation = transport.getSnapshot().generation;
    engine.clear();
    transport.seek(4);
    expect(transport.getSnapshot().generation).toBeGreaterThan(generation);
    expect(engine.calls[0].type).toBe("allNotesOff");
    expect(ons(engine).map((call) => call.midi).sort((a, b) => a - b)).toEqual([60, 65, 69]);
    expect(ons(engine).every((call) => call.atMs === t0 + 100)).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(3000);
    // Nothing from the first chord (beat 0) was scheduled after the seek.
    expect(ons(engine)).toHaveLength(3);
    expect(transport.getSnapshot().state).toBe("stopped");
    transport.dispose();
  });

  it("seek while stopped only moves the position", () => {
    const { transport } = setup();
    transport.seek(6);
    expect(transport.getSnapshot().positionBeats).toBe(6);
    transport.seek(100);
    expect(transport.getSnapshot().positionBeats).toBe(8);
    transport.dispose();
  });

  it("a stop during engine preparation cancels the pending start (stale generation)", async () => {
    let resolvePrepare: () => void = () => undefined;
    const silent = new SilentTimelineEngine();
    const engine: TimelineEngine = {
      prepare: () =>
        new Promise<void>((resolve) => {
          resolvePrepare = resolve;
        }),
      noteOn: (midi, velocity, channel, atMs) => silent.noteOn(midi, velocity, channel, atMs),
      noteOff: (midi, channel, atMs) => silent.noteOff(midi, channel, atMs),
      allNotesOff: (channel) => silent.allNotesOff(channel)
    };
    const transport = new Transport(engine, { clock: fakeClock() });
    transport.load(compileTimeline(makeSequence(TWO_CHORDS)));
    const pending = transport.play();
    transport.stop();
    resolvePrepare();
    await pending;
    vi.advanceTimersByTime(1000);
    expect(silent.noteOns()).toHaveLength(0);
    expect(transport.getSnapshot().state).toBe("stopped");
    expect(vi.getTimerCount()).toBe(0);
    transport.dispose();
  });

  it("ends naturally: stopped at 0 with no timers left", async () => {
    const { engine, transport } = setup();
    const states: string[] = [];
    transport.subscribe((status) => states.push(status.state));
    await transport.play();
    vi.advanceTimersByTime(4200);
    expect(transport.getSnapshot().state).toBe("stopped");
    expect(transport.getSnapshot().positionBeats).toBe(0);
    expect(states[states.length - 1]).toBe("stopped");
    expect(engine.noteOffs()).toHaveLength(6);
    expect(vi.getTimerCount()).toBe(0);
    transport.dispose();
  });

  it("dispose leaves no timers and ignores further calls", async () => {
    const { engine, transport } = setup();
    await transport.play();
    vi.advanceTimersByTime(300);
    transport.dispose();
    expect(vi.getTimerCount()).toBe(0);
    engine.clear();
    await transport.play();
    vi.advanceTimersByTime(1000);
    expect(engine.calls).toHaveLength(0);
  });

  it("notifies subscribers on state changes, not per frame, and caches the state snapshot", async () => {
    const { transport } = setup([chordEvent("a", 0, "C", 0, 16)]);
    const statuses: TransportStatus[] = [];
    transport.subscribe((status) => statuses.push(status));
    const cachedBefore = transport.getStateSnapshot();
    expect(transport.getStateSnapshot()).toBe(cachedBefore);
    await transport.play();
    const afterPlay = statuses.length;
    vi.advanceTimersByTime(2000);
    expect(statuses.length).toBe(afterPlay);
    expect(transport.getStateSnapshot().state).toBe("playing");
    expect(transport.getStateSnapshot()).toBe(statuses[statuses.length - 1]);
    // Live snapshot moves; cached one does not.
    expect(transport.getSnapshot().positionBeats).toBeCloseTo(4, 6);
    expect(transport.getStateSnapshot().positionBeats).toBe(0);
    transport.dispose();
  });
});

describe("Transport — count-in, loop, tempo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts in with negative positions, then plays from 0", async () => {
    const { engine, transport, t0 } = setup();
    transport.setCountIn(4);
    const states: string[] = [];
    transport.subscribe((status) => states.push(status.state));
    await transport.play();
    let snapshot = transport.getSnapshot();
    expect(snapshot.state).toBe("countingIn");
    expect(snapshot.positionBeats).toBeCloseTo(-4, 6);
    expect(snapshot.countInTargetBeat).toBe(0);
    vi.advanceTimersByTime(1000);
    snapshot = transport.getSnapshot();
    expect(snapshot.positionBeats).toBeCloseTo(-2, 6);
    expect(snapshot.positionSeconds).toBeCloseTo(-1, 6);
    expect(ons(engine, 1)).toHaveLength(0);
    vi.advanceTimersByTime(1000);
    snapshot = transport.getSnapshot();
    expect(snapshot.state).toBe("playing");
    expect(snapshot.positionBeats).toBeCloseTo(0, 6);
    expect(states).toEqual(["countingIn", "playing"]);
    const clicks = ons(engine, 10);
    expect(clicks.map((call) => call.atMs)).toEqual([t0, t0 + 500, t0 + 1000, t0 + 1500]);
    expect(clicks[0].velocity).toBe(120);
    expect(ons(engine, 1).every((call) => call.atMs === t0 + 2000)).toBe(true);
    transport.dispose();
  });

  it("count-in clicks are tagged as count-in metronome notes", async () => {
    const { transport } = setup();
    transport.setCountIn(2);
    const seen: { part: string; countIn: boolean }[] = [];
    transport.onNoteOn((note, info) => seen.push({ part: note.part, countIn: info.countIn }));
    await transport.play();
    vi.advanceTimersByTime(1100);
    expect(seen.slice(0, 2)).toEqual([
      { part: "metronome", countIn: true },
      { part: "metronome", countIn: true }
    ]);
    expect(seen.slice(2).every((entry) => entry.part === "learner" && !entry.countIn)).toBe(true);
    transport.dispose();
  });

  it("wraps a loop and retriggers a repeated pitch with noteOff before noteOn", async () => {
    const { engine, transport, t0 } = setup([chordEvent("a", 0, "C", 0, 4), chordEvent("b", 1, "F", 4, 4)]);
    transport.setLoop({ startBeat: 0, endBeat: 4 });
    const passes: number[] = [];
    transport.subscribe((status) => passes.push(status.loopPass));
    await transport.play();
    vi.advanceTimersByTime(2100);
    const wrapAt = t0 + 2000;
    const atWrap = engine.calls.filter((call) => call.midi === 60 && call.atMs === wrapAt);
    expect(atWrap.map((call) => call.type)).toEqual(["noteOff", "noteOn"]);
    // F chord (beat 4) is never played while looping bars 0..4.
    vi.advanceTimersByTime(4000);
    expect(ons(engine).some((call) => call.midi === 65)).toBe(false);
    const snapshot = transport.getSnapshot();
    expect(snapshot.state).toBe("playing");
    expect(snapshot.positionBeats).toBeGreaterThanOrEqual(0);
    expect(snapshot.positionBeats).toBeLessThan(4);
    expect(snapshot.loopPass).toBe(3);
    expect(passes).toContain(1);
    expect(passes).toContain(2);
    expect(ons(engine).filter((call) => call.midi === 60).map((call) => call.atMs - t0)).toEqual([0, 2000, 4000, 6000]);
    transport.dispose();
  });

  it("clips notes at the loop end and starts outside-loop plays at the loop start", async () => {
    const { engine, transport, t0 } = setup([chordEvent("a", 0, "C", 0, 4), chordEvent("b", 1, "F", 4, 4)]);
    transport.setLoop({ startBeat: 4, endBeat: 6 });
    await transport.play();
    expect(transport.getSnapshot().positionBeats).toBeCloseTo(4, 6);
    vi.advanceTimersByTime(1100);
    const offs = engine.noteOffs().filter((call) => call.midi === 65);
    expect(offs[0].atMs).toBe(t0 + 1000);
    expect(ons(engine).filter((call) => call.midi === 65).map((call) => call.atMs)).toEqual([t0, t0 + 1000]);
    transport.dispose();
  });

  it("setting a loop while playing sends allNotesOff and keeps going", async () => {
    const { engine, transport } = setup([chordEvent("a", 0, "C", 0, 4), chordEvent("b", 1, "F", 4, 4)]);
    await transport.play();
    vi.advanceTimersByTime(2500);
    engine.clear();
    transport.setLoop({ startBeat: 0, endBeat: 2 });
    expect(engine.calls[0].type).toBe("allNotesOff");
    // Position 5 is past the new loop end → jumps to the loop start.
    expect(transport.getSnapshot().positionBeats).toBeCloseTo(0, 6);
    transport.setLoop(null);
    expect(transport.getSnapshot().loop).toBeNull();
    transport.dispose();
  });

  it("keeps the beat position continuous across a tempo change", async () => {
    const { engine, transport } = setup([chordEvent("a", 0, "C", 0, 16)]);
    await transport.play();
    vi.advanceTimersByTime(1000);
    expect(transport.getSnapshot().positionBeats).toBeCloseTo(2, 6);
    engine.clear();
    transport.setTempo(60);
    expect(engine.calls[0].type).toBe("allNotesOff");
    const snapshot = transport.getSnapshot();
    expect(snapshot.positionBeats).toBeCloseTo(2, 6);
    expect(snapshot.tempoBpm).toBe(60);
    vi.advanceTimersByTime(1000);
    expect(transport.getSnapshot().positionBeats).toBeCloseTo(3, 6);
    expect(transport.getSnapshot().positionSeconds).toBeCloseTo(3, 6);
    transport.setTempo(null);
    expect(transport.getSnapshot().tempoBpm).toBe(120);
    expect(transport.getSnapshot().positionBeats).toBeCloseTo(3, 6);
    transport.dispose();
  });

  it("a tempo change during count-in keeps counting in", async () => {
    const { transport } = setup();
    transport.setCountIn(4);
    await transport.play();
    vi.advanceTimersByTime(1000);
    transport.setTempo(60);
    let snapshot = transport.getSnapshot();
    expect(snapshot.state).toBe("countingIn");
    expect(snapshot.positionBeats).toBeCloseTo(-2, 6);
    vi.advanceTimersByTime(2000);
    snapshot = transport.getSnapshot();
    expect(snapshot.state).toBe("playing");
    expect(snapshot.positionBeats).toBeCloseTo(0, 6);
    transport.dispose();
  });

  it("switching engines silences the old one and continues on the new one", async () => {
    const { engine, transport } = setup();
    await transport.play();
    vi.advanceTimersByTime(500);
    const next = new SilentTimelineEngine();
    await transport.setEngine(next);
    expect(engine.calls[engine.calls.length - 1].type).toBe("allNotesOff");
    expect(next.noteOns().map((call) => call.midi)).toEqual([60, 64, 67]);
    vi.advanceTimersByTime(1600);
    expect(next.noteOns()).toHaveLength(6);
    transport.dispose();
  });
});

describe("Transport over Web MIDI", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loops a held chord with clean retriggers and leaves no timers after dispose", async () => {
    const send = vi.fn();
    const engine = new WebMidiTimelineEngine({ send }, fakeClock());
    const transport = new Transport(engine, { clock: fakeClock() });
    transport.load(compileTimeline(makeSequence([chordEvent("a", 0, "C", 0, 2)])));
    transport.setLoop({ startBeat: 0, endBeat: 2 });
    await transport.play();
    vi.advanceTimersByTime(1050);
    const middleC = send.mock.calls.map(([message]) => message as number[]).filter((message) => message[1] === 60);
    expect(middleC).toEqual([
      [0x90, 60, 96],
      [0x80, 60, 0],
      [0x90, 60, 96]
    ]);
    transport.dispose();
    expect(vi.getTimerCount()).toBe(0);
    const last = send.mock.calls[send.mock.calls.length - 1]?.[0];
    expect(last).toEqual([0xb0, 123, 0]);
  });

  it("drops notes that are already too late after a stalled tick instead of bursting them", async () => {
    let now = 0;
    const timers: { at: number; cb: () => void; id: number }[] = [];
    let nextId = 1;
    const clock = {
      now: (): number => now,
      setTimeout: (cb: () => void, ms: number): unknown => {
        const id = nextId++;
        timers.push({ at: now + ms, cb, id });
        return id;
      },
      clearTimeout: (handle: unknown): void => {
        const index = timers.findIndex((timer) => timer.id === handle);
        if (index >= 0) {
          timers.splice(index, 1);
        }
      }
    };
    const engine = new SilentTimelineEngine(() => now);
    const transport = new Transport(engine, { clock });
    transport.load(compileTimeline(makeSequence([chordEvent("a", 0, "C", 0, 1), chordEvent("b", 1, "F", 1, 1), chordEvent("c", 2, "G", 2, 2)])));
    await transport.play();
    // The tab stalls for 1.2 s: beat 1 (500 ms) is long gone, beat 2 (1000 ms) is 200 ms late.
    now = 1200;
    const timer = timers.shift();
    timer?.cb();
    const calls = engine.noteOns();
    const midis = calls.map((call) => call.midi);
    expect(midis.slice(0, 3)).toEqual([60, 64, 67]);
    // F (beats 1..2) has already ended: dropped. G (beats 2..4) is still sounding: attacked now.
    expect(midis).not.toContain(65);
    const late = calls.slice(3);
    expect(late.length).toBe(3);
    expect(late.every((call) => call.atMs === 1200)).toBe(true);
    expect(transport.getSnapshot().positionBeats).toBeCloseTo(2.4, 6);
    transport.dispose();
  });
});
