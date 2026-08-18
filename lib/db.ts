import { supabase } from "./supabase";
import type { DowngradeReason, RequirementKind, Verdict } from "./schemas";

/**
 * Every database touch in the app lives here as a plain async function.
 *
 * Route handlers and pages call these; nothing else builds a query. That keeps the
 * routes thin, and it means integration tests mock this one module instead of trying
 * to fake the Supabase query builder.
 */

export type Job = {
  id: string;
  title: string;
  description: string;
  locked: boolean;
  created_at: string;
};

export type Requirement = {
  id: string;
  job_id: string;
  text: string;
  kind: RequirementKind;
  sort_order: number;
};

export type CandidateStatus = "pending" | "done" | "error";

export type Candidate = {
  id: string;
  job_id: string;
  name: string;
  cv_text: string;
  status: CandidateStatus;
  error_message: string | null;
  /** Original upload filename, or null when the CV was pasted as text. */
  source_filename: string | null;
  created_at: string;
};

export type Evaluation = {
  id: string;
  candidate_id: string;
  requirement_id: string;
  verdict: Verdict;
  evidence: string | null;
  reasoning: string | null;
  downgrade_reason: DowngradeReason | null;
};

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) throw new Error("No data returned from the database.");
  return result.data;
}

/** ---------------- jobs ---------------- */

export async function getLatestJob(): Promise<Job | null> {
  const { data, error } = await supabase()
    .from("jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

export async function getJob(id: string): Promise<Job | null> {
  const { data, error } = await supabase().from("jobs").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function createJob(title: string, description: string): Promise<Job> {
  return unwrap(
    await supabase().from("jobs").insert({ title, description }).select("*").single(),
  );
}

export async function lockJob(id: string): Promise<void> {
  const { error } = await supabase().from("jobs").update({ locked: true }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** ---------------- requirements ---------------- */

export async function getRequirements(jobId: string): Promise<Requirement[]> {
  const { data, error } = await supabase()
    .from("requirements")
    .select("*")
    .eq("job_id", jobId)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getRequirement(id: string): Promise<Requirement | null> {
  const { data, error } = await supabase()
    .from("requirements")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function insertRequirements(
  jobId: string,
  requirements: Array<{ text: string; kind: RequirementKind }>,
): Promise<Requirement[]> {
  if (requirements.length === 0) return [];
  return unwrap(
    await supabase()
      .from("requirements")
      .insert(
        requirements.map((r, i) => ({
          job_id: jobId,
          text: r.text,
          kind: r.kind,
          sort_order: i,
        })),
      )
      .select("*"),
  );
}

export async function addRequirement(
  jobId: string,
  text: string,
  kind: RequirementKind,
): Promise<Requirement> {
  const existing = await getRequirements(jobId);
  const nextOrder = existing.reduce((max, r) => Math.max(max, r.sort_order), -1) + 1;
  return unwrap(
    await supabase()
      .from("requirements")
      .insert({ job_id: jobId, text, kind, sort_order: nextOrder })
      .select("*")
      .single(),
  );
}

export async function updateRequirement(
  id: string,
  patch: { text?: string; kind?: RequirementKind },
): Promise<Requirement> {
  return unwrap(
    await supabase().from("requirements").update(patch).eq("id", id).select("*").single(),
  );
}

export async function deleteRequirement(id: string): Promise<void> {
  const { error } = await supabase().from("requirements").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** ---------------- candidates ---------------- */

export async function getCandidates(jobId: string): Promise<Candidate[]> {
  const { data, error } = await supabase()
    .from("candidates")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getCandidate(id: string): Promise<Candidate | null> {
  const { data, error } = await supabase()
    .from("candidates")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function createCandidate(
  jobId: string,
  name: string,
  cvText: string,
  sourceFilename: string | null = null,
): Promise<Candidate> {
  return unwrap(
    await supabase()
      .from("candidates")
      .insert({ job_id: jobId, name, cv_text: cvText, source_filename: sourceFilename })
      .select("*")
      .single(),
  );
}

export async function setCandidateStatus(
  id: string,
  status: CandidateStatus,
  errorMessage: string | null = null,
): Promise<void> {
  const { error } = await supabase()
    .from("candidates")
    .update({ status, error_message: errorMessage })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** ---------------- evaluations ---------------- */

export async function replaceEvaluations(
  candidateId: string,
  rows: Array<{
    requirementId: string;
    verdict: Verdict;
    evidence: string | null;
    reasoning: string;
    downgradeReason: DowngradeReason | null;
  }>,
): Promise<void> {
  const client = supabase();

  const { error: deleteError } = await client
    .from("evaluations")
    .delete()
    .eq("candidate_id", candidateId);
  if (deleteError) throw new Error(deleteError.message);

  if (rows.length === 0) return;

  const { error } = await client.from("evaluations").insert(
    rows.map((r) => ({
      candidate_id: candidateId,
      requirement_id: r.requirementId,
      verdict: r.verdict,
      evidence: r.evidence,
      reasoning: r.reasoning,
      downgrade_reason: r.downgradeReason,
    })),
  );
  if (error) throw new Error(error.message);
}

export async function getEvaluationsForCandidate(candidateId: string): Promise<Evaluation[]> {
  const { data, error } = await supabase()
    .from("evaluations")
    .select("*")
    .eq("candidate_id", candidateId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getEvaluationsForJob(jobId: string): Promise<Evaluation[]> {
  const { data, error } = await supabase()
    .from("evaluations")
    .select("*, candidates!inner(job_id)")
    .eq("candidates.job_id", jobId);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Evaluation[];
}
