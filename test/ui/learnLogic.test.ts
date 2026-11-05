import { describe, expect, it } from "vitest";
import type { ConceptDefinition, ConceptExample, ProgressEvidence } from "@/model/contracts";
import { contentBundle, getConcept } from "@/content";
import type { ContentBundle } from "@/content";
import {
  DEFAULT_LEARN_FILTERS,
  buildCatalogue,
  examplePlan,
  policyLabel,
  readEvidence,
  recommendRoute,
  timelineToAuditionNotes,
  unitMarker
} from "@/ui/learn/learnLogic";
import { modeComparison } from "@/scalelab/compare";

function concept(id: string): ConceptDefinition {
  const found = getConcept(id);
  if (!found) throw new Error(`missing concept ${id}`);
  return found;
}

function example(conceptId: string, exampleId: string): ConceptExample {
  const found = concept(conceptId).examples.find((e) => e.id === exampleId);
  if (!found) throw new Error(`missing example ${exampleId}`);
  return found;
}

function allIds(view: ReturnType<typeof buildCatalogue>): string[] {
  return view.groups.flatMap((group) => group.items.map((item) => item.id));
}

describe("learn catalogue filters", () => {
  it("groups results by strand and lists drafts with their status", () => {
    const view = buildCatalogue(DEFAULT_LEARN_FILTERS);
    expect(view.total).toBeGreaterThan(10);
    const labels = view.groups.map((group) => group.label);
    expect(labels).toContain("Learning paths");
    expect(labels).toContain("Scales and modes");
    const dorian = view.groups.flatMap((g) => g.items).find((item) => item.id === "dorian-mode");
    expect(dorian?.status).toBe("draft");
  });

  it("hides deferred items from lessons and lists them under coming later", () => {
    const view = buildCatalogue(DEFAULT_LEARN_FILTERS);
    expect(allIds(view)).not.toContain("drop2-voicings");
    expect(view.comingLater.map((item) => item.id)).toContain("drop2-voicings");
  });

  it("hides drafts when asked and reports how many were hidden", () => {
    const view = buildCatalogue({ ...DEFAULT_LEARN_FILTERS, showDrafts: false });
    expect(view.total).toBe(0);
    expect(view.hiddenDrafts).toBeGreaterThan(10);
  });

  it("filters by input availability", () => {
    const none = allIds(buildCatalogue({ ...DEFAULT_LEARN_FILTERS, input: "none" }));
    // Reading/listening only: concepts and listen exercises stay, play exercises go.
    expect(none).toContain("dorian-mode");
    expect(none).toContain("ex-dorian-vs-minor-listen");
    expect(none).not.toContain("ex-d-dorian-run");
    const keys = allIds(buildCatalogue({ ...DEFAULT_LEARN_FILTERS, input: "computerKeyboard" }));
    const midi = allIds(buildCatalogue({ ...DEFAULT_LEARN_FILTERS, input: "midi" }));
    expect(keys).toContain("ex-d-dorian-run");
    expect(midi.length).toBeGreaterThanOrEqual(keys.length);
  });

  it("filters by demand, strand and query", () => {
    const view = buildCatalogue({ ...DEFAULT_LEARN_FILTERS, query: "dorian", strand: "scalesModes", demand: "intermediate" });
    const ids = allIds(view);
    expect(ids).toContain("dorian-mode");
    expect(ids.every((id) => id !== "keyboard-geography")).toBe(true);
  });

  it("never lists unavailable items as lessons", () => {
    const bundle: ContentBundle = {
      ...contentBundle,
      concepts: contentBundle.concepts.map((c) => (c.id === "dorian-mode" ? { ...c, meta: { ...c.meta, status: "unavailable" as const } } : c))
    };
    const view = buildCatalogue(DEFAULT_LEARN_FILTERS, bundle);
    expect(allIds(view)).not.toContain("dorian-mode");
    expect(view.comingLater.map((item) => item.id)).toContain("dorian-mode");
  });
});

describe("entry-route recommendation", () => {
  it("waits for the deciding answer", () => {
    expect(recommendRoute({ findNotes: null, readSymbols: null, playTwoFiveOne: null })).toBeNull();
    expect(recommendRoute({ findNotes: "yes", readSymbols: null, playTwoFiveOne: null })).toBeNull();
  });

  it("recommends foundations when notes cannot be found yet, with the reason", () => {
    const rec = recommendRoute({ findNotes: "no", readSymbols: null, playTwoFiveOne: null });
    expect(rec?.pathId).toBe("path-foundations");
    expect(rec?.reasons.join(" ")).toMatch(/find notes/);
  });

  it("recommends foundations when chord symbols are unsure", () => {
    const rec = recommendRoute({ findNotes: "yes", readSymbols: "unsure", playTwoFiveOne: null });
    expect(rec?.pathId).toBe("path-foundations");
    expect(rec?.reasons.join(" ")).toMatch(/chord symbols/);
  });

  it("recommends harmony and scales before ii–V–I, voicings after", () => {
    const harmony = recommendRoute({ findNotes: "yes", readSymbols: "yes", playTwoFiveOne: "no" });
    expect(harmony?.pathId).toBe("path-harmony-scales");
    expect(harmony?.reasons.join(" ")).toMatch(/ii–V–I/);
    const voicing = recommendRoute({ findNotes: "yes", readSymbols: "yes", playTwoFiveOne: "yes" });
    expect(voicing?.pathId).toBe("path-voicing-sampler");
    expect(voicing?.reasons.length).toBeGreaterThan(0);
  });
});

