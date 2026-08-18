/**
 * CV file parsing: PDF and DOCX in, plain text out.
 *
 * This sits in front of an otherwise unchanged pipeline. Whatever text comes out of here
 * is stored as candidates.cv_text AND is the exact string sent to the model, so the
 * verbatim-quote check in lib/evidence.ts still validates against the same text the model
 * read. Extraction quality therefore affects how well a candidate is evaluated; it can
 * never let an unsupported claim through.
 */

export const MAX_FILE_BYTES = 4 * 1024 * 1024;

/** Below this much real text we assume the file had no text layer at all. */
const MIN_USEFUL_CHARS = 30;

export type CvFormat = "pdf" | "docx";

export type ParseErrorKind = "unsupported" | "too_large" | "empty" | "corrupt";

export class ParseError extends Error {
  readonly kind: ParseErrorKind;
  constructor(message: string, kind: ParseErrorKind) {
    super(message);
    this.name = "ParseError";
    this.kind = kind;
  }
}

export type ParsedCv = {
  text: string;
  filename: string;
  suggestedName: string;
  pages: number | null;
};

function extensionOf(filename: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filename.trim());
  return match ? match[1].toLowerCase() : "";
}

/**
 * Decides how to parse, and refuses clearly when it cannot. Legacy .doc is called out by
 * name because "my CV is a Word file" most often means .docx, and a generic
 * "unsupported file" message would send people looking in the wrong place.
 */
export function detectFormat(filename: string): CvFormat {
  const ext = extensionOf(filename);

  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";

  if (ext === "doc") {
    throw new ParseError(
      "Legacy .doc files are not supported. Open it in Word and save as .docx, or paste the text instead.",
      "unsupported",
    );
  }
  if (ext === "txt" || ext === "md" || ext === "rtf") {
    throw new ParseError(
      `Paste the contents of a .${ext} file into the text box instead.`,
      "unsupported",
    );
  }
  if (ext === "") {
    throw new ParseError("That file has no extension, so it cannot be read.", "unsupported");
  }
  throw new ParseError(`.${ext} files are not supported. Upload a PDF or .docx.`, "unsupported");
}

/**
 * Tidies extracted text without changing what it says. Safe to do because this runs
 * before the text is stored, so the model and the validator still see one identical
 * string.
 */
export function cleanExtractedText(raw: string): string {
  return (
    raw
      .replace(/\r\n?/g, "\n")
      // Soft hyphens and zero-width characters, both common in justified PDF text.
      .replace(/[­​‌‍﻿]/g, "")
      // Any run of horizontal whitespace, including non-breaking spaces, becomes one space.
      .replace(/[^\S\n]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Best guess at the candidate's name: the first line that looks like one, falling back to
 * the filename. Same convention as the paste flow, which uses the first non-blank line.
 */
export function suggestName(text: string, filename: string): string {
  const firstLine = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  const plausible =
    firstLine !== undefined &&
    firstLine.length <= 60 &&
    /[a-z]/i.test(firstLine) &&
    !/@|https?:|\d{4}/.test(firstLine);

  if (plausible) return firstLine;

  const base = filename
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
  return base || "Unnamed candidate";
}

async function parsePdf(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  try {
    // pdf.js takes ownership of the buffer it is handed and detaches it, which would
    // leave the caller holding a zero-length array. Give it a copy instead.
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    return { text, pages: totalPages };
  } catch (err) {
    throw new ParseError(
      `That PDF could not be read (${err instanceof Error ? err.message : String(err)}). It may be corrupt or password protected.`,
      "corrupt",
    );
  }
}

async function parseDocx(bytes: Uint8Array): Promise<{ text: string; pages: null }> {
  const mammoth = (await import("mammoth")).default;
  try {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return { text: value, pages: null };
  } catch (err) {
    throw new ParseError(
      `That .docx could not be read (${err instanceof Error ? err.message : String(err)}). It may be corrupt.`,
      "corrupt",
    );
  }
}

export async function parseCv(filename: string, bytes: Uint8Array): Promise<ParsedCv> {
  if (bytes.byteLength === 0) {
    throw new ParseError("That file is empty.", "empty");
  }
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new ParseError(
      `That file is ${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB. The limit is ${MAX_FILE_BYTES / 1024 / 1024}MB.`,
      "too_large",
    );
  }

  const format = detectFormat(filename);
  const { text: raw, pages } = format === "pdf" ? await parsePdf(bytes) : await parseDocx(bytes);
  const text = cleanExtractedText(raw);

  // A PDF of scanned pages parses fine and yields nothing. Say so, rather than creating a
  // candidate whose every requirement is missing for the wrong reason.
  if (text.replace(/\s/g, "").length < MIN_USEFUL_CHARS) {
    throw new ParseError(
      format === "pdf"
        ? "No text could be read from that PDF. It is probably a scan or an image, so there is no text layer to quote from. Paste the text instead."
        : "No text could be read from that document.",
      "empty",
    );
  }

  return { text, filename, suggestedName: suggestName(text, filename), pages };
}
