import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { DraftResponse, EvaluationResponse, ExtractionResponse } from "./schemas";

/**
 * The three model calls, through the official Anthropic SDK.
 *
 * Structured outputs (output_config.format) constrain the response to the zod schema
 * server-side, so malformed JSON is rare rather than routine. It is still not trusted:
 * every evaluation goes through lib/evidence.ts before anything reaches the database.
 */

const DEFAULT_MODEL = "claude-opus-5";
const TIMEOUT_MS = 30_000;
const MAX_TOKENS = 8000;

export type AiErrorKind = "config" | "timeout" | "transport" | "malformed" | "refusal";

export class AiError extends Error {
  readonly kind: AiErrorKind;
  constructor(message: string, kind: AiErrorKind) {
    super(message);
    this.name = "AiError";
    this.kind = kind;
  }
}

let cached: Anthropic | null = null;

function client(): Anthropic {
  if (cached) return cached;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AiError("ANTHROPIC_API_KEY is not set.", "config");
  cached = new Anthropic({ apiKey, maxRetries: 1, timeout: TIMEOUT_MS });
  return cached;
}

function model(): string {
  return process.env.AI_MODEL || DEFAULT_MODEL;
}

function toAiError(err: unknown): AiError {
  if (err instanceof AiError) return err;

  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiError("The AI request timed out. Please try again.", "timeout");
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return new AiError("The Anthropic API key was rejected.", "config");
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AiError("Rate limited by the Anthropic API. Try again shortly.", "transport");
  }
  if (err instanceof Anthropic.APIError) {
    return new AiError(`Anthropic API error ${err.status}: ${err.message}`, "transport");
  }
  return new AiError(err instanceof Error ? err.message : String(err), "transport");
}

/**
 * One structured call, with a single retry when the response cannot be parsed into the
 * schema. After two failures the caller gets a typed error the UI renders as a state.
 */
async function callStructured<T>(
  name: string,
  schema: z.ZodType<T>,
  system: string,
  user: string,
): Promise<T> {
  const attempt = async (extra?: string): Promise<T | null> => {
    const message = await client().messages.parse({
      model: model(),
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: "user", content: extra ? `${user}\n\n${extra}` : user }],
      output_config: { format: zodOutputFormat(schema) },
    });

    if (message.stop_reason === "refusal") {
      throw new AiError("The model declined to answer this request.", "refusal");
    }
    return (message.parsed_output as T | null) ?? null;
  };

  try {
    const first = await attempt();
    if (first !== null) return first;

    const second = await attempt(
      "Your previous response could not be parsed. Reply again with valid JSON matching the required schema exactly.",
    );
    if (second !== null) return second;

    throw new AiError(`The AI returned an unreadable ${name} response twice.`, "malformed");
  } catch (err) {
    throw toAiError(err);
  }
}

/** ---------------- Call A: requirement extraction ---------------- */

const EXTRACTION_SYSTEM = `You extract hiring requirements from a job description. You do not evaluate anyone.

Rules:
- Each requirement is ONE atomic, checkable thing. Split compound phrases: "React and
  TypeScript" becomes two requirements.
- Phrase each as a short noun phrase a reviewer could check against a CV. No benefits,
  no culture statements, no responsibilities that are not skills or experience.
- kind = "must_have" when the text marks it required, essential, must, or minimum, or
  when it is plainly a core capability of the role.
- kind = "nice_to_have" when marked preferred, bonus, plus, desirable, or nice to have.
- Return between 3 and 12 requirements.
- If the description contains too little information to produce at least 3 requirements,
  return an empty title and an empty requirements array.
- Never invent a requirement that the text does not support.`;

export async function extractRequirements(description: string): Promise<ExtractionResponse> {
  return callStructured(
    "requirement_extraction",
    ExtractionResponse,
    EXTRACTION_SYSTEM,
    `Job description:\n\n${description}`,
  );
}

/** ---------------- Call B: candidate evaluation ---------------- */

const EVALUATION_SYSTEM = `You check one candidate CV against a list of requirements. You judge evidence only. You never score, rank, compare candidates, or recommend a hiring decision.

Verdicts:
- "met":     the CV contains direct evidence the requirement is satisfied.
- "partial": the CV contains related but incomplete evidence, such as an adjacent
             technology, less experience than asked for, or unclear scope or ownership.
- "missing": the CV contains no supporting evidence.

Hard rules:
- For "met" or "partial" you MUST return "evidence": a span copied VERBATIM, character
  for character, from the CV text. Do not paraphrase. Do not fix typos or capitalisation.
  Do not join separate lines. Do not add ellipses or quotation marks. Copy one contiguous
  span.
- If you cannot copy a verbatim supporting span, the verdict is "missing" and "evidence"
  must be null. This rule is absolute.
- Use only the CV text. Never use outside knowledge about the person, their employers, or
  what one technology implies about another.
- "reasoning": one sentence, 20 words maximum.
- Return exactly one result for every requirement id given, and no other ids.`;

export type RequirementForModel = {
  handle: string;
  text: string;
  kind: "must_have" | "nice_to_have";
};

export async function evaluateCandidate(
  cvText: string,
  requirements: RequirementForModel[],
): Promise<EvaluationResponse> {
  const list = requirements
    .map((r) => `${r.handle}. [${r.kind === "must_have" ? "MUST" : "NICE"}] ${r.text}`)
    .join("\n");

  return callStructured(
    "candidate_evaluation",
    EvaluationResponse,
    EVALUATION_SYSTEM,
    `Requirements:\n${list}\n\n--- CV TEXT BEGINS ---\n${cvText}\n--- CV TEXT ENDS ---`,
  );
}

/** ---------------- Call C: interview invite draft ----------------
 * Deliberately never sees the CV. It is given only the evidence quotes that already
 * survived verbatim validation, so it cannot reference experience that failed the check.
 */

const DRAFT_SYSTEM = `You draft a short interview invitation email.

You are given a job title, a candidate name, and a list of requirements with the VERBATIM
evidence lines that were verified against their CV. You are not given the CV itself.

Rules:
- Reference at most three specific pieces of the supplied evidence. Paraphrase naturally.
- Never claim experience that is not in the supplied evidence list.
- Never state or imply a score, a rank, or a comparison to other candidates.
- Under 150 words. No placeholder brackets except [Your name].`;

export type DraftEvidence = { requirement: string; quote: string };

export async function draftInvite(
  jobTitle: string,
  candidateName: string,
  evidence: DraftEvidence[],
): Promise<DraftResponse> {
  const lines = evidence.length
    ? evidence.map((e) => `- ${e.requirement}\n  Verified quote: "${e.quote}"`).join("\n")
    : "(no verified evidence)";

  return callStructured(
    "invite_draft",
    DraftResponse,
    DRAFT_SYSTEM,
    `Job title: ${jobTitle}\nCandidate name: ${candidateName}\n\nVerified evidence:\n${lines}`,
  );
}
