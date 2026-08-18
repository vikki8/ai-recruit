import { expect, test } from "@playwright/test";

/**
 * The end-to-end happy path: land on the seeded job, read the grid, open a candidate,
 * see quoted evidence, draft an invite. Then the second half creates a fresh job from a
 * pasted spec and adds two candidates to it.
 *
 * NOT RUN as part of this submission, and not wired into CI. It is committed because the
 * spec is cheap to write and documents the intended flow precisely, but the two hours
 * were better spent on the unit and integration layers that guard the rules the product
 * depends on. Running it needs a real ANTHROPIC_API_KEY and a seeded database:
 *
 *   npx playwright install chromium
 *   npm run seed
 *   npx playwright test
 */

const JOB_SPEC = `Senior Data Engineer

We need a senior data engineer to own our ingestion pipelines.

Requirements:
- At least 4 years building production data pipelines
- Strong Python
- Experience with dbt or a comparable transformation framework
- Designed and owned a pipeline end to end

Nice to have:
- Airflow in production
- Experience with Snowflake`;

const CV_STRONG = `Wren Halloway
Senior Data Engineer, Leeds

Six years building production data pipelines for retail analytics.
Owned the order ingestion pipeline end to end, including its alerting.
Everything is written in Python, with dbt for all transformations.
Airflow schedules every job we run in production.`;

const CV_WEAK = `Jamie Cole
Analyst, Leeds

Two years in a business analyst role.
Built dashboards in Looker and wrote some SQL for ad hoc reporting.`;

test("seeded job: grid, candidate evidence, and a drafted invite", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Senior Backend Engineer" })).toBeVisible();

  // The comparison grid is present with the seeded candidates as columns.
  await expect(page.getByRole("link", { name: "Priya Raman" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Mei Lin Chen" })).toBeVisible();

  // Ranking is deterministic: a missing must-have disqualifies regardless of strength.
  await expect(page.getByText(/Not shortlisted/).first()).toBeVisible();

  // Sofia's must-have was claimed by the model with a quote absent from her CV.
  await page.getByRole("link", { name: "Sofia Andersson" }).click();
  await expect(page.getByRole("heading", { name: "Sofia Andersson" })).toBeVisible();
  await expect(
    page.getByText(/does not appear in this CV, so this was recorded as missing/),
  ).toBeVisible();

  // Every surviving verdict shows the quote it rests on.
  await expect(
    page.getByText("Everything I ship is TypeScript on Node, with a little Go for tooling."),
  ).toBeVisible();

  await page.getByRole("button", { name: /Draft interview invite/ }).click();
  await expect(page.getByText(/Written from \d+ verified quote/)).toBeVisible({ timeout: 60_000 });
});

test("new job: extract requirements, add two candidates, compare them", async ({ page }) => {
  await page.goto("/new");

  await page.getByPlaceholder("Paste the full job description").fill(JOB_SPEC);
  await page.getByRole("button", { name: "Extract requirements" }).click();

  // Lands on the new job page once extraction returns.
  await expect(page.getByRole("heading", { name: /Data Engineer/ })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("Requirements")).toBeVisible();

  for (const cv of [CV_STRONG, CV_WEAK]) {
    await page.getByPlaceholder("Paste the full CV as plain text").fill(cv);
    await page.getByRole("button", { name: "Evaluate candidate" }).click();
    await expect(page.getByText(/added\./)).toBeVisible({ timeout: 60_000 });
  }

  await expect(page.getByRole("link", { name: "Wren Halloway" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Jamie Cole" })).toBeVisible();

  // The requirement set locks once the first candidate has been measured against it.
  await expect(page.getByText(/Locked/)).toBeVisible();
});
