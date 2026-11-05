import { describe, expect, it } from "vitest";
import { chartsForConcept, conceptsForChart, glossary, searchContent } from "@/content";
import { findGlossaryTerm } from "@/content/glossary";

describe("searchContent", () => {
  it("finds dorian content case-insensitively", () => {
    const results = searchContent("DORIAN");
    const ids = results.map((r) => r.id);
    expect(ids).toContain("dorian-mode");
    expect(ids).toContain("ex-d-dorian-run");
    expect(ids).toContain("dorian-drift");
    expect(results[0].id).toBe("dorian-mode");
  });

  it("filters by demand", () => {
    const beginner = searchContent("dorian", { demand: "beginner" });
    expect(beginner.map((r) => r.id)).not.toContain("dorian-mode");
    const intermediate = searchContent("dorian", { demand: "intermediate" });
    expect(intermediate.map((r) => r.id)).toContain("dorian-mode");
    for (const r of intermediate) expect(r.demand).toContain("intermediate");
  });

  it("filters by strand and kind", () => {
    const results = searchContent("", { strand: "technique", kinds: ["concept"] });
    expect(results.map((r) => r.id).sort()).toEqual(["articulation-dynamics", "contrary-motion", "five-finger-warmup"]);
  });

  it("matches tags and glossary terms", () => {
    expect(searchContent("half-diminished").map((r) => r.id)).toContain("seventh-chords");
    expect(searchContent("passing tone").map((r) => r.id)).toContain("harmonising-melody");
  });

  it("excludes deferred content by default and flags drafts", () => {
    expect(searchContent("drop").map((r) => r.id)).not.toContain("drop2-voicings");
    expect(searchContent("drop", { status: "deferred" }).map((r) => r.id)).toEqual(["drop2-voicings"]);
    for (const r of searchContent("triad")) expect(r.status).toBe("draft");
  });

  it("filters by available input", () => {
    const none = searchContent("dorian", { inputAvailable: "none" });
    const noneIds = none.map((r) => r.id);
    expect(noneIds).toContain("dorian-mode");
    expect(noneIds).toContain("ex-dorian-vs-minor-listen");
    expect(noneIds).not.toContain("ex-d-dorian-run");
    const keyboard = searchContent("shells", { inputAvailable: "computerKeyboard", kinds: ["exercise"] }).map((r) => r.id);
    expect(keyboard).toContain("ex-ii-v-i-shells-c");
    expect(keyboard).not.toContain("ex-ii-v-i-shells-c-timed"); // timed chords are MIDI-only by default
  });
});

describe("navigation and glossary", () => {
  it("links charts and concepts both ways", () => {
    expect(conceptsForChart("dorian-drift").map((c) => c.id)).toContain("dorian-mode");
    expect(conceptsForChart("evening-loop").map((c) => c.id)).toContain("slash-chords");
    expect(chartsForConcept("modal-vamp").map((c) => c.id)).toEqual(["dorian-drift"]);
    expect(chartsForConcept("rootless-voicings").map((c) => c.id)).toEqual(["evening-loop"]);
  });

  it("aggregates glossary terms from concepts", () => {
    const entry = findGlossaryTerm(glossary, "dorian");
    expect(entry).toBeDefined();
    expect(entry!.conceptIds).toContain("dorian-mode");
    const terms = glossary.map((g) => g.term.toLowerCase());
    expect(new Set(terms).size).toBe(terms.length);
    expect(glossary.length).toBeGreaterThan(40);
  });
});
