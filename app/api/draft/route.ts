import { NextResponse } from "next/server";
import { draftInvite, type DraftEvidence } from "@/lib/ai";
import { getCandidate, getEvaluationsForCandidate, getJob, getRequirements } from "@/lib/db";
import { badRequest, failure, notFound, readJson, str } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await readJson(req);
  const candidateId = str(body.candidateId);
  if (candidateId === "") return badRequest("Missing candidate.");

  try {
    const candidate = await getCandidate(candidateId);
    if (!candidate) return notFound("That candidate no longer exists.");

    const job = await getJob(candidate.job_id);
    if (!job) return notFound("That job no longer exists.");

    const [requirements, evaluations] = await Promise.all([
      getRequirements(candidate.job_id),
      getEvaluationsForCandidate(candidateId),
    ]);

    const byId = new Map(requirements.map((r) => [r.id, r]));

    // Only verified evidence is handed to the writer, and the CV itself never is, so
    // the draft cannot reference experience that failed the quote check.
    const evidence: DraftEvidence[] = evaluations
      .filter((e) => e.evidence !== null && (e.verdict === "met" || e.verdict === "partial"))
      .sort((a, b) => (a.verdict === b.verdict ? 0 : a.verdict === "met" ? -1 : 1))
      .map((e) => ({
        requirement: byId.get(e.requirement_id)?.text ?? "Requirement",
        quote: e.evidence as string,
      }));

    const draft = await draftInvite(job.title, candidate.name, evidence);

    return NextResponse.json({
      ...draft,
      evidenceUsed: evidence.length,
    });
  } catch (err) {
    return failure(err);
  }
}
