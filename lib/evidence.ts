import { DowngradeReason, Verdict } from "./schemas";

/**
 * Evidence validation. Nothing the model says about a verdict is trusted until the
 * supporting quote has been located in the CV the user actually submitted.
 *
 * A "met" or "partial" verdict survives only if its quote can be found in the CV.
 * Everything else is forced to "missing" with a recorded reason.
 */

export type ModelResult = {
  id: string;
  verdict: string;
  evidence: string | null;
  reasoning: string;
};

export type RequirementRef = {
  id: string;
  handle: string;
  text: string;
  kind: "must_have" | "nice_to_have";
};

export type ValidatedEvaluation = {
  requirementId: string;
  verdict: "met" | "partial" | "missing";
  evidence: string | null;
  reasoning: string;
  downgradeReason: DowngradeReason | null;
};

/** Characters models silently substitute when copying text. */
const CHAR_FOLD: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "‚": "'",
  "‛": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "‟": '"',
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "–": "-",
  "—": "-",
  "―": "-",
  "−": "-",
  "…": "...",
};

type Normalised = {
  /** The comparable form. */
  text: string;
  /** map[i] is the index in the ORIGINAL string that normalised char i came from. */
  map: number[];
};

/**
 * Collapses whitespace runs to one space, folds lookalike punctuation, and casefolds,
 * while remembering where every surviving character came from.
 *
 * The index map is the point. A plain `cv.includes(quote)` would reject a quote that is
 * correct in substance but reflowed a line break or swapped an en dash, which would show
 * a real match as a gap. Normalising fixes that; the map lets us then store the TRUE
 * span from the CV rather than the model's copy of it.
 */
export function normalise(input: string): Normalised {
  const chars: string[] = [];
  const map: number[] = [];
  let pendingSpace = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      pendingSpace = chars.length > 0;
      continue;
    }
    if (pendingSpace) {
      chars.push(" ");
      map.push(i);
      pendingSpace = false;
    }
    const folded = (CHAR_FOLD[ch] ?? ch).toLowerCase();
    for (const c of folded) {
      chars.push(c);
      map.push(i);
    }
  }

  return { text: chars.join(""), map };
}

/**
 * Locates `quote` inside `cvText` under normalisation. Returns the matching span taken
 * verbatim from the ORIGINAL CV text, or null when the quote is not present at all.
 */
export function findVerbatimSpan(cvText: string, quote: string): string | null {
  const haystack = normalise(cvText);
  const needle = normalise(quote);
  if (needle.text.length === 0) return null;

  const at = haystack.text.indexOf(needle.text);
  if (at === -1) return null;

  const start = haystack.map[at];
  const end = haystack.map[at + needle.text.length - 1] + 1;
  return cvText.slice(start, end);
}

function downgrade(
  requirementId: string,
  reasoning: string,
  reason: DowngradeReason,
): ValidatedEvaluation {
  return {
    requirementId,
    verdict: "missing",
    evidence: null,
    reasoning,
    downgradeReason: reason,
  };
}

/**
 * Turns a raw model response into the rows we are willing to store. Always returns
 * exactly one entry per requirement, in requirement order. Unknown ids are dropped.
 */
export function validateEvaluations(
  cvText: string,
  requirements: RequirementRef[],
  modelResults: ModelResult[],
): ValidatedEvaluation[] {
  const byHandle = new Map<string, ModelResult>();
  for (const result of modelResults) {
    if (!byHandle.has(result.id)) byHandle.set(result.id, result);
  }

  return requirements.map((req) => {
    const result = byHandle.get(req.handle);
    if (!result) return downgrade(req.id, "", "no_result");

    const reasoning = (result.reasoning ?? "").trim();

    const verdict = Verdict.safeParse(result.verdict);
    if (!verdict.success) return downgrade(req.id, reasoning, "bad_verdict");

    if (verdict.data === "missing") {
      return {
        requirementId: req.id,
        verdict: "missing" as const,
        evidence: null,
        reasoning,
        downgradeReason: null,
      };
    }

    const quote = (result.evidence ?? "").trim();
    if (quote === "") return downgrade(req.id, reasoning, "no_evidence");

    const span = findVerbatimSpan(cvText, quote);
    if (span === null) return downgrade(req.id, reasoning, "quote_not_found");

    return {
      requirementId: req.id,
      verdict: verdict.data,
      evidence: span,
      reasoning,
      downgradeReason: null,
    };
  });
}
