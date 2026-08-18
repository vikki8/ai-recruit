# Evidence Match

Evidence-linked requirement matching for hiring. Paste a job spec, review the requirements the model pulled out of it, paste CVs, and get a grid where every "yes" is backed by a verbatim quote from the CV it came from.

## Architecture

Next.js App Router on Vercel, Supabase Postgres for persistence, Anthropic for the three model calls. Pages are server components that read through `lib/db.ts` (every database touch lives there as a plain function); mutations go through four route handlers under `app/api/`. There is no auth and no browser-side Supabase client — RLS is on with zero policies and the server holds the only key that can read past it.

## The AI / deterministic split

The model does exactly one kind of work: reading text and deciding whether a single requirement is evidenced, returning a verbatim quote when it says yes. It is never asked for a score, a ranking, or a hiring recommendation, and it never sees more than one candidate at a time. Everything else is TypeScript: `lib/evidence.ts` forces any `met`/`partial` verdict to `missing` when its quote cannot be found in the submitted CV, and `lib/ranking.ts` does all counting, disqualification and tie-breaking. A missing must-have disqualifies; a partial must-have does not, and is flagged in the UI instead. The database enforces the same rule independently — a `CHECK` constraint makes a positive verdict without evidence impossible to store.

Quote matching normalises whitespace, curly quotes, dashes and case before comparing, then stores the true span from the CV rather than the model's copy of it. A naive `includes()` would reject correct quotes that merely reflowed a line break, and gaps that aren't real are worse than the problem being solved.

## Running it

```bash
npm install
npm run seed      # 1 job, 8 requirements, 6 candidates
npm run dev
```

| Env var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key (server only) |
| `AI_MODEL` | Model id; defaults to `claude-opus-5` |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server only, never `NEXT_PUBLIC_`) |

`npm run smoke` makes one real call of each type and prints how many quotes survived validation — the fastest way to confirm your keys work. Schema lives in the migration history and in the SQL at the top of `scripts/seed.ts`'s output (`npm run seed -- --sql`).

**Deploy:** push to a Vercel project, set the four env vars above for Production/Preview/Development, deploy. Nothing touches the database at build time (every data page is `force-dynamic`), and `supabase-js` speaks HTTP to PostgREST, so there is no connection pool to exhaust. Evaluation is one HTTP request per candidate, which keeps each function invocation short instead of one long request for the whole batch.

## What is tested

41 tests, `npm test`. Unit tests cover the two rules the product rests on: evidence validation (quote absent from the CV, no quote at all, whitespace-only quote, invented verdict, skipped requirement, unknown id, evidence attached to a `missing` verdict — all resolve to `missing` with a recorded reason) and ranking (missing must-have disqualifies, partial does not, unevaluated requirements count as missing, ties fall through to a deterministic order). Integration tests drive the route handlers with the AI and database mocked, covering the empty and too-short inputs, malformed JSON, timeouts, the locked-requirements conflict, and the fact that a model quote absent from the CV is downgraded *before* it is stored.

## Deliberately left out

- **Vercel AI Gateway.** The brief specified it; it returned `403 customer_verification_required` on every inference call because the account has no card on file. Rather than ship a dead code path, calls go directly to Anthropic through the official SDK. Swapping back is one module.
- **Playwright E2E is committed but never run** (`e2e/happy-path.spec.ts`). The spec documents the intended flow and the config is there, but the two hours went to the unit and integration layers instead. It needs a real API key and a seeded database, because the mock AI layer was removed from application code — test scaffolding shouldn't live in the shipping path.
- **Re-evaluation.** Requirements lock once the first candidate is evaluated. Editing them afterwards would leave the grid quietly stale, and a "re-evaluate everyone" flow was more than the budget allowed.
- **Auth, multi-tenancy, file/PDF upload, real email sending, scoring weights, bulk import, pagination, dark mode, analytics, rate limiting** — all out of scope by agreement.
- **Streaming and progressive UI.** Candidates evaluate one at a time with a spinner; good enough at this scale.
- Seed data is hand-authored rather than model-generated so the demo is instant, free and identical every run. It is still pushed through the real validator, so a quote that doesn't match its CV fails the seed instead of silently becoming a gap. `npm run seed -- --evaluate` regenerates it with real model calls; it exists but the shipped fixtures are the hand-authored set.

One seeded candidate, Sofia Andersson, reads as strong but is not shortlisted: the model claimed a must-have with a quote that does not appear in her CV, so the validator recorded it as missing. That is the whole product in one row.
