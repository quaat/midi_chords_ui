import { describe, expect, it } from "vitest";
import { parseChordSequence } from "@/parser/parseChordSequence";

describe("parseChordSequence", () => {
  it("parses valid lines and ignores comments/blank lines", () => {
    const input = `# comment\n\nCmaj7\nNC | 0.5\nG7/B | 2`;
    const parsed = parseChordSequence(input, 1);

    expect(parsed.errors).toHaveLength(0);
    expect(parsed.events).toHaveLength(3);
    expect(parsed.events[0].chordSymbol).toBe("Cmaj7");
    expect(parsed.events[1].isRest).toBe(true);
    expect(parsed.events[1].durationMeasures).toBe(0.5);
    expect(parsed.events[2].durationMeasures).toBe(2);
  });

  it("reports line-level errors", () => {
    const input = `Cmaj7 |\nDmaj7 || 1\nHmaj7`;
    const parsed = parseChordSequence(input, 1);

    expect(parsed.errors).toHaveLength(3);
    expect(parsed.errors[0].line).toBe(1);
    expect(parsed.errors[1].line).toBe(2);
    expect(parsed.errors[2].line).toBe(3);
  });
});
