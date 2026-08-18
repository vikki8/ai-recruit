"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim().length > 0);
  return (line ?? "").trim().slice(0, 80);
}

export function AddCandidatePanel({
  jobId,
  disabled,
}: {
  jobId: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [cvText, setCvText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The name defaults to the first non-blank line of the paste, which is almost always
  // the candidate's name, and stops being guessed once the recruiter types their own.
  const effectiveName = nameTouched ? name : firstLine(cvText);

  async function submit() {
    if (cvText.trim() === "") {
      setError("Paste the candidate CV text first.");
      return;
    }

    setPending(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch("/api/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, name: effectiveName, cvText }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? "That candidate could not be evaluated.");
        router.refresh();
        return;
      }

      if (data.downgraded > 0) {
        setNotice(
          `${data.name} added. ${data.downgraded} claim${data.downgraded === 1 ? "" : "s"} were recorded as missing because the quote could not be found in the CV.`,
        );
      } else {
        setNotice(`${data.name} added.`);
      }

      setCvText("");
      setName("");
      setNameTouched(false);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-sm font-semibold">Add a candidate</h2>
      <p className="mt-1 mb-4 text-xs text-[var(--muted)]">
        Paste CV text. Every requirement is checked individually, and any claim without a
        quote from this text is recorded as missing.
      </p>

      {error && (
        <p className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}
      {notice && (
        <p className="mb-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      )}

      <label className="mb-1 block text-xs font-medium text-[var(--muted)]">Name</label>
      <input
        value={effectiveName}
        onChange={(e) => {
          setNameTouched(true);
          setName(e.target.value);
        }}
        placeholder="Taken from the first line of the CV"
        disabled={disabled || pending}
        className="mb-3 w-full rounded border border-[var(--border)] px-3 py-2 text-sm focus:border-slate-400 focus:outline-none disabled:bg-slate-50"
      />

      <label className="mb-1 block text-xs font-medium text-[var(--muted)]">CV text</label>
      <textarea
        value={cvText}
        onChange={(e) => setCvText(e.target.value)}
        rows={10}
        disabled={disabled || pending}
        placeholder="Paste the full CV as plain text…"
        className="w-full rounded border border-[var(--border)] px-3 py-2 font-mono text-xs leading-relaxed focus:border-slate-400 focus:outline-none disabled:bg-slate-50"
      />

      <button
        type="button"
        onClick={submit}
        disabled={disabled || pending || cvText.trim() === ""}
        className="mt-3 w-full rounded bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
      >
        {pending ? "Evaluating against every requirement…" : "Evaluate candidate"}
      </button>

      {disabled && (
        <p className="mt-2 text-xs text-[var(--muted)]">
          Add at least one requirement before adding candidates.
        </p>
      )}
    </section>
  );
}
