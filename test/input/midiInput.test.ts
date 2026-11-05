import { describe, expect, it } from "vitest";
import type { InputEvent } from "@/model/contracts";
import { MidiInputManager } from "@/input/midiInput";
import type { MidiDevicesSnapshot } from "@/input/midiInput";
import { HeldStateTracker } from "@/input/heldState";
import type { HeldChange } from "@/input/heldState";
import { FakeAccess, FakeInput, FakeOutput, fakeNavigator } from "./fakeMidi";

interface Rig {
  manager: MidiInputManager;
  access: FakeAccess;
  piano: FakeInput;
  pianoOut: FakeOutput;
  events: InputEvent[];
  held: HeldChange[];
  clock: { t: number };
}

async function rig(options: { recordRaw?: boolean; rawLogCapacity?: number } = {}): Promise<Rig> {
  const piano = new FakeInput("in-1", "CASIO USB-MIDI", "Casio");
  const pianoOut = new FakeOutput("out-1", "CASIO USB-MIDI", "Casio");
  const access = new FakeAccess([piano, new FakeInput("in-2", "Other Keys", "Acme")], [pianoOut]);
  const clock = { t: 1000 };
  const manager = new MidiInputManager({
    navigator: fakeNavigator(access),
    isSecureContext: true,
    now: () => clock.t,
    recordRaw: options.recordRaw,
    rawLogCapacity: options.rawLogCapacity
  });
  const events: InputEvent[] = [];
  const held: HeldChange[] = [];
  manager.onEvent((event) => events.push(event));
  manager.onHeldChange((change) => held.push(change));
  await manager.requestAccess();
  return { manager, access, piano, pianoOut, events, held, clock };
}

describe("MidiInputManager access", () => {
  it("reports unsupported without navigator.requestMIDIAccess", async () => {
    const manager = new MidiInputManager({ navigator: {}, isSecureContext: true });
    expect(manager.getAccessInfo().state).toBe("unsupported");
    const info = await manager.requestAccess();
    expect(info).toMatchObject({ state: "unsupported", reason: "noWebMidi" });
    expect(new MidiInputManager({ navigator: null }).getAccessInfo().state).toBe("unsupported");
  });

  it("reports unsupported in an insecure context without prompting", async () => {
    const nav = fakeNavigator(new FakeAccess());
    const manager = new MidiInputManager({ navigator: nav, isSecureContext: false });
    const info = await manager.requestAccess();
    expect(info).toMatchObject({ state: "unsupported", reason: "insecureContext" });
    expect(nav.requestCount).toBe(0);
  });

  it("starts in prompt, becomes granted, and lists devices", async () => {
    const access = new FakeAccess([new FakeInput("in-1", "CASIO USB-MIDI", "Casio")], [new FakeOutput("out-1", "Synth", "Acme")]);
    const manager = new MidiInputManager({ navigator: fakeNavigator(access), isSecureContext: true });
    expect(manager.getAccessInfo().state).toBe("prompt");
    const states: string[] = [];
    manager.onAccessChanged((info) => states.push(info.state));
    const info = await manager.requestAccess();
    expect(info.state).toBe("granted");
    expect(states).toEqual(["granted"]);
    expect(manager.listInputs()).toEqual([
      { id: "in-1", name: "CASIO USB-MIDI", manufacturer: "Casio", state: "connected", connection: "closed", type: "input", label: "CASIO USB-MIDI" }
    ]);
    expect(manager.listOutputs()[0]).toMatchObject({ id: "out-1", label: "Synth (Acme)", type: "output" });
    expect(access.listenerCount()).toBe(1);
  });

  it("reports denied when the user blocks access", async () => {
    const manager = new MidiInputManager({ navigator: fakeNavigator(new FakeAccess(), { rejectWith: "NotAllowedError" }), isSecureContext: true });
    const info = await manager.requestAccess();
    expect(info).toMatchObject({ state: "denied", reason: "notAllowed" });
  });

  it("queryPermission reflects a blocked permission without prompting", async () => {
    const nav = fakeNavigator(new FakeAccess(), { permissionState: "denied" });
    const manager = new MidiInputManager({ navigator: nav, isSecureContext: true });
    const info = await manager.queryPermission();
    expect(info.state).toBe("denied");
    expect(nav.requestCount).toBe(0);
  });
});

