import type { ResolvedEvent } from "@/types";
import type { PlaybackEngine } from "@/playback/types";
import type { ArpeggiateOctaves } from "@/types";
import { buildArpeggiatedNotes } from "@/playback/arpeggiation";

export interface SchedulerCallbacks {
  onProgress?: (seconds: number, totalSeconds: number) => void;
  onActiveEvent?: (eventIndex: number | null, activeNotes: number[]) => void;
  onStop?: () => void;
}

export class PlaybackScheduler {
  private readonly lookaheadSec = 0.2;
  private timer: number | null = null;
  private startPerfMs = 0;
  private positionSec = 0;
  private nextEventIndex = 0;
  private playing = false;
  private loop = false;

  constructor(
    private engine: PlaybackEngine,
    private events: ResolvedEvent[],
    private totalSeconds: number,
    private velocity: number,
    private channel: number,
    private arpeggiateOctaves: ArpeggiateOctaves,
    private callbacks: SchedulerCallbacks = {}
  ) {}

  setLoop(enabled: boolean): void {
    this.loop = enabled;
  }

  setSequence(events: ResolvedEvent[], totalSeconds: number): void {
    this.events = events;
    this.totalSeconds = totalSeconds;
    this.stop();
  }

  async play(fromSeconds?: number): Promise<void> {
    if (this.playing) {
      return;
    }

    if (fromSeconds !== undefined) {
      this.positionSec = Math.max(0, Math.min(fromSeconds, this.totalSeconds));
    }

    this.nextEventIndex = this.events.findIndex((event) => event.startSeconds >= this.positionSec - 0.0001);
    if (this.nextEventIndex === -1) {
      this.nextEventIndex = this.events.length;
    }

    await this.engine.prepare();
    this.playing = true;
    this.startPerfMs = performance.now() - this.positionSec * 1000;
    this.scheduleTick();
  }

  pause(): void {
    if (!this.playing) {
      return;
    }
    this.playing = false;
    this.engine.stopAll(this.channel);
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.positionSec = Math.max(0, (performance.now() - this.startPerfMs) / 1000);
  }

  stop(): void {
    this.playing = false;
    this.positionSec = 0;
    this.nextEventIndex = 0;
    this.engine.stopAll(this.channel);
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.callbacks.onProgress?.(0, this.totalSeconds);
    this.callbacks.onActiveEvent?.(null, []);
    this.callbacks.onStop?.();
  }

  isPlaying(): boolean {
    return this.playing;
  }

  getPositionSeconds(): number {
    if (this.playing) {
      return Math.max(0, (performance.now() - this.startPerfMs) / 1000);
    }
    return this.positionSec;
  }

  setPosition(seconds: number): void {
    this.positionSec = Math.max(0, Math.min(seconds, this.totalSeconds));
    this.nextEventIndex = this.events.findIndex((event) => event.startSeconds >= this.positionSec - 0.0001);
    if (this.nextEventIndex === -1) {
      this.nextEventIndex = this.events.length;
    }

    const active = this.events.find(
      (event) =>
        !event.isRest &&
        this.positionSec >= event.startSeconds &&
        this.positionSec < event.startSeconds + event.durationSeconds
    );

    this.callbacks.onProgress?.(this.positionSec, this.totalSeconds);
    this.callbacks.onActiveEvent?.(active ? active.index : null, active ? active.noteNumbers : []);

    if (this.playing) {
      this.startPerfMs = performance.now() - this.positionSec * 1000;
    }
  }

  private scheduleTick(): void {
    if (!this.playing) {
      return;
    }

    this.timer = window.setTimeout(() => {
      this.tick();
      this.scheduleTick();
    }, 25);
  }

  private tick(): void {
    const nowSec = Math.max(0, (performance.now() - this.startPerfMs) / 1000);
    this.positionSec = nowSec;

    while (this.nextEventIndex < this.events.length) {
      const event = this.events[this.nextEventIndex];
      if (event.startSeconds > nowSec + this.lookaheadSec) {
        break;
      }

      const delay = Math.max(0, event.startSeconds - nowSec);
      if (!event.isRest) {
        const arpeggiated = buildArpeggiatedNotes(event.noteNumbers, event.durationSeconds, this.arpeggiateOctaves, 0.02);
        arpeggiated.forEach((noteEvent) => {
          this.engine.scheduleNote(
            noteEvent.note,
            this.velocity,
            delay + noteEvent.startOffset,
            noteEvent.duration,
            this.channel
          );
        });
      }
      this.nextEventIndex += 1;
    }

    const active = this.events.find(
      (event) => !event.isRest && nowSec >= event.startSeconds && nowSec < event.startSeconds + event.durationSeconds
    );

    this.callbacks.onProgress?.(Math.min(nowSec, this.totalSeconds), this.totalSeconds);
    this.callbacks.onActiveEvent?.(active ? active.index : null, active ? active.noteNumbers : []);

    if (nowSec >= this.totalSeconds) {
      if (this.loop && this.totalSeconds > 0) {
        this.engine.stopAll(this.channel);
        this.positionSec = 0;
        this.startPerfMs = performance.now();
        this.nextEventIndex = 0;
        return;
      }
      this.stop();
    }
  }
}
