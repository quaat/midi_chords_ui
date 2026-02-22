export interface PlaybackEngine {
  prepare(): Promise<void>;
  scheduleNote(note: number, velocity: number, startDelaySec: number, durationSec: number, channel: number): void;
  stopAll(channel: number): void;
}
