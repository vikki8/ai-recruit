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

/** ---------- Call A: requirement extraction ---------- */

export const ExtractionResponse = z.object({
  title: z.string(),
  requirements: z.array(
    z.object({
      text: z.string().min(1),
      kind: RequirementKind,
    }),
  ),
});
export type ExtractionResponse = z.infer<typeof ExtractionResponse>;

export const extractionJsonSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    requirements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          kind: { type: "string", enum: ["must_have", "nice_to_have"] },
        },
        required: ["text", "kind"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "requirements"],
  additionalProperties: false,
} as const;

/** ---------- Call B: candidate evaluation ----------
 * `verdict` is deliberately typed as a loose string rather than an enum. If the model
 * returns something unexpected for ONE requirement we want to downgrade that single
 * requirement to `missing`, not reject the whole response and lose the other 11 good
 * answers. All tightening happens in lib/evidence.ts, which is the only place allowed
 * to decide a final verdict.
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

export const evaluationJsonSchema = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          verdict: { type: "string", enum: ["met", "partial", "missing"] },
          evidence: { type: ["string", "null"] },
          reasoning: { type: "string" },
        },
        required: ["id", "verdict", "evidence", "reasoning"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
} as const;

/** ---------- Call C: interview invite draft ---------- */

export const DraftResponse = z.object({
  subject: z.string(),
  body: z.string(),
});
export type DraftResponse = z.infer<typeof DraftResponse>;

export const draftJsonSchema = {
  type: "object",
  properties: {
    subject: { type: "string" },
    body: { type: "string" },
  },
  required: ["subject", "body"],
  additionalProperties: false,
} as const;
