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
  private noteGeneration = 0;
  private activeNoteTokens = new Map<string, number>();
  private scheduledTimers = new Set<ReturnType<typeof globalThis.setTimeout>>();

  async prepare(): Promise<void> {
    return Promise.resolve();
  }

  setOutput(output: MIDIOutput | null): void {
    this.clearScheduledTimers();
    this.activeNoteTokens.clear();
    this.output = output;
  }

  scheduleNote(note: number, velocity: number, startDelaySec: number, durationSec: number, channel: number): void {
    if (!this.output) {
      return;
    }

    const ch = Math.min(15, Math.max(0, channel - 1));
    const statusOn = 0x90 | ch;
    const statusOff = 0x80 | ch;
    const noteKey = `${ch}:${note}`;
    const delayMs = Math.max(0, startDelaySec) * 1000;
    const durationMs = Math.max(0, durationSec) * 1000;

    const onTimer = globalThis.setTimeout(() => {
      this.scheduledTimers.delete(onTimer);
      if (!this.output) {
        return;
      }

      const token = ++this.noteGeneration;
      this.activeNoteTokens.set(noteKey, token);

      // Rearticulate the note cleanly on hardware synths before starting the new attack.
      this.output.send([statusOff, note, 0]);
      this.output.send([statusOn, note, velocity]);

      const offTimer = globalThis.setTimeout(() => {
        this.scheduledTimers.delete(offTimer);
        if (!this.output) {
          return;
        }
        if (this.activeNoteTokens.get(noteKey) !== token) {
          return;
        }
        this.output.send([statusOff, note, 0]);
        this.activeNoteTokens.delete(noteKey);
      }, durationMs);

      this.scheduledTimers.add(offTimer);
    }, delayMs);

    this.scheduledTimers.add(onTimer);
  }

  stopAll(channel: number): void {
    this.clearScheduledTimers();
    this.activeNoteTokens.clear();
    if (!this.output) {
      return;
    }
    const ch = Math.min(15, Math.max(0, channel - 1));
    this.output.send([0xb0 | ch, 123, 0]);
  }

  private clearScheduledTimers(): void {
    this.scheduledTimers.forEach((timer) => {
      globalThis.clearTimeout(timer);
    });
    this.scheduledTimers.clear();
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
