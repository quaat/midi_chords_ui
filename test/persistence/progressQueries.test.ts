import { describe, expect, it } from "vitest";
import type { ProgressFile } from "@/model/contracts";
import { createEmptyProgress } from "@/persistence/progress";
import {
  attemptsForExercise,
  difficultTransitions,
  evidenceByConcept,
  lastAttempt,
  scoringVersionNote,
  suggestReview
} from "@/persistence/progressQueries";
import { makeAttempt, makeEvidence, pitchObs, timingObs } from "./helpers";

const cMajor = { tonic: { letter: "C" as const, accidental: 0 as const }, mode: "major" as const };
const fMajor = { tonic: { letter: "F" as const, accidental: 0 as const }, mode: "major" as const };

function progressWith(partial: Partial<ProgressFile>): ProgressFile {
  return { ...createEmptyProgress("2026-11-01T00:00:00.000Z"), ...partial };
}

describe("evidenceByConcept", () => {
  it("keeps read/listened/assisted/independent/transfer distinct per key/tempo/assistance", () => {
    const progress = progressWith({
      evidence: [
        makeEvidence("read", "2026-10-01T00:00:00.000Z", { exerciseId: undefined }),
        makeEvidence("listened", "2026-10-02T00:00:00.000Z", { key: cMajor, tempoBpm: 80, assistance: "full" }),
        makeEvidence("assisted", "2026-10-03T00:00:00.000Z", { key: cMajor, tempoBpm: 80, assistance: "full" }),
        makeEvidence("independent", "2026-10-04T00:00:00.000Z", { key: cMajor, tempoBpm: 80, assistance: "none" }),
        makeEvidence("independent", "2026-10-05T00:00:00.000Z", { key: cMajor, tempoBpm: 80, assistance: "none" }),
        makeEvidence("transfer", "2026-10-06T00:00:00.000Z", { key: fMajor, tempoBpm: 80, assistance: "none" }),
        makeEvidence("read", "2026-10-06T00:00:00.000Z", { conceptId: "shell-voicings", exerciseId: undefined })
      ]
    });
    const summary = evidenceByConcept(progress);
    expect(Object.keys(summary)).toEqual(["ii-V-I", "shell-voicings"]);
    const concept = summary["ii-V-I"];
    expect(Object.keys(concept.kinds).sort()).toEqual(["assisted", "independent", "listened", "read", "transfer"]);
    expect(concept.kinds.independent?.count).toBe(2);
    const combos = Object.fromEntries(concept.combinations.map((combo) => [combo.comboId, combo]));
    expect(combos["C:major|80|full"].best).toBe("assisted");
    expect(Object.keys(combos["C:major|80|full"].kinds).sort()).toEqual(["assisted", "listened"]);
    expect(combos["C:major|80|none"].best).toBe("independent");
    expect(combos["F:major|80|none"].best).toBe("transfer");
    expect(combos["any|-|-"].best).toBe("read");
    expect(concept).not.toHaveProperty("mastery");
    expect(concept.lastAt).toBe("2026-10-06T00:00:00.000Z");
  });
});

describe("attempt queries", () => {
  const progress = progressWith({
    attempts: [
      makeAttempt("b", { startedAt: "2026-11-02T10:00:00.000Z", completedAt: "2026-11-02T10:05:00.000Z" }),
      makeAttempt("a", { startedAt: "2026-11-01T10:00:00.000Z" }),
      makeAttempt("other", { exerciseId: "ex-other", startedAt: "2026-11-03T10:00:00.000Z", completedAt: "2026-11-03T10:05:00.000Z" })
    ]
  });

  it("attemptsForExercise and lastAttempt", () => {
    expect(attemptsForExercise(progress, "ex-251").map((attempt) => attempt.id)).toEqual(["a", "b"]);
    expect(lastAttempt(progress, "ex-251")?.id).toBe("b");
    expect(lastAttempt(progress)?.id).toBe("other");
    expect(lastAttempt(progress, "unknown")).toBeUndefined();
  });

  it("scoringVersionNote reports changed scoring without rewriting the attempt", () => {
    const attempt = makeAttempt("a", { scoringVersion: "1.0.0" });
    const same = scoringVersionNote(attempt, "1.0.0");
    expect(same.changed).toBe(false);
    const changed = scoringVersionNote(attempt, "2.0.0");
    expect(changed.changed).toBe(true);
    expect(changed.text).toMatch(/1\.0\.0.*2\.0\.0.*originally recorded/);
    expect(attempt.scoringVersion).toBe("1.0.0");
    expect(scoringVersionNote(attempt).changed).toBe(false);
  });
});

describe("difficultTransitions", () => {
  it("ranks occurrences by pitch and timing misses", () => {
    const progress = progressWith({
      attempts: [
        makeAttempt("a1", {
          pitch: [pitchObs("occ-dm9", false, ["seventh"], [72]), pitchObs("occ-g13", true)],
          timing: [timingObs("occ-g13", "late"), timingObs("occ-dm9", "onTime")],
          summary: { stepsCompleted: 3, stepsTotal: 3, difficultOccurrenceIds: ["occ-dm9"] }
        }),
        makeAttempt("a2", {
          startedAt: "2026-11-02T10:00:00.000Z",
          completedAt: "2026-11-02T10:05:00.000Z",
          pitch: [pitchObs("occ-dm9", false, ["seventh", "third"], [72, 65])]
        })
      ]
    });
    const rows = difficultTransitions(progress);
    expect(rows.map((row) => row.occurrenceId)).toEqual(["occ-dm9", "occ-g13"]);
    expect(rows[0]).toMatchObject({ pitchMisses: 3, timingMisses: 0, flagged: 1, attemptCount: 2, missingRoles: { seventh: 2, third: 1 } });
    expect(rows[1]).toMatchObject({ pitchMisses: 0, timingMisses: 1 });
    expect(difficultTransitions(progress, { limit: 1 })).toHaveLength(1);
    expect(difficultTransitions(progress, { exerciseId: "none" })).toEqual([]);
  });
});

