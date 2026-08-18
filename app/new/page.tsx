"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NewJobPage() {
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (description.trim() === "") {
      setError("Paste a job description first.");
      return;
    }

    setPending(true);
    setError(null);

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? "The job description could not be processed.");
        return;
      }

      router.push(`/jobs/${data.jobId}`);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-lg font-semibold">New job</h1>
      <p className="mt-1 mb-5 text-sm text-[var(--muted)]">
        Paste the job description. The model pulls out a list of requirements and tags each one
        must-have or nice-to-have. You review that list before any candidate is evaluated.
      </p>

      {error && (
        <p className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={16}
        disabled={pending}
        placeholder="Paste the full job description…"
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-xs leading-relaxed focus:border-slate-400 focus:outline-none disabled:bg-slate-50"
      />

      <button
        type="button"
        onClick={submit}
        disabled={pending || description.trim() === ""}
        className="mt-3 rounded bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
      >
        {pending ? "Extracting requirements…" : "Extract requirements"}
      </button>
    </div>
  );
}
