/**
 * Arrangement compiler (plan E30, §4 "Song charts and accompaniment"): a SongChart plus an
 * ArrangementDefinition becomes a MusicalSequence (one event per chart occurrence), a shared
 * PerformanceTimeline (learner + accompaniment + optional metronome) and the list of tasks
 * that are actually assessed.
 *
 * Chart vs arrangement vs exercise
 * - The chart only states harmony. Exact learner notes exist only because the arrangement
 *   generates or authors them ("roots", "blockTriads", "voicingRecipe", "explicit").
 * - "chartOnly" arrangements create NO learner notes and must use the "free" policy; their
 *   tasks have no targets, so silence is never a missed note.
 * - Accompaniment is compiled by compileTimeline's pattern (part "accompaniment") and can
 *   never count as learner input.
 *
 * Identity: timeline occurrence ids equal chart occurrence ids for the first pass; further
 * passes requested with `repeats` get `<occurrenceId>@r<pass>`. Occurrences carry
 * `sectionId` and `sourceBarIndex` (the performance bar index from expandChart).
 */
import type {
  AnswerPolicy,
  ArrangementDefinition,
  ChordDefinition,
  ExerciseStep,
  Hand,
  MusicalSequence,
  PerformanceOccurrence,
  PerformanceTimeline,
  PerformedNote,
  SequenceEvent,
  SongChart,
  VoicedNote,
  VoicingInstance
} from "@/model/contracts";
import { tryChordFromSymbol } from "@/music/chords";
import { degreeLabelFromInterval, intervalBetweenPitchClasses } from "@/music/intervals";
import { formatPitchClass, formatSpelledNote, noteFromMidi, pitchClassOf } from "@/music/pitch";
import { compareNotes, compileTimelineWithDiagnostics } from "@/timeline/compile";
import type { FallbackVoicing } from "@/timeline/compile";
import { expandChart, sectionLoopRegion } from "@/charts/expand";
import type { ChartExpansion, ChartOccurrence, LoopRegion } from "@/charts/expand";
import { engineVoice, localCloseVoicing, lowestInRange, spellInChord } from "@/charts/voicer";
import type { ArrangementVoicer } from "@/charts/voicer";

const EPSILON = 1e-6;

export const DEFAULT_ROOTS_REGISTER = { low: 48, high: 60 };
export const DEFAULT_CHORD_REGISTER = { low: 55, high: 79 };
export const DEFAULT_ACCOMPANIMENT_REGISTER = { low: 36, high: 58 };

export interface CompileArrangementOptions {
  /** Voicing engine for "voicingRecipe" arrangements (default: src/voicing realizeVoicing). */
  voicer?: ArrangementVoicer;
  tempoBpm?: number;
  countInBeats?: number;
  metronome?: boolean;
  /** Whole-chart passes (default 1). */
  repeats?: number;
  /** Section to loop; the region is returned as `loopRegion`. */
  loop?: { sectionId: string; orderIndex?: number };
  velocity?: number;
}

export interface ArrangementTask {
  occurrenceId: string;
  symbol: string;
  sectionId: string;
  barIndex: number;
  startBeat: number;
  durationBeats: number;
  isRest: boolean;
  policy: AnswerPolicy;
  /** Learner notes assessed for this occurrence (empty for chart-only and rests). */
  targets: PerformedNote[];
  /** True when something is scored for this occurrence. */
  assessed: boolean;
  description: string;
}

export interface CompiledArrangement {
  ok: true;
  chartId: string;
  chartVersion: number;
  arrangementId: string;
  learnerKind: ArrangementDefinition["learnerPart"]["kind"];
  timeline: PerformanceTimeline;
  sequence: MusicalSequence;
  expansion: ChartExpansion;
  expectedTasks: ArrangementTask[];
  loopRegion: LoopRegion | null;
  warnings: string[];
}

export type CompileArrangementResult = CompiledArrangement | { ok: false; reason: string };

function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

function where(occurrence: ChartOccurrence): string {
  return `bar ${occurrence.barIndex + 1} (section "${occurrence.sectionId}", span "${occurrence.spanId}")`;
}

function noteName(note: { midi: number; spelled?: VoicedNote["spelled"] }): string {
  return formatSpelledNote(note.spelled ?? noteFromMidi(note.midi));
}

