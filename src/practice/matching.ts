/**
 * Pure answer matchers (plan E13/E14, E27/E30 acceptance).
 *
 * Policies (what "correct" means for one step):
 * - exactVoicing: the played MIDI set equals the target set; extra notes fail unless
 *   `allowExtraNotes`.
 * - roles: every required role must be present — by pitch class when `octaveFree` (default true),
 *   else at the target's exact pitch. Optional roles are neither required nor extra. A played
 *   pitch class outside the chord is "extra" (fails unless `allowExtraNotes`). Roles the step's
 *   targets do not carry fall back to the chord's degree with that role; a chart symbol alone
 *   never adds exact-note requirements.
 * - pitchClass: the set of played pitch classes equals the targets' pitch classes.
 * - listen / free: nothing is graded; always "correct" with an explanation saying so.
 *
 * Helpers:
 * - `groupAttacks` — chord assembly: an attack more than `assemblyWindowMs` after the FIRST
 *   attack of the current group starts a new group.
 * - `matchSequenceAttacks` — assigns each attack to at most one target (never reuses an attack),
 *   processing targets earliest-first and picking the nearest attack in time.
 */
import type { AnswerPolicy, ChordDefinition, ChordRole, ExerciseStep, PerformedNote, TimingObservation } from "@/model/contracts";
import { chordPitchClasses, chordTones, formatPitchClass, mod12 } from "@/music";
import { chordLabel, noteLabel, pitchClassLabel, roleName } from "@/practice/text";

export interface PitchMatch {
  correct: boolean;
  missingMidi: number[];
  extraMidi: number[];
  missingRoles: ChordRole[];
  satisfiedRoles: ChordRole[];
  /** Plain-language explanation lines ("The seventh (C) is missing", "B is not in Dm9"). */
  notes: string[];
}

function unique(values: number[]): number[] {
  const out: number[] = [];
  values.forEach((value) => {
    if (!out.includes(value)) {
      out.push(value);
    }
  });
  return out.sort((a, b) => a - b);
}

function uniqueRoles(roles: ChordRole[]): ChordRole[] {
  const out: ChordRole[] = [];
  roles.forEach((role) => {
    if (!out.includes(role)) {
      out.push(role);
    }
  });
  return out;
}

function extraLine(midi: number, chord: ChordDefinition | undefined, withOctave: boolean): string {
  if (chord && !chordPitchClasses(chord).includes(mod12(midi))) {
    return `${pitchClassLabel(midi, chord)} is not in ${chordLabel(chord)}`;
  }
  const name = withOctave ? noteLabel(midi, chord) : pitchClassLabel(midi, chord);
  return `${name} was not expected here`;
}

function missingLine(note: PerformedNote, chord: ChordDefinition | undefined, withOctave: boolean): string {
  const name = withOctave ? noteLabel(note.midi, chord, note.spelled) : pitchClassLabel(note.midi, chord, note.spelled);
  return note.role ? `The ${roleName(note.role)} (${name}) is missing` : `${name} is missing`;
}

const NOTHING_PLAYED = "Nothing was played yet";

function matchExact(step: ExerciseStep, played: number[], allowExtra: boolean): PitchMatch {
  const targets = unique(step.targets.map((note) => note.midi));
  const playedSet = unique(played);
  const missingMidi = targets.filter((midi) => !playedSet.includes(midi));
  const extraMidi = playedSet.filter((midi) => !targets.includes(midi));
  const notes: string[] = [];
  const missingRoles: ChordRole[] = [];
  const satisfiedRoles: ChordRole[] = [];
  step.targets.forEach((note) => {
    if (!note.role) return;
    if (missingMidi.includes(note.midi)) missingRoles.push(note.role);
    else satisfiedRoles.push(note.role);
  });
  if (playedSet.length === 0) {
    notes.push(NOTHING_PLAYED);
  }
  missingMidi.forEach((midi) => {
    const note = step.targets.find((target) => target.midi === midi);
    if (note) notes.push(missingLine(note, step.chord, true));
  });
  extraMidi.forEach((midi) => {
    // A right pitch class in the wrong octave gets a more helpful line.
    const sameClass = missingMidi.find((m) => mod12(m) === mod12(midi));
    if (sameClass !== undefined) {
      notes.push(`${noteLabel(midi, step.chord)} is in the wrong octave (expected ${noteLabel(sameClass, step.chord)})`);
    } else {
      notes.push(extraLine(midi, step.chord, true));
    }
  });
  const correct = playedSet.length > 0 && missingMidi.length === 0 && (allowExtra || extraMidi.length === 0);
  if (correct && extraMidi.length > 0) {
    notes.push("Extra notes are allowed in this exercise");
  }
  return { correct, missingMidi, extraMidi: allowExtra ? [] : extraMidi, missingRoles: uniqueRoles(missingRoles), satisfiedRoles: uniqueRoles(satisfiedRoles), notes };
}

