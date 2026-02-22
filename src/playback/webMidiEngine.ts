import type { PlaybackEngine } from "@/playback/types";

export type WebMidiState = {
  available: boolean;
  outputs: { id: string; name: string }[];
  error?: string;
};

export async function getWebMidiState(): Promise<WebMidiState> {
  if (typeof navigator === "undefined" || !("requestMIDIAccess" in navigator)) {
    return {
      available: false,
      outputs: [],
      error: "Web MIDI is not available in this browser."
    };
  }

  try {
    const access = await (navigator as Navigator & {
      requestMIDIAccess: () => Promise<MIDIAccess>;
    }).requestMIDIAccess();

    const outputs = [...access.outputs.values()].map((output) => ({
      id: output.id,
      name: output.name || "Unknown MIDI Output"
    }));

    return {
      available: true,
      outputs
    };
  } catch {
    return {
      available: false,
      outputs: [],
      error: "MIDI access was denied."
    };
  }
}

export class WebMidiPlaybackEngine implements PlaybackEngine {
  private output: MIDIOutput | null = null;

  async prepare(): Promise<void> {
    return Promise.resolve();
  }

  setOutput(output: MIDIOutput | null): void {
    this.output = output;
  }

  scheduleNote(note: number, velocity: number, startDelaySec: number, durationSec: number, channel: number): void {
    if (!this.output) {
      return;
    }

    const statusOn = 0x90 | Math.min(15, Math.max(0, channel - 1));
    const statusOff = 0x80 | Math.min(15, Math.max(0, channel - 1));
    const now = performance.now();
    const onTime = now + Math.max(0, startDelaySec) * 1000;
    const offTime = onTime + Math.max(0, durationSec) * 1000;

    this.output.send([statusOn, note, velocity], onTime);
    this.output.send([statusOff, note, 0], offTime);
  }

  stopAll(channel: number): void {
    if (!this.output) {
      return;
    }
    const ch = Math.min(15, Math.max(0, channel - 1));
    this.output.send([0xb0 | ch, 123, 0]);
  }
}

export async function getMidiAccess(): Promise<MIDIAccess | null> {
  if (typeof navigator === "undefined" || !("requestMIDIAccess" in navigator)) {
    return null;
  }
  try {
    return await (navigator as Navigator & {
      requestMIDIAccess: () => Promise<MIDIAccess>;
    }).requestMIDIAccess();
  } catch {
    return null;
  }
}
