import { notFound } from "next/navigation";
import { AddCandidatePanel } from "@/components/AddCandidatePanel";
import { ComparisonGrid } from "@/components/ComparisonGrid";
import { RequirementEditor } from "@/components/RequirementEditor";
import { Legend } from "@/components/Verdict";
import {
  getCandidates,
  getEvaluationsForJob,
  getJob,
  getRequirements,
} from "@/lib/db";
import { rankCandidates } from "@/lib/ranking";

export const dynamic = "force-dynamic";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const job = await getJob(id);
  if (!job) notFound();

  const [requirements, candidates, evaluations] = await Promise.all([
    getRequirements(id),
    getCandidates(id),
    getEvaluationsForJob(id),
  ]);

  // Ranking is computed here, in TypeScript, from stored verdicts. The model is never
  // asked who is best.
  const standings = rankCandidates(
    requirements,
    candidates.map((c) => ({ id: c.id, name: c.name })),
    evaluations.map((e) => ({
      candidateId: e.candidate_id,
      requirementId: e.requirement_id,
      verdict: e.verdict,
    })),
  );

  const shortlisted = standings.filter((s) => !s.disqualified).length;
  const failed = candidates.filter((c) => c.status === "error");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">{job.title}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {requirements.length} requirement{requirements.length === 1 ? "" : "s"} &middot;{" "}
          {candidates.length} candidate{candidates.length === 1 ? "" : "s"} &middot; {shortlisted}{" "}
          shortlisted
        </p>
      </header>

      {failed.length > 0 && (
        <p className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {failed.length} candidate{failed.length === 1 ? "" : "s"} failed to evaluate (
          {failed.map((c) => c.name).join(", ")}). Their CV text is saved — remove and re-add to
          retry.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <RequirementEditor jobId={job.id} requirements={requirements} locked={job.locked} />
        <AddCandidatePanel jobId={job.id} disabled={requirements.length === 0} />
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">Comparison</h2>
          <Legend />
        </div>

        {candidates.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--muted)]">
            No candidates yet. Paste a CV to see how it measures against each requirement.
          </p>
        ) : (
          <>
            <ComparisonGrid
              requirements={requirements}
              candidates={candidates}
              evaluations={evaluations}
              standings={standings}
            />
            <p className="text-xs text-[var(--muted)]">
              Ranking is computed in code, not by the model: any must-have with no evidence
              disqualifies, and ties break on nice-to-haves met.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
