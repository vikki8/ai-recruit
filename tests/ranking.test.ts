import { describe, expect, it } from "vitest";
import {
  rankCandidates,
  summariseCandidate,
  type CandidateLike,
  type EvaluationLike,
  type RequirementLike,
} from "@/lib/ranking";

const requirements: RequirementLike[] = [
  { id: "m1", text: "Backend ownership", kind: "must_have" },
  { id: "m2", text: "TypeScript", kind: "must_have" },
  { id: "n1", text: "Kubernetes", kind: "nice_to_have" },
  { id: "n2", text: "Mentoring", kind: "nice_to_have" },
];

const alice: CandidateLike = { id: "a", name: "Alice" };
const bob: CandidateLike = { id: "b", name: "Bob" };
const cara: CandidateLike = { id: "c", name: "Cara" };

function evals(
  candidateId: string,
  verdicts: Record<string, EvaluationLike["verdict"]>,
): EvaluationLike[] {
  return Object.entries(verdicts).map(([requirementId, verdict]) => ({
    candidateId,
    requirementId,
    verdict,
  }));
}

describe("summariseCandidate", () => {
  it("disqualifies a candidate with a missing must-have and names it", () => {
    const standing = summariseCandidate(
      alice,
      requirements,
      evals("a", { m1: "met", m2: "missing", n1: "met", n2: "met" }),
    );

    expect(standing.disqualified).toBe(true);
    expect(standing.missingMustHaveIds).toEqual(["m2"]);
  });

  it("does NOT disqualify a partial must-have, but records it for the UI", () => {
    const standing = summariseCandidate(
      alice,
      requirements,
      evals("a", { m1: "met", m2: "partial", n1: "met", n2: "met" }),
    );

    expect(standing.disqualified).toBe(false);
    expect(standing.partialMustHaveIds).toEqual(["m2"]);
    expect(standing.mustPartial).toBe(1);
  });

  it("treats a requirement with no evaluation as missing", () => {
    const standing = summariseCandidate(alice, requirements, evals("a", { m1: "met" }));

    expect(standing.mustMissing).toBe(1);
    expect(standing.missingMustHaveIds).toEqual(["m2"]);
    expect(standing.niceMissing).toBe(2);
    expect(standing.disqualified).toBe(true);
  });

  it("ignores evaluations belonging to another candidate", () => {
    const standing = summariseCandidate(
      alice,
      requirements,
      evals("b", { m1: "met", m2: "met", n1: "met", n2: "met" }),
    );

    expect(standing.mustMet).toBe(0);
    expect(standing.disqualified).toBe(true);
  });

  it("handles a candidate matching zero requirements", () => {
    const standing = summariseCandidate(
      alice,
      requirements,
      evals("a", { m1: "missing", m2: "missing", n1: "missing", n2: "missing" }),
    );

    expect(standing.mustMet).toBe(0);
    expect(standing.niceMet).toBe(0);
    expect(standing.disqualified).toBe(true);
    expect(standing.missingMustHaveIds).toEqual(["m1", "m2"]);
  });

  it("qualifies everyone when the job has no requirements at all", () => {
    const standing = summariseCandidate(alice, [], []);

    expect(standing.disqualified).toBe(false);
    expect(standing.mustMet).toBe(0);
  });
});

describe("rankCandidates", () => {
  it("puts qualified candidates ahead of disqualified ones regardless of counts", () => {
    const ranked = rankCandidates(
      requirements,
      [alice, bob],
      [
        // Alice fails one must-have but sweeps every nice-to-have.
        ...evals("a", { m1: "met", m2: "missing", n1: "met", n2: "met" }),
        // Bob scrapes the must-haves and nothing else.
        ...evals("b", { m1: "met", m2: "met", n1: "missing", n2: "missing" }),
      ],
    );

    expect(ranked.map((r) => r.name)).toEqual(["Bob", "Alice"]);
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].rank).toBeNull();
  });

  it("breaks a must-have tie on nice-to-haves met", () => {
    const ranked = rankCandidates(
      requirements,
      [alice, bob],
      [
        ...evals("a", { m1: "met", m2: "met", n1: "missing", n2: "missing" }),
        ...evals("b", { m1: "met", m2: "met", n1: "met", n2: "missing" }),
      ],
    );

    expect(ranked.map((r) => r.name)).toEqual(["Bob", "Alice"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2]);
  });

  it("breaks a remaining tie on partials before falling back to name", () => {
    const ranked = rankCandidates(
      requirements,
      [alice, bob],
      [
        ...evals("a", { m1: "met", m2: "met", n1: "missing", n2: "missing" }),
        ...evals("b", { m1: "met", m2: "partial", n1: "missing", n2: "missing" }),
      ],
    );

    // Alice has two must-haves met, Bob only one, so Alice leads on the first key.
    expect(ranked.map((r) => r.name)).toEqual(["Alice", "Bob"]);
  });

  it("is deterministic on a complete tie, ordering by name", () => {
    const identical = { m1: "met", m2: "met", n1: "met", n2: "met" } as const;
    const ranked = rankCandidates(
      requirements,
      [cara, bob, alice],
      [...evals("c", identical), ...evals("b", identical), ...evals("a", identical)],
    );

    expect(ranked.map((r) => r.name)).toEqual(["Alice", "Bob", "Cara"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("numbers ranks over shortlisted candidates only, skipping the disqualified", () => {
    const ranked = rankCandidates(
      requirements,
      [alice, bob, cara],
      [
        ...evals("a", { m1: "met", m2: "met", n1: "met", n2: "met" }),
        ...evals("b", { m1: "met", m2: "missing", n1: "met", n2: "met" }),
        ...evals("c", { m1: "met", m2: "met", n1: "met", n2: "missing" }),
      ],
    );

    expect(ranked.map((r) => [r.name, r.rank])).toEqual([
      ["Alice", 1],
      ["Cara", 2],
      ["Bob", null],
    ]);
  });

  it("returns an empty list when there are no candidates", () => {
    expect(rankCandidates(requirements, [], [])).toEqual([]);
  });
});
