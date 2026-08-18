import { describe, expect, it } from "vitest";
import {
  MAX_FILE_BYTES,
  ParseError,
  cleanExtractedText,
  detectFormat,
  parseCv,
  suggestName,
} from "@/lib/parse-cv";
import { FIXTURE_LINES, emptyPdf, sampleDocx, samplePdf } from "./cv-fixtures";

const SOFT_HYPHEN = "­";
const ZERO_WIDTH = "​";
const NBSP = " ";

describe("cleanExtractedText", () => {
  it("keeps ordinary spaces between words", () => {
    // Guards a real bug: an over-eager whitespace regex that deleted every space and
    // silently turned every CV into one unreadable word.
    expect(cleanExtractedText("Priya Raman is a backend engineer")).toBe(
      "Priya Raman is a backend engineer",
    );
  });

  it("strips soft hyphens and zero-width characters left by PDF extraction", () => {
    expect(cleanExtractedText(`Sen${SOFT_HYPHEN}ior Eng${ZERO_WIDTH}ineer`)).toBe(
      "Senior Engineer",
    );
  });

  it("collapses non-breaking spaces and tabs to a single space", () => {
    expect(cleanExtractedText(`Priya${NBSP}Raman\t\tLondon`)).toBe("Priya Raman London");
  });

  it("normalises line endings and collapses runs of blank lines", () => {
    expect(cleanExtractedText("A\r\n\r\n\r\n\r\nB")).toBe("A\n\nB");
  });

  it("trims leading and trailing whitespace", () => {
    expect(cleanExtractedText("   \n  Priya  \n   ")).toBe("Priya");
  });
});

describe("suggestName", () => {
  it("uses the first non-blank line when it looks like a name", () => {
    expect(suggestName("Priya Raman\nSenior Engineer", "cv.pdf")).toBe("Priya Raman");
  });

  it("falls back to the filename when the first line is an email", () => {
    expect(suggestName("contact@example.com\nPriya", "priya_raman_cv.pdf")).toBe(
      "priya raman cv",
    );
  });

  it("falls back to the filename when the first line carries a year", () => {
    expect(suggestName("Curriculum Vitae 2024\nPriya", "priya-raman.docx")).toBe("priya raman");
  });

  it("falls back when the first line is too long to be a name", () => {
    const long = "A".repeat(80);
    expect(suggestName(`${long}\nPriya`, "wren.pdf")).toBe("wren");
  });

  it("never returns an empty string", () => {
    expect(suggestName("", ".pdf")).toBe("Unnamed candidate");
  });
});

describe("detectFormat", () => {
  it("recognises pdf and docx regardless of case", () => {
    expect(detectFormat("CV.PDF")).toBe("pdf");
    expect(detectFormat("cv.DocX")).toBe("docx");
  });

  it("rejects legacy .doc with actionable advice", () => {
    try {
      detectFormat("cv.doc");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      expect((err as ParseError).kind).toBe("unsupported");
      expect((err as ParseError).message).toMatch(/save as \.docx/i);
    }
  });

  it("points plain-text formats at the paste box", () => {
    expect(() => detectFormat("cv.txt")).toThrow(/paste the contents/i);
  });

  it("rejects a file with no extension and an unknown extension", () => {
    expect(() => detectFormat("cv")).toThrow(/no extension/i);
    expect(() => detectFormat("cv.pages")).toThrow(/not supported/i);
  });
});

describe("parseCv", () => {
  it("extracts every line from a real PDF", async () => {
    const parsed = await parseCv("wren_halloway_cv.pdf", samplePdf());

    for (const line of FIXTURE_LINES) expect(parsed.text).toContain(line);
    expect(parsed.pages).toBe(1);
    expect(parsed.suggestedName).toBe("Wren Halloway");
    expect(parsed.filename).toBe("wren_halloway_cv.pdf");
  });

  it("extracts every line from a real .docx", async () => {
    const parsed = await parseCv("wren_halloway_cv.docx", sampleDocx());

    for (const line of FIXTURE_LINES) expect(parsed.text).toContain(line);
    expect(parsed.pages).toBeNull();
    expect(parsed.suggestedName).toBe("Wren Halloway");
  });

  it("does not detach the caller's buffer", async () => {
    // pdf.js takes ownership of any buffer handed to it. Without an internal copy this
    // leaves the caller with a zero-length array, which is a very quiet way to lose data.
    const bytes = samplePdf();
    const before = bytes.byteLength;

    await parseCv("cv.pdf", bytes);

    expect(bytes.byteLength).toBe(before);
  });

  it("produces text a verbatim quote can be found in", async () => {
    // The whole product rests on this: the stored text must contain the spans the model
    // will later be asked to quote.
    const parsed = await parseCv("cv.pdf", samplePdf());
    expect(parsed.text).toContain("Owned the order ingestion pipeline end to end.");
  });

  it("rejects a scanned PDF that carries no text layer", async () => {
    await expect(parseCv("scan.pdf", emptyPdf())).rejects.toMatchObject({
      kind: "empty",
      message: expect.stringMatching(/scan or an image/i),
    });
  });

  it("rejects an empty file", async () => {
    await expect(parseCv("cv.pdf", new Uint8Array(0))).rejects.toMatchObject({
      kind: "empty",
    });
  });

  it("rejects a file over the size limit before trying to parse it", async () => {
    await expect(parseCv("cv.pdf", new Uint8Array(MAX_FILE_BYTES + 1))).rejects.toMatchObject({
      kind: "too_large",
      message: expect.stringMatching(/limit is 4MB/i),
    });
  });

  it("rejects an unsupported extension before reading any bytes", async () => {
    await expect(parseCv("cv.doc", samplePdf())).rejects.toMatchObject({
      kind: "unsupported",
    });
  });

  it("reports a corrupt PDF rather than throwing something raw", async () => {
    const garbage = new Uint8Array(Buffer.from("this is definitely not a pdf", "utf8"));
    await expect(parseCv("cv.pdf", garbage)).rejects.toMatchObject({ kind: "corrupt" });
  });
});