describe("suggestReview", () => {
  const now = "2026-11-10T12:00:00.000Z";
  const describeOccurrence = (_exerciseId: string, occurrenceId: string) => (occurrenceId === "occ-dm9" ? "Dm9" : undefined);

  const progress = progressWith({
    attempts: [
      makeAttempt("a1", {
        startedAt: "2026-11-01T10:00:00.000Z",
        completedAt: "2026-11-01T10:05:00.000Z",
        pitch: [pitchObs("occ-dm9", false, ["seventh"]), pitchObs("occ-dm9", false, ["seventh"])]
      }),
      makeAttempt("a2", { exerciseId: "ex-shells", startedAt: "2026-11-09T10:00:00.000Z", completedAt: "2026-11-09T10:01:00.000Z" })
    ],
    evidence: [
      makeEvidence("independent", "2026-11-01T10:05:00.000Z", { attemptId: "a1" }),
      makeEvidence("assisted", "2026-11-09T10:01:00.000Z", { exerciseId: "ex-shells", conceptId: "shell-voicings" }),
      makeEvidence("independent", "2026-11-09T11:00:00.000Z", { exerciseId: "ex-recent", conceptId: "blues" })
    ]
  });
  const candidates = [
    { exerciseId: "ex-new", conceptId: "quartal" },
    { exerciseId: "ex-recent", conceptId: "blues" },
    { exerciseId: "ex-shells", conceptId: "shell-voicings" },
    { exerciseId: "ex-251", conceptId: "ii-V-I" }
  ];

  it("returns transparent reasons in a deterministic order", () => {
    const suggestions = suggestReview(progress, now, candidates, { describeOccurrence });
    expect(suggestions.map((s) => s.exerciseId)).toEqual(["ex-251", "ex-recent", "ex-shells", "ex-new"]);
    for (const suggestion of suggestions) expect(typeof suggestion.reason).toBe("string");
    expect(suggestions[0].reason).toBe("Last independent attempt 9 days ago, 2 missed sevenths in Dm9 (review interval 1 day)");
    expect(suggestions[0].kind).toBe("review");
    expect(suggestions[1]).toMatchObject({ kind: "review", intervalDays: 1, daysSinceLast: 1, due: true });
    expect(suggestions[2].kind).toBe("consolidate");
    expect(suggestions[2].reason).toMatch(/assisted practice 1 day ago but not yet played independently/);
    expect(suggestions[3]).toMatchObject({ kind: "new", reason: "Not practised yet" });
    expect(suggestReview(progress, now, candidates.slice().reverse(), { describeOccurrence })).toEqual(suggestions);
  });

  it("uses the 1/3/7/14 day spaced intervals and hides not-yet-due reviews by default", () => {
    const spaced = progressWith({
      evidence: [
        makeEvidence("independent", "2026-11-01T10:00:00.000Z"),
        makeEvidence("independent", "2026-11-02T10:00:00.000Z"),
        makeEvidence("transfer", "2026-11-03T10:00:00.000Z", { key: fMajor })
      ]
    });
    const candidate = [{ exerciseId: "ex-251", conceptId: "ii-V-I" }];
    expect(suggestReview(spaced, "2026-11-05T10:00:00.000Z", candidate)).toEqual([]);
    const notDue = suggestReview(spaced, "2026-11-05T10:00:00.000Z", candidate, { includeNotDue: true });
    expect(notDue[0]).toMatchObject({ due: false, intervalDays: 7, lastEvidenceKind: "transfer" });
    expect(notDue[0].reason).toMatch(/next review in 5 days/);
    const due = suggestReview(spaced, "2026-11-10T10:00:00.000Z", candidate);
    expect(due[0]).toMatchObject({ due: true, intervalDays: 7, daysSinceLast: 7 });
    expect(due[0].reason).toMatch(/^Last transfer attempt 7 days ago/);
  });

  it("resets the interval when a later attempt had misses", () => {
    const lapsed = progressWith({
      evidence: [
        makeEvidence("independent", "2026-11-01T10:00:00.000Z"),
        makeEvidence("independent", "2026-11-02T10:00:00.000Z"),
        makeEvidence("independent", "2026-11-03T10:00:00.000Z")
      ],
      attempts: [makeAttempt("late", { startedAt: "2026-11-04T10:00:00.000Z", completedAt: "2026-11-04T10:01:00.000Z", pitch: [pitchObs("occ-g13", false, [], [71])] })]
    });
    const result = suggestReview(lapsed, "2026-11-04T12:00:00.000Z", [{ exerciseId: "ex-251", conceptId: "ii-V-I" }]);
    expect(result[0]).toMatchObject({ intervalDays: 1, due: true });
    expect(result[0].reason).toMatch(/1 wrong or missing note in occ-g13; a later attempt had misses/);
  });
});