interface RoleRequirement {
  role: ChordRole;
  /** Accepted pitch classes (octave-free) or exact MIDI (octave-bound). */
  pcs: number[];
  midis: number[];
  label: string;
}

function roleRequirement(step: ExerciseStep, role: ChordRole): RoleRequirement | null {
  const targets = step.targets.filter((note) => note.role === role);
  if (targets.length > 0) {
    return {
      role,
      pcs: unique(targets.map((note) => mod12(note.midi))),
      midis: unique(targets.map((note) => note.midi)),
      label: pitchClassLabel(targets[0].midi, step.chord, targets[0].spelled)
    };
  }
  const chord = step.chord;
  if (!chord) {
    return null;
  }
  const tones = chordTones(chord, 4).filter((tone) => tone.degree.role === role);
  if (tones.length === 0) {
    return null;
  }
  return {
    role,
    pcs: unique(tones.map((tone) => mod12(tone.midi))),
    midis: unique(tones.map((tone) => tone.midi)),
    label: formatPitchClass(tones[0].spelled, { unicode: true })
  };
}

function matchRoles(step: ExerciseStep, played: number[], policy: Extract<AnswerPolicy, { kind: "roles" }>): PitchMatch {
  const octaveFree = policy.octaveFree !== false;
  const allowExtra = policy.allowExtraNotes === true;
  const playedSet = unique(played);
  const playedPcs = unique(playedSet.map(mod12));
  const notes: string[] = [];
  const missingRoles: ChordRole[] = [];
  const satisfiedRoles: ChordRole[] = [];
  const missingMidi: number[] = [];
  if (playedSet.length === 0) {
    notes.push(NOTHING_PLAYED);
  }
  const optional = policy.optionalRoles ?? [];
  uniqueRoles(policy.requiredRoles).forEach((role) => {
    const requirement = roleRequirement(step, role);
    if (!requirement) {
      notes.push(`This step does not define a ${roleName(role)}, so it is not checked`);
      return;
    }
    const ok = octaveFree
      ? requirement.pcs.some((pc) => playedPcs.includes(pc))
      : requirement.midis.some((midi) => playedSet.includes(midi));
    if (ok) {
      satisfiedRoles.push(role);
    } else {
      missingRoles.push(role);
      requirement.midis.forEach((midi) => missingMidi.push(midi));
      notes.push(`The ${roleName(role)} (${requirement.label}) is missing`);
    }
  });
  optional.forEach((role) => {
    const requirement = roleRequirement(step, role);
    if (requirement && requirement.pcs.some((pc) => playedPcs.includes(pc)) && !satisfiedRoles.includes(role)) {
      satisfiedRoles.push(role);
    }
  });
  // Allowed pitch classes: the chord's tones (or, without a chord, the targets').
  const allowedPcs = step.chord ? chordPitchClasses(step.chord) : unique(step.targets.map((note) => mod12(note.midi)));
  const extraMidi = playedSet.filter((midi) => !allowedPcs.includes(mod12(midi)));
  extraMidi.forEach((midi) => notes.push(extraLine(midi, step.chord, false)));
  const correct = playedSet.length > 0 && missingRoles.length === 0 && (allowExtra || extraMidi.length === 0);
  if (correct && extraMidi.length > 0) {
    notes.push("Extra notes are allowed in this exercise");
  }
  return { correct, missingMidi: unique(missingMidi), extraMidi: allowExtra ? [] : extraMidi, missingRoles, satisfiedRoles, notes };
}

