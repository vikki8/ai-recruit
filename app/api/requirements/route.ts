import { NextResponse } from "next/server";
import { addRequirement, getJob } from "@/lib/db";
import { RequirementKind } from "@/lib/schemas";
import { badRequest, conflict, failure, notFound, readJson, str } from "@/lib/http";

export const runtime = "nodejs";

/**
 * Adding a requirement by hand. This is the recovery path when a job spec was too thin
 * for the model to extract anything, so the empty case is never a dead end.
 */
export async function POST(req: Request) {
  const body = await readJson(req);
  const jobId = str(body.jobId);
  const text = str(body.text);

  if (jobId === "") return badRequest("Missing job.");
  if (text === "") return badRequest("A requirement cannot be empty.");

  const kind = RequirementKind.safeParse(body.kind ?? "must_have");
  if (!kind.success) return badRequest("Kind must be must_have or nice_to_have.");

  try {
    const job = await getJob(jobId);
    if (!job) return notFound("That job no longer exists.");
    if (job.locked) {
      return conflict(
        "Requirements are locked once a candidate has been evaluated, so the comparison stays valid.",
      );
    }

    return NextResponse.json(await addRequirement(jobId, text, kind.data));
  } catch (err) {
    return failure(err);
  }
}
