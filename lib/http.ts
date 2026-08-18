import { NextResponse } from "next/server";
import { AiError } from "./ai";

/** Shape every route returns on failure, so the UI has one thing to render. */
export type ApiError = { error: string };

export function badRequest(message: string) {
  return NextResponse.json<ApiError>({ error: message }, { status: 400 });
}

export function notFound(message: string) {
  return NextResponse.json<ApiError>({ error: message }, { status: 404 });
}

export function conflict(message: string) {
  return NextResponse.json<ApiError>({ error: message }, { status: 409 });
}

/**
 * Turns any thrown error into a response the UI can show a person. AI failures get
 * a message describing what to do next; anything else is reported without leaking
 * internals into the browser.
 */
export function failure(err: unknown) {
  if (err instanceof AiError) {
    const message =
      err.kind === "timeout"
        ? "The AI call timed out. Try again."
        : err.kind === "malformed"
          ? "The AI returned an unreadable response twice. Try again."
          : err.kind === "config"
            ? "The AI is not configured. Check ANTHROPIC_API_KEY."
            : err.kind === "refusal"
              ? "The model declined to process this text."
              : err.message;

    return NextResponse.json<ApiError>(
      { error: message },
      { status: err.kind === "config" ? 500 : 502 },
    );
  }

  console.error(err);
  return NextResponse.json<ApiError>(
    { error: "Something went wrong. Please try again." },
    { status: 500 },
  );
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** First non-blank line of a CV, used when the recruiter leaves the name box empty. */
export function nameFromCv(cvText: string): string {
  const line = cvText.split(/\r?\n/).find((l) => l.trim().length > 0);
  return (line ?? "").trim().slice(0, 80) || "Unnamed candidate";
}
