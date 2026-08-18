import { readFileSync } from "node:fs";
import { draftInvite, evaluateCandidate, extractRequirements } from "../lib/ai";
import { validateEvaluations, type RequirementRef } from "../lib/evidence";
import { SEED_CANDIDATES, SEED_JOB } from "../lib/seed-data";

/**
 * Live end-to-end check of the three model calls: extract, evaluate, draft.
 *
 *   npm run smoke
 *
 * Makes real API calls. Useful for confirming ANTHROPIC_API_KEY and AI_MODEL are set
 * correctly before running the app, and for seeing how often the model's quotes survive
 * verbatim validation on a given model.
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
    // No .env; rely on the ambient environment.
  }
}

async function main() {
  loadEnv();
  console.log(`model: ${process.env.AI_MODEL || "claude-opus-5"}\n`);

  console.log("1/3 extracting requirements...");
  const extraction = await extractRequirements(SEED_JOB.description);
  console.log(`  title: ${extraction.title}`);
  for (const r of extraction.requirements) {
    console.log(`  [${r.kind === "must_have" ? "MUST" : "NICE"}] ${r.text}`);
  }

  const refs: RequirementRef[] = extraction.requirements.map((r, i) => ({
    id: `req-${i + 1}`,
    handle: `r${i + 1}`,
    text: r.text,
    kind: r.kind,
  }));

  const candidate = SEED_CANDIDATES[0];
  console.log(`\n2/3 evaluating ${candidate.name} against ${refs.length} requirements...`);
  const response = await evaluateCandidate(candidate.cvText, refs);
  const validated = validateEvaluations(candidate.cvText, refs, response.results);

  for (const [i, row] of validated.entries()) {
    const quote = row.evidence ? `"${row.evidence.slice(0, 60)}"` : "-";
    const note = row.downgradeReason ? `  <- DOWNGRADED (${row.downgradeReason})` : "";
    console.log(`  ${refs[i].handle} ${row.verdict.padEnd(7)} ${quote}${note}`);
  }

  const downgraded = validated.filter((v) => v.downgradeReason !== null).length;
  console.log(
    `\n  ${validated.length - downgraded}/${validated.length} verdicts survived verbatim validation.`,
  );

  console.log("\n3/3 drafting an invite from verified quotes only...");
  const evidence = validated
    .filter((v) => v.evidence !== null)
    .map((v, i) => ({ requirement: refs[i]?.text ?? "Requirement", quote: v.evidence as string }));
  const draft = await draftInvite(SEED_JOB.title, candidate.name, evidence);
  console.log(`  subject: ${draft.subject}`);
  console.log(`  body:\n${draft.body.replace(/^/gm, "    ")}`);

  console.log("\nAll three calls succeeded.");
}

main().catch((err) => {
  console.error(`\nFAILED: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
