import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integration tests for the route handlers. The AI module and the database module are
 * both mocked, so nothing here touches the network or Supabase.
 *
 * The point of these is the seam between them: that a model response passes through
 * evidence validation before anything is stored, and that failures leave the app in a
 * state a person can understand.
 */

vi.mock("@/lib/ai", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai")>("@/lib/ai");
  return {
    ...actual,
    extractRequirements: vi.fn(),
    evaluateCandidate: vi.fn(),
    draftInvite: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({
  createJob: vi.fn(),
  insertRequirements: vi.fn(),
  getJob: vi.fn(),
  lockJob: vi.fn(),
  getRequirements: vi.fn(),
  getRequirement: vi.fn(),
  addRequirement: vi.fn(),
  updateRequirement: vi.fn(),
  deleteRequirement: vi.fn(),
  createCandidate: vi.fn(),
  getCandidate: vi.fn(),
  setCandidateStatus: vi.fn(),
  replaceEvaluations: vi.fn(),
  getEvaluationsForCandidate: vi.fn(),
}));

import { AiError, draftInvite, evaluateCandidate, extractRequirements } from "@/lib/ai";
import * as db from "@/lib/db";
import { POST as createCandidateRoute } from "@/app/api/candidates/route";
import { POST as draftRoute } from "@/app/api/draft/route";
import { POST as createJobRoute } from "@/app/api/jobs/route";
import { POST as parseRoute } from "@/app/api/parse/route";
import { PATCH as patchRequirementRoute } from "@/app/api/requirements/[id]/route";
import { FIXTURE_LINES, emptyPdf, sampleDocx, samplePdf } from "./cv-fixtures";

const post = (url: string, body: unknown) =>
  new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const LONG_SPEC = "Senior Backend Engineer. ".repeat(5).trim();

const CV = `Priya Raman
Eight years building production backend services.
Wrote the service in Go, with a TypeScript admin console alongside it.`;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/jobs", () => {
  it("rejects a whitespace-only job spec without calling the model", async () => {
    const res = await createJobRoute(post("http://t/api/jobs", { description: "   \n  " }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/paste a job description/i);
    expect(extractRequirements).not.toHaveBeenCalled();
  });

  it("rejects a job spec too short to extract from, without calling the model", async () => {
    const res = await createJobRoute(post("http://t/api/jobs", { description: "Backend dev" }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/too short/i);
    expect(extractRequirements).not.toHaveBeenCalled();
  });

  it("creates the job and stores the extracted requirements", async () => {
    vi.mocked(extractRequirements).mockResolvedValue({
      title: "Senior Backend Engineer",
      requirements: [
        { text: "5 years backend", kind: "must_have" },
        { text: "Kubernetes", kind: "nice_to_have" },
      ],
    });
    vi.mocked(db.createJob).mockResolvedValue({
      id: "job-1",
      title: "Senior Backend Engineer",
      description: LONG_SPEC,
      locked: false,
      created_at: "",
    });
    vi.mocked(db.insertRequirements).mockResolvedValue([
      { id: "r-1", job_id: "job-1", text: "5 years backend", kind: "must_have", sort_order: 0 },
      { id: "r-2", job_id: "job-1", text: "Kubernetes", kind: "nice_to_have", sort_order: 1 },
    ]);

    const res = await createJobRoute(post("http://t/api/jobs", { description: LONG_SPEC }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ jobId: "job-1", requirementCount: 2 });
  });

  it("still creates the job when the model extracts nothing", async () => {
    vi.mocked(extractRequirements).mockResolvedValue({ title: "", requirements: [] });
    vi.mocked(db.createJob).mockResolvedValue({
      id: "job-2",
      title: "Untitled role",
      description: LONG_SPEC,
      locked: false,
      created_at: "",
    });
    vi.mocked(db.insertRequirements).mockResolvedValue([]);

    const res = await createJobRoute(post("http://t/api/jobs", { description: LONG_SPEC }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ requirementCount: 0 });
    expect(db.createJob).toHaveBeenCalledWith("Untitled role", LONG_SPEC);
  });

  it("reports malformed JSON as a clear error rather than crashing", async () => {
    vi.mocked(extractRequirements).mockRejectedValue(
      new AiError("The AI returned malformed JSON twice.", "malformed"),
    );

    const res = await createJobRoute(post("http://t/api/jobs", { description: LONG_SPEC }));

    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/unreadable response twice/i);
  });

  it("reports a timeout as a clear error", async () => {
    vi.mocked(extractRequirements).mockRejectedValue(new AiError("aborted", "timeout"));

    const res = await createJobRoute(post("http://t/api/jobs", { description: LONG_SPEC }));

    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/timed out/i);
  });
});

