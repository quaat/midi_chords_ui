/**
 * Learner trace for the falling-notes stage: what the learner played, with a verdict per note
 * (the stage draws colour AND a glyph, so the verdict is not colour-only). Pure.
 */
import type { PerformedNote, TimingObservation } from "@/model/contracts";
import type { StepPracticeState } from "@/practice";
import type { LearnerTraceNote } from "@/ui/stage/stageRenderer";

export interface TraceAttack {
  midi: number;
  velocity: number;
  /** Performance-clock ms (latency already applied by the input layer). */
  atMs: number;
  onsetBeat: number;
  durationBeats: number;
  /** Loop pass the attack belongs to (0 without a loop). */
  pass: number;
  released: boolean;
}

export const MAX_TRACE_ATTACKS = 160;
export const DEFAULT_TRACE_BEATS = 0.25;

/** "ev-1#0:learner:0@2" → { noteId: "ev-1#0:learner:0", pass: 2 }. */
export function splitTargetId(targetNoteId: string): { noteId: string; pass: number } {
  const match = /^(.*)@(\d+)$/.exec(targetNoteId);
  if (!match) {
    return { noteId: targetNoteId, pass: 0 };
  }
  return { noteId: match[1], pass: Number(match[2]) };
}

function samePitch(a: number, b: number, pitchClassOnly: boolean): boolean {
  return pitchClassOnly ? ((a % 12) + 12) % 12 === ((b % 12) + 12) % 12 : a === b;
}

export interface TimedTraceOptions {
  nowMs: number;
  searchWindowMs: number;
  /** Only attacks/targets of this loop pass are shown. */
  pass: number;
  /** Match by pitch class (pitchClass/roles policies). */
  pitchClassOnly: boolean;
  /** After finish every unmatched attack is an extra. */
  finished: boolean;
}

/**
 * Trace notes for a timed attempt: attacks credited by an observation get its verdict
 * (onTime/early/late); attacks never credited become "extra" once their search window closed;
 * targets resolved as missed are added at their own position with verdict "missed".
 */
export function timedTraceNotes(
  attacks: readonly TraceAttack[],
  observations: readonly TimingObservation[],
  notesById: ReadonlyMap<string, PerformedNote>,
  options: TimedTraceOptions
): LearnerTraceNote[] {
  const out: LearnerTraceNote[] = [];
  const used = new Set<number>();
  const visible = attacks.filter((attack) => attack.pass === options.pass);
  const credited = new Map<TraceAttack, TimingObservation["verdict"]>();
  observations.forEach((observation) => {
    const { noteId, pass } = splitTargetId(observation.targetNoteId);
    const target = notesById.get(noteId);
    if (!target) {
      return;
    }
    if (observation.verdict === "missed") {
      if (pass === options.pass) {
        out.push({ midi: target.midi, onsetBeat: target.onsetBeat, durationBeats: target.durationBeats, verdict: "missed" });
      }
      return;
    }
    if (typeof observation.actualOnsetMs !== "number") {
      return;
    }
    const actual = observation.actualOnsetMs;
    let bestIndex = -1;
    let bestGap = Infinity;
    visible.forEach((attack, index) => {
      if (used.has(index) || !samePitch(attack.midi, target.midi, options.pitchClassOnly)) {
        return;
      }
      const gap = Math.abs(attack.atMs - actual);
      if (gap < 1 && gap < bestGap) {
        bestGap = gap;
        bestIndex = index;
      }
    });
    if (bestIndex >= 0) {
      used.add(bestIndex);
      credited.set(visible[bestIndex], observation.verdict);
    }
  });
  visible.forEach((attack, index) => {
    const verdict = credited.get(attack);
    const note: LearnerTraceNote = { midi: attack.midi, onsetBeat: attack.onsetBeat, durationBeats: attack.durationBeats };
    if (verdict) {
      note.verdict = verdict;
    } else if (!used.has(index) && (options.finished || options.nowMs - attack.atMs > options.searchWindowMs)) {
      note.verdict = "extra";
    }
    out.push(note);
  });
  return out;
}

/**
 * Trace notes for step practice: the notes currently counted toward the step, drawn at the
 * step's position. Correct-so-far notes are "onTime", notes outside the answer "extra"
 * (exact voicing) — pending notes have no verdict until the step is judged.
 */
export function stepTraceNotes(state: StepPracticeState, onsetBeat: number, durationBeats: number): LearnerTraceNote[] {
  const step = state.step;
  if (!step) {
    return [];
  }
  const match = state.lastMatch;
  const expected = new Set(step.targets.map((note) => note.midi));
  const extras = new Set(match ? match.extraMidi : []);
  return state.counted.map((midi) => {
    const note: LearnerTraceNote = { midi, onsetBeat, durationBeats };
    if (extras.has(midi)) {
      note.verdict = "extra";
    } else if (expected.has(midi) || (match !== null && match.correct)) {
      note.verdict = "onTime";
    } else if (match !== null) {
      note.verdict = "wrong";
    }
    return note;
  });
}

/** Free (record/replay) trace: no verdicts — nothing is scored. */
export function freeTraceNotes(attacks: readonly TraceAttack[]): LearnerTraceNote[] {
  return attacks.map((attack) => ({ midi: attack.midi, onsetBeat: attack.onsetBeat, durationBeats: attack.durationBeats }));
}

/**
 * Audition notes for "Replay my take": onsets relative to the first attack, converted from
 * clock time at `tempoBpm` (the audition transport's tempo), so loops and pauses replay as played.
 */
export function replayNotes(attacks: readonly TraceAttack[], tempoBpm: number): { midi: number; onsetBeat: number; durationBeats: number; velocity: number }[] {
  if (attacks.length === 0) {
    return [];
  }
  const bpm = Number.isFinite(tempoBpm) && tempoBpm > 0 ? tempoBpm : 90;
  const sorted = [...attacks].sort((a, b) => a.atMs - b.atMs);
  const firstMs = sorted[0].atMs;
  return sorted.map((attack) => ({
    midi: attack.midi,
    onsetBeat: Math.max(0, ((attack.atMs - firstMs) * bpm) / 60000),
    durationBeats: Math.max(0.125, attack.durationBeats),
    velocity: Math.max(1, Math.min(127, Math.round(attack.velocity)))
  }));
}
