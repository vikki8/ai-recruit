import Link from "next/link";
import { notFound } from "next/navigation";
import { DraftInvite } from "@/components/DraftInvite";
import { KindBadge, VerdictPill } from "@/components/Verdict";
import {
  getCandidate,
  getEvaluationsForCandidate,
  getJob,
  getRequirements,
} from "@/lib/db";
import { summariseCandidate } from "@/lib/ranking";
import type { DowngradeReason } from "@/lib/schemas";

export const dynamic = "force-dynamic";

const DOWNGRADE_NOTE: Record<DowngradeReason, string> = {
  quote_not_found:
    "The model offered a supporting quote that does not appear in this CV, so this was recorded as missing.",
  no_evidence:
    "The model claimed this was met but supplied no quote, so this was recorded as missing.",
  no_result: "The model returned no verdict for this requirement, so it was recorded as missing.",
  bad_verdict:
    "The model returned an unrecognised verdict, so this was recorded as missing.",
};

export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const candidate = await getCandidate(id);
  if (!candidate) notFound();

  const [job, requirements, evaluations] = await Promise.all([
    getJob(candidate.job_id),
    getRequirements(candidate.job_id),
    getEvaluationsForCandidate(id),
  ]);
  if (!job) notFound();

  const standing = summariseCandidate(
    { id: candidate.id, name: candidate.name },
    requirements,
    evaluations.map((e) => ({
      candidateId: e.candidate_id,
      requirementId: e.requirement_id,
      verdict: e.verdict,
    })),
  );

  const byRequirement = new Map(evaluations.map((e) => [e.requirement_id, e]));
  const gaps = requirements.filter(
    (r) => (byRequirement.get(r.id)?.verdict ?? "missing") === "missing",
  );

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/jobs/${job.id}`} className="text-sm text-[var(--muted)] hover:underline">
          &larr; {job.title}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{candidate.name}</h1>

        {candidate.status === "error" ? (
          <p className="mt-2 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            This candidate failed to evaluate: {candidate.error_message}
          </p>
        ) : standing.disqualified ? (
          <p className="mt-2 text-sm font-medium text-rose-600">
            Not shortlisted &mdash; {standing.missingMustHaveIds.length} must-have
            {standing.missingMustHaveIds.length === 1 ? "" : "s"} with no evidence
          </p>
        ) : (
          <p className="mt-2 text-sm font-medium text-emerald-700">
            Shortlisted &mdash; every must-have has supporting evidence
            {standing.partialMustHaveIds.length > 0 && (
              <span className="text-amber-700">
                {" "}
                ({standing.partialMustHaveIds.length} must-have
                {standing.partialMustHaveIds.length === 1 ? "" : "s"} only partially evidenced)
              </span>
            )}
          </p>
        )}

        <p className="mt-1 text-sm text-[var(--muted)]">
          {standing.mustMet} of {standing.mustMet + standing.mustPartial + standing.mustMissing}{" "}
          must-haves met &middot; {standing.niceMet} of{" "}
          {standing.niceMet + standing.nicePartial + standing.niceMissing} nice-to-haves met
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Requirement by requirement</h2>
          <ul className="space-y-3">
            {requirements.map((req) => {
              const evaluation = byRequirement.get(req.id);
              const verdict = evaluation?.verdict ?? "missing";
              const downgrade = evaluation?.downgrade_reason ?? null;

              return (
                <li
                  key={req.id}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex items-start gap-2 text-sm font-medium">
                      <KindBadge kind={req.kind} />
                      {req.text}
                    </span>
                    <VerdictPill verdict={verdict} />
                  </div>

                  {evaluation?.evidence ? (
                    <blockquote className="mt-3 border-l-2 border-emerald-300 bg-emerald-50/50 py-2 pl-3 font-mono text-xs leading-relaxed">
                      {evaluation.evidence}
                    </blockquote>
                  ) : (
                    <p className="mt-3 text-xs text-[var(--muted)]">
                      No quoted evidence in this CV.
                    </p>
                  )}

                  {evaluation?.reasoning && (
                    <p className="mt-2 text-xs text-[var(--muted)]">{evaluation.reasoning}</p>
                  )}

                  {downgrade && (
                    <p className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                      {DOWNGRADE_NOTE[downgrade]}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <div className="space-y-6">
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
            <h2 className="text-sm font-semibold">Gaps</h2>
            {gaps.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--muted)]">
                Every requirement has supporting evidence.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {gaps.map((req) => (
                  <li key={req.id} className="flex items-start gap-2 text-sm">
                    <KindBadge kind={req.kind} />
                    <span>{req.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
            <h2 className="mb-3 text-sm font-semibold">Next step</h2>
            <DraftInvite
              candidateId={candidate.id}
              candidateName={candidate.name}
              disqualified={standing.disqualified}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
