/**
 * Learner MIDI input manager (plan E09): capability/permission flow, device listing,
 * input selection, hot-plug recovery, optional monitoring/echo, panic, raw capture, and
 * latency calibration.
 *
 * Browser-facing but dependency-injected: tests pass a fake navigator / MIDIAccess.
 *
 * Routing rules
 * - Only the selected input produces learner InputEvents (source "midi"). Output ports are
 *   never listened to, so demonstration/accompaniment playback cannot become learner input.
 * - Monitoring (forwarding learner notes to an output) is OFF by default: the baseline for
 *   a digital piano such as the AP-470 is that the instrument's own (Local Control) sound
 *   plays while the app only observes. Forwarded messages are remembered briefly, and an
 *   identical message arriving back on the input (a loopback/echoing device) is dropped, so
 *   echo cannot manufacture answers.
 *
 * Timing
 * - Event timestamps come from MIDIMessageEvent.timeStamp (DOMHighResTimeStamp, same time
 *   origin as performance.now()), falling back to the injected `now()`.
 * - `setLatencyOffsetMs(ms)` is a calibration ESTIMATE of how late events arrive; it is
 *   subtracted from emitted timestamps (positive = receipt lags the performance). Event
 *   receipt is not physical key motion: the offset cannot account for key travel, device
 *   scan rate, or USB/driver jitter, and should be treated as approximate.
 * - Raw log entries keep the unadjusted receipt time so a recording can be re-calibrated.
 */

import type { InputEvent } from "@/model/contracts";
import type { HeldChange, HeldChangeListener } from "@/input/heldState";
import { HeldStateTracker } from "@/input/heldState";
import type { MidiBytes, MidiPortMeta } from "@/input/normalize";
import { isRealtimeMessage, parseMidiMessage } from "@/input/normalize";
import { RingBuffer } from "@/input/ringBuffer";
import { describeDevice } from "@/input/devices";

export type MidiAccessState = "unsupported" | "prompt" | "granted" | "denied";

export type MidiAccessReason = "noWebMidi" | "insecureContext" | "notAllowed" | "error";

export interface MidiAccessInfo {
  state: MidiAccessState;
  reason?: MidiAccessReason;
  /** Short user-facing explanation, suitable for a recovery hint. */
  message: string;
}

export interface MidiPortInfo {
  id: string;
  name: string;
  manufacturer: string;
  /** "connected" | "disconnected" */
  state: string;
  /** "open" | "closed" | "pending" */
  connection: string;
  type: "input" | "output";
  label: string;
}

export interface MidiDevicesSnapshot {
  inputs: MidiPortInfo[];
  outputs: MidiPortInfo[];
  selectedInputId: string | null;
  selectedInputConnected: boolean;
  echoOutputId: string | null;
}

export interface RawMidiLogEntry {
  data: number[];
  /** Unadjusted receipt timestamp (ms, performance clock). */
  timestampMs: number;
  portId: string;
  portName?: string;
  /** Set when the message was recognised as an echo of our own monitoring output and dropped. */
  echo?: boolean;
}

/** Subset of `navigator` used here; the real Navigator satisfies it. */
export interface MidiNavigatorLike {
  requestMIDIAccess?(options?: { sysex?: boolean; software?: boolean }): Promise<MIDIAccess>;
  permissions?: {
    query(descriptor: { name: string }): Promise<{ state: string }>;
  };
}

export interface MidiInputManagerOptions {
  /** Defaults to the global navigator. Pass null to simulate "no Web MIDI". */
  navigator?: MidiNavigatorLike | null;
  /** Defaults to globalThis.isSecureContext (true when unknown). */
  isSecureContext?: boolean;
  /** Performance clock in ms. Defaults to performance.now(). */
  now?: () => number;
  /** Share one tracker between MIDI, computer keyboard and touch input. */
  heldState?: HeldStateTracker;
  recordRaw?: boolean;
  /** Ring-buffer capacity for the raw log (default 5000). */
  rawLogCapacity?: number;
  /** Also log clock/active-sensing bytes (default false; the AP-470 sends active sensing). */
  recordRealtime?: boolean;
  /** How long a forwarded monitoring message is remembered for echo suppression (default 100 ms). */
  echoSuppressionWindowMs?: number;
  latencyOffsetMs?: number;
}

