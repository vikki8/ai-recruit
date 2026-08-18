import Link from "next/link";
import type { Candidate, Evaluation, Requirement } from "@/lib/db";
import type { Standing } from "@/lib/ranking";
import { KindBadge, VERDICT_UI } from "./Verdict";

/**
 * Requirements down the side, candidates across the top. Every cell is a verdict the
 * model produced for one requirement, and every non-missing cell carries the quote
 * that survived validation.
 */
export function ComparisonGrid({
  requirements,
  candidates,
  evaluations,
  standings,
}: {
  requirements: Requirement[];
  candidates: Candidate[];
  evaluations: Evaluation[];
  standings: Standing[];
}) {
  const byCell = new Map<string, Evaluation>();
  for (const e of evaluations) byCell.set(`${e.candidate_id}:${e.requirement_id}`, e);

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const ordered = standings.map((s) => byId.get(s.candidateId)).filter((c): c is Candidate => !!c);

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 min-w-[260px] border-b border-[var(--border)] bg-[var(--surface)] p-3 text-left text-xs font-semibold tracking-wide text-[var(--muted)] uppercase">
              Requirement
            </th>
            {standings.map((standing) => (
              <th
                key={standing.candidateId}
                className="min-w-[150px] border-b border-l border-[var(--border)] p-3 text-left align-top"
              >
                <Link
                  href={`/candidates/${standing.candidateId}`}
                  className="candidate-link block font-semibold"
                >
                  {standing.name}
                </Link>
                {standing.disqualified ? (
                  <span className="mt-1 block text-xs font-medium text-rose-600">
                    Not shortlisted &middot; {standing.missingMustHaveIds.length} must-have
                    {standing.missingMustHaveIds.length === 1 ? "" : "s"} missing
                  </span>
                ) : (
                  <span className="mt-1 block text-xs font-medium text-emerald-700">
                    Shortlisted &middot; #{standing.rank}
                  </span>
                )}
                {!standing.disqualified && standing.partialMustHaveIds.length > 0 && (
                  <span className="mt-0.5 block text-xs text-amber-700">
                    {standing.partialMustHaveIds.length} must-have
                    {standing.partialMustHaveIds.length === 1 ? "" : "s"} only partially evidenced
                  </span>
                )}
                <span className="mt-1 block text-xs text-[var(--muted)]">
                  {standing.mustMet}/{standing.mustMet + standing.mustPartial + standing.mustMissing}{" "}
                  must &middot; {standing.niceMet}/
                  {standing.niceMet + standing.nicePartial + standing.niceMissing} nice
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {requirements.map((req) => (
            <tr key={req.id} className="even:bg-slate-50/50">
              <th
                scope="row"
                className="sticky left-0 z-10 border-b border-[var(--border)] bg-inherit p-3 text-left font-normal"
              >
                <span className="flex items-start gap-2">
                  <KindBadge kind={req.kind} />
                  <span>{req.text}</span>
                </span>
              </th>
              {ordered.map((candidate) => {
                const evaluation = byCell.get(`${candidate.id}:${req.id}`);
                const verdict = evaluation?.verdict ?? "missing";
                const ui = VERDICT_UI[verdict];
                const tooltip =
                  evaluation?.evidence ??
                  evaluation?.reasoning ??
                  (candidate.status === "error"
                    ? "This candidate failed to evaluate."
                    : "No supporting evidence found.");

                return (
                  <td
                    key={candidate.id}
                    className="border-b border-l border-[var(--border)] p-3 align-middle"
                  >
                    <span
                      title={tooltip}
                      className={`flex h-7 w-7 cursor-help items-center justify-center rounded font-semibold ${ui.cell}`}
                    >
                      {ui.symbol}
                      <span className="sr-only">
                        {ui.label}: {tooltip}
                      </span>
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