function bassNote(chord: ChordDefinition, low: number, high: number, hand: Hand, voiceId: string): VoicedNote | null {
  const target = chord.bass ?? chord.root;
  const midi = lowestInRange(pitchClassOf(target), low, high);
  if (midi === null) {
    return null;
  }
  const spelled = spellInChord(midi, chord);
  if (spelled.degree) {
    return { midi, spelled: spelled.spelled, degree: spelled.degree.label, role: spelled.degree.role, hand, voiceId };
  }
  const interval = intervalBetweenPitchClasses(chord.root, target);
  return { midi, spelled: spelled.spelled, degree: interval ? degreeLabelFromInterval(interval) : "bass", role: "added", hand, voiceId };
}

function rootsVoicing(chord: ChordDefinition, low: number, high: number, hand: Hand): VoicingInstance | null {
  const note = bassNote(chord, low, high, hand, "v1");
  if (!note) {
    return null;
  }
  const slash = chord.bass !== undefined;
  return {
    id: `roots:${chord.symbol}:${note.midi}`,
    chord,
    recipeId: "roots",
    notes: [note],
    omitted: [],
    explanation: [slash ? `Play the written bass ${formatPitchClass(chord.bass ?? chord.root)} of ${chord.symbol}.` : `Play the root ${formatPitchClass(chord.root)} of ${chord.symbol}.`]
  };
}

function explicitVoicing(chord: ChordDefinition, spanId: string, notes: NonNullable<ArrangementDefinition["learnerPart"]["explicitNotes"]>[string], hand: Hand): VoicingInstance {
  const sorted = [...notes].sort((a, b) => a.midi - b.midi);
  const voiced: VoicedNote[] = sorted.map((authored, index) => {
    const spelled = spellInChord(authored.midi, chord);
    const note: VoicedNote = {
      midi: authored.midi,
      spelled: spelled.spelled,
      degree: authored.degree ?? (spelled.degree ? spelled.degree.label : "?"),
      role: authored.role ?? (spelled.degree ? spelled.degree.role : "added"),
      hand: authored.hand ?? hand,
      voiceId: `v${index + 1}`
    };
    if (authored.finger !== undefined) {
      note.finger = authored.finger;
    }
    return note;
  });
  return { id: `explicit:${spanId}`, chord, recipeId: "explicit", notes: voiced, omitted: [], explanation: ["Authored notes for this chord span."] };
}

function emptyVoicing(chord: ChordDefinition): VoicingInstance {
  return { id: `chartOnly:${chord.symbol}`, chord, recipeId: "chartOnly", notes: [], omitted: [], explanation: ["Chart only: no learner notes are generated."] };
}

function policyText(policy: AnswerPolicy): string {
  switch (policy.kind) {
    case "exactVoicing":
      return "the exact notes shown are assessed";
    case "roles": {
      const required = policy.requiredRoles.join(", ");
      const optional = policy.optionalRoles && policy.optionalRoles.length > 0 ? `; optional: ${policy.optionalRoles.join(", ")}` : "";
      return `assessed by chord roles (required: ${required}${optional})${policy.octaveFree ? " in any octave or inversion" : ""}`;
    }
    case "pitchClass":
      return "assessed by pitch class in any octave";
    case "listen":
      return "listen only; nothing is scored";
    case "free":
      return "not scored";
  }
}

function describeTask(kind: ArrangementDefinition["learnerPart"]["kind"], occurrence: ChartOccurrence, targets: PerformedNote[], policy: AnswerPolicy, recipeId: string | undefined): string {
  if (occurrence.isRest) {
    return `Rest (${occurrence.symbol}): nothing to play.`;
  }
  const names = targets.map((note) => noteName(note)).join(" ");
  let action = "";
  switch (kind) {
    case "chartOnly":
      return `${occurrence.symbol}: comp freely from the chart symbol; nothing is scored and silence is not a missed note.`;
    case "roots":
      action = `play the bass note ${names}`;
      break;
    case "blockTriads":
      action = `play the triad ${names}`;
      break;
    case "voicingRecipe":
      action = `play the ${recipeId ?? "recipe"} voicing ${names}`;
      break;
    case "explicit":
      action = `play ${names}`;
      break;
  }
  return `${occurrence.symbol}: ${action}; ${policyText(policy)}.`;
}

function fitShift(midis: number[], low: number, high: number): number {
  let best = 0;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let octaves = -4; octaves <= 4; octaves += 1) {
    const shifted = midis.map((midi) => midi + octaves * 12);
    let cost = 0;
    shifted.forEach((midi) => {
      if (midi < low) cost += low - midi;
      if (midi > high) cost += midi - high;
      if (midi < 0 || midi > 127) cost += 1000;
    });
    const total = cost * 100 + Math.abs(octaves);
    if (total < bestCost) {
      bestCost = total;
      best = octaves;
    }
  }
  return best * 12;
}

