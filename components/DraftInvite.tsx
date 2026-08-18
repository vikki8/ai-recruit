"use client";

import { useState } from "react";

type Draft = { subject: string; body: string; evidenceUsed: number };

export function DraftInvite({
  candidateId,
  candidateName,
  disqualified,
}: {
  candidateId: string;
  candidateName: string;
  disqualified: boolean;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "The draft could not be generated.");
        return;
      }
      setDraft(data as Draft);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={generate}
        disabled={pending}
        className="w-full rounded bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
      >
        {pending ? "Drafting…" : `Draft interview invite for ${candidateName}`}
      </button>

      {disqualified && (
        <p className="mt-2 text-xs text-amber-700">
          This candidate is not shortlisted — a must-have has no evidence. You can still draft
          an invite if you want to override that.
        </p>
      )}

      {error && (
        <p className="mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      {draft && (
        <div className="mt-4 rounded-lg border border-[var(--border)] bg-slate-50 p-4">
          <p className="text-xs font-semibold tracking-wide text-[var(--muted)] uppercase">
            Subject
          </p>
          <p className="mb-3 text-sm font-medium">{draft.subject}</p>
          <p className="text-xs font-semibold tracking-wide text-[var(--muted)] uppercase">Body</p>
          <pre className="mt-1 text-sm whitespace-pre-wrap">{draft.body}</pre>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="rounded border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-medium"
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <span className="text-xs text-[var(--muted)]">
              Written from {draft.evidenceUsed} verified quote
              {draft.evidenceUsed === 1 ? "" : "s"}. The CV itself was not sent to the model.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
