/**
 * Warm-up adapter (plan E28): a WarmupSpec becomes explicit-note practice steps, and an attempt's
 * MIDI attacks become MEASURED observations only (timing spread, velocity consistency, hand
 * synchrony under the warm-up's declared hand-attribution assumption). The warm-up's authored
 * guidance (fingering, relaxation, posture) is passed through separately and is never presented
 * as measured. Pure, React-free.
 */
import type {
  AttemptResult,
  ExerciseDefinition,
  ExerciseStep,
  Hand,
  PerformanceOccurrence,
  PerformanceTimeline,
  PerformedNote
} from "@/model/contracts";
import type { MeasuredObservationKind, WarmupSpec } from "@/content/authoring";
import { noteLabel } from "@/practice/text";

export interface WarmupSettings {
  tempoBpm?: number;
  /** Whole-pattern passes (default 1). */
  repeats?: number;
  /** "left"/"right" keeps only that hand's notes; anything else keeps every note. */
  hand?: Hand;
}

export interface WarmupPractice {
  title: string;
  timeline: PerformanceTimeline;
  steps: ExerciseStep[];
  exercise: ExerciseDefinition;
  /** Authored guidance text (not measured). */
  guidance: string[];
  measuredKinds: MeasuredObservationKind[];
  handAttributionNote?: string;
}

function handTag(hand: Hand | undefined): string {
  if (hand === "left") return "LH";
  if (hand === "right") return "RH";
  return "";
}

function noteText(note: PerformedNote): string {
  const tag = handTag(note.hand);
  return tag ? `${noteLabel(note.midi)} (${tag})` : noteLabel(note.midi);
}

/** Compile a warm-up into an exact-voicing exercise (one step per authored chord attack). */
export function warmupToSteps(warmup: WarmupSpec, settings: WarmupSettings = {}): WarmupPractice {
  const tempo = settings.tempoBpm !== undefined && settings.tempoBpm > 0 ? settings.tempoBpm : warmup.tempoBpm;
  const repeats = Math.max(1, Math.min(8, Math.round(settings.repeats ?? 1)));
  const handFilter: Hand | null = settings.hand === "left" || settings.hand === "right" ? settings.hand : null;
  const beatsPerBar = Math.max(1, Math.round((warmup.timeSignature.numerator * 4) / Math.max(1, warmup.timeSignature.denominator)));

  const notes: PerformedNote[] = [];
  const occurrences: PerformanceOccurrence[] = [];
  const steps: ExerciseStep[] = [];
  let beat = 0;
  for (let pass = 0; pass < repeats; pass += 1) {
    warmup.steps.forEach((authored, index) => {
      const eventId = `${warmup.id}-s${index + 1}`;
      const occurrenceId = `${eventId}#${pass}`;
      const chosen = authored.notes.filter((note) => handFilter === null || note.hand === undefined || note.hand === handFilter);
      const targets: PerformedNote[] = chosen
        .slice()
        .sort((a, b) => a.midi - b.midi)
        .map((note, k) => {
          const performed: PerformedNote = {
            id: `${occurrenceId}:learner:${k}`,
            eventId,
            occurrenceId,
            part: "learner",
            midi: note.midi,
            onsetBeat: beat,
            durationBeats: authored.durationBeats,
            velocity: 80
          };
          if (note.hand !== undefined) performed.hand = note.hand;
          if (note.degree !== undefined) performed.degree = note.degree;
          if (note.role !== undefined) performed.role = note.role;
          // Fingering is shown only for pianist-reviewed warm-ups.
          if (warmup.reviewed && note.finger !== undefined) performed.finger = note.finger;
          return performed;
        });
      const symbol = targets.map((note) => noteLabel(note.midi)).join("+") || "rest";
      occurrences.push({ occurrenceId, eventId, passIndex: pass, startBeat: beat, durationBeats: authored.durationBeats, symbol });
      if (targets.length > 0) {
        notes.push(...targets);
        const text = targets.map(noteText).join(" + ");
        const hands = Array.from(new Set(targets.map((note) => note.hand).filter((hand): hand is Hand => hand !== undefined)));
        steps.push({
          id: `step-${steps.length + 1}`,
          occurrenceId,
          prompt: `Play ${text}.`,
          targets,
          policy: { kind: "exactVoicing" },
          hints: [
            hands.length > 1 ? "Both hands together." : hands.length === 1 ? `${hands[0] === "left" ? "Left" : "Right"} hand.` : "Follow the highlighted keys.",
            `Notes: ${targets.map((note) => noteLabel(note.midi)).join(" ")}.`,
            `Exactly: ${text}.`
          ]
        });
      }
      beat += authored.durationBeats;
    });
  }

  const handSuffix = handFilter ? ` (${handFilter} hand)` : "";
  const timeline: PerformanceTimeline = {
    id: `${warmup.id}@${warmup.version}~${tempo}x${repeats}${handFilter ? `-${handFilter}` : ""}`,
    sourceId: warmup.id,
    sourceVersion: warmup.version,
    tempo: { bpm: tempo },
    timeSignature: { numerator: warmup.timeSignature.numerator, denominator: warmup.timeSignature.denominator },
    notes,
    occurrences,
    totalBeats: beat,
    countInBeats: beatsPerBar
  };
  const exercise: ExerciseDefinition = {
    id: warmup.id,
    version: warmup.version,
    title: `${warmup.title}${handSuffix}`,
    objective: warmup.objective,
    conceptIds: [...warmup.conceptIds],
    prerequisites: [],
    contract: "reproduce",
    timeline,
    steps,
    policy: { kind: "exactVoicing" },
    timing: { mode: "timed", onsetWindowMs: 150, countInBeats: beatsPerBar, assemblyWindowMs: 80 },
    demand: warmup.demand,
    status: warmup.status
  };
  const out: WarmupPractice = {
    title: exercise.title,
    timeline,
    steps,
    exercise,
    guidance: [...warmup.guidance.text],
    measuredKinds: [...warmup.measuredObservations]
  };
  if (warmup.handAttribution.kind === "registerSplit") {
    out.handAttributionNote = warmup.handAttribution.note;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Measured feedback
// ---------------------------------------------------------------------------

export interface MeasuredAttack {
  midi: number;
  velocity: number;
  timestampMs: number;
}

export interface MeasuredObservation {
  kind: MeasuredObservationKind;
  label: string;
  value: string;
  detail: string;
}

export interface WarmupFeedback {
  /** Only what MIDI input measured. */
  measured: MeasuredObservation[];
  /** Declared observations that could not be measured in this attempt (with the reason). */
  notMeasured: string[];
  /** The warm-up's authored guidance, labelled as such in the UI. */
  authoredGuidance: string[];
  handAttributionNote?: string;
  caveat: string;
}

export const WARMUP_CAVEAT =
  "Only key timing and velocity are measured. Fingering, posture, tension and physical technique are not observed; finishing a warm-up is not proof of healthy or correct technique.";

const OBSERVATION_LABELS: Readonly<Record<MeasuredObservationKind, string>> = {
  timingSpread: "Timing spread",
  velocityConsistency: "Velocity consistency",
  releaseOverlap: "Release overlap",
  handSynchrony: "Hand synchrony"
};

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: readonly number[]): number {
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - m) * (value - m), 0) / values.length);
}