/**
 * Compile a chart with an arrangement into a sequence, a performance timeline, and the
 * assessed tasks.
 */
export function compileArrangement(chart: SongChart, arrangement: ArrangementDefinition, options: CompileArrangementOptions = {}): CompileArrangementResult {
  if (arrangement.chartId !== chart.id) {
    return fail(`Arrangement "${arrangement.id}" belongs to chart "${arrangement.chartId}", not "${chart.id}".`);
  }
  const learner = arrangement.learnerPart;
  if (learner.kind === "chartOnly" && arrangement.policy.kind !== "free") {
    return fail(`Arrangement "${arrangement.id}" is chart-only, so it has no learner notes to assess; its policy must be "free" (got "${arrangement.policy.kind}").`);
  }
  if (learner.kind === "voicingRecipe" && !learner.voicingRecipeId) {
    return fail(`Arrangement "${arrangement.id}" uses a voicing recipe but does not name one.`);
  }
  const expanded = expandChart(chart);
  if (!expanded.ok) {
    return fail(expanded.reason);
  }
  const expansion: ChartExpansion = expanded;
  const hand: Hand = learner.hand ?? (learner.kind === "roots" ? "left" : "right");
  const register = learner.register ?? (learner.kind === "roots" ? DEFAULT_ROOTS_REGISTER : DEFAULT_CHORD_REGISTER);
  const pattern = arrangement.accompaniment.pattern;
  const accRegister = arrangement.accompaniment.register ?? DEFAULT_ACCOMPANIMENT_REGISTER;
  const injected: ArrangementVoicer | undefined = options.voicer;
  const warnings: string[] = [];

  const events: SequenceEvent[] = [];
  const bassByEvent = new Map<string, number>();
  let previous: VoicingInstance | undefined;
  for (const occurrence of expansion.occurrences) {
    const index = events.length;
    const event: SequenceEvent = {
      id: occurrence.occurrenceId,
      index,
      kind: occurrence.isRest ? "rest" : "chord",
      symbol: occurrence.isRest ? "NC" : occurrence.symbol,
      startBeat: occurrence.startBeat,
      durationBeats: occurrence.durationBeats
    };
    if (chart.key || occurrence.romanNumeral !== undefined) {
      event.context = {};
      if (chart.key) event.context.key = chart.key;
      if (occurrence.romanNumeral !== undefined) event.context.romanNumeral = occurrence.romanNumeral;
    }
    if (occurrence.isRest) {
      events.push(event);
      continue;
    }
    const parsed = tryChordFromSymbol(occurrence.symbol);
    if (!parsed.ok) {
      return fail(`Chord "${occurrence.symbol}" in ${where(occurrence)} is not supported: ${parsed.error}`);
    }
    const chord = parsed.chord;
    event.chord = chord;
    let voicing: VoicingInstance | null = null;
    switch (learner.kind) {
      case "roots":
        voicing = rootsVoicing(chord, register.low, register.high, hand);
        if (!voicing) return fail(`No ${formatPitchClass(chord.bass ?? chord.root)} fits the learner register ${register.low}–${register.high} for ${occurrence.symbol} in ${where(occurrence)}.`);
        break;
      case "blockTriads": {
        const closeOptions: { low: number; high: number; hand: Hand; previousMidi?: number[] } = { low: register.low, high: register.high, hand };
        if (previous) closeOptions.previousMidi = previous.notes.map((note) => note.midi);
        voicing = localCloseVoicing(chord, "close-triads-rh", closeOptions);
        if (!voicing) return fail(`Cannot place a close triad of ${occurrence.symbol} (root, third, fifth) in the register ${register.low}–${register.high} at ${where(occurrence)}.`);
        break;
      }
      case "voicingRecipe": {
        const recipeId = learner.voicingRecipeId ?? "";
        const constraints: { minMidi: number; maxMidi: number; hand: Hand; previous?: VoicingInstance } = { minMidi: register.low, maxMidi: register.high, hand };
        if (previous) constraints.previous = previous;
        const outcome = injected ? { voicing: injected(chord, recipeId, constraints), reason: undefined } : engineVoice(chord, recipeId, constraints);
        const realised = outcome.voicing;
        if (!realised) return fail(`The "${recipeId}" voicing cannot realise ${occurrence.symbol} in the register ${register.low}–${register.high} at ${where(occurrence)}${outcome.reason ? `: ${outcome.reason}` : "."}`);
        voicing = { ...realised, notes: realised.notes.map((note) => ({ ...note })) };
        break;
      }
      case "explicit": {
        const authored = learner.explicitNotes ? learner.explicitNotes[occurrence.spanId] : undefined;
        if (!authored) return fail(`Arrangement "${arrangement.id}" has no authored notes for span "${occurrence.spanId}" (${occurrence.symbol}, ${where(occurrence)}).`);
        voicing = explicitVoicing(chord, occurrence.spanId, authored, hand);
        break;
      }
      case "chartOnly":
        voicing = emptyVoicing(chord);
        break;
    }
    if (!voicing) {
      return fail(`No learner part for ${occurrence.symbol} at ${where(occurrence)}.`);
    }
    if (pattern === "none") {
      delete voicing.accompanimentBass;
    } else {
      const top = Math.min(accRegister.high, accRegister.low + 11);
      const bass = bassNote(chord, accRegister.low, top, "left", "bass") ?? bassNote(chord, accRegister.low, accRegister.high, "left", "bass");
      if (bass) {
        voicing.accompanimentBass = bass;
        bassByEvent.set(event.id, bass.midi);
      } else {
        delete voicing.accompanimentBass;
        warnings.push(`No accompaniment bass for ${occurrence.symbol} fits ${accRegister.low}–${accRegister.high}; the default bass is used.`);
      }
    }
    event.voicing = voicing;
    event.voicingRecipeId = voicing.recipeId;
    if (voicing.notes.length > 0) {
      previous = voicing;
    }
    events.push(event);
  }

  const sequence: MusicalSequence = {
    id: chart.id,
    version: chart.version,
    title: chart.title,
    tempo: { bpm: chart.tempo.bpm },
    timeSignature: { numerator: chart.timeSignature.numerator, denominator: chart.timeSignature.denominator },
    events,
    totalBeats: expansion.totalBeats
  };
  if (chart.key) sequence.key = chart.key;
  if (learner.kind === "voicingRecipe" && learner.voicingRecipeId) sequence.defaultVoicingRecipeId = learner.voicingRecipeId;

  const noVoicer = (): FallbackVoicing | null => null;
  const compiled = compileTimelineWithDiagnostics(sequence, {
    velocity: options.velocity,
    accompaniment: pattern,
    metronome: options.metronome === true,
    repeats: options.repeats ?? 1,
    countInBeats: options.countInBeats ?? 0,
    tempoBpm: options.tempoBpm,
    fallbackVoicer: noVoicer,
    timelineId: `${chart.id}@${chart.version}:${arrangement.id}`,
    arrangementId: arrangement.id
  });
  compiled.warnings.forEach((warning) => warnings.push(warning));
  const raw = compiled.timeline;

  // Re-identify occurrences with chart occurrence ids and chart metadata.
  const chartOccById = new Map<string, ChartOccurrence>();
  expansion.occurrences.forEach((occurrence) => chartOccById.set(occurrence.occurrenceId, occurrence));
  const performancesPerPass = new Map<string, number>();
  expansion.occurrences.forEach((occurrence) => {
    const key = `${occurrence.sourceBarId}\u0000${occurrence.spanId}`;
    performancesPerPass.set(key, (performancesPerPass.get(key) ?? 0) + 1);
  });
  const idMap = new Map<string, string>();
  const occurrences: PerformanceOccurrence[] = raw.occurrences.map((occurrence) => {
    const source = chartOccById.get(occurrence.eventId);
    const pass = occurrence.passIndex;
    const newId = pass === 0 ? occurrence.eventId : `${occurrence.eventId}@r${pass}`;
    idMap.set(occurrence.occurrenceId, newId);
    const copy: PerformanceOccurrence = { ...occurrence, occurrenceId: newId };
    if (source) {
      const perPass = performancesPerPass.get(`${source.sourceBarId}\u0000${source.spanId}`) ?? 1;
      copy.passIndex = source.passIndex + pass * perPass;
      copy.sourceBarIndex = source.barIndex;
      copy.sectionId = source.sectionId;
    }
    return copy;
  });

  const notes: PerformedNote[] = [];
  const bassNotes = raw.notes.filter((note) => note.part === "accompaniment" && note.spelled !== undefined);
  raw.notes.forEach((note) => {
    const newOcc = idMap.get(note.occurrenceId);
    const renamed: PerformedNote = newOcc ? { ...note, occurrenceId: newOcc, id: `${newOcc}${note.id.slice(note.occurrenceId.length)}` } : { ...note };
    if (note.part === "accompaniment" && note.spelled === undefined) {
      // Chord tone of the accompaniment pattern: move it into the arrangement's register.
      const group = raw.notes.filter((other) => other.part === "accompaniment" && other.spelled === undefined && other.occurrenceId === note.occurrenceId && Math.abs(other.onsetBeat - note.onsetBeat) < EPSILON);
      const shift = fitShift(group.map((other) => other.midi), accRegister.low, accRegister.high);
      renamed.midi = note.midi + shift;
      const duplicate = bassNotes.some(
        (bass) =>
          bass.occurrenceId === note.occurrenceId &&
          bass.midi === renamed.midi &&
          bass.onsetBeat < note.onsetBeat + note.durationBeats - EPSILON &&
          note.onsetBeat < bass.onsetBeat + bass.durationBeats - EPSILON
      );
      if (duplicate || renamed.midi < 0 || renamed.midi > 127) {
        return;
      }
      const occ = raw.occurrences.find((candidate) => candidate.occurrenceId === note.occurrenceId);
      if (occ && occ.chord) {
        const spelled = spellInChord(renamed.midi, occ.chord);
        renamed.spelled = spelled.spelled;
        if (spelled.degree) {
          renamed.degree = spelled.degree.label;
          renamed.role = spelled.degree.role;
        }
      }
    }
    if (renamed.onsetBeat < 0) {
      return;
    }
    notes.push(renamed);
  });
  notes.sort(compareNotes);

  const timeline: PerformanceTimeline = { ...raw, notes, occurrences };

  const expectedTasks: ArrangementTask[] = occurrences.map((occurrence) => {
    const source = chartOccById.get(occurrence.eventId);
    const targets = learner.kind === "chartOnly" ? [] : notes.filter((note) => note.part === "learner" && note.occurrenceId === occurrence.occurrenceId);
    const isRest = source ? source.isRest : occurrence.symbol === "NC";
    const description = source ? describeTask(learner.kind, source, targets, arrangement.policy, learner.voicingRecipeId) : occurrence.symbol;
    return {
      occurrenceId: occurrence.occurrenceId,
      symbol: occurrence.symbol,
      sectionId: occurrence.sectionId ?? "",
      barIndex: occurrence.sourceBarIndex ?? -1,
      startBeat: occurrence.startBeat,
      durationBeats: occurrence.durationBeats,
      isRest,
      policy: arrangement.policy,
      targets,
      assessed: targets.length > 0 && arrangement.policy.kind !== "free" && arrangement.policy.kind !== "listen",
      description
    };
  });

  let loopRegion: LoopRegion | null = null;
  if (options.loop) {
    loopRegion = sectionLoopRegion(expansion, options.loop.sectionId, options.loop.orderIndex);
    if (!loopRegion) {
      return fail(`Section "${options.loop.sectionId}"${options.loop.orderIndex !== undefined ? ` at order position ${options.loop.orderIndex + 1}` : ""} is not part of the performance order of "${chart.title}".`);
    }
  }

  return {
    ok: true,
    chartId: chart.id,
    chartVersion: chart.version,
    arrangementId: arrangement.id,
    learnerKind: learner.kind,
    timeline,
    sequence,
    expansion,
    expectedTasks,
    loopRegion,
    warnings
  };
}

