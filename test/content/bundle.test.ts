import { describe, expect, it } from "vitest";
import {
  buildManifest,
  contentBundle,
  contentManifest,
  formatIssue,
  getArrangement,
  getChart,
  getConcept,
  getExerciseSpec,
  getPath,
  getPlayable,
  getRoutine,
  publishedOnly,
  validateContent,
  KNOWN_VOICING_RECIPE_IDS,
} from "@/content";
import type { ValidationIssue } from "@/content";
import type { Demand } from "@/model/contracts";

describe("shipped content bundle", () => {
  it("validates with zero errors (warnings are printed)", () => {
    const issues = validateContent(contentBundle);
    const warnings = issues.filter((i: ValidationIssue) => i.severity === "warning");
    const errs = issues.filter((i: ValidationIssue) => i.severity === "error");
    console.log(`content validation: ${errs.length} error(s), ${warnings.length} warning(s)`);
    for (const w of warnings) console.log(`  ${formatIssue(w)}`);
    for (const e of errs) console.log(`  ${formatIssue(e)}`);
    expect(errs).toEqual([]);
  });

  it("ships the minimum first-release set", () => {
    expect(contentBundle.concepts.length).toBeGreaterThanOrEqual(30);
    expect(contentBundle.exerciseSpecs.length).toBeGreaterThanOrEqual(20);
    expect(contentBundle.charts.map((c) => c.id)).toEqual(["evening-loop", "dorian-drift"]);
    expect(contentBundle.warmups.length).toBe(3);
    expect(contentBundle.melodies.length).toBe(1);
    expect(contentBundle.melodies[0].solutions.length).toBeGreaterThanOrEqual(2);
    expect(contentBundle.routines.map((r) => r.title)).toEqual(["Starter routine (15 min)"]);
  });

  // Nothing has had pianist/teacher review yet (plan §7, E16, E21): the manifest must not
  // claim "reviewed" status for any unit, so the UI flags every unit as a draft until a
  // named reviewer signs it off and the item's meta.reviewer is filled in.
  it("manifest contains no reviewed items", () => {
    expect(contentManifest.reviewed).toEqual([]);
    expect(contentManifest.draft.length).toBeGreaterThan(0);
    expect(contentManifest.draft).toContain("exercise:ex-ii-v-i-rootless-c");
    expect(contentManifest.deferred).toContain("concept:drop2-voicings");
    expect(contentManifest.entries.length).toBe(
      contentManifest.reviewed.length + contentManifest.draft.length + contentManifest.unavailable.length + contentManifest.deferred.length,
    );
  });

  it("publishedOnly excludes deferred/unavailable items and leaves no dangling references", () => {
    const published = publishedOnly(contentBundle);
    const manifest = buildManifest(published);
    expect(manifest.deferred).toEqual([]);
    expect(manifest.unavailable).toEqual([]);
    expect(published.concepts.some((c) => c.id === "drop2-voicings")).toBe(false);
    const errs = validateContent(published).filter((i: ValidationIssue) => i.severity === "error");
    expect(errs).toEqual([]);
  });

  it("every path's units resolve and form read → play → apply journeys for all three entries", () => {
    const entries: Demand[] = [];
    for (const path of contentBundle.paths) {
      entries.push(path.entry);
      for (const unit of path.units) {
        const found =
          unit.kind === "concept" ? getConcept(unit.id) : unit.kind === "exercise" ? getExerciseSpec(unit.id) : unit.kind === "chart" ? getChart(unit.id) : getRoutine(unit.id);
        expect(found).toBeDefined();
      }
      const kinds = new Set(path.units.map((u) => u.kind));
      expect(kinds.has("concept")).toBe(true); // read (+ listen to the concept's examples)
      expect(kinds.has("exercise")).toBe(true); // play
      expect(kinds.has("chart") || kinds.has("routine")).toBe(true); // apply
      // vary: at least one exercise in the path is a variant/transfer or offers transfer keys
      const varied = path.units.some((u) => {
        const e = u.kind === "exercise" ? getExerciseSpec(u.id) : undefined;
        return e !== undefined && (e.variantOf !== undefined || (e.transferKeys ?? []).length > 0);
      });
      expect(varied).toBe(true);
      // listen: every concept in the path has an audible example
      for (const u of path.units) if (u.kind === "concept") expect(getConcept(u.id)!.examples.length).toBeGreaterThan(0);
    }
    expect(entries.sort()).toEqual(["advanced", "beginner", "intermediate"]);
    expect(getPath("path-voicing-sampler")!.description).toContain("not a complete course");
  });

  it("every concept exercise id resolves to an exercise or warm-up", () => {
    for (const concept of contentBundle.concepts) for (const id of concept.exerciseIds) expect(getPlayable(id)).toBeDefined();
  });

  it("charts and arrangements match the plan", () => {
    const evening = getChart("evening-loop")!;
    expect(evening.performanceOrder).toEqual(["A", "A", "B", "A"]);
    expect(evening.sections.map((s) => s.bars.length)).toEqual([4, 4]);
    const spans = evening.sections.flatMap((s) => s.bars.flatMap((b) => b.spans));
    expect(evening.sections.some((s) => s.bars.some((b) => b.spans.length === 2))).toBe(true);
    expect(spans.some((s) => s.symbol.includes("/"))).toBe(true);
    expect(getArrangement("evening-loop-simple")!.learnerPart.kind).toBe("roots");
    expect(getArrangement("evening-loop-simple")!.policy.kind).toBe("pitchClass");
    expect(getArrangement("evening-loop-richer")!.learnerPart.voicingRecipeId).toBe("close-triads-rh");
    expect(getArrangement("evening-loop-richer")!.accompaniment.pattern).toBe("bassAndChord");
    expect(getArrangement("evening-loop-richer")!.policy.kind).toBe("roles");
    expect(getArrangement("evening-loop-chart-only")!.policy.kind).toBe("free");

    const drift = getChart("dorian-drift")!;
    expect(drift.pickupBeats).toBe(2);
    expect(drift.sections.find((s) => s.id === "pickup")!.bars[0].beats).toBe(2);
    expect(drift.sections.find((s) => s.id === "A")!.bars.length).toBe(8);
    expect(drift.performanceOrder.filter((s) => s === "A")).toEqual(["A", "A"]);
    expect(getArrangement("dorian-drift-simple")!.learnerPart.kind).toBe("blockTriads");
    expect(getArrangement("dorian-drift-chart-only")!.policy.kind).toBe("free");
    for (const chart of contentBundle.charts) expect(chart.provenance.origin).toBe("original");
  });

  it("only references voicing recipes in the published recipe list", () => {
    const used = new Set<string>();
    for (const e of contentBundle.exerciseSpecs) if (e.material.kind === "chordSequence" && e.material.voicingRecipeId) used.add(e.material.voicingRecipeId);
    for (const a of contentBundle.arrangements) if (a.learnerPart.voicingRecipeId) used.add(a.learnerPart.voicingRecipeId);
    for (const id of used) expect(KNOWN_VOICING_RECIPE_IDS).toContain(id);
  });

  it("the starter routine runs warm-up → scale → harmony → song section", () => {
    const routine = getRoutine("routine-starter-15")!;
    expect(routine.items.map((i) => `${i.kind}:${i.refId}`)).toEqual([
      "warmup:wu-five-finger-c",
      "exercise:ex-c-major-run",
      "exercise:ex-ii-v-i-shells-c",
      "chart:evening-loop",
    ]);
    expect(routine.items[3].settings.sectionId).toBe("A");
    const total = routine.items.reduce((sum, i) => sum + (i.settings.durationTargetSec ?? 0), 0);
    expect(total).toBe(15 * 60);
    for (const item of routine.items) {
      expect(item.settings.tempoBpm).toBeGreaterThan(0);
      expect(item.settings.hand).toBeDefined();
      expect(item.settings.repeats).toBeGreaterThan(0);
      expect(item.settings.assistance).toBeDefined();
    }
  });

  it("warm-ups separate authored guidance from measured observations and are unreviewed", () => {
    for (const w of contentBundle.warmups) {
      expect(w.reviewed).toBe(false);
      expect(w.guidance.kind).toBe("authoredGuidance");
      expect(w.guidance.text[0]).toContain("Authored guidance, not measured");
      expect(w.steps.every((s) => s.notes.every((n) => n.finger === undefined))).toBe(true);
    }
  });
});
