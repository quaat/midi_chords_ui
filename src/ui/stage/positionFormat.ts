import type { TimeSignatureSpec } from "@/model/contracts";
import { beatsPerBar } from "@/ui/stage/stageMath";

export interface BarBeat {
  /** 1-based bar; 0 or less during the count-in. */
  bar: number;
  /** 1-based beat within the bar (quarter-note beats). */
  beat: number;
  countIn: boolean;
}

export function toBarBeat(positionBeats: number, timeSignature?: TimeSignatureSpec): BarBeat {
  const perBar = beatsPerBar(timeSignature);
  if (positionBeats < 0) {
    // Count-in counts down to the downbeat: -4 -> beat 1 of the count, -1 -> last beat.
    const beatsLeft = Math.ceil(-positionBeats - 1e-9);
    const countBeat = Math.max(1, Math.round(perBar) - beatsLeft + 1);
    return { bar: 0, beat: countBeat, countIn: true };
  }
  const bar = Math.floor(positionBeats / perBar + 1e-9);
  const beat = Math.floor(positionBeats - bar * perBar + 1e-9);
  return { bar: bar + 1, beat: beat + 1, countIn: false };
}

/** "Bar 3 · Beat 2" or "Count-in 2" — for displays polled outside React state. */
export function formatBarBeat(positionBeats: number, timeSignature?: TimeSignatureSpec): string {
  const bb = toBarBeat(positionBeats, timeSignature);
  if (bb.countIn) {
    return `Count-in ${bb.beat}`;
  }
  return `Bar ${bb.bar} · Beat ${bb.beat}`;
}