function round(value: number): number {
  return Math.round(value);
}

/** Group attacks closer than `windowMs` to the group's first attack (chord attacks). */
function groupAttacksByTime(attacks: readonly MeasuredAttack[], windowMs: number): MeasuredAttack[][] {
  const sorted = [...attacks].sort((a, b) => a.timestampMs - b.timestampMs);
  const groups: MeasuredAttack[][] = [];
  let current: MeasuredAttack[] = [];
  let start = 0;
  sorted.forEach((attack) => {
    if (current.length > 0 && attack.timestampMs - start <= windowMs) {
      current.push(attack);
      return;
    }
    if (current.length > 0) {
      groups.push(current);
    }
    current = [attack];
    start = attack.timestampMs;
  });
  if (current.length > 0) {
    groups.push(current);
  }
  return groups;
}

/**
 * Measured-only feedback for a warm-up attempt. `attacks` are the learner's attacks during the
 * attempt; `result` supplies timed onset deltas when the attempt was timed.
 */
export function warmupFeedback(warmup: WarmupSpec, attacks: readonly MeasuredAttack[], result: AttemptResult | null): WarmupFeedback {
  const measured: MeasuredObservation[] = [];
  const notMeasured: string[] = [];
  warmup.measuredObservations.forEach((kind) => {
    const label = OBSERVATION_LABELS[kind];
    if (kind === "timingSpread") {
      const deltas = result ? result.timing.filter((obs) => typeof obs.deltaMs === "number").map((obs) => obs.deltaMs as number) : [];
      if (deltas.length >= 2) {
        measured.push({
          kind,
          label,
          value: `±${round(standardDeviation(deltas))} ms`,
          detail: `Standard deviation of ${deltas.length} onsets around the beat (average ${mean(deltas) >= 0 ? "+" : ""}${round(mean(deltas))} ms).`
        });
      } else {
        notMeasured.push(`${label}: needs a timed attempt with at least two matched onsets.`);
      }
      return;
    }
    if (kind === "velocityConsistency") {
      const velocities = attacks.map((attack) => attack.velocity).filter((velocity) => Number.isFinite(velocity) && velocity > 0);
      if (velocities.length >= 2) {
        measured.push({
          kind,
          label,
          value: `±${round(standardDeviation(velocities))} velocity`,
          detail: `${velocities.length} key presses, velocity ${Math.min(...velocities)}–${Math.max(...velocities)} (average ${round(mean(velocities))}). Touch and computer keys report a fixed velocity.`
        });
      } else {
        notMeasured.push(`${label}: needs at least two key presses.`);
      }
      return;
    }
    if (kind === "handSynchrony") {
      if (warmup.handAttribution.kind !== "registerSplit") {
        notMeasured.push(`${label}: not reported, because MIDI does not say which hand played and no hand split is declared.`);
        return;
      }
      const split = warmup.handAttribution.splitMidi;
      const gaps: number[] = [];
      groupAttacksByTime(attacks, 80).forEach((group) => {
        const left = group.filter((attack) => attack.midi < split);
        const right = group.filter((attack) => attack.midi >= split);
        if (left.length > 0 && right.length > 0) {
          gaps.push(Math.abs(left[0].timestampMs - right[0].timestampMs));
        }
      });
      if (gaps.length >= 1) {
        measured.push({
          kind,
          label,
          value: `${round(mean(gaps))} ms apart on average`,
          detail: `Across ${gaps.length} two-hand attacks (largest gap ${round(Math.max(...gaps))} ms), assuming notes below MIDI ${split} are the left hand.`
        });
      } else {
        notMeasured.push(`${label}: no two-hand attacks were found.`);
      }
      return;
    }
    notMeasured.push(`${label}: not reported in this version.`);
  });
  const feedback: WarmupFeedback = {
    measured,
    notMeasured,
    authoredGuidance: [...warmup.guidance.text],
    caveat: WARMUP_CAVEAT
  };
  if (warmup.handAttribution.kind === "registerSplit") {
    feedback.handAttributionNote = warmup.handAttribution.note;
  }
  return feedback;
}