function matchPitchClass(step: ExerciseStep, played: number[], allowExtra: boolean): PitchMatch {
  const targetPcs = unique(step.targets.map((note) => mod12(note.midi)));
  const playedSet = unique(played);
  const playedPcs = unique(playedSet.map(mod12));
  const notes: string[] = [];
  if (playedSet.length === 0) {
    notes.push(NOTHING_PLAYED);
  }
  const missingMidi: number[] = [];
  const missingRoles: ChordRole[] = [];
  const satisfiedRoles: ChordRole[] = [];
  targetPcs.forEach((pc) => {
    const note = step.targets.find((target) => mod12(target.midi) === pc);
    if (!note) return;
    if (playedPcs.includes(pc)) {
      if (note.role) satisfiedRoles.push(note.role);
      return;
    }
    missingMidi.push(note.midi);
    if (note.role) missingRoles.push(note.role);
    notes.push(missingLine(note, step.chord, false));
  });
  const extraMidi = playedSet.filter((midi) => !targetPcs.includes(mod12(midi)));
  extraMidi.forEach((midi) => notes.push(extraLine(midi, step.chord, false)));
  const correct = playedSet.length > 0 && missingMidi.length === 0 && (allowExtra || extraMidi.length === 0);
  return { correct, missingMidi, extraMidi: allowExtra ? [] : extraMidi, missingRoles: uniqueRoles(missingRoles), satisfiedRoles: uniqueRoles(satisfiedRoles), notes };
}

/** Grade one step's played pitches under a policy (default: the step's own policy). */
export function matchStep(step: ExerciseStep, played: number[], policy: AnswerPolicy = step.policy): PitchMatch {
  switch (policy.kind) {
    case "exactVoicing":
      return matchExact(step, played, policy.allowExtraNotes === true);
    case "roles":
      return matchRoles(step, played, policy);
    case "pitchClass":
      return matchPitchClass(step, played, policy.allowExtraNotes === true);
    case "listen":
      return { correct: true, missingMidi: [], extraMidi: [], missingRoles: [], satisfiedRoles: [], notes: ["Listening exercise: nothing you play is graded"] };
    case "free":
    default:
      return { correct: true, missingMidi: [], extraMidi: [], missingRoles: [], satisfiedRoles: [], notes: ["Free playing: nothing is graded"] };
  }
}

/** True when a policy grades pitches at all. */
export function isGradedPolicy(policy: AnswerPolicy): boolean {
  return policy.kind !== "listen" && policy.kind !== "free";
}

// ---------------------------------------------------------------------------
// Chord assembly
// ---------------------------------------------------------------------------

export interface TimedAttack {
  midi: number;
  timestampMs: number;
}

export interface AttackGroup {
  startMs: number;
  endMs: number;
  attacks: TimedAttack[];
  /** Distinct pitches in the group, ascending. */
  midi: number[];
}

export const DEFAULT_ASSEMBLY_WINDOW_MS = 80;

/**
 * Group attacks into chord attempts. Attacks are ordered by time; an attack more than
 * `windowMs` after the first attack of the current group starts a new group (an attack exactly
 * `windowMs` after it still belongs to the group).
 */
export function groupAttacks(attacks: TimedAttack[], windowMs: number = DEFAULT_ASSEMBLY_WINDOW_MS): AttackGroup[] {
  const sorted = attacks
    .map((attack, index) => ({ attack, index }))
    .sort((a, b) => (a.attack.timestampMs !== b.attack.timestampMs ? a.attack.timestampMs - b.attack.timestampMs : a.index - b.index))
    .map((entry) => entry.attack);
  const groups: AttackGroup[] = [];
  for (const attack of sorted) {
    const last: AttackGroup | undefined = groups.length > 0 ? groups[groups.length - 1] : undefined;
    let group: AttackGroup;
    if (!last || attack.timestampMs - last.startMs > windowMs + 1e-9) {
      group = { startMs: attack.timestampMs, endMs: attack.timestampMs, attacks: [], midi: [] };
      groups.push(group);
    } else {
      group = last;
    }
    group.attacks.push(attack);
    group.endMs = attack.timestampMs;
    if (!group.midi.includes(attack.midi)) {
      group.midi.push(attack.midi);
      group.midi.sort((a, b) => a - b);
    }
  }
  return groups;
}

/** Alias kept for readability at call sites. */
export const chordAssembly = groupAttacks;

// ---------------------------------------------------------------------------
// Sequence matching (runs, timed chords)
// ---------------------------------------------------------------------------

