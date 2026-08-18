import { NextResponse } from "next/server";
import { extractRequirements } from "@/lib/ai";
import { createJob, insertRequirements } from "@/lib/db";
import { badRequest, failure, readJson, str } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

const MIN_DESCRIPTION_LENGTH = 40;

export async function POST(req: Request) {
  const body = await readJson(req);
  const description = str(body.description);

  if (description === "") {
    return badRequest("Paste a job description first.");
  }
  if (description.length < MIN_DESCRIPTION_LENGTH) {
    return badRequest(
      "That job description is too short to extract requirements from. Add a few lines about the role.",
    );
  }

  try {
    const extraction = await extractRequirements(description);

    // A spec the model could not pull requirements from is still a real job. Create it
    // and let the recruiter add requirements by hand rather than losing what they typed.
    const job = await createJob(extraction.title.trim() || "Untitled role", description);
    const requirements = await insertRequirements(job.id, extraction.requirements);

    return NextResponse.json({
      jobId: job.id,
      title: job.title,
      requirementCount: requirements.length,
    });
  } catch (err) {
    return failure(err);
  }
}
