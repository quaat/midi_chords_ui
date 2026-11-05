import { describe, expect, it } from "vitest";
import { contentBundle } from "@/content";
import type { ContentBundle } from "@/content/authoring";
import { findPrerequisiteCycles, isPlausibleChordSymbol, validateContent } from "@/content/validate";
import type { ValidationIssue } from "@/content/validate";

function clone(): ContentBundle {
  return JSON.parse(JSON.stringify(contentBundle)) as ContentBundle;
}

function errors(bundle: ContentBundle): ValidationIssue[] {
  return validateContent(bundle).filter((i: ValidationIssue) => i.severity === "error");
}

function hasError(bundle: ContentBundle, code: ValidationIssue["code"], id?: string): boolean {
  return errors(bundle).some((i: ValidationIssue) => i.code === code && (id === undefined || i.id === id));
}

describe("validateContent: failure cases", () => {
  it("baseline clone has no errors", () => {
    expect(errors(clone())).toEqual([]);
  });

  it("catches duplicate IDs per collection", () => {
    const b = clone();
    b.concepts.push({ ...b.concepts[0] });
    b.exerciseSpecs.push({ ...b.exerciseSpecs[0] });
    const dupes = errors(b).filter((i) => i.code === "duplicateId");
    expect(dupes.some((i) => i.kind === "concept" && i.id === b.concepts[0].id)).toBe(true);
    expect(dupes.some((i) => i.kind === "exercise" && i.id === b.exerciseSpecs[0].id)).toBe(true);
  });

  it("catches duplicate span IDs inside a chart", () => {
    const b = clone();
    const bars = b.charts[0].sections[0].bars;
    bars[1].spans[0].id = bars[0].spans[0].id;
    expect(hasError(b, "duplicateId", b.charts[0].id)).toBe(true);
  });

  it("catches dangling references of every kind", () => {
    const b = clone();
    b.concepts[0].prerequisites.push("no-such-concept");
    b.concepts[0].exerciseIds.push("ex-missing");
    b.concepts[0].related.push("also-missing");
    b.concepts[0].applications.push({ label: "x", chartId: "missing-chart" });
    b.paths[0].units.push({ kind: "exercise", id: "ex-ghost" });
    b.routines[0].items.push({ id: "ghost-item", kind: "chart", refId: "ghost-chart", settings: {} });
    b.arrangements[0].chartId = "ghost-chart-2";
    b.charts[1].arrangementIds.push("ghost-arrangement");
    b.exerciseSpecs[0].conceptIds.push("ghost-concept");
    b.melodies[0].conceptIds.push("ghost-concept-2");
    const dangling = errors(b).filter((i) => i.code === "danglingReference").map((i) => i.message);
    for (const target of ["no-such-concept", "ex-missing", "also-missing", "missing-chart", "ex-ghost", "ghost-chart", "ghost-chart-2", "ghost-arrangement", "ghost-concept", "ghost-concept-2"]) {
      expect(dangling.some((m: string) => m.includes(`"${target}"`))).toBe(true);
    }
  });

  it("reports a reference to an item of the wrong type", () => {
    const b = clone();
    b.concepts[0].related.push("evening-loop"); // a chart, not a concept
    b.routines[0].items[0].kind = "exercise"; // wu-five-finger-c is a warm-up
    const wrong = errors(b).filter((i) => i.code === "wrongReferenceType");
    expect(wrong.some((i) => i.kind === "concept" && i.message.includes("evening-loop"))).toBe(true);
    expect(wrong.some((i) => i.kind === "routine" && i.message.includes("wu-five-finger-c"))).toBe(true);
  });

  it("detects prerequisite cycles and reports the cycle", () => {
    const b = clone();
    const a = b.concepts.find((c) => c.id === "keyboard-geography")!;
    a.prerequisites.push("intervals"); // intervals → whole-half-steps → keyboard-geography → intervals
    const cycles = findPrerequisiteCycles(b);
    expect(cycles.length).toBe(1);
    expect(cycles[0]).toEqual(["intervals", "whole-half-steps", "keyboard-geography", "intervals"]);
    const issue = errors(b).find((i) => i.code === "prerequisiteCycle");
    expect(issue).toBeDefined();
    expect(issue!.message).toContain("intervals → whole-half-steps → keyboard-geography → intervals");
  });

  it("detects cycles that pass through exercises", () => {
    const b = clone();
    const run = b.exerciseSpecs.find((e) => e.id === "ex-c-major-run")!;
    run.prerequisites.push("ex-c-major-run-timed");
    expect(hasError(b, "prerequisiteCycle")).toBe(true);
  });

  it("catches out-of-range MIDI pitches", () => {
    const b = clone();
    const rootless = b.exerciseSpecs.find((e) => e.id === "ex-ii-v-i-rootless-c")!;
    if (rootless.material.kind !== "explicitNotes") throw new Error("fixture changed");
    rootless.material.steps[0].notes[0].midi = 15;
    b.melodies[0].notes[0].midi = 120;
    b.warmups[0].steps[0].notes[0].midi = 20;
    expect(hasError(b, "midiOutOfRange", "ex-ii-v-i-rootless-c")).toBe(true);
    expect(hasError(b, "midiOutOfRange", "mel-four-bar-c")).toBe(true);
    expect(hasError(b, "midiOutOfRange", "wu-five-finger-c")).toBe(true);
  });

  it("catches a scale run that leaves the piano range", () => {
    const b = clone();
    const run = b.exerciseSpecs.find((e) => e.id === "ex-c-major-run")!;
    if (run.material.kind !== "scaleRun") throw new Error("fixture changed");
    run.material.startOctave = 8; // C8 = 108, top C9 = 120
    expect(hasError(b, "midiOutOfRange", "ex-c-major-run")).toBe(true);
  });

  it("catches bar duration mismatches and span gaps", () => {
    const b = clone();
    b.charts[0].sections[0].bars[0].spans[0].durationBeats = 3;
    expect(hasError(b, "barDuration", "evening-loop")).toBe(true);
    const c = clone();
    c.charts[0].sections[0].bars[3].spans[1].startBeat = 3;
    expect(hasError(c, "spanLayout", "evening-loop")).toBe(true);
  });

  it("accepts a pickup bar that matches bar.beats and rejects a mismatched one", () => {
    const b = clone();
    expect(hasError(b, "barDuration", "dorian-drift")).toBe(false);
    b.charts[1].sections[0].bars[0].spans[0].durationBeats = 4;
    expect(hasError(b, "barDuration", "dorian-drift")).toBe(true);
  });

  it("catches a bad performanceOrder", () => {
    const b = clone();
    b.charts[0].performanceOrder = ["A", "C"];
    expect(hasError(b, "performanceOrder", "evening-loop")).toBe(true);
    const c = clone();
    c.charts[0].performanceOrder = [];
    expect(hasError(c, "performanceOrder", "evening-loop")).toBe(true);
  });

  it("catches arrangement explicitNotes keyed by unknown spans", () => {
    const b = clone();
    b.arrangements[0].learnerPart = { kind: "explicit", explicitNotes: { "el-a1-s1": [{ midi: 48 }], "no-span": [{ midi: 50 }] } };
    b.arrangements[0].policy = { kind: "exactVoicing" };
    const keyed = errors(b).filter((i) => i.code === "explicitNotesKey");
    expect(keyed.length).toBe(1);
    expect(keyed[0].message).toContain("no-span");
  });

  it("enforces policy/contract consistency", () => {
    const b = clone();
    const free = b.exerciseSpecs.find((e) => e.id === "ex-dorian-free-improv")!;
    free.contract = "satisfyConstraints";
    expect(hasError(b, "policyContract", "ex-dorian-free-improv")).toBe(true);
    const c = clone();
    const run = c.exerciseSpecs.find((e) => e.id === "ex-c-major-run")!;
    run.policy = { kind: "free" };
    const issues = errors(c).filter((i) => i.code === "policyContract" && i.id === "ex-c-major-run");
    expect(issues.length).toBe(2); // free needs exploreReflect; reproduce forbids free
  });

  it("enforces chart-only arrangements to be free and free arrangements to be chart-only", () => {
    const b = clone();
    const chartOnly = b.arrangements.find((a) => a.id === "evening-loop-chart-only")!;
    chartOnly.policy = { kind: "pitchClass" };
    expect(hasError(b, "policyContract", "evening-loop-chart-only")).toBe(true);
    const c = clone();
    const simple = c.arrangements.find((a) => a.id === "evening-loop-simple")!;
    simple.policy = { kind: "free" };
    expect(hasError(c, "policyContract", "evening-loop-simple")).toBe(true);
  });

  it("catches unsatisfiable answers", () => {
    const b = clone();
    const rootless = b.exerciseSpecs.find((e) => e.id === "ex-ii-v-i-rootless-c")!;
    rootless.policy = { kind: "roles", requiredRoles: ["root", "third"] }; // rootless has no root
    expect(hasError(b, "unsatisfiable", "ex-ii-v-i-rootless-c")).toBe(true);
    const c = clone();
    const inv = c.exerciseSpecs.find((e) => e.id === "ex-c-triad-inversions")!;
    if (inv.material.kind !== "chordSequence") throw new Error("fixture changed");
    delete inv.material.voicingRecipeId; // exact voicing over symbols with no recipe
    expect(hasError(c, "unsatisfiable", "ex-c-triad-inversions")).toBe(true);
  });

  it("requires metadata and review fields", () => {
    const b = clone();
    b.concepts[0].meta.status = "reviewed"; // author present, reviewer missing
    b.exerciseSpecs[0].title = "";
    b.exerciseSpecs[1].version = 0;
    b.charts[0].meta.status = "reviewed";
    b.warmups[0].status = "reviewed";
    b.warmups[0].reviewer = "Some Pianist"; // still reviewed: false
    expect(hasError(b, "reviewMetadata", b.concepts[0].id)).toBe(true);
    expect(hasError(b, "missingMetadata", b.exerciseSpecs[0].id)).toBe(true);
    expect(hasError(b, "missingMetadata", b.exerciseSpecs[1].id)).toBe(true);
    expect(hasError(b, "reviewMetadata", "evening-loop")).toBe(true);
    expect(hasError(b, "reviewMetadata", "wu-five-finger-c")).toBe(true);
  });

  it("checks chord symbol plausibility and melody palettes", () => {
    expect(isPlausibleChordSymbol("Dm9")).toBe(true);
    expect(isPlausibleChordSymbol("G13")).toBe(true);
    expect(isPlausibleChordSymbol("Cmaj9")).toBe(true);
    expect(isPlausibleChordSymbol("Dm7b5")).toBe(true);
    expect(isPlausibleChordSymbol("G/B")).toBe(true);
    expect(isPlausibleChordSymbol("Bbmaj7/F")).toBe(true);
    expect(isPlausibleChordSymbol("H7")).toBe(false);
    expect(isPlausibleChordSymbol("Cxyz")).toBe(false);
    expect(isPlausibleChordSymbol("C/E/G")).toBe(false);
    const b = clone();
    b.melodies[0].palette.push("Q7");
    b.melodies[0].solutions[0].chords[1] = "Bb";
    b.melodies[0].solutions[1].chords.pop();
    const melodyErrors = errors(b).filter((i) => i.id === "mel-four-bar-c");
    expect(melodyErrors.some((i) => i.code === "chordSymbol")).toBe(true);
    expect(melodyErrors.some((i) => i.code === "melody" && i.message.includes("not in the palette"))).toBe(true);
    expect(melodyErrors.some((i) => i.code === "melody" && i.message.includes("harmonic-rhythm slots"))).toBe(true);
  });

  it("checks routine item refIds by kind and chart sections", () => {
    const b = clone();
    const item = b.routines[0].items.find((i) => i.kind === "chart")!;
    item.settings.sectionId = "Z";
    expect(hasError(b, "danglingReference", "routine-starter-15")).toBe(true);
  });

  it("requires a hand-attribution assumption for hand-synchrony feedback", () => {
    const b = clone();
    b.warmups[0].handAttribution = { kind: "none" };
    expect(hasError(b, "unsatisfiable", "wu-five-finger-c")).toBe(true);
  });

  it("requires an onset window for scored timed exercises", () => {
    const b = clone();
    const timed = b.exerciseSpecs.find((e) => e.id === "ex-c-major-run-timed")!;
    timed.timing = { mode: "timed", countInBeats: 4 };
    expect(hasError(b, "timing", "ex-c-major-run-timed")).toBe(true);
  });
});