describe("example → audition mapping", () => {
  it("plays a chord example as a block chord with degree targets", () => {
    const plan = examplePlan(example("triads-major-minor", "tri-c"));
    expect(plan.notes.map((n) => n.midi)).toEqual([60, 64, 67]);
    expect(plan.notes.every((n) => n.onsetBeat === 0)).toBe(true);
    expect(plan.targets.map((t) => t.degreeLabel)).toEqual(["1", "3", "5"]);
  });

  it("plays a progression one bar per chord, built from symbols", () => {
    const plan = examplePlan(example("diatonic-progressions", "prog-145"));
    const onsets = Array.from(new Set(plan.notes.map((n) => n.onsetBeat)));
    expect(onsets).toEqual([0, 4, 8, 12]);
    expect(plan.chords.map((c) => c.symbol)).toEqual(["C", "F", "G", "C"]);
    expect(plan.targets.map((t) => t.midi)).toEqual([60, 64, 67]);
  });

  it("splits explicit progression MIDI evenly between the chords", () => {
    const plan = examplePlan(example("shell-voicings", "shell-251"));
    expect(plan.chords.map((c) => c.midi)).toEqual([
      [50, 53, 60],
      [43, 47, 53],
      [48, 52, 59]
    ]);
    expect(plan.chords[1].labels).toEqual(["1", "3", "b7"]);
  });

  it("plays a scale example as a run", () => {
    const plan = examplePlan(example("dorian-mode", "dor-d-minor"));
    expect(plan.notes.map((n) => n.midi)).toEqual([62, 64, 65, 67, 69, 70, 72, 74]);
    expect(plan.notes[1].onsetBeat).toBe(0.5);
  });

  it("compares D natural minor and D Dorian via modeComparison and highlights the sixth", () => {
    const dorian = concept("dorian-mode");
    const plan = examplePlan(example("dorian-mode", "dor-d-dorian"), dorian.examples);
    const cmp = modeComparison("D", "naturalMinor", "dorian", 4);
    expect(plan.variants.length).toBe(3);
    expect(plan.notes).toEqual(timelineToAuditionNotes(cmp.timelines.aThenB));
    expect(plan.targets.map((t) => t.midi)).toEqual(cmp.characteristicDegreeMidi);
    expect(plan.targets.map((t) => t.midi)).toEqual([70, 71]);
    expect(plan.summary).toMatch(/sixth/);
  });

  it("compares chord examples A then B", () => {
    const sevenths = concept("seventh-chords");
    const plan = examplePlan(example("seventh-chords", "sev-c7"), sevenths.examples);
    expect(plan.variants.map((v) => v.label)).toEqual(["Cmaj7", "C7", "Cmaj7 then C7"]);
    expect(plan.variants[0].notes.map((n) => n.midi)).toEqual([60, 64, 67, 71]);
    expect(plan.variants[1].notes.map((n) => n.midi)).toEqual([60, 64, 67, 70]);
    const both = plan.variants[2].notes;
    expect(Math.max(...both.map((n) => n.onsetBeat))).toBeGreaterThan(0);
  });

  it("drops metronome notes when mapping timelines", () => {
    const notes = timelineToAuditionNotes({
      id: "t",
      sourceId: "s",
      sourceVersion: 1,
      tempo: { bpm: 90 },
      timeSignature: { numerator: 4, denominator: 4 },
      totalBeats: 1,
      occurrences: [],
      notes: [
        { id: "a", eventId: "e", occurrenceId: "o", part: "learner", midi: 60, onsetBeat: 0, durationBeats: 1, velocity: 80 },
        { id: "b", eventId: "e", occurrenceId: "o", part: "metronome", midi: 76, onsetBeat: 0, durationBeats: 0.1, velocity: 80 }
      ]
    });
    expect(notes).toEqual([{ midi: 60, onsetBeat: 0, durationBeats: 1, velocity: 80 }]);
  });
});

describe("progress markers and labels", () => {
  const evidence: ProgressEvidence[] = [
    { kind: "read", conceptId: "dorian-mode", at: "2026-11-01T10:00:00.000Z" },
    { kind: "assisted", exerciseId: "ex-d-dorian-run", at: "2026-11-01T10:05:00.000Z" },
    { kind: "independent", exerciseId: "ex-d-dorian-run", at: "2026-11-01T10:10:00.000Z" }
  ];

  it("keeps reading and playing evidence distinct", () => {
    expect(unitMarker(evidence, "concept", "dorian-mode").label).toBe("Read");
    expect(unitMarker(evidence, "exercise", "ex-d-dorian-run").state).toBe("independent");
    expect(unitMarker(evidence, "exercise", "ex-c-major-run").done).toBe(false);
  });

  it("builds read evidence", () => {
    expect(readEvidence("dorian-mode", new Date("2026-11-04T00:00:00.000Z"))).toEqual({ kind: "read", conceptId: "dorian-mode", at: "2026-11-04T00:00:00.000Z" });
  });

  it("labels policies", () => {
    expect(policyLabel({ kind: "exactVoicing" })).toBe("Exact notes");
    expect(policyLabel({ kind: "roles", requiredRoles: ["third", "seventh"] })).toBe("Required chord roles, your voicing");
    expect(policyLabel({ kind: "free" })).toBe("Chart only — not scored");
  });
});