describe("POST /api/candidates", () => {
  const job = {
    id: "job-1",
    title: "Senior Backend Engineer",
    description: "",
    locked: false,
    created_at: "",
  };
  const requirements = [
    { id: "req-1", job_id: "job-1", text: "Go or TypeScript", kind: "must_have" as const, sort_order: 0 },
  ];
  const candidate = {
    id: "cand-1",
    job_id: "job-1",
    name: "Priya Raman",
    cv_text: CV,
    status: "pending" as const,
    error_message: null,
    source_filename: null,
    created_at: "",
  };

  it("rejects an empty CV without calling the model", async () => {
    const res = await createCandidateRoute(
      post("http://t/api/candidates", { jobId: "job-1", cvText: "   " }),
    );

    expect(res.status).toBe(400);
    expect(evaluateCandidate).not.toHaveBeenCalled();
  });

  it("refuses to evaluate against an empty requirement set", async () => {
    vi.mocked(db.getJob).mockResolvedValue(job);
    vi.mocked(db.getRequirements).mockResolvedValue([]);

    const res = await createCandidateRoute(
      post("http://t/api/candidates", { jobId: "job-1", cvText: CV }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/at least one requirement/i);
  });

  it("stores a verdict whose quote is in the CV, and locks the job", async () => {
    vi.mocked(db.getJob).mockResolvedValue(job);
    vi.mocked(db.getRequirements).mockResolvedValue(requirements);
    vi.mocked(db.createCandidate).mockResolvedValue(candidate);
    vi.mocked(evaluateCandidate).mockResolvedValue({
      results: [
        {
          id: "r1",
          verdict: "met",
          evidence: "Wrote the service in Go, with a TypeScript admin console alongside it.",
          reasoning: "Uses both languages.",
        },
      ],
    });

    const res = await createCandidateRoute(
      post("http://t/api/candidates", { jobId: "job-1", cvText: CV }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ candidateId: "cand-1", downgraded: 0 });
    expect(db.lockJob).toHaveBeenCalledWith("job-1");
    expect(db.replaceEvaluations).toHaveBeenCalledWith("cand-1", [
      expect.objectContaining({ requirementId: "req-1", verdict: "met" }),
    ]);
    expect(db.setCandidateStatus).toHaveBeenCalledWith("cand-1", "done");
  });

  it("downgrades a met verdict whose quote is not in the CV before storing it", async () => {
    vi.mocked(db.getJob).mockResolvedValue(job);
    vi.mocked(db.getRequirements).mockResolvedValue(requirements);
    vi.mocked(db.createCandidate).mockResolvedValue(candidate);
    vi.mocked(evaluateCandidate).mockResolvedValue({
      results: [
        {
          id: "r1",
          verdict: "met",
          evidence: "Ten years of Rust in production",
          reasoning: "Claims Rust experience.",
        },
      ],
    });

    const res = await createCandidateRoute(
      post("http://t/api/candidates", { jobId: "job-1", cvText: CV }),
    );

    expect(await res.json()).toMatchObject({ downgraded: 1 });
    expect(db.replaceEvaluations).toHaveBeenCalledWith("cand-1", [
      expect.objectContaining({
        verdict: "missing",
        evidence: null,
        downgradeReason: "quote_not_found",
      }),
    ]);
  });

  it("keeps the candidate and marks it failed when the AI call times out", async () => {
    vi.mocked(db.getJob).mockResolvedValue(job);
    vi.mocked(db.getRequirements).mockResolvedValue(requirements);
    vi.mocked(db.createCandidate).mockResolvedValue(candidate);
    vi.mocked(evaluateCandidate).mockRejectedValue(new AiError("aborted", "timeout"));

    const res = await createCandidateRoute(
      post("http://t/api/candidates", { jobId: "job-1", cvText: CV }),
    );

    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/timed out/i);
    expect(db.setCandidateStatus).toHaveBeenCalledWith("cand-1", "error", expect.any(String));
    expect(db.replaceEvaluations).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/requirements/[id]", () => {
  it("refuses to edit a requirement once the job is locked", async () => {
    vi.mocked(db.getRequirement).mockResolvedValue({
      id: "req-1",
      job_id: "job-1",
      text: "Go",
      kind: "must_have",
      sort_order: 0,
    });
    vi.mocked(db.getJob).mockResolvedValue({
      id: "job-1",
      title: "",
      description: "",
      locked: true,
      created_at: "",
    });

    const res = await patchRequirementRoute(
      post("http://t/api/requirements/req-1", { text: "Rust" }),
      { params: Promise.resolve({ id: "req-1" }) },
    );

    expect(res.status).toBe(409);
    expect(db.updateRequirement).not.toHaveBeenCalled();
  });
});

describe("POST /api/draft", () => {
  it("passes only verified quotes to the model, never the CV", async () => {
    vi.mocked(db.getCandidate).mockResolvedValue({
      id: "cand-1",
      job_id: "job-1",
      name: "Priya Raman",
      cv_text: CV,
      status: "done",
      error_message: null,
      source_filename: null,
      created_at: "",
    });
    vi.mocked(db.getJob).mockResolvedValue({
      id: "job-1",
      title: "Senior Backend Engineer",
      description: "",
      locked: true,
      created_at: "",
    });
    vi.mocked(db.getRequirements).mockResolvedValue([
      { id: "req-1", job_id: "job-1", text: "Go or TypeScript", kind: "must_have", sort_order: 0 },
      { id: "req-2", job_id: "job-1", text: "Kubernetes", kind: "nice_to_have", sort_order: 1 },
    ]);
    vi.mocked(db.getEvaluationsForCandidate).mockResolvedValue([
      {
        id: "e1",
        candidate_id: "cand-1",
        requirement_id: "req-1",
        verdict: "met",
        evidence: "Wrote the service in Go",
        reasoning: "",
        downgrade_reason: null,
      },
      {
        id: "e2",
        candidate_id: "cand-1",
        requirement_id: "req-2",
        verdict: "missing",
        evidence: null,
        reasoning: "",
        downgrade_reason: null,
      },
    ]);
    vi.mocked(draftInvite).mockResolvedValue({ subject: "Hello", body: "Body" });

    const res = await draftRoute(post("http://t/api/draft", { candidateId: "cand-1" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ subject: "Hello", evidenceUsed: 1 });

    expect(draftInvite).toHaveBeenCalledWith("Senior Backend Engineer", "Priya Raman", [
      { requirement: "Go or TypeScript", quote: "Wrote the service in Go" },
    ]);

    // The CV must never reach the drafting model.
    const args = JSON.stringify(vi.mocked(draftInvite).mock.calls[0]);
    expect(args).not.toContain("Eight years building production backend services");
  });
});

describe("POST /api/parse", () => {
  const upload = (filename: string, bytes: Uint8Array) => {
    const form = new FormData();
    form.append("file", new File([bytes as BlobPart], filename));
    return new Request("http://t/api/parse", { method: "POST", body: form });
  };

  it("turns an uploaded PDF into text a quote can be verified against", async () => {
    const res = await parseRoute(upload("wren_halloway_cv.pdf", samplePdf()));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Wren Halloway");
    expect(body.pages).toBe(1);
    expect(body.filename).toBe("wren_halloway_cv.pdf");
    for (const line of FIXTURE_LINES) expect(body.text).toContain(line);
  });

  it("turns an uploaded .docx into text", async () => {
    const res = await parseRoute(upload("wren_halloway_cv.docx", sampleDocx()));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Wren Halloway");
    for (const line of FIXTURE_LINES) expect(body.text).toContain(line);
  });

  it("rejects a legacy .doc as a bad request, not a server error", async () => {
    const res = await parseRoute(upload("cv.doc", samplePdf()));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.kind).toBe("unsupported");
    expect(body.error).toMatch(/save as \.docx/i);
  });

  it("rejects a scanned PDF with no text layer", async () => {
    const res = await parseRoute(upload("scan.pdf", emptyPdf()));

    expect(res.status).toBe(400);
    expect((await res.json()).kind).toBe("empty");
  });

  it("rejects a corrupt PDF", async () => {
    const res = await parseRoute(
      upload("cv.pdf", new Uint8Array(Buffer.from("not a pdf", "utf8"))),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).kind).toBe("corrupt");
  });

  it("rejects a request with no file attached", async () => {
    const res = await parseRoute(
      new Request("http://t/api/parse", { method: "POST", body: new FormData() }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/no file/i);
  });

  it("rejects a body that is not a file upload at all", async () => {
    const res = await parseRoute(post("http://t/api/parse", { nope: true }));

    expect(res.status).toBe(400);
  });
});
