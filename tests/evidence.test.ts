import { describe, expect, it } from "vitest";
import {
  findVerbatimSpan,
  validateEvaluations,
  type ModelResult,
  type RequirementRef,
} from "@/lib/evidence";

const CV = [
  "Priya Raman",
  "Senior Backend Engineer",
  "",
  "Monzo (2019-2023)",
  "Led the payments platform rebuild, owning the service end to end.",
  "Deployed services to ECS and Fargate on a weekly release cadence.",
  "Mentored four junior engineers through to promotion.",
].join("\n");

const reqs: RequirementRef[] = [
  { id: "uuid-1", handle: "r1", text: "Backend ownership", kind: "must_have" },
  { id: "uuid-2", handle: "r2", text: "Kubernetes", kind: "nice_to_have" },
];

function results(...items: Partial<ModelResult>[]): ModelResult[] {
  return items.map((item, i) => ({
    id: `r${i + 1}`,
    verdict: "met",
    evidence: null,
    reasoning: "",
    ...item,
  }));
}

describe("findVerbatimSpan", () => {
  it("finds an exact quote and returns the span from the CV", () => {
    expect(findVerbatimSpan(CV, "Deployed services to ECS and Fargate")).toBe(
      "Deployed services to ECS and Fargate",
    );
  });

  it("matches across a line break the model collapsed into a space", () => {
    const span = findVerbatimSpan(CV, "the service end to end. Deployed services to ECS");
    expect(span).toBe("the service end to end.\nDeployed services to ECS");
  });

  it("matches when the model swapped in curly quotes and an em dash", () => {
    const cv = "Built the team’s CI pipeline — cutting build times in half.";
    expect(findVerbatimSpan(cv, "Built the team's CI pipeline - cutting build times")).toBe(
      "Built the team’s CI pipeline — cutting build times",
    );
  });

  it("matches regardless of case", () => {
    expect(findVerbatimSpan(CV, "MENTORED FOUR JUNIOR ENGINEERS")).toBe(
      "Mentored four junior engineers",
    );
  });

  it("returns null when the quote is absent", () => {
    expect(findVerbatimSpan(CV, "Built distributed systems in Rust")).toBeNull();
  });

  it("returns null for an empty or whitespace-only quote", () => {
    expect(findVerbatimSpan(CV, "")).toBeNull();
    expect(findVerbatimSpan(CV, "   \n  ")).toBeNull();
  });
});

describe("validateEvaluations", () => {
  it("keeps a met verdict backed by a real quote, storing the CV span", () => {
    const [first] = validateEvaluations(
      CV,
      [reqs[0]],
      results({ verdict: "met", evidence: "led the payments platform rebuild" }),
    );

    expect(first.verdict).toBe("met");
    expect(first.evidence).toBe("Led the payments platform rebuild");
    expect(first.downgradeReason).toBeNull();
  });

  it("keeps a partial verdict backed by a real quote", () => {
    const [first] = validateEvaluations(
      CV,
      [reqs[0]],
      results({ verdict: "partial", evidence: "Deployed services to ECS and Fargate" }),
    );

    expect(first.verdict).toBe("partial");
    expect(first.evidence).toBe("Deployed services to ECS and Fargate");
  });

  it("downgrades a met verdict whose quote is not in the CV", () => {
    const [first] = validateEvaluations(
      CV,
      [reqs[0]],
      results({ verdict: "met", evidence: "Ran a Kubernetes cluster in production" }),
    );

    expect(first.verdict).toBe("missing");
    expect(first.evidence).toBeNull();
    expect(first.downgradeReason).toBe("quote_not_found");
  });

  it("downgrades a met verdict with no quote at all", () => {
    const [first] = validateEvaluations(CV, [reqs[0]], results({ verdict: "met", evidence: null }));

    expect(first.verdict).toBe("missing");
    expect(first.downgradeReason).toBe("no_evidence");
  });

  it("downgrades a met verdict whose quote is only whitespace", () => {
    const [first] = validateEvaluations(
      CV,
      [reqs[0]],
      results({ verdict: "met", evidence: "   " }),
    );

    expect(first.verdict).toBe("missing");
    expect(first.downgradeReason).toBe("no_evidence");
  });

  it("downgrades a verdict the model invented", () => {
    const [first] = validateEvaluations(
      CV,
      [reqs[0]],
      results({ verdict: "strong", evidence: "Led the payments platform rebuild" }),
    );

    expect(first.verdict).toBe("missing");
    expect(first.downgradeReason).toBe("bad_verdict");
  });

  it("records a requirement the model skipped entirely as missing", () => {
    const out = validateEvaluations(
      CV,
      reqs,
      results({ verdict: "met", evidence: "Led the payments platform rebuild" }),
    );

    expect(out).toHaveLength(2);
    expect(out[1].verdict).toBe("missing");
    expect(out[1].downgradeReason).toBe("no_result");
  });

  it("strips evidence the model attached to a missing verdict", () => {
    const [first] = validateEvaluations(
      CV,
      [reqs[0]],
      results({ verdict: "missing", evidence: "Led the payments platform rebuild" }),
    );

    expect(first.verdict).toBe("missing");
    expect(first.evidence).toBeNull();
    expect(first.downgradeReason).toBeNull();
  });

  it("drops results for ids that were never asked about", () => {
    const out = validateEvaluations(CV, [reqs[0]], [
      { id: "r1", verdict: "met", evidence: "Mentored four junior engineers", reasoning: "" },
      { id: "r99", verdict: "met", evidence: "Mentored four junior engineers", reasoning: "" },
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].requirementId).toBe("uuid-1");
  });

  it("returns one row per requirement, in requirement order", () => {
    const out = validateEvaluations(CV, reqs, []);
    expect(out.map((r) => r.requirementId)).toEqual(["uuid-1", "uuid-2"]);
  });
});