export type InputEventListener = (event: InputEvent) => void;
export type DevicesChangedListener = (devices: MidiDevicesSnapshot) => void;
export type AccessChangedListener = (info: MidiAccessInfo) => void;

interface DesiredInput {
  id: string;
  name: string;
  manufacturer: string;
}

interface PendingEcho {
  key: string;
  at: number;
}

const DEFAULT_RAW_CAPACITY = 5000;
const MAX_PENDING_ECHO = 256;

function defaultNavigator(): MidiNavigatorLike | null {
  const holder = globalThis as { navigator?: unknown };
  if (holder.navigator === undefined || holder.navigator === null) {
    return null;
  }
  return holder.navigator as MidiNavigatorLike;
}

function defaultSecureContext(): boolean {
  const holder = globalThis as { isSecureContext?: unknown };
  return typeof holder.isSecureContext === "boolean" ? holder.isSecureContext : true;
}

function defaultNow(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function bytesKey(data: MidiBytes): string {
  const parts: number[] = [];
  for (let i = 0; i < data.length && i < 3; i += 1) {
    parts.push(data[i]);
  }
  return parts.join(",");
}

function errorName(error: unknown): string {
  if (typeof error === "object" && error !== null && "name" in error) {
    const name = (error as { name: unknown }).name;
    return typeof name === "string" ? name : "";
  }
  return "";
}

function portInfo(port: MIDIPort, type: "input" | "output"): MidiPortInfo {
  const name = port.name ?? "";
  const manufacturer = port.manufacturer ?? "";
  return {
    id: port.id,
    name,
    manufacturer,
    state: String(port.state),
    connection: String(port.connection),
    type,
    label: describeDevice({ id: port.id, name, manufacturer, type })
  };
}

export class MidiInputManager {
  private readonly nav: MidiNavigatorLike | null;
  private readonly secure: boolean;
  private readonly now: () => number;
  private readonly held: HeldStateTracker;
  private readonly rawLog: RingBuffer<RawMidiLogEntry>;
  private readonly recordRealtime: boolean;
  private readonly echoWindowMs: number;

  private access: MIDIAccess | null = null;
  private accessInfo: MidiAccessInfo;
  private pendingRequest: Promise<MidiAccessInfo> | null = null;
  private desired: DesiredInput | null = null;
  private attachedInput: MIDIInput | null = null;
  private echoOutputId: string | null = null;
  private echoOutput: MIDIOutput | null = null;
  private monitoring = false;
  private recordRaw: boolean;
  private latencyOffsetMs: number;
  private pendingEcho: PendingEcho[] = [];
  private echoSuppressed = 0;
  private portStates = new Map<string, string>();
  private unsubscribeHeld: () => void;

  private eventListeners = new Set<InputEventListener>();
  private deviceListeners = new Set<DevicesChangedListener>();
  private heldListeners = new Set<HeldChangeListener>();
  private accessListeners = new Set<AccessChangedListener>();

  constructor(options: MidiInputManagerOptions = {}) {
    this.nav = options.navigator !== undefined ? options.navigator : defaultNavigator();
    this.secure = options.isSecureContext !== undefined ? options.isSecureContext : defaultSecureContext();
    this.now = options.now ?? defaultNow;
    this.held = options.heldState ?? new HeldStateTracker();
    this.rawLog = new RingBuffer<RawMidiLogEntry>(options.rawLogCapacity ?? DEFAULT_RAW_CAPACITY);
    this.recordRaw = options.recordRaw ?? false;
    this.recordRealtime = options.recordRealtime ?? false;
    this.echoWindowMs = options.echoSuppressionWindowMs ?? 100;
    this.latencyOffsetMs = options.latencyOffsetMs ?? 0;
    this.accessInfo = this.detectUnsupported() ?? { state: "prompt", message: "MIDI access has not been requested yet." };
    this.unsubscribeHeld = this.held.onChange((change: HeldChange) => {
      this.heldListeners.forEach((listener) => listener(change));
    });
  }

  // -------------------------------------------------------------------------
  // Capability and permission
  // -------------------------------------------------------------------------

  getAccessInfo(): MidiAccessInfo {
    return { ...this.accessInfo };
  }

  /**
   * Query the Permissions API without prompting. Returns the current info; it does not
   * acquire MIDIAccess (call requestAccess for that, ideally from a user gesture).
   */
  async queryPermission(): Promise<MidiAccessInfo> {
    if (this.accessInfo.state === "unsupported" || this.access) {
      return this.getAccessInfo();
    }
    const permissions = this.nav ? this.nav.permissions : undefined;
    if (!permissions) {
      return this.getAccessInfo();
    }
    try {
      const status = await permissions.query({ name: "midi" });
      if (status.state === "denied") {
        this.setAccessInfo({ state: "denied", reason: "notAllowed", message: "MIDI access is blocked for this site. Allow it in the browser's site settings." });
      } else if (status.state === "granted" || status.state === "prompt") {
        this.setAccessInfo({
          state: "prompt",
          message: status.state === "granted" ? "MIDI access is allowed; connect to start." : "Connect to allow MIDI access."
        });
      }
    } catch {
      // Permissions API without "midi" support: state remains unknown ("prompt").
    }
    return this.getAccessInfo();
  }

  /** Request Web MIDI access (no SysEx). Safe to call repeatedly. */
  requestAccess(): Promise<MidiAccessInfo> {
    if (this.access) {
      return Promise.resolve(this.getAccessInfo());
    }
    if (this.pendingRequest) {
      return this.pendingRequest;
    }
    this.pendingRequest = this.doRequestAccess().then((info) => {
      this.pendingRequest = null;
      return info;
    });
    return this.pendingRequest;
  }

  private async doRequestAccess(): Promise<MidiAccessInfo> {
    const unsupported = this.detectUnsupported();
    if (unsupported) {
      this.setAccessInfo(unsupported);
      return this.getAccessInfo();
    }
    const nav = this.nav as MidiNavigatorLike;
    const request = nav.requestMIDIAccess;
    if (typeof request !== "function") {
      this.setAccessInfo({ state: "unsupported", reason: "noWebMidi", message: "Web MIDI is not available in this browser." });
      return this.getAccessInfo();
    }
    try {
      const access = await request.call(nav, { sysex: false });
      this.adoptAccess(access);
      this.setAccessInfo({ state: "granted", message: "MIDI access granted." });
    } catch (error) {
      const name = errorName(error);
      if (name === "NotSupportedError") {
        this.setAccessInfo({ state: "unsupported", reason: "error", message: "This browser could not start Web MIDI." });
      } else if (name === "NotAllowedError" || name === "SecurityError") {
        this.setAccessInfo({
          state: "denied",
          reason: "notAllowed",
          message: "MIDI access was denied. Allow MIDI in the site settings, or use the computer keyboard or on-screen piano."
        });
      } else {
        this.setAccessInfo({
          state: "denied",
          reason: "error",
          message: "MIDI access failed. Reconnect the device and try again, or use the computer keyboard or on-screen piano."
        });
      }
    }
    return this.getAccessInfo();
  }

  private detectUnsupported(): MidiAccessInfo | null {
    if (!this.secure) {
      return { state: "unsupported", reason: "insecureContext", message: "Web MIDI needs a secure (https or localhost) page." };
    }
    if (!this.nav || typeof this.nav.requestMIDIAccess !== "function") {
      return { state: "unsupported", reason: "noWebMidi", message: "Web MIDI is not available in this browser." };
    }
    return null;
  }

  private setAccessInfo(info: MidiAccessInfo): void {
    this.accessInfo = info;
    const copy = this.getAccessInfo();
    this.accessListeners.forEach((listener) => listener(copy));
  }

  private adoptAccess(access: MIDIAccess): void {
    this.access = access;
    access.inputs.forEach((input) => {
      this.portStates.set(input.id, String(input.state));
    });
    access.outputs.forEach((output) => {
      this.portStates.set(output.id, String(output.state));
    });
    access.addEventListener("statechange", this.handleStateChangeEvent);
    if (this.echoOutputId !== null && !this.echoOutput) {
      this.echoOutput = this.lookupOutput(this.echoOutputId);
    }
    this.tryAttachDesired();
    this.emitDevicesChanged();
  }

  // -------------------------------------------------------------------------
  // Devices
  // -------------------------------------------------------------------------

  listInputs(): MidiPortInfo[] {
    const result: MidiPortInfo[] = [];
    if (this.access) {
      this.access.inputs.forEach((input) => {
        result.push(portInfo(input, "input"));
      });
    }
    return result;
  }

  listOutputs(): MidiPortInfo[] {
    const result: MidiPortInfo[] = [];
    if (this.access) {
      this.access.outputs.forEach((output) => {
        result.push(portInfo(output, "output"));
      });
    }
    return result;
  }

  getDevices(): MidiDevicesSnapshot {
    return {
      inputs: this.listInputs(),
      outputs: this.listOutputs(),
      selectedInputId: this.desired ? this.desired.id : null,
      selectedInputConnected: this.attachedInput !== null,
      echoOutputId: this.echoOutputId
    };
  }

  /** The MIDIOutput object for an id (e.g. to hand to WebMidiPlaybackEngine.setOutput). */
  getOutput(id: string): MIDIOutput | null {
    return this.lookupOutput(id);
  }

  getSelectedInputId(): string | null {
    return this.desired ? this.desired.id : null;
  }

  isSelectedInputConnected(): boolean {
    return this.attachedInput !== null;
  }

  /**
   * Select the learner input by port id (null = none). The selection is remembered: if the
   * device is absent or disconnects, it is re-attached automatically when it (re)appears.
   * Held state of the previously attached port is cleared. Returns true when attached now.
   */
  selectInput(id: string | null): boolean {
    const previous = this.attachedInput;
    this.detachInput();
    if (previous) {
      this.held.clearPort(previous.id, this.now());
    }
    if (id === null) {
      this.desired = null;
      this.emitDevicesChanged();
      return false;
    }
    const port = this.access ? this.access.inputs.get(id) : undefined;
    this.desired = {
      id,
      name: port && port.name ? port.name : "",
      manufacturer: port && port.manufacturer ? port.manufacturer : ""
    };
    this.tryAttachDesired();
    this.emitDevicesChanged();
    return this.attachedInput !== null;
  }

  private tryAttachDesired(): void {
    if (!this.desired || !this.access || this.attachedInput) {
      return;
    }
    const desired = this.desired;
    let found: MIDIInput | null = null;
    const byId = this.access.inputs.get(desired.id);
    if (byId && byId.state !== "disconnected") {
      found = byId;
    } else if (desired.name !== "") {
      // Some platforms assign a new port id after re-plugging; fall back to name + manufacturer.
      const candidates: MIDIInput[] = Array.from(this.access.inputs.values());
      for (const input of candidates) {
        if (input.state === "disconnected") {
          continue;
        }
        if ((input.name ?? "") === desired.name && (input.manufacturer ?? "") === desired.manufacturer) {
          found = input;
          break;
        }
      }
    }
    if (found) {
      this.attachInput(found);
    }
  }

  private attachInput(input: MIDIInput): void {
    this.attachedInput = input;
    if (this.desired) {
      this.desired.id = input.id;
      if (input.name) {
        this.desired.name = input.name;
      }
      if (input.manufacturer) {
        this.desired.manufacturer = input.manufacturer;
      }
    }
    input.onmidimessage = (event: MIDIMessageEvent) => {
      this.handleMidiMessage(input, event);
    };
  }

  private detachInput(): void {
    const input = this.attachedInput;
    if (!input) {
      return;
    }
    input.onmidimessage = null;
    this.attachedInput = null;
  }

  private lookupOutput(id: string): MIDIOutput | null {
    if (!this.access) {
      return null;
    }
    const output = this.access.outputs.get(id);
    if (!output || output.state === "disconnected") {
      return null;
    }
    return output;
  }

  private readonly handleStateChangeEvent = (event: Event): void => {
    const port = (event as MIDIConnectionEvent).port;
    if (!port) {
      return;
    }
    this.handlePortState(port);
  };

  private handlePortState(port: MIDIPort): void {
    const state = String(port.state);
    const previous = this.portStates.get(port.id);
    this.portStates.set(port.id, state);
    const changed = previous !== state;

    if (port.type === "input") {
      if (changed && state === "disconnected") {
        if (this.attachedInput && this.attachedInput.id === port.id) {
          this.detachInput();
        }
        this.dispatch({
          source: "midi",
          type: "connection",
          timestampMs: this.now(),
          portId: port.id,
          portName: port.name ?? "",
          connected: false
        });
      } else if (changed && state === "connected") {
        this.dispatch({
          source: "midi",
          type: "connection",
          timestampMs: this.now(),
          portId: port.id,
          portName: port.name ?? "",
          connected: true
        });
      }
      if (state === "connected") {
        this.tryAttachDesired();
      }
    } else if (port.type === "output" && this.echoOutputId === port.id) {
      this.echoOutput = state === "disconnected" ? null : this.lookupOutput(port.id);
    }
    this.emitDevicesChanged();
  }

  // -------------------------------------------------------------------------
  // Monitoring / echo / panic
  // -------------------------------------------------------------------------

  /** Forward learner notes/pedals to the echo output. Default OFF. Never counted as input. */
  setMonitoring(enabled: boolean): void {
    this.monitoring = enabled;
    if (!enabled) {
      this.pendingEcho = [];
    }
  }

  isMonitoring(): boolean {
    return this.monitoring;
  }

  /** Choose the monitoring/panic output by object or id (null = none). */
  setEchoOutput(output: MIDIOutput | string | null): void {
    if (output === null) {
      this.echoOutputId = null;
      this.echoOutput = null;
    } else if (typeof output === "string") {
      this.echoOutputId = output;
      this.echoOutput = this.lookupOutput(output);
    } else {
      this.echoOutputId = output.id;
      this.echoOutput = output;
    }
    this.pendingEcho = [];
    this.emitDevicesChanged();
  }

  getEchoOutputId(): string | null {
    return this.echoOutputId;
  }

  /** Number of incoming messages dropped as echoes of our own monitoring output. */
  getEchoSuppressedCount(): number {
    return this.echoSuppressed;
  }

  /** Human-readable routing warnings for the settings UI. */
  getRoutingWarnings(): string[] {
    const warnings: string[] = [];
    if (this.monitoring && this.echoOutput && this.attachedInput) {
      const inName = (this.attachedInput.name ?? "").trim().toLowerCase();
      const outName = (this.echoOutput.name ?? "").trim().toLowerCase();
      if (inName !== "" && inName === outName) {
        warnings.push(
          "Monitoring sends your notes back to the same instrument. Turn its Local Control off, or disable monitoring, to avoid doubled notes."
        );
      }
    }
    if (this.monitoring && !this.echoOutput) {
      warnings.push("Monitoring is on but no output is selected.");
    }
    return warnings;
  }

  /** Send sustain-off + all-notes-off on all 16 channels of the echo output and reset held state. */
  panic(): void {
    const output = this.echoOutput;
    if (output) {
      for (let channel = 0; channel < 16; channel += 1) {
        try {
          output.send([0xb0 | channel, 64, 0]);
          output.send([0xb0 | channel, 123, 0]);
        } catch {
          // Output vanished mid-panic; held state is still reset below.
        }
      }
    }
    this.pendingEcho = [];
    this.held.reset(this.now());
  }

  // -------------------------------------------------------------------------
  // Raw capture and calibration
  // -------------------------------------------------------------------------

  setRecordRaw(enabled: boolean): void {
    this.recordRaw = enabled;
  }

  isRecordingRaw(): boolean {
    return this.recordRaw;
  }

  /** Oldest → newest copy of the bounded raw log. */
  getRawLog(): RawMidiLogEntry[] {
    return this.rawLog.toArray().map((entry) => ({ ...entry, data: entry.data.slice() }));
  }

  clearRawLog(): void {
    this.rawLog.clear();
  }

  /** Entries dropped from the raw log because it was full. */
  getRawLogDroppedCount(): number {
    return this.rawLog.droppedCount;
  }

  /**
   * Calibration estimate (ms) subtracted from emitted timestamps. This approximates the
   * delay between performing and the event being received; it is not a measurement of key
   * motion and cannot remove jitter.
   */
  setLatencyOffsetMs(ms: number): void {
    this.latencyOffsetMs = Number.isFinite(ms) ? ms : 0;
  }

  getLatencyOffsetMs(): number {
    return this.latencyOffsetMs;
  }

  // -------------------------------------------------------------------------
  // Subscriptions
  // -------------------------------------------------------------------------

  getHeldState(): HeldStateTracker {
    return this.held;
  }

  onEvent(listener: InputEventListener): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  onDevicesChanged(listener: DevicesChangedListener): () => void {
    this.deviceListeners.add(listener);
    return () => {
      this.deviceListeners.delete(listener);
    };
  }

  onHeldChange(listener: HeldChangeListener): () => void {
    this.heldListeners.add(listener);
    return () => {
      this.heldListeners.delete(listener);
    };
  }

  onAccessChanged(listener: AccessChangedListener): () => void {
    this.accessListeners.add(listener);
    return () => {
      this.accessListeners.delete(listener);
    };
  }

  /** Detach from the device and MIDIAccess and drop all listeners. */
  dispose(): void {
    this.detachInput();
    if (this.access) {
      this.access.removeEventListener("statechange", this.handleStateChangeEvent);
    }
    this.unsubscribeHeld();
    this.eventListeners.clear();
    this.deviceListeners.clear();
    this.heldListeners.clear();
    this.accessListeners.clear();
  }

  // -------------------------------------------------------------------------
  // Message path
  // -------------------------------------------------------------------------

  private handleMidiMessage(input: MIDIInput, event: MIDIMessageEvent): void {
    const data = event.data;
    if (!data) {
      return;
    }
    const stamp = event.timeStamp;
    const received = typeof stamp === "number" && Number.isFinite(stamp) && stamp > 0 ? stamp : this.now();
    this.receiveBytes(data, received, { portId: input.id, portName: input.name ?? "" });
  }

  private receiveBytes(data: MidiBytes, receivedMs: number, meta: MidiPortMeta): void {
    const isEcho = this.consumeEcho(data);
    if (this.recordRaw && (this.recordRealtime || !isRealtimeMessage(data))) {
      const entry: RawMidiLogEntry = { data: Array.from(data), timestampMs: receivedMs, portId: meta.portId, portName: meta.portName };
      if (isEcho) {
        entry.echo = true;
      }
      this.rawLog.push(entry);
    }
    if (isEcho) {
      this.echoSuppressed += 1;
      return;
    }
    const parsed = parseMidiMessage(data, receivedMs - this.latencyOffsetMs, meta, "midi");
    if (!parsed) {
      return;
    }
    this.forwardToMonitor(data, parsed);
    this.dispatch(parsed);
  }

  private consumeEcho(data: MidiBytes): boolean {
    if (this.pendingEcho.length === 0) {
      return false;
    }
    const now = this.now();
    this.pendingEcho = this.pendingEcho.filter((entry) => now - entry.at <= this.echoWindowMs);
    const key = bytesKey(data);
    const index = this.pendingEcho.findIndex((entry) => entry.key === key);
    if (index < 0) {
      return false;
    }
    this.pendingEcho.splice(index, 1);
    return true;
  }

  private forwardToMonitor(data: MidiBytes, event: InputEvent): void {
    if (!this.monitoring || !this.echoOutput) {
      return;
    }
    if (event.type === "connection") {
      return;
    }
    const bytes = [data[0], data[1], data[2]];
    // Register the expected echo BEFORE sending so even a synchronous loopback is caught.
    const pending: PendingEcho = { key: bytesKey(bytes), at: this.now() };
    this.pendingEcho.push(pending);
    if (this.pendingEcho.length > MAX_PENDING_ECHO) {
      this.pendingEcho.shift();
    }
    try {
      this.echoOutput.send(bytes);
    } catch {
      this.pendingEcho = this.pendingEcho.filter((entry) => entry !== pending);
    }
  }

  private dispatch(event: InputEvent): void {
    this.held.apply(event);
    this.eventListeners.forEach((listener) => listener(event));
  }

  private emitDevicesChanged(): void {
    if (this.deviceListeners.size === 0) {
      return;
    }
    const devices = this.getDevices();
    this.deviceListeners.forEach((listener) => listener(devices));
  }
}
