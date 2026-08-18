"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Requirement } from "@/lib/db";
import { KindBadge } from "./Verdict";

type Kind = "must_have" | "nice_to_have";

export function RequirementEditor({
  jobId,
  requirements,
  locked,
}: {
  jobId: string;
  requirements: Requirement[];
  locked: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newText, setNewText] = useState("");
  const [newKind, setNewKind] = useState<Kind>("must_have");

  async function send(url: string, method: string, body?: unknown, key = url) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "That did not work. Try again.");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  if (locked) {
    return (
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
        <header className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">Requirements</h2>
          <span className="text-xs text-[var(--muted)]">
            Locked — candidates have been measured against this set
          </span>
        </header>
        <ul className="space-y-2">
          {requirements.map((req) => (
            <li key={req.id} className="flex items-start gap-2 text-sm">
              <KindBadge kind={req.kind} />
              <span>{req.text}</span>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <header className="mb-1 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Requirements</h2>
        <span className="text-xs text-[var(--muted)]">
          Edit freely — this set locks when you add your first candidate
        </span>
      </header>
      <p className="mb-4 text-xs text-[var(--muted)]">
        Extracted by the model, reviewed by you. Nothing is evaluated until you say so.
      </p>

      {error && (
        <p className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      {requirements.length === 0 && (
        <p className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          No requirements were extracted from this job spec — it may be too short. Add them by
          hand below.
        </p>
      )}

      <ul className="space-y-2">
        {requirements.map((req) => {
          const value = drafts[req.id] ?? req.text;
          const dirty = value.trim() !== req.text && value.trim() !== "";
          return (
            <li key={req.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  send(
                    `/api/requirements/${req.id}`,
                    "PATCH",
                    { kind: req.kind === "must_have" ? "nice_to_have" : "must_have" },
                    `kind-${req.id}`,
                  )
                }
                title="Toggle between must-have and nice-to-have"
                className="cursor-pointer"
              >
                <KindBadge kind={req.kind} />
              </button>
              <input
                value={value}
                onChange={(e) => setDrafts({ ...drafts, [req.id]: e.target.value })}
                className="flex-1 rounded border border-[var(--border)] px-2 py-1.5 text-sm focus:border-slate-400 focus:outline-none"
              />
              {dirty && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={async () => {
                    const ok = await send(
                      `/api/requirements/${req.id}`,
                      "PATCH",
                      { text: value.trim() },
                      `save-${req.id}`,
                    );
                    if (ok) setDrafts({ ...drafts, [req.id]: value.trim() });
                  }}
                  className="rounded bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  Save
                </button>
              )}
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => send(`/api/requirements/${req.id}`, "DELETE", undefined, req.id)}
                className="rounded border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--muted)] hover:border-rose-300 hover:text-rose-600 disabled:opacity-50"
              >
                Delete
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex items-center gap-2 border-t border-[var(--border)] pt-4">
        <select
          value={newKind}
          onChange={(e) => setNewKind(e.target.value as Kind)}
          className="rounded border border-[var(--border)] px-2 py-1.5 text-sm"
        >
          <option value="must_have">Must</option>
          <option value="nice_to_have">Nice</option>
        </select>
        <input
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="Add a requirement the model missed"
          className="flex-1 rounded border border-[var(--border)] px-2 py-1.5 text-sm focus:border-slate-400 focus:outline-none"
        />
        <button
          type="button"
          disabled={busy !== null || newText.trim() === ""}
          onClick={async () => {
            const ok = await send(
              "/api/requirements",
              "POST",
              { jobId, text: newText.trim(), kind: newKind },
              "add",
            );
            if (ok) setNewText("");
          }}
          className="rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </section>
  );
}
