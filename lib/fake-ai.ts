import type { DraftEvidence, RequirementForModel } from "./ai";
import type { DraftResponse, EvaluationResponse, ExtractionResponse } from "./schemas";

/**
 * Deterministic stand-in for the model, used when FAKE_AI=1.
 *
 * It exists for two reasons: the end-to-end test needs a fixed, offline, no-key run,
 * and a live demo should not break because the gateway is slow or rate limited.
 * It deliberately produces quotes copied straight out of the CV, so the real evidence
 * validator still runs and still has something to verify.
 */

const STOPWORDS = new Set([
  "with", "and", "the", "for", "years", "year", "experience", "using", "strong",
  "production", "have", "from", "that", "this", "work", "working", "able", "team",
]);

function keywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

export function fakeExtract(description: string): ExtractionResponse {
  const bullets = description
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
    .filter((l) => l.length > 8);

  if (bullets.length < 3) return { title: "", requirements: [] };

  const firstLine = description.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "Role";

  return {
    title: firstLine.trim().slice(0, 80),
    requirements: bullets.slice(0, 8).map((text) => ({
      text,
      kind: /nice to have|preferred|bonus|plus|desirable/i.test(text)
        ? ("nice_to_have" as const)
        : ("must_have" as const),
    })),
  };
}

export function fakeEvaluate(
  cvText: string,
  requirements: RequirementForModel[],
): EvaluationResponse {
  const lines = cvText.split(/\r?\n/).filter((l) => l.trim().length > 0);

  return {
    results: requirements.map((req) => {
      const words = keywords(req.text);

      let bestLine: string | null = null;
      let bestHits = 0;
      for (const line of lines) {
        const lower = line.toLowerCase();
        const hits = words.filter((w) => lower.includes(w)).length;
        if (hits > bestHits) {
          bestHits = hits;
          bestLine = line;
        }
      }

      if (bestLine === null || bestHits === 0) {
        return {
          id: req.handle,
          verdict: "missing",
          evidence: null,
          reasoning: "No supporting line found in the CV.",
        };
      }

      return {
        id: req.handle,
        verdict: bestHits >= 2 ? "met" : "partial",
        evidence: bestLine.trim(),
        reasoning:
          bestHits >= 2
            ? "CV line matches the requirement directly."
            : "CV line is related but does not fully cover the requirement.",
      };
    }),
  };
}

export function fakeDraft(
  jobTitle: string,
  candidateName: string,
  evidence: DraftEvidence[],
): DraftResponse {
  const highlights = evidence.slice(0, 3).map((e) => `- ${e.requirement}: "${e.quote}"`);

  return {
    subject: `Interview invitation: ${jobTitle}`,
    body: [
      `Hi ${candidateName},`,
      "",
      `Thanks for applying for the ${jobTitle} role. Your background stood out on a few points we care about:`,
      "",
      ...(highlights.length ? highlights : ["- Your overall background"]),
      "",
      "Would you be open to a 45-minute conversation with the team next week? Let me know a couple of times that suit you.",
      "",
      "Best regards,",
      "[Your name]",
    ].join("\n"),
  };
}
