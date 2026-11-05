/** Hand-written Web MIDI fakes implementing only the subset MidiInputManager uses. */

export interface FakeMessageEvent {
  data: Uint8Array | null;
  timeStamp: number;
}

type PortState = "connected" | "disconnected";

export class FakeInput {
  readonly type = "input";
  state: PortState = "connected";
  connection = "closed";
  onmidimessage: ((event: FakeMessageEvent) => void) | null = null;

  constructor(
    public id: string,
    public name: string,
    public manufacturer = "Test"
  ) {}

  /** Simulate the device sending bytes. Returns false when nobody is listening. */
  emit(bytes: number[], timeStamp: number): boolean {
    if (!this.onmidimessage || this.state === "disconnected") {
      return false;
    }
    this.onmidimessage({ data: new Uint8Array(bytes), timeStamp });
    return true;
  }
}

export class FakeOutput {
  readonly type = "output";
  state: PortState = "connected";
  connection = "open";
  sent: number[][] = [];
  /** Optional loopback: called for every send (simulates a device echoing MIDI back). */
  onSend: ((data: number[]) => void) | null = null;

  constructor(
    public id: string,
    public name: string,
    public manufacturer = "Test"
  ) {}

  send(data: number[]): void {
    this.sent.push(Array.from(data));
    if (this.onSend) {
      this.onSend(Array.from(data));
    }
  }
}

type Listener = (event: { port: FakeInput | FakeOutput }) => void;

export class FakeAccess {
  inputs = new Map<string, FakeInput>();
  outputs = new Map<string, FakeOutput>();
  private listeners: Listener[] = [];

  constructor(inputs: FakeInput[] = [], outputs: FakeOutput[] = []) {
    inputs.forEach((input) => this.inputs.set(input.id, input));
    outputs.forEach((output) => this.outputs.set(output.id, output));
  }

  addEventListener(type: string, listener: Listener): void {
    if (type === "statechange") {
      this.listeners.push(listener);
    }
  }

  removeEventListener(type: string, listener: Listener): void {
    if (type === "statechange") {
      this.listeners = this.listeners.filter((l) => l !== listener);
    }
  }

  listenerCount(): number {
    return this.listeners.length;
  }

  unplug(port: FakeInput | FakeOutput): void {
    port.state = "disconnected";
    this.fire(port);
  }

  plug(port: FakeInput | FakeOutput): void {
    port.state = "connected";
    if (port instanceof FakeInput) {
      this.inputs.set(port.id, port);
    } else {
      this.outputs.set(port.id, port);
    }
    this.fire(port);
  }

  fire(port: FakeInput | FakeOutput): void {
    this.listeners.slice().forEach((listener) => listener({ port }));
  }
}

export interface FakeNavigatorOptions {
  rejectWith?: string;
  permissionState?: string;
}

export interface FakeNavigator {
  requestCount: number;
  requestMIDIAccess(): Promise<MIDIAccess>;
  permissions: { query(): Promise<{ state: string }> };
}

export function fakeNavigator(access: FakeAccess, options: FakeNavigatorOptions = {}): FakeNavigator {
  const nav: FakeNavigator = {
    requestCount: 0,
    requestMIDIAccess(): Promise<MIDIAccess> {
      nav.requestCount += 1;
      if (options.rejectWith) {
        const error = new Error("rejected");
        error.name = options.rejectWith;
        return Promise.reject(error);
      }
      return Promise.resolve(access as unknown as MIDIAccess);
    },
    permissions: {
      query(): Promise<{ state: string }> {
        return Promise.resolve({ state: options.permissionState ?? "prompt" });
      }
    }
  };
  return nav;
}
