import { NextResponse } from "next/server";
import { evaluateCandidate, type RequirementForModel } from "@/lib/ai";
import {
  createCandidate,
  getJob,
  getRequirements,
  lockJob,
  replaceEvaluations,
  setCandidateStatus,
} from "@/lib/db";
import { validateEvaluations, type RequirementRef } from "@/lib/evidence";
import { badRequest, failure, nameFromCv, notFound, readJson, str } from "@/lib/http";

export const runtime = "nodejs";
// One candidate per request. Six candidates is six short requests rather than one long
// one, which keeps every invocation well inside the platform timeout and lets the UI
// fill the grid a column at a time.
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await readJson(req);
  const jobId = str(body.jobId);
  const cvText = str(body.cvText);
  const providedName = str(body.name);

  if (jobId === "") return badRequest("Missing job.");
  if (cvText === "") return badRequest("Paste the candidate CV text first.");

  let candidateId: string | null = null;

  try {
    const job = await getJob(jobId);
    if (!job) return notFound("That job no longer exists.");

    const requirements = await getRequirements(jobId);
    if (requirements.length === 0) {
      return badRequest("Add at least one requirement before adding candidates.");
    }

    const candidate = await createCandidate(jobId, providedName || nameFromCv(cvText), cvText);
    candidateId = candidate.id;

    // Freeze the requirement set the moment the first candidate is measured against it.
    if (!job.locked) await lockJob(jobId);

    // Short handles keep the prompt small and make a hallucinated id impossible to
    // mistake for a real row; they are mapped back to UUIDs during validation.
    const forModel: RequirementForModel[] = requirements.map((r, i) => ({
      handle: `r${i + 1}`,
      text: r.text,
      kind: r.kind,
    }));
    const refs: RequirementRef[] = requirements.map((r, i) => ({
      id: r.id,
      handle: `r${i + 1}`,
      text: r.text,
      kind: r.kind,
    }));

    const response = await evaluateCandidate(cvText, forModel);

    // Nothing the model said is trusted until the quote is found in this CV.
    const validated = validateEvaluations(cvText, refs, response.results);

    await replaceEvaluations(candidate.id, validated);
    await setCandidateStatus(candidate.id, "done");

    return NextResponse.json({
      candidateId: candidate.id,
      name: candidate.name,
      downgraded: validated.filter((v) => v.downgradeReason !== null).length,
    });
  } catch (err) {
    // The paste is never lost. The candidate stays in the grid as a failed column the
    // recruiter can see and retry, instead of the request vanishing.
    if (candidateId) {
      const message = err instanceof Error ? err.message : "Evaluation failed.";
      await setCandidateStatus(candidateId, "error", message.slice(0, 300)).catch(() => {});
    }
    return failure(err);
  }
}
