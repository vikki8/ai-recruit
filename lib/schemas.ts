import { z } from "zod";

export const RequirementKind = z.enum(["must_have", "nice_to_have"]);
export type RequirementKind = z.infer<typeof RequirementKind>;

export const Verdict = z.enum(["met", "partial", "missing"]);
export type Verdict = z.infer<typeof Verdict>;

export type DowngradeReason =
  | "no_evidence"
  | "quote_not_found"
  | "no_result"
  | "bad_verdict";

/** Call A: requirement extraction. */
export const ExtractionResponse = z.object({
  title: z.string(),
  requirements: z.array(
    z.object({
      text: z.string(),
      kind: RequirementKind,
    }),
  ),
});
export type ExtractionResponse = z.infer<typeof ExtractionResponse>;

/**
 * Call B: candidate evaluation.
 *
 * `verdict` is deliberately a loose string rather than an enum. If the model returns
 * something unexpected for ONE requirement we want to downgrade that single requirement
 * to `missing`, not reject the whole response and lose the other eleven good answers.
 * All tightening happens in lib/evidence.ts, the only place allowed to decide a verdict.
 */
export const EvaluationResponse = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      verdict: z.string(),
      evidence: z.string().nullable(),
      reasoning: z.string(),
    }),
  ),
});
export type EvaluationResponse = z.infer<typeof EvaluationResponse>;

/** Call C: interview invite draft. */
export const DraftResponse = z.object({
  subject: z.string(),
  body: z.string(),
});
export type DraftResponse = z.infer<typeof DraftResponse>;
