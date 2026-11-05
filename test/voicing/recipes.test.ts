import { describe, expect, it } from "vitest";
import { VOICING_RECIPES, getRecipe, registerCentre, recipeIds, resolveRecipeId } from "@/voicing/recipes";

const REQUIRED_IDS = ["close-rp", "close-triads-rh", "close-sevenths-rh", "open", "shell-137", "shell-137-rh", "guide-tones-37", "rootless-a", "rootless-b"];

describe("voicing recipe catalogue", () => {
  it("contains every recipe id other modules reference, once each", () => {
    const ids = recipeIds();
    REQUIRED_IDS.forEach((id) => expect(ids).toContain(id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resolves the legacy guide-tones alias and rejects unknown ids", () => {
    expect(resolveRecipeId("guide-tones")).toBe("guide-tones-37");
    const alias = getRecipe("guide-tones");
    expect(alias ? alias.id : "").toBe("guide-tones-37");
    expect(getRecipe("drop-2-someday")).toBeUndefined();
  });

  it("declares qualities, roles, hand, note count, register and context for every recipe", () => {
    VOICING_RECIPES.forEach((recipe) => {
      expect(recipe.supportedQualities.length).toBeGreaterThan(0);
      expect(recipe.requiredRoles.length).toBeGreaterThan(0);
      expect(recipe.noteCount.min).toBeLessThanOrEqual(recipe.noteCount.max);
      expect(recipe.register.low).toBeLessThan(recipe.register.high);
      expect(["left", "right", "either", "both"]).toContain(recipe.hand);
      expect(recipe.reviewed).toBe(false);
      expect((recipe.context ?? []).length).toBeGreaterThan(0);
      expect(recipe.description.length).toBeGreaterThan(10);
    });
  });

  it("keeps shells, guide tones, rootless and close recipes within one octave", () => {
    VOICING_RECIPES.filter((recipe) => recipe.family !== "open").forEach((recipe) => {
      expect(recipe.maxSpanSemitones ?? 99).toBeLessThanOrEqual(12);
    });
  });

  it("uses the briefed registers, hands and accompaniment flags", () => {
    const expectations: Array<[string, number, number, string, boolean]> = [
      ["close-rp", 55, 84, "right", false],
      ["close-triads-rh", 60, 84, "right", true],
      ["close-sevenths-rh", 55, 84, "right", true],
      ["open", 40, 84, "both", false],
      ["shell-137", 43, 67, "left", false],
      ["shell-137-rh", 55, 79, "right", true],
      ["guide-tones-37", 52, 72, "either", true],
      ["rootless-a", 52, 72, "left", true],
      ["rootless-b", 52, 72, "left", true]
    ];
    expectations.forEach(([id, low, high, hand, bass]) => {
      const recipe = getRecipe(id);
      expect(recipe).toBeDefined();
      if (!recipe) {
        return;
      }
      expect(recipe.register).toEqual({ low, high });
      expect(recipe.hand).toBe(hand);
      expect(recipe.accompanimentBass).toBe(bass);
    });
  });

  it("documents omissions: shells omit the fifth, rootless omits the root", () => {
    const shell = getRecipe("shell-137");
    const rootless = getRecipe("rootless-a");
    expect(shell ? shell.omittedRoles : []).toContain("fifth");
    expect(rootless ? rootless.omittedRoles : []).toEqual(["root"]);
    expect(rootless ? rootless.supportedQualities : []).toContain("min9");
    expect(rootless ? rootless.supportedQualities : []).toContain("dom13");
  });

  it("explains that rootless A/B naming varies between traditions", () => {
    ["rootless-a", "rootless-b"].forEach((id) => {
      const recipe = getRecipe(id);
      expect(recipe ? recipe.teachingNotes ?? "" : "").toMatch(/naming varies between teaching traditions/);
    });
  });

  it("uses the register midpoint as centre unless overridden", () => {
    const rootless = getRecipe("rootless-a");
    const triads = getRecipe("close-triads-rh");
    expect(rootless ? registerCentre(rootless) : 0).toBe(62);
    expect(triads ? registerCentre(triads) : 0).toBe(64);
  });
});
