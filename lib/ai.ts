import { z } from "zod";
import {
  DraftResponse,
  EvaluationResponse,
  ExtractionResponse,
  draftJsonSchema,
  evaluationJsonSchema,
  extractionJsonSchema,
} from "./schemas";
import { fakeDraft, fakeEvaluate, fakeExtract } from "./fake-ai";

const DEFAULT_BASE_URL = "https://ai-gateway.vercel.sh/v1";
const DEFAULT_MODEL = "anthropic/claude-sonnet-5";
const TIMEOUT_MS = 25_000;

export type AiErrorKind = "config" | "timeout" | "transport" | "malformed";

export class AiError extends Error {
  readonly kind: AiErrorKind;
  constructor(message: string, kind: AiErrorKind) {
    super(message);
    this.name = "AiError";
    this.kind = kind;
  }
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
type JsonSchema = { name: string; schema: unknown };

function usingFakeAi(): boolean {
  return process.env.FAKE_AI === "1";
}

/** One raw round trip to the OpenAI-compatible endpoint on the AI Gateway. */
async function chat(messages: ChatMessage[], jsonSchema: JsonSchema): Promise<string> {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) throw new AiError("AI_GATEWAY_API_KEY is not set.", "config");

  const baseUrl = process.env.AI_GATEWAY_BASE_URL || DEFAULT_BASE_URL;
  const model = process.env.AI_MODEL || DEFAULT_MODEL;

  const send = async (withResponseFormat: boolean): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 8192,
          messages,
          ...(withResponseFormat
            ? {
                response_format: {
                  type: "json_schema",
                  json_schema: {
                    name: jsonSchema.name,
                    strict: true,
                    schema: jsonSchema.schema,
                  },
                },
              }
            : {}),
        }),
        signal: controller.signal,
      });
    } catch (err) {
      const e = err as Error;
      if (e.name === "AbortError" || e.name === "TimeoutError") {
        throw new AiError("The AI request timed out. Please try again.", "timeout");
      }
      throw new AiError(`Could not reach the AI gateway: ${e.message}`, "transport");
    } finally {
      clearTimeout(timer);
    }
  };

  let res = await send(true);

  // Structured-output support varies by routed provider. If the gateway rejects the
  // response_format parameter itself, fall back to prompt-enforced JSON: the prompts
  // already demand raw JSON and every response is validated by zod regardless.
  if (res.status === 400) {
    const body = await res.text();
    if (body.includes("response_format")) {
      res = await send(false);
    } else {
      throw new AiError(`AI gateway rejected the request: ${body.slice(0, 300)}`, "transport");
    }
  }

  if (!res.ok) {
    const body = await res.text();
    throw new AiError(`AI gateway returned ${res.status}: ${body.slice(0, 300)}`, "transport");
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new AiError("The AI returned an empty response.", "malformed");
  }
  return content;
}

/** Models sometimes wrap JSON in markdown fences despite being told not to. */
function stripFences(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
}

function describe(err: unknown): string {
  if (err instanceof z.ZodError) {
    return err.issues.map((i) => `${i.path.join(".") || "root"}: ${i.message}`).join("; ");
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Calls the model and validates the result. Exactly one repair retry on malformed
 * JSON, with the parse error fed back, then a typed error the UI can render.
 */
async function callJson<T>(
  messages: ChatMessage[],
  jsonSchema: JsonSchema,
  parser: z.ZodType<T>,
): Promise<T> {
  const first = await chat(messages, jsonSchema);
  try {
    return parser.parse(JSON.parse(stripFences(first)));
  } catch (firstErr) {
    const repair: ChatMessage[] = [
      ...messages,
      { role: "assistant", content: first },
      {
        role: "user",
        content:
          `That response could not be parsed: ${describe(firstErr)}\n\n` +
          `Reply again with ONLY valid JSON matching the schema. No prose, no markdown fences.`,
      },
    ];
    const second = await chat(repair, jsonSchema);
    try {
      return parser.parse(JSON.parse(stripFences(second)));
    } catch (secondErr) {
      throw new AiError(
        `The AI returned malformed JSON twice. Last error: ${describe(secondErr)}`,
        "malformed",
      );
    }
  }
}

/** ---------------- Call A: requirement extraction ---------------- */

const EXTRACTION_SYSTEM = `You extract hiring requirements from a job description. You do not evaluate anyone.

Output ONLY a JSON object. No prose, no markdown fences.

Schema:
{ "title": string, "requirements": [ { "text": string, "kind": "must_have" | "nice_to_have" } ] }

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
  return { "title": "", "requirements": [] }.
- Never invent a requirement that the text does not support.`;

export async function extractRequirements(description: string): Promise<ExtractionResponse> {
  if (usingFakeAi()) return fakeExtract(description);
  return callJson(
    [
      { role: "system", content: EXTRACTION_SYSTEM },
      { role: "user", content: `Job description:\n\n${description}` },
    ],
    { name: "requirement_extraction", schema: extractionJsonSchema },
    ExtractionResponse,
  );
}

/** ---------------- Call B: candidate evaluation ---------------- */

const EVALUATION_SYSTEM = `You check one candidate CV against a list of requirements. You judge evidence only. You never score, rank, compare candidates, or recommend a hiring decision.

Output ONLY a JSON object. No prose, no markdown fences.

Schema:
{ "results": [ { "id": string, "verdict": "met" | "partial" | "missing",
                 "evidence": string | null, "reasoning": string } ] }

Verdicts:
- "met":     the CV contains direct evidence the requirement is satisfied.
- "partial": the CV contains related but incomplete evidence, such as an adjacent
             technology, less experience than asked for, or unclear scope or ownership.
- "missing": the CV contains no supporting evidence.

Hard rules:
- For "met" or "partial" you MUST return "evidence": a span copied VERBATIM, character
  for character, from the CV text below. Do not paraphrase. Do not fix typos or
  capitalisation. Do not join separate lines. Do not add ellipses or quotation marks.
  Copy one contiguous span.
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
  if (usingFakeAi()) return fakeEvaluate(cvText, requirements);

  const list = requirements
    .map((r) => `${r.handle}. [${r.kind === "must_have" ? "MUST" : "NICE"}] ${r.text}`)
    .join("\n");

  return callJson(
    [
      { role: "system", content: EVALUATION_SYSTEM },
      {
        role: "user",
        content: `Requirements:\n${list}\n\n--- CV TEXT BEGINS ---\n${cvText}\n--- CV TEXT ENDS ---`,
      },
    ],
    { name: "candidate_evaluation", schema: evaluationJsonSchema },
    EvaluationResponse,
  );
}

/** ---------------- Call C: interview invite draft ----------------
 * Deliberately never sees the CV. It is given only the evidence quotes that already
 * survived verbatim validation, so it cannot reference experience that failed the check.
 */

const DRAFT_SYSTEM = `You draft a short interview invitation email. Output ONLY JSON:
{ "subject": string, "body": string }

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
  if (usingFakeAi()) return fakeDraft(jobTitle, candidateName, evidence);

  const lines = evidence.length
    ? evidence.map((e) => `- ${e.requirement}\n  Verified quote: "${e.quote}"`).join("\n")
    : "(no verified evidence)";

  return callJson(
    [
      { role: "system", content: DRAFT_SYSTEM },
      {
        role: "user",
        content: `Job title: ${jobTitle}\nCandidate name: ${candidateName}\n\nVerified evidence:\n${lines}`,
      },
    ],
    { name: "invite_draft", schema: draftJsonSchema },
    DraftResponse,
  );
}