export interface SequenceMatchOptions {
  /**
   * How far from the expected onset an attack may still be credited to a target (as early/late).
   * Default 2 × windowMs. Attacks further away are extras; targets without a credited attack are missed.
   */
  searchWindowMs?: number;
  /** Key used to compare pitches: default exact MIDI; pass `mod12` for octave-free matching. */
  matchKey?: (midi: number) => number;
  /** Observation id overrides (default note.id / note.occurrenceId). */
  targetId?: (note: PerformedNote) => string;
  occurrenceId?: (note: PerformedNote) => string;
}

export interface SequenceMatchResult {
  /** One observation per target, in target order. */
  observations: TimingObservation[];
  /** Index into `attacks` credited to each target (-1 = missed), in target order. */
  assignment: number[];
  /** Attacks not credited to any target. */
  extraAttacks: TimedAttack[];
}

const EPS = 1e-6;

/** onTime when |delta| ≤ window (exact boundary is on time), else early/late. */
export function verdictForDelta(deltaMs: number, windowMs: number): "early" | "onTime" | "late" {
  if (Math.abs(deltaMs) <= windowMs + EPS) {
    return "onTime";
  }
  return deltaMs < 0 ? "early" : "late";
}

/**
 * Credit attacks to targets. Targets are processed earliest-first; each takes the nearest unused
 * attack with the same pitch key inside the search window, preferring attacks that are on time
 * for it, and never taking an attack that would be on time for a later target of the same pitch
 * when it is not on time for this one. An attack is credited at most once.
 */
export function matchSequenceAttacks(
  targets: PerformedNote[],
  attacks: TimedAttack[],
  expectedOnsetMs: (note: PerformedNote) => number,
  windowMs: number,
  options: SequenceMatchOptions = {}
): SequenceMatchResult {
  const search = options.searchWindowMs ?? windowMs * 2;
  const key = options.matchKey ?? ((midi: number): number => midi);
  const targetId = options.targetId ?? ((note: PerformedNote): string => note.id);
  const occurrenceId = options.occurrenceId ?? ((note: PerformedNote): string => note.occurrenceId);
  const order = targets
    .map((note, index) => ({ note, index, expected: expectedOnsetMs(note) }))
    .sort((a, b) => (a.expected !== b.expected ? a.expected - b.expected : a.index - b.index));
  const used: boolean[] = attacks.map(() => false);
  const assignmentByTarget: number[] = targets.map(() => -1);

  order.forEach((entry, position) => {
    const targetKey = key(entry.note.midi);
    let best = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    attacks.forEach((attack, attackIndex) => {
      if (used[attackIndex] || key(attack.midi) !== targetKey) {
        return;
      }
      const delta = attack.timestampMs - entry.expected;
      if (Math.abs(delta) > search + EPS) {
        return;
      }
      const onTime = Math.abs(delta) <= windowMs + EPS;
      if (!onTime) {
        // Do not steal an attack that is on time for a later target of the same pitch.
        const laterWants = order.slice(position + 1).some((later) => key(later.note.midi) === targetKey && Math.abs(attack.timestampMs - later.expected) <= windowMs + EPS);
        if (laterWants) {
          return;
        }
      }
      // On-time candidates always beat early/late ones; then nearest; ties → earlier attack.
      const score = (onTime ? 0 : 1e9) + Math.abs(delta) * 1000 + attack.timestampMs * 1e-9;
      if (score < bestScore) {
        bestScore = score;
        best = attackIndex;
      }
    });
    if (best >= 0) {
      used[best] = true;
      assignmentByTarget[entry.index] = best;
    }
  });

  const observations: TimingObservation[] = targets.map((note, index) => {
    const expected = expectedOnsetMs(note);
    const attackIndex = assignmentByTarget[index];
    if (attackIndex < 0) {
      return { targetNoteId: targetId(note), occurrenceId: occurrenceId(note), expectedOnsetMs: expected, verdict: "missed" };
    }
    const actual = attacks[attackIndex].timestampMs;
    const delta = actual - expected;
    return {
      targetNoteId: targetId(note),
      occurrenceId: occurrenceId(note),
      expectedOnsetMs: expected,
      actualOnsetMs: actual,
      deltaMs: delta,
      verdict: verdictForDelta(delta, windowMs)
    };
  });
  const extraAttacks = attacks.filter((_, index) => !used[index]);
  return { observations, assignment: assignmentByTarget, extraAttacks };
}

/** Octave-free pitch key for `matchSequenceAttacks`. */
export function pitchClassKey(midi: number): number {
  return mod12(midi);
}
