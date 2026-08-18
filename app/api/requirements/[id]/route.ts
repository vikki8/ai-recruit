import { NextResponse } from "next/server";
import { deleteRequirement, getJob, getRequirement, updateRequirement } from "@/lib/db";
import { RequirementKind } from "@/lib/schemas";
import { badRequest, conflict, failure, notFound, readJson, str } from "@/lib/http";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * Requirements are editable only until the first candidate has been evaluated. After
 * that the grid would silently go stale, so the set is frozen instead.
 */
async function assertEditable(id: string) {
  const requirement = await getRequirement(id);
  if (!requirement) return { error: notFound("That requirement no longer exists.") };

  const job = await getJob(requirement.job_id);
  if (job?.locked) {
    return {
      error: conflict(
        "Requirements are locked once a candidate has been evaluated, so the comparison stays valid.",
      ),
    };
  }
  return { requirement };
}

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;

  try {
    const guard = await assertEditable(id);
    if (guard.error) return guard.error;

    const body = await readJson(req);
    const patch: { text?: string; kind?: "must_have" | "nice_to_have" } = {};

    if ("text" in body) {
      const text = str(body.text);
      if (text === "") return badRequest("A requirement cannot be empty.");
      patch.text = text;
    }

    if ("kind" in body) {
      const kind = RequirementKind.safeParse(body.kind);
      if (!kind.success) return badRequest("Kind must be must_have or nice_to_have.");
      patch.kind = kind.data;
    }

    if (Object.keys(patch).length === 0) return badRequest("Nothing to update.");

    return NextResponse.json(await updateRequirement(id, patch));
  } catch (err) {
    return failure(err);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;

  try {
    const guard = await assertEditable(id);
    if (guard.error) return guard.error;

    await deleteRequirement(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return failure(err);
  }
}
