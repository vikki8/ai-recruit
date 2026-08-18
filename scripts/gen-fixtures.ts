/**
 * Builds real minimal PDF and DOCX files, checks they parse, and writes them into
 * tests/cv-fixtures.ts as base64. Run with: npx tsx scripts/gen-fixtures.ts
 *
 * The parser tests use these so they exercise unpdf and mammoth for real. Committing
 * generated base64 rather than binary blobs keeps the fixtures reviewable in a diff.
 */
import { writeFileSync } from "node:fs";
import { parseCv } from "../lib/parse-cv";

function buildPdf(lines: string[]): Uint8Array {
  const content =
    "BT /F1 12 Tf 20 260 Td 16 TL\n" +
    lines.map((l) => `(${l.replace(/([()\\])/g, "\\$1")}) Tj T*`).join("\n") +
    "\nET";

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

async function buildDocx(paragraphs: string[]): Promise<Uint8Array> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs
      .map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`)
      .join("")}</w:body></w:document>`,
  );

  return new Uint8Array(await zip.generateAsync({ type: "nodebuffer" }));
}

const wrap = (b64: string) =>
  (b64.match(/.{1,96}/g) ?? []).map((line) => `  "${line}"`).join(" +\n");

async function main() {
  const lines = [
    "Wren Halloway",
    "Senior Data Engineer, Leeds",
    "Six years building production data pipelines.",
    "Owned the order ingestion pipeline end to end.",
  ];

  const pdf = buildPdf(lines);
  const docx = await buildDocx(lines);
  // A structurally valid PDF with no text operators, standing in for a scanned CV.
  const emptyPdf = buildPdf([]);

  const fromPdf = await parseCv("wren_halloway_cv.pdf", pdf);
  const fromDocx = await parseCv("wren_halloway_cv.docx", docx);

  console.log("PDF  bytes:", pdf.byteLength, "pages:", fromPdf.pages);
  console.log("PDF  text :", JSON.stringify(fromPdf.text));
  console.log("DOCX bytes:", docx.byteLength);
  console.log("DOCX text :", JSON.stringify(fromDocx.text));
  console.log("empty PDF bytes:", emptyPdf.byteLength);

  writeFileSync(
    "tests/cv-fixtures.ts",
    `/**
 * Real PDF and DOCX files, base64 encoded, so the parser tests exercise unpdf and
 * mammoth for real rather than mocking them.
 *
 * Regenerate with: npx tsx scripts/gen-fixtures.ts
 */

export const FIXTURE_LINES = [
${lines.map((l) => `  ${JSON.stringify(l)},`).join("\n")}
];

const PDF_BASE64 =
${wrap(Buffer.from(pdf).toString("base64"))};

const DOCX_BASE64 =
${wrap(Buffer.from(docx).toString("base64"))};

/** A valid PDF containing no text at all, like a scan with no OCR layer. */
const EMPTY_PDF_BASE64 =
${wrap(Buffer.from(emptyPdf).toString("base64"))};

export const samplePdf = (): Uint8Array => new Uint8Array(Buffer.from(PDF_BASE64, "base64"));
export const sampleDocx = (): Uint8Array => new Uint8Array(Buffer.from(DOCX_BASE64, "base64"));
export const emptyPdf = (): Uint8Array =>
  new Uint8Array(Buffer.from(EMPTY_PDF_BASE64, "base64"));
`,
  );
  console.log("\ntests/cv-fixtures.ts written");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
