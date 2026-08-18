import { NextResponse } from "next/server";
import { MAX_FILE_BYTES, ParseError, parseCv } from "@/lib/parse-cv";
import { badRequest, failure } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Turns an uploaded PDF or .docx into plain text.
 *
 * Deliberately separate from POST /api/candidates, which still takes text and is
 * unchanged. Parsing and evaluating are different failures with different fixes: an
 * unreadable file is the recruiter's problem to solve, a failed evaluation is ours. Two
 * routes keeps each one's errors honest, and leaves the door open to showing extracted
 * text for review before it is evaluated.
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return badRequest("Expected a file upload.");
  }

  const file = form.get("file");
  if (!(file instanceof File)) return badRequest("No file was uploaded.");

  // Checked before reading the body into memory as well as inside parseCv, so an
  // oversized upload is rejected without being buffered first.
  if (file.size > MAX_FILE_BYTES) {
    return badRequest(
      `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is ${MAX_FILE_BYTES / 1024 / 1024}MB.`,
    );
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = await parseCv(file.name, bytes);

    return NextResponse.json({
      filename: parsed.filename,
      name: parsed.suggestedName,
      text: parsed.text,
      pages: parsed.pages,
      characters: parsed.text.length,
    });
  } catch (err) {
    // A file we cannot read is a bad request, not a server fault. The message is written
    // for the person holding the file and says what to do next.
    if (err instanceof ParseError) {
      return NextResponse.json({ error: err.message, kind: err.kind }, { status: 400 });
    }
    return failure(err);
  }
}