/**
 * Practice-runtime steps for a compiled arrangement: one step per chord occurrence (rests are
 * skipped). Chart-only arrangements produce free-policy steps with no targets.
 */
export function arrangementSteps(result: CompiledArrangement): ExerciseStep[] {
  const steps: ExerciseStep[] = [];
  result.expectedTasks.forEach((task) => {
    if (task.isRest) {
      return;
    }
    const occurrence = result.timeline.occurrences.find((candidate) => candidate.occurrenceId === task.occurrenceId);
    const chartOnly = result.learnerKind === "chartOnly";
    const hints: string[] = [`Chord: ${task.symbol}`];
    if (!chartOnly && task.targets.length > 0) {
      hints.push(`Notes: ${task.targets.map((note) => noteName(note)).join(" ")}`);
      hints.push(`Keys: ${task.targets.map((note) => `${noteName(note)} (MIDI ${note.midi})`).join(", ")}`);
    }
    const step: ExerciseStep = {
      id: `step:${task.occurrenceId}`,
      occurrenceId: task.occurrenceId,
      prompt: task.description,
      targets: chartOnly ? [] : task.targets,
      policy: chartOnly ? { kind: "free" } : task.policy,
      hints
    };
    if (occurrence && occurrence.chord) {
      step.chord = occurrence.chord;
    }
    steps.push(step);
  });
  return steps;
}
