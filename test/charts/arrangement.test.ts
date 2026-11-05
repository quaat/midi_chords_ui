import { describe, expect, it } from "vitest";
import type { ArrangementDefinition, SongChart, VoicingInstance } from "@/model/contracts";
import { getArrangement, getChart } from "@/content";
import { arrangementSteps, compileArrangement } from "@/charts/arrangement";
import type { CompiledArrangement } from "@/charts/arrangement";
import { localVoicer } from "@/charts/voicer";

function chart(id: string): SongChart {
  const found = getChart(id);
  if (!found) throw new Error(`missing chart ${id}`);
  return found;
}

function arrangement(id: string): ArrangementDefinition {
  const found = getArrangement(id);
  if (!found) throw new Error(`missing arrangement ${id}`);
  return found;
}

function compiled(chartId: string, arrangementId: string, options = {}): CompiledArrangement {
  const result = compileArrangement(chart(chartId), arrangement(arrangementId), options);
  if (!result.ok) throw new Error(result.reason);
  return result;
}

describe("compileArrangement: evening-loop", () => {
  const simple = compiled("evening-loop", "evening-loop-simple");
  const richer = compiled("evening-loop", "evening-loop-richer");
  const chartOnly = compiled("evening-loop", "evening-loop-chart-only");

  it("builds one sequence event per chart occurrence with the occurrence id", () => {
    expect(simple.sequence.events).toHaveLength(simple.expansion.occurrences.length);
    expect(simple.sequence.events.map((e) => e.id)).toEqual(simple.expansion.occurrences.map((o) => o.occurrenceId));
    expect(simple.sequence.events[1].chord?.bass).toEqual({ letter: "B", accidental: 0 });
    expect(simple.sequence.totalBeats).toBe(64);
  });

  it("simple arrangement: one bass note per span in the learner register (slash bass written)", () => {
    const tasks = simple.expectedTasks;
    expect(tasks).toHaveLength(19);
    tasks.forEach((task) => expect(task.targets).toHaveLength(1));
    expect(tasks.map((t) => t.targets[0].midi).slice(0, 5)).toEqual([36, 47, 45, 41, 43]);
    expect(tasks[1].targets[0].spelled).toEqual({ letter: "B", accidental: 0, octave: 2 });
    expect(tasks[0].policy).toEqual({ kind: "pitchClass" });
    expect(tasks[0].assessed).toBe(true);
    expect(tasks[0].description).toContain("pitch class");
  });

  it("richer arrangement: close triads in the right-hand register with voice leading", () => {
    const tasks = richer.expectedTasks;
    tasks.forEach((task) => {
      expect(task.targets).toHaveLength(3);
      task.targets.forEach((note) => {
        expect(note.midi).toBeGreaterThanOrEqual(59);
        expect(note.midi).toBeLessThanOrEqual(79);
        expect(note.hand).toBe("right");
      });
    });
    expect(tasks[0].targets.map((n) => n.midi)).toEqual([60, 64, 67]);
    // Slash chord: the written bass B is the lowest learner note.
    const gOverB = tasks[1].targets;
    expect(gOverB[0].spelled?.letter).toBe("B");
    expect(gOverB.map((n) => n.role).sort()).toEqual(["fifth", "root", "third"]);
    expect(tasks[0].policy.kind).toBe("roles");
    expect(tasks[0].description).toContain("close-triads-rh");
  });

  it("chart-only arrangement has no learner notes, free policy and unassessed tasks", () => {
    expect(chartOnly.timeline.notes.filter((n) => n.part === "learner")).toEqual([]);
    chartOnly.expectedTasks.forEach((task) => {
      expect(task.targets).toEqual([]);
      expect(task.policy).toEqual({ kind: "free" });
      expect(task.assessed).toBe(false);
    });
    expect(chartOnly.timeline.notes.some((n) => n.part === "accompaniment")).toBe(true);
    const steps = arrangementSteps(chartOnly);
    expect(steps).toHaveLength(19);
    steps.forEach((step) => {
      expect(step.policy).toEqual({ kind: "free" });
      expect(step.targets).toEqual([]);
    });
  });

  it("changing arrangement visibly changes the expected tasks", () => {
    const describe = (result: CompiledArrangement): string => JSON.stringify(result.expectedTasks.map((t) => [t.description, t.targets.map((n) => n.midi)]));
    expect(describe(simple)).not.toBe(describe(richer));
    expect(describe(richer)).not.toBe(describe(chartOnly));
    // Same chart, same occurrences.
    expect(simple.expectedTasks.map((t) => t.occurrenceId)).toEqual(chartOnly.expectedTasks.map((t) => t.occurrenceId));
  });

  it("changing only the policy changes the tasks' policy and assessment", () => {
    const base = arrangement("evening-loop-richer");
    const exact: ArrangementDefinition = { ...base, id: "exact", policy: { kind: "exactVoicing" } };
    const result = compileArrangement(chart("evening-loop"), exact);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.expectedTasks[0].policy).toEqual({ kind: "exactVoicing" });
    expect(result.expectedTasks[0].description).toContain("exact notes");
    expect(result.expectedTasks[0].description).not.toBe(richer.expectedTasks[0].description);
  });

  it("accompaniment notes are part accompaniment and sit in the arrangement register", () => {
    const acc = richer.timeline.notes.filter((n) => n.part === "accompaniment");
    expect(acc.length).toBeGreaterThan(0);
    acc.forEach((note) => {
      expect(note.midi).toBeGreaterThanOrEqual(36);
      expect(note.midi).toBeLessThanOrEqual(58);
    });
    const simpleAcc = simple.timeline.notes.filter((n) => n.part === "accompaniment");
    simpleAcc.forEach((note) => {
      expect(note.midi).toBeGreaterThanOrEqual(55);
      expect(note.midi).toBeLessThanOrEqual(76);
    });
    // No accompaniment note doubles another at the same onset and pitch.
    const keys = simpleAcc.map((n) => `${n.onsetBeat}:${n.midi}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("occurrences carry sectionId and sourceBarIndex; ids match the expansion", () => {
    const occ = richer.timeline.occurrences;
    expect(occ.map((o) => o.occurrenceId)).toEqual(richer.expansion.occurrences.map((o) => o.occurrenceId));
    expect(occ[0]).toMatchObject({ sectionId: "A", sourceBarIndex: 0, passIndex: 0 });
    const b = occ.find((o) => o.sectionId === "B");
    expect(b?.sourceBarIndex).toBe(8);
    const secondA = occ.filter((o) => o.eventId === "A#1:el-a1:el-a1-s1");
    expect(secondA[0].passIndex).toBe(1);
    richer.timeline.notes.forEach((note) => {
      if (note.part === "metronome") return;
      expect(occ.some((o) => o.occurrenceId === note.occurrenceId)).toBe(true);
    });
  });

  it("timeline notes never start before beat 0, even with a count-in", () => {
    const withCountIn = compiled("evening-loop", "evening-loop-richer", { countInBeats: 4, metronome: true });
    expect(withCountIn.timeline.countInBeats).toBe(4);
    withCountIn.timeline.notes.forEach((note) => expect(note.onsetBeat).toBeGreaterThanOrEqual(0));
    expect(withCountIn.timeline.notes.some((n) => n.part === "metronome")).toBe(true);
  });

  it("returns the loop region of the requested section", () => {
    const looped = compiled("evening-loop", "evening-loop-simple", { loop: { sectionId: "B" } });
    expect(looped.loopRegion).toMatchObject({ startBeat: 32, endBeat: 48 });
    const region = looped.loopRegion;
    if (!region) return;
    const inside = looped.timeline.occurrences.filter((o) => o.startBeat >= region.startBeat && o.startBeat < region.endBeat);
    inside.forEach((o) => expect(o.sectionId).toBe("B"));
    const missing = compileArrangement(chart("evening-loop"), arrangement("evening-loop-simple"), { loop: { sectionId: "Z" } });
    expect(missing.ok).toBe(false);
  });

  it("whole-chart repeats give distinct occurrence ids and continuing pass indices", () => {
    const twice = compiled("evening-loop", "evening-loop-simple", { repeats: 2 });
    const ids = twice.timeline.occurrences.map((o) => o.occurrenceId);
    expect(new Set(ids).size).toBe(ids.length);
    const a1 = twice.timeline.occurrences.filter((o) => o.eventId === "A#0:el-a1:el-a1-s1");
    expect(a1.map((o) => o.occurrenceId)).toEqual(["A#0:el-a1:el-a1-s1", "A#0:el-a1:el-a1-s1@r1"]);
    expect(a1.map((o) => o.passIndex)).toEqual([0, 3]);
    expect(twice.expectedTasks).toHaveLength(38);
  });
});

describe("compileArrangement: dorian-drift and edge cases", () => {
  it("block triads skip the pickup rest and use triads of seventh chords", () => {
    const result = compiled("dorian-drift", "dorian-drift-simple");
    const first = result.expectedTasks[0];
    expect(first.isRest).toBe(true);
    expect(first.targets).toEqual([]);
    expect(first.assessed).toBe(false);
    const dm = result.expectedTasks[1];
    expect(dm.symbol).toBe("Dm7");
    expect(dm.startBeat).toBe(2);
    expect(dm.targets.map((n) => n.role).sort()).toEqual(["fifth", "root", "third"]);
    const steps = arrangementSteps(result);
    expect(steps).toHaveLength(result.expectedTasks.length - 1);
    expect(steps[0].occurrenceId).toBe(dm.occurrenceId);
    expect(steps[0].chord?.symbol).toBe("Dm7");
  });

  it("rejects a chart-only arrangement that claims a scored policy", () => {
    const bad: ArrangementDefinition = { ...arrangement("evening-loop-chart-only"), policy: { kind: "pitchClass" } };
    const result = compileArrangement(chart("evening-loop"), bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("free");
  });

  it("rejects an arrangement for another chart", () => {
    expect(compileArrangement(chart("dorian-drift"), arrangement("evening-loop-simple")).ok).toBe(false);
  });

  it("explicit arrangements need authored notes for every span", () => {
    const base = arrangement("dorian-drift-simple");
    const explicit: ArrangementDefinition = {
      ...base,
      id: "dd-explicit",
      learnerPart: { kind: "explicit", explicitNotes: { "dd-a1-s1": [{ midi: 62 }, { midi: 65 }] } },
      policy: { kind: "exactVoicing" }
    };
    const result = compileArrangement(chart("dorian-drift"), explicit);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("dd-a2-s1");
    const notes: Record<string, { midi: number }[]> = {};
    chart("dorian-drift").sections.forEach((s) => s.bars.forEach((b) => b.spans.forEach((span) => (notes[span.id] = [{ midi: 62 }, { midi: 65 }]))));
    const full = compileArrangement(chart("dorian-drift"), { ...explicit, learnerPart: { kind: "explicit", explicitNotes: notes } });
    expect(full.ok).toBe(true);
    if (!full.ok) return;
    expect(full.expectedTasks[1].targets.map((n) => n.midi)).toEqual([62, 65]);
    expect(full.expectedTasks[1].targets[1].degree).toBe("b3");
  });

  it("the local voicer keeps common tones (G/B after C moves by step)", () => {
    const result = compileArrangement(chart("evening-loop"), arrangement("evening-loop-richer"), { voicer: localVoicer });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.expectedTasks[1].targets.map((n) => n.midi)).toEqual([59, 62, 67]);
  });

  it("uses an injected voicer with the previous voicing for continuity", () => {
    const calls: (VoicingInstance | undefined)[] = [];
    const result = compileArrangement(chart("evening-loop"), arrangement("evening-loop-richer"), {
      voicer: (chordDef, recipeId, constraints) => {
        calls.push(constraints.previous);
        expect(recipeId).toBe("close-triads-rh");
        expect(constraints.minMidi).toBe(59);
        return localVoicer(chordDef, recipeId, constraints);
      }
    });
    expect(result.ok).toBe(true);
    expect(calls[0]).toBeUndefined();
    expect(calls[1]?.chord.symbol).toBe("C");
    const failing = compileArrangement(chart("evening-loop"), arrangement("evening-loop-richer"), { voicer: () => null });
    expect(failing.ok).toBe(false);
  });
});