describe("MidiInputManager input", () => {
  it("emits normalised events with source midi from the selected input only", async () => {
    const { manager, access, piano, events } = await rig();
    expect(manager.selectInput("in-1")).toBe(true);
    piano.emit([0x90, 60, 100], 1500);
    piano.emit([0x90, 60, 0], 1600);
    access.inputs.get("in-2")?.emit([0x90, 62, 100], 1700);
    expect(events.map((e) => [e.type, e.midi, e.timestampMs, e.source, e.portId, e.portName, e.channel])).toEqual([
      ["noteOn", 60, 1500, "midi", "in-1", "CASIO USB-MIDI", 1],
      ["noteOff", 60, 1600, "midi", "in-1", "CASIO USB-MIDI", 1]
    ]);
  });

  it("falls back to now() when the event has no timestamp", async () => {
    const { manager, piano, events, clock } = await rig();
    manager.selectInput("in-1");
    clock.t = 4242;
    piano.emit([0x90, 60, 100], 0);
    expect(events[0].timestampMs).toBe(4242);
  });

  it("applies the latency offset to emitted timestamps but not to the raw log", async () => {
    const { manager, piano, events } = await rig({ recordRaw: true });
    manager.selectInput("in-1");
    manager.setLatencyOffsetMs(12);
    piano.emit([0x90, 60, 100], 2000);
    expect(events[0].timestampMs).toBe(1988);
    expect(manager.getRawLog()[0].timestampMs).toBe(2000);
    expect(manager.getLatencyOffsetMs()).toBe(12);
  });

  it("switching the selected input detaches the old one and clears its held notes", async () => {
    const { manager, access, piano, held } = await rig();
    manager.selectInput("in-1");
    piano.emit([0x90, 60, 100], 1100);
    expect(manager.getHeldState().sounding()).toEqual([60]);
    manager.selectInput("in-2");
    expect(piano.onmidimessage).toBeNull();
    expect(manager.getHeldState().sounding()).toEqual([]);
    expect(held[held.length - 1]).toMatchObject({ kind: "reset", portId: "in-1" });
    expect(piano.emit([0x90, 61, 100], 1200)).toBe(false);
    access.inputs.get("in-2")?.emit([0x90, 62, 100], 1300);
    expect(manager.getHeldState().sounding()).toEqual([62]);
    manager.selectInput(null);
    expect(manager.getSelectedInputId()).toBeNull();
    expect(manager.getHeldState().sounding()).toEqual([]);
  });

  it("disconnect clears only that port and reconnect re-selects the same device", async () => {
    const shared = new HeldStateTracker();
    shared.apply({ source: "computerKeyboard", type: "noteOn", timestampMs: 0, midi: 72, velocity: 96 });
    const piano = new FakeInput("in-1", "CASIO USB-MIDI", "Casio");
    const access = new FakeAccess([piano], []);
    const manager = new MidiInputManager({ navigator: fakeNavigator(access), isSecureContext: true, now: () => 5, heldState: shared });
    const events: InputEvent[] = [];
    const devices: MidiDevicesSnapshot[] = [];
    manager.onEvent((event) => events.push(event));
    manager.onDevicesChanged((snapshot) => devices.push(snapshot));
    await manager.requestAccess();
    manager.selectInput("in-1");
    piano.emit([0x90, 60, 100], 10);
    piano.emit([0xb0, 64, 127], 11);
    expect(shared.sounding()).toEqual([60, 72]);

    access.unplug(piano);
    expect(shared.sounding()).toEqual([72]);
    expect(manager.isSelectedInputConnected()).toBe(false);
    expect(manager.getSelectedInputId()).toBe("in-1");
    expect(events[events.length - 1]).toMatchObject({ type: "connection", connected: false, portId: "in-1" });
    expect(devices[devices.length - 1]).toMatchObject({ selectedInputId: "in-1", selectedInputConnected: false });

    access.plug(piano);
    expect(manager.isSelectedInputConnected()).toBe(true);
    expect(events[events.length - 1]).toMatchObject({ type: "connection", connected: true });
    piano.emit([0x90, 64, 90], 20);
    expect(shared.snapshot().pressed).toEqual([64, 72]);
    expect(shared.snapshot().sustainDown).toBe(false);
  });

  it("re-selects by name when the device returns with a new port id", async () => {
    const { manager, access, piano, events } = await rig();
    manager.selectInput("in-1");
    access.unplug(piano);
    access.inputs.delete("in-1");
    const replugged = new FakeInput("in-9", "CASIO USB-MIDI", "Casio");
    access.plug(replugged);
    expect(manager.getSelectedInputId()).toBe("in-9");
    replugged.emit([0x90, 60, 100], 3000);
    expect(events[events.length - 1]).toMatchObject({ type: "noteOn", portId: "in-9" });
  });

  it("ignores repeated statechange events without a state transition", async () => {
    const { manager, access, piano, events } = await rig();
    manager.selectInput("in-1");
    access.fire(piano);
    access.fire(piano);
    expect(events.filter((e) => e.type === "connection")).toHaveLength(0);
    expect(manager.isSelectedInputConnected()).toBe(true);
  });

  it("remembers a selection made before the device is present", async () => {
    const { manager, access } = await rig();
    expect(manager.selectInput("later")).toBe(false);
    const later = new FakeInput("later", "Late Keys", "Acme");
    access.plug(later);
    expect(manager.isSelectedInputConnected()).toBe(true);
    expect(later.onmidimessage).not.toBeNull();
  });
});

