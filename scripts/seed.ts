import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { validateEvaluations, type RequirementRef } from "../lib/evidence";
import { SEED_CANDIDATES, SEED_JOB, SEED_REQUIREMENTS } from "../lib/seed-data";

/**
 * Seeds the demo job and its six candidates.
 *
 *   npm run seed           write to Supabase using SUPABASE_SERVICE_ROLE_KEY
 *   npm run seed -- --sql  print the equivalent SQL instead of writing
 *
 * The fixtures are hand-authored, but they are put through the same validator the live
 * path uses. If a quote does not appear in its CV the seed fails rather than silently
 * writing a gap, so the demo data can never drift from what the app would produce.
 *
 * A --evaluate mode that regenerates these through a real AI run is intentionally not
 * implemented; see the README for why.
 */

function loadEnv() {
  try {
    for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // No .env file; rely on the ambient environment.
  }
}

const q = (value: string | null) =>
  value === null ? "null" : `'${value.replace(/'/g, "''")}'`;

type Row = {
  candidateId: string;
  requirementId: string;
  verdict: string;
  evidence: string | null;
  reasoning: string;
  downgradeReason: string | null;
};

function buildPlan() {
  const jobId = randomUUID();

  const requirements = SEED_REQUIREMENTS.map((r, i) => ({
    id: randomUUID(),
    handle: `r${i + 1}`,
    text: r.text,
    kind: r.kind,
    sortOrder: i,
  }));

  const refs: RequirementRef[] = requirements.map((r) => ({
    id: r.id,
    handle: r.handle,
    text: r.text,
    kind: r.kind,
  }));

  const candidates: Array<{ id: string; name: string; cvText: string }> = [];
  const evaluations: Row[] = [];
  let downgraded = 0;

  for (const seed of SEED_CANDIDATES) {
    const id = randomUUID();
    candidates.push({ id, name: seed.name, cvText: seed.cvText });

    const validated = validateEvaluations(seed.cvText, refs, seed.results);

    validated.forEach((row, i) => {
      const authored = seed.results[i];
      const wasDowngraded = row.downgradeReason !== null;

      if (wasDowngraded && !authored.unsupported) {
        throw new Error(
          `Seed fixture is wrong: ${seed.name} / ${authored.id} was downgraded ` +
            `(${row.downgradeReason}). Its quote does not appear in the CV text.`,
        );
      }
      if (authored.unsupported && !wasDowngraded) {
        throw new Error(
          `Seed fixture is wrong: ${seed.name} / ${authored.id} is marked unsupported ` +
            `but the validator accepted it.`,
        );
      }
      if (wasDowngraded) downgraded++;

      evaluations.push({
        candidateId: id,
        requirementId: row.requirementId,
        verdict: row.verdict,
        evidence: row.evidence,
        reasoning: row.reasoning,
        downgradeReason: row.downgradeReason,
      });
    });
  }

  return { jobId, requirements, candidates, evaluations, downgraded };
}

function toSql(plan: ReturnType<typeof buildPlan>): string {
  const lines: string[] = [
    "begin;",
    "delete from public.jobs;",
    `insert into public.jobs (id, title, description, locked) values (${q(plan.jobId)}, ${q(
      SEED_JOB.title,
    )}, ${q(SEED_JOB.description)}, true);`,
    "insert into public.requirements (id, job_id, text, kind, sort_order) values",
    plan.requirements
      .map(
        (r) =>
          `  (${q(r.id)}, ${q(plan.jobId)}, ${q(r.text)}, ${q(r.kind)}, ${r.sortOrder})`,
      )
      .join(",\n") + ";",
    "insert into public.candidates (id, job_id, name, cv_text, status) values",
    plan.candidates
      .map((c) => `  (${q(c.id)}, ${q(plan.jobId)}, ${q(c.name)}, ${q(c.cvText)}, 'done')`)
      .join(",\n") + ";",
    "insert into public.evaluations (candidate_id, requirement_id, verdict, evidence, reasoning, downgrade_reason) values",
    plan.evaluations
      .map(
        (e) =>
          `  (${q(e.candidateId)}, ${q(e.requirementId)}, ${q(e.verdict)}, ${q(
            e.evidence,
          )}, ${q(e.reasoning)}, ${q(e.downgradeReason)})`,
      )
      .join(",\n") + ";",
    "commit;",
  ];
  return lines.join("\n");
}

async function writeToSupabase(plan: ReturnType<typeof buildPlan>) {
  const { createClient } = await import("@supabase/supabase-js");

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. Run with --sql to print SQL instead.",
    );
  }

  const client = createClient(url, key, { auth: { persistSession: false } });
  const check = (error: { message: string } | null, step: string) => {
    if (error) throw new Error(`${step}: ${error.message}`);
  };

  check((await client.from("jobs").delete().not("id", "is", null)).error, "clear jobs");
  check(
    (
      await client.from("jobs").insert({
        id: plan.jobId,
        title: SEED_JOB.title,
        description: SEED_JOB.description,
        locked: true,
      })
    ).error,
    "insert job",
  );
  check(
    (
      await client.from("requirements").insert(
        plan.requirements.map((r) => ({
          id: r.id,
          job_id: plan.jobId,
          text: r.text,
          kind: r.kind,
          sort_order: r.sortOrder,
        })),
      )
    ).error,
    "insert requirements",
  );
  check(
    (
      await client.from("candidates").insert(
        plan.candidates.map((c) => ({
          id: c.id,
          job_id: plan.jobId,
          name: c.name,
          cv_text: c.cvText,
          status: "done",
        })),
      )
    ).error,
    "insert candidates",
  );
  check(
    (
      await client.from("evaluations").insert(
        plan.evaluations.map((e) => ({
          candidate_id: e.candidateId,
          requirement_id: e.requirementId,
          verdict: e.verdict,
          evidence: e.evidence,
          reasoning: e.reasoning,
          downgrade_reason: e.downgradeReason,
        })),
      )
    ).error,
    "insert evaluations",
  );
}

async function main() {
  loadEnv();
  const plan = buildPlan();

  if (process.argv.includes("--sql")) {
    process.stdout.write(toSql(plan) + "\n");
    return;
  }

  await writeToSupabase(plan);
  console.log(
    `Seeded "${SEED_JOB.title}" with ${plan.requirements.length} requirements, ` +
      `${plan.candidates.length} candidates and ${plan.evaluations.length} evaluations ` +
      `(${plan.downgraded} downgraded by the evidence validator).`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
