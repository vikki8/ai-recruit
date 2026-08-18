import Link from "next/link";
import { redirect } from "next/navigation";
import { getLatestJob } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  let job: Awaited<ReturnType<typeof getLatestJob>> = null;

  try {
    job = await getLatestJob();
  } catch (err) {
    // Almost always a missing or wrong env var. Say so plainly instead of a stack trace.
    return (
      <div className="mx-auto max-w-xl rounded-lg border border-rose-200 bg-rose-50 p-6">
        <h1 className="text-base font-semibold text-rose-900">Cannot reach the database</h1>
        <p className="mt-2 text-sm text-rose-800">
          Check that <code className="font-mono">SUPABASE_URL</code> and{" "}
          <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code> are set.
        </p>
        <p className="mt-2 font-mono text-xs text-rose-700">
          {err instanceof Error ? err.message : String(err)}
        </p>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="mx-auto max-w-xl text-center">
        <h1 className="text-lg font-semibold">No jobs yet</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Paste a job description to extract its requirements.
        </p>
        <Link
          href="/new"
          className="mt-5 inline-block rounded bg-slate-900 px-4 py-2.5 text-sm font-medium text-white"
        >
          Start a job
        </Link>
      </div>
    );
  }

  redirect(`/jobs/${job.id}`);
}
