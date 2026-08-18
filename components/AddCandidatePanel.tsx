"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type FileState = "queued" | "parsing" | "evaluating" | "done" | "failed";

type FileRow = {
  key: string;
  filename: string;
  state: FileState;
  detail: string;
};

const STATE_LABEL: Record<FileState, string> = {
  queued: "Queued",
  parsing: "Reading file…",
  evaluating: "Evaluating…",
  done: "Added",
  failed: "Failed",
};

const STATE_STYLE: Record<FileState, string> = {
  queued: "text-[var(--muted)]",
  parsing: "text-slate-700",
  evaluating: "text-slate-700",
  done: "text-emerald-700",
  failed: "text-rose-600",
};

function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim().length > 0);
  return (line ?? "").trim().slice(0, 80);
}

export function AddCandidatePanel({ jobId, disabled }: { jobId: string; disabled: boolean }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<FileRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [cvText, setCvText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const effectiveName = nameTouched ? name : firstLine(cvText);

  function patch(key: string, update: Partial<FileRow>) {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...update } : r)));
  }

  /** Parses then evaluates one file. Sequential, so the grid fills a column at a time. */
  async function handleFiles(files: File[]) {
    if (files.length === 0) return;

    const queued: FileRow[] = files.map((file, i) => ({
      key: `${Date.now()}-${i}-${file.name}`,
      filename: file.name,
      state: "queued",
      detail: "",
    }));
    setRows((current) => [...current, ...queued]);
    setUploading(true);

    for (const [i, file] of files.entries()) {
      const { key } = queued[i];

      try {
        patch(key, { state: "parsing" });
        const form = new FormData();
        form.append("file", file);
        const parseRes = await fetch("/api/parse", { method: "POST", body: form });
        const parsed = await parseRes.json().catch(() => ({}));

        if (!parseRes.ok) {
          patch(key, { state: "failed", detail: parsed.error ?? "Could not read that file." });
          continue;
        }

        patch(key, { state: "evaluating", detail: `${parsed.name} · ${parsed.characters} chars` });

        const evalRes = await fetch("/api/candidates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId,
            name: parsed.name,
            cvText: parsed.text,
            sourceFilename: parsed.filename,
          }),
        });
        const evaluated = await evalRes.json().catch(() => ({}));

        if (!evalRes.ok) {
          patch(key, { state: "failed", detail: evaluated.error ?? "Evaluation failed." });
          continue;
        }

        patch(key, {
          state: "done",
          detail:
            evaluated.downgraded > 0
              ? `${evaluated.name} · ${evaluated.downgraded} claim${evaluated.downgraded === 1 ? "" : "s"} dropped for unverifiable quotes`
              : evaluated.name,
        });
      } catch {
        patch(key, { state: "failed", detail: "Could not reach the server." });
      }

      router.refresh();
    }

    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function submitPaste() {
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

      setNotice(
        data.downgraded > 0
          ? `${data.name} added. ${data.downgraded} claim${data.downgraded === 1 ? "" : "s"} recorded as missing because the quote was not in the CV.`
          : `${data.name} added.`,
      );
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

  const busy = disabled || uploading || pending;

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-sm font-semibold">Add candidates</h2>
      <p className="mt-1 mb-4 text-xs text-[var(--muted)]">
        Every requirement is checked individually, and any claim without a quote from the CV is
        recorded as missing.
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!busy) void handleFiles(Array.from(e.dataTransfer.files));
        }}
        className={`rounded-lg border-2 border-dashed p-5 text-center transition ${
          dragging ? "border-slate-500 bg-slate-50" : "border-[var(--border)]"
        } ${busy ? "opacity-60" : ""}`}
      >
        <p className="text-sm font-medium">Drop CVs here</p>
        <p className="mt-1 text-xs text-[var(--muted)]">PDF or .docx, up to 4MB each</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
          className="mt-3 rounded border border-[var(--border)] bg-white px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          Choose files
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          onChange={(e) => void handleFiles(Array.from(e.target.files ?? []))}
        />
      </div>

      {rows.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {rows.map((row) => (
            <li key={row.key} className="flex items-baseline justify-between gap-3 text-xs">
              <span className="truncate font-mono">{row.filename}</span>
              <span className={`shrink-0 text-right ${STATE_STYLE[row.state]}`}>
                {STATE_LABEL[row.state]}
                {row.detail && <span className="block text-[var(--muted)]">{row.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-[var(--border)]" />
        <span className="text-xs text-[var(--muted)]">or paste text</span>
        <span className="h-px flex-1 bg-[var(--border)]" />
      </div>

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
        disabled={busy}
        className="mb-3 w-full rounded border border-[var(--border)] px-3 py-2 text-sm focus:border-slate-400 focus:outline-none disabled:bg-slate-50"
      />

      <label className="mb-1 block text-xs font-medium text-[var(--muted)]">CV text</label>
      <textarea
        value={cvText}
        onChange={(e) => setCvText(e.target.value)}
        rows={8}
        disabled={busy}
        placeholder="Paste the full CV as plain text…"
        className="w-full rounded border border-[var(--border)] px-3 py-2 font-mono text-xs leading-relaxed focus:border-slate-400 focus:outline-none disabled:bg-slate-50"
      />

      <button
        type="button"
        onClick={submitPaste}
        disabled={busy || cvText.trim() === ""}
        className="mt-3 w-full rounded bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
      >
        {pending ? "Evaluating against every requirement…" : "Evaluate pasted CV"}
      </button>

      {disabled && (
        <p className="mt-2 text-xs text-[var(--muted)]">
          Add at least one requirement before adding candidates.
        </p>
      )}
    </section>
  );
}