describe("MidiInputManager monitoring and panic", () => {
  it("monitoring is off by default: nothing is echoed to the instrument", async () => {
    const { manager, piano, pianoOut } = await rig();
    manager.selectInput("in-1");
    manager.setEchoOutput(pianoOut);
    piano.emit([0x90, 60, 100], 1100);
    expect(manager.isMonitoring()).toBe(false);
    expect(pianoOut.sent).toEqual([]);
  });

  it("monitoring forwards learner notes and pedals to the echo output", async () => {
    const { manager, piano, pianoOut } = await rig();
    manager.selectInput("in-1");
    manager.setEchoOutput("out-1");
    manager.setMonitoring(true);
    piano.emit([0x90, 60, 100], 1100);
    piano.emit([0xb0, 64, 127], 1101);
    piano.emit([0x80, 60, 0], 1102);
    piano.emit([0xb0, 7, 100], 1103);
    expect(pianoOut.sent).toEqual([
      [0x90, 60, 100],
      [0xb0, 64, 127],
      [0x80, 60, 0]
    ]);
    expect(manager.getRoutingWarnings()[0]).toContain("Local Control");
  });

  it("echo cannot create learner input: forwarded output looping back is dropped", async () => {
    const { manager, piano, pianoOut, events, held } = await rig({ recordRaw: true });
    // A loopback device: everything we send comes straight back on the selected input.
    pianoOut.onSend = (data) => {
      piano.emit(data, 1200);
    };
    manager.selectInput("in-1");
    manager.setEchoOutput(pianoOut);
    manager.setMonitoring(true);
    piano.emit([0x90, 60, 100], 1100);
    piano.emit([0x90, 60, 0], 1150);
    expect(pianoOut.sent).toHaveLength(2);
    expect(events.map((e) => e.type)).toEqual(["noteOn", "noteOff"]);
    expect(held.filter((c) => c.kind === "attack")).toHaveLength(1);
    expect(manager.getEchoSuppressedCount()).toBe(2);
    const raw = manager.getRawLog();
    expect(raw).toHaveLength(4);
    expect(raw.filter((entry) => entry.echo === true)).toHaveLength(2);
  });

  it("playback on an output port is never observed as learner input", async () => {
    const { manager, pianoOut, events } = await rig();
    manager.selectInput("in-1");
    pianoOut.send([0x90, 60, 100]);
    expect(events).toEqual([]);
    expect(manager.getHeldState().sounding()).toEqual([]);
  });

  it("panic sends all-notes-off to the echo output and resets held state", async () => {
    const { manager, piano, pianoOut, held } = await rig();
    manager.selectInput("in-1");
    manager.setEchoOutput(pianoOut);
    piano.emit([0x90, 60, 100], 1100);
    piano.emit([0xb0, 64, 127], 1101);
    manager.panic();
    expect(manager.getHeldState().snapshot()).toEqual({ pressed: [], sustained: [], sustainDown: false, sostenutoDown: false, softDown: false });
    expect(pianoOut.sent).toHaveLength(32);
    expect(pianoOut.sent).toContainEqual([0xb0, 123, 0]);
    expect(pianoOut.sent).toContainEqual([0xbf, 123, 0]);
    expect(pianoOut.sent).toContainEqual([0xb0, 64, 0]);
    expect(held[held.length - 1]).toMatchObject({ kind: "reset", reason: "reset" });
  });

  it("drops the echo output when it disconnects and restores it on reconnect", async () => {
    const { manager, access, piano, pianoOut } = await rig();
    manager.selectInput("in-1");
    manager.setEchoOutput("out-1");
    manager.setMonitoring(true);
    access.unplug(pianoOut);
    piano.emit([0x90, 60, 100], 1100);
    expect(pianoOut.sent).toEqual([]);
    access.plug(pianoOut);
    piano.emit([0x90, 62, 100], 1200);
    expect(pianoOut.sent).toEqual([[0x90, 62, 100]]);
  });
});

describe("MidiInputManager raw log", () => {
  it("records raw messages only when enabled, skipping realtime bytes", async () => {
    const { manager, piano } = await rig();
    manager.selectInput("in-1");
    piano.emit([0x90, 60, 100], 1100);
    expect(manager.getRawLog()).toEqual([]);
    manager.setRecordRaw(true);
    piano.emit([0xfe], 1150);
    piano.emit([0xb0, 7, 100], 1200);
    expect(manager.getRawLog()).toEqual([{ data: [0xb0, 7, 100], timestampMs: 1200, portId: "in-1", portName: "CASIO USB-MIDI" }]);
    manager.clearRawLog();
    expect(manager.getRawLog()).toEqual([]);
  });

  it("keeps the raw log bounded, dropping the oldest entries", async () => {
    const { manager, piano } = await rig({ recordRaw: true, rawLogCapacity: 5 });
    manager.selectInput("in-1");
    for (let i = 0; i < 12; i += 1) {
      piano.emit([0x90, 40 + i, 100], 2000 + i);
    }
    const raw = manager.getRawLog();
    expect(raw).toHaveLength(5);
    expect(raw.map((entry) => entry.data[1])).toEqual([47, 48, 49, 50, 51]);
    expect(manager.getRawLogDroppedCount()).toBe(7);
  });

  it("dispose detaches the input and the statechange listener", async () => {
    const { manager, access, piano } = await rig();
    manager.selectInput("in-1");
    manager.dispose();
    expect(piano.onmidimessage).toBeNull();
    expect(access.listenerCount()).toBe(0);
  });
});
