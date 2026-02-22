import * as Tone from "tone";
import type { PlaybackEngine } from "@/playback/types";

export class TonePlaybackEngine implements PlaybackEngine {
  private synth: Tone.PolySynth | null = null;

  async prepare(): Promise<void> {
    await Tone.start();
    if (!this.synth) {
      this.synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: {
          type: "triangle"
        },
        envelope: {
          attack: 0.01,
          decay: 0.2,
          sustain: 0.5,
          release: 1.2
        }
      }).toDestination();
    }
  }

  scheduleNote(note: number, velocity: number, startDelaySec: number, durationSec: number): void {
    if (!this.synth) {
      return;
    }
    const time = Tone.now() + Math.max(0, startDelaySec);
    this.synth.triggerAttackRelease(Tone.Frequency(note, "midi").toFrequency(), durationSec, time, velocity / 127);
  }

  stopAll(): void {
    this.synth?.releaseAll();
  }
}
