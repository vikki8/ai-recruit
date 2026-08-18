import { RequirementKind, Verdict } from "./schemas";

/**
 * Ranking. Pure, deterministic, and the model is never consulted here.
 *
 * The model's only job is deciding whether a single requirement is evidenced. Counting,
 * disqualifying, ordering and tie-breaking all happen in this file, which is why the
 * outcome is reproducible and explainable.
 */

export type RequirementLike = {
  id: string;
  text: string;
  kind: RequirementKind;
};

export type CandidateLike = {
  id: string;
  name: string;
};

export type EvaluationLike = {
  candidateId: string;
  requirementId: string;
  verdict: Verdict;
};

export type Standing = {
  candidateId: string;
  name: string;
  mustMet: number;
  mustPartial: number;
  mustMissing: number;
  niceMet: number;
  nicePartial: number;
  niceMissing: number;
  /** Must-haves with no evidence at all. Any entry here disqualifies. */
  missingMustHaveIds: string[];
  /** Must-haves evidenced only partially. Surfaced in the UI, does NOT disqualify. */
  partialMustHaveIds: string[];
  disqualified: boolean;
  /** 1-based position among shortlisted candidates; null when disqualified. */
  rank: number | null;
};

function verdictFor(
  evaluations: Map<string, Verdict>,
  requirementId: string,
): Verdict {
  // A requirement with no stored evaluation counts as missing. Absence of evidence is
  // never silently treated as a pass.
  return evaluations.get(requirementId) ?? "missing";
}

export function summariseCandidate(
  candidate: CandidateLike,
  requirements: RequirementLike[],
  evaluations: EvaluationLike[],
): Standing {
  const mine = new Map<string, Verdict>();
  for (const e of evaluations) {
    if (e.candidateId === candidate.id) mine.set(e.requirementId, e.verdict);
  }

  const standing: Standing = {
    candidateId: candidate.id,
    name: candidate.name,
    mustMet: 0,
    mustPartial: 0,
    mustMissing: 0,
    niceMet: 0,
    nicePartial: 0,
    niceMissing: 0,
    missingMustHaveIds: [],
    partialMustHaveIds: [],
    disqualified: false,
    rank: null,
  };

  for (const req of requirements) {
    const verdict = verdictFor(mine, req.id);
    const must = req.kind === "must_have";

    if (verdict === "met") {
      if (must) standing.mustMet++;
      else standing.niceMet++;
    } else if (verdict === "partial") {
      if (must) {
        standing.mustPartial++;
        standing.partialMustHaveIds.push(req.id);
      } else {
        standing.nicePartial++;
      }
    } else {
      if (must) {
        standing.mustMissing++;
        standing.missingMustHaveIds.push(req.id);
      } else {
        standing.niceMissing++;
      }
    }
  }

  // Only an outright missing must-have disqualifies. A partially evidenced must-have
  // keeps the candidate on the shortlist and is flagged in the UI instead.
  standing.disqualified = standing.missingMustHaveIds.length > 0;

  return standing;
}

/** Total order. Every comparison falls through to name, so there are no arbitrary ties. */
function compare(a: Standing, b: Standing): number {
  if (a.disqualified !== b.disqualified) return a.disqualified ? 1 : -1;
  if (a.mustMet !== b.mustMet) return b.mustMet - a.mustMet;
  if (a.niceMet !== b.niceMet) return b.niceMet - a.niceMet;
  if (a.mustPartial !== b.mustPartial) return b.mustPartial - a.mustPartial;
  if (a.nicePartial !== b.nicePartial) return b.nicePartial - a.nicePartial;
  return a.name.localeCompare(b.name);
}

export function rankCandidates(
  requirements: RequirementLike[],
  candidates: CandidateLike[],
  evaluations: EvaluationLike[],
): Standing[] {
  const standings = candidates
    .map((c) => summariseCandidate(c, requirements, evaluations))
    .sort(compare);

  let position = 0;
  for (const standing of standings) {
    if (!standing.disqualified) {
      position++;
      standing.rank = position;
    }
  }

  return standings;
}
