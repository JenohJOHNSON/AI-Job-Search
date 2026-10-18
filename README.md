# Élan

Élan is a private, self-hosted job-search agent for France and Europe. It discovers real vacancies from official or explicitly public sources, scores each one against your reviewed profile with a transparent rule-based engine (optionally refined by an AI model within hard spending limits), de-duplicates and tracks them, notifies you once about new strong matches, and keeps your whole application pipeline in one responsive workspace.

It runs as three pieces that share PostgreSQL: a Next.js web app, an independent background worker, and an optional GitHub Actions backup trigger. Nothing needs your computer to stay on.

The app starts empty. It never ships or invents vacancies, candidate facts or results.

## What it does

| Area | Behaviour |
| --- | --- |
| Account | Single owner created with a one-time `SETUP_SECRET`; scrypt password hashes; revocable, hashed, HTTP-only sessions; same-origin checks; rate-limited login/setup/uploads. |
| Profile | Reviewed candidate profile with a version number. CV upload (PDF, DOCX, Markdown, text) is parsed in a sandboxed worker thread; the original file is kept untouched. AI suggestions (when configured) are reviewed field by field and never applied automatically. |
| Search profiles | Several focused searches (titles, related titles, places, keywords, exclusions, contract, salary floor, minimum score), with templates for data/integration, DevOps/C++ and analyst roles. French and English title variants are searched automatically. |
| Sources | France Travail (official API), Greenhouse, Lever and Ashby (public job-board APIs) and explicitly allow-listed company pages with schema.org `JobPosting` data. LinkedIn, Indeed, HelloWork, Jobijoba, Apec, Welcome to the Jungle and Cadremploi are listed as unavailable and supported through manual or URL import only. |
| Discovery | Whole boards are read, every vacancy is scored, relevant ones are stored; duplicates across sources are merged; vacancies that leave a board are marked removed or expired and come back if they reappear. |
| Matching | 0–100 score with Strong / Good / Possible / Low labels, per-component evidence, missing and transferable skills, hard blockers. Works with no AI key. See [docs/MATCHING.md](docs/MATCHING.md). |
| AI (optional) | OpenAI, Anthropic, Gemini or OpenRouter; schema-validated output, fingerprint caching, atomic daily request and cost reservations, no AI call without exact token prices. AI can refine a score but never lift a job past a hard blocker. |
| Pipeline | Kanban with Saved, Applied, Recruiter contact, Interview, Offer, Rejected and Archived, drag and drop, notes, follow-ups, interview dates and activity history. |
| Documents | Tailoring suggestions and cover letters in French or English, versioned, exported as Markdown, HTML, PDF and DOCX. Only facts from your reviewed profile are used; Élan never submits an application. |
| Automation | PostgreSQL task queue with leases, retry/backoff and crash recovery; a built-in daily schedule (Europe/Paris aware); run history with per-source diagnostics. |
| Notifications | Email (Resend or SMTP) and Telegram digests of genuinely new jobs above your threshold; each job is announced once per channel; test buttons in Settings. |
| Privacy | JSON export of all personal data and permanent deletion of the account and every private record. Logs exclude CVs and secrets. |

## Architecture

```mermaid
flowchart LR
  Browser --> Web[Next.js web]
  Actions[GitHub Actions backup trigger] --> Web
  Web --> DB[(PostgreSQL)]
  Worker[Worker + scheduler] --> DB
  Worker --> Sources[France Travail / Greenhouse / Lever / Ashby / company pages]
  Sources --> Score[Normalize, deduplicate, rule-based score]
  Score --> DB
  Score --> AI[Optional budgeted AI]
  Worker --> Digest[Email / Telegram digest]
```

More detail: [Architecture](docs/ARCHITECTURE.md) · [Matching](docs/MATCHING.md) · [Deployment](docs/DEPLOYMENT.md) · [Provider matrix](docs/PROVIDER_MATRIX.md) · [API contract](docs/API_CONTRACT.md) · [Adding a provider](docs/ADDING_PROVIDER.md) · [Technical audit](docs/AUDIT.md).

## Quick start

Requirements: Node.js 22 and PostgreSQL 16.

```bash
cp .env.example .env        # set DATABASE_URL, APP_URL, SETUP_SECRET, JOB_RUNNER_SECRET
npm install
npm run db:migrate
npm run dev                 # web on http://localhost:3000
```

In a second terminal run the worker. It reads `.env` itself:

```bash
npm run worker
```

Open `http://localhost:3000`, create the owner account with your `SETUP_SECRET`, then follow the checklist on the dashboard:

1. **My profile**: target roles, skills, locations, languages, years of experience, work style, minimum salary (and optionally upload your CV).
2. **Search profiles**: start from a template, adjust, save.
3. **Job sources**: add Greenhouse, Lever or Ashby board names (paste the board URL if you like), or configure France Travail; run **Check connection**; enable the source.
4. **Run job search**. The worker fetches, scores and stores vacancies; results appear under **Discover jobs**.

Local development uses `next dev`, whose hot reload needs a relaxed Content-Security-Policy; use a production build (`npm run build && npm start`) to see exactly what ships.

## Environment variables

Required: `DATABASE_URL`, `APP_URL`, `SETUP_SECRET` (16+ characters), `JOB_RUNNER_SECRET` (24+ characters, different). `NEXTAUTH_SECRET` is no longer used and may be omitted.

| Group | Variables | Notes |
| --- | --- | --- |
| France Travail | `FRANCE_TRAVAIL_CLIENT_ID`, `FRANCE_TRAVAIL_CLIENT_SECRET` | Optional. Create an application at [francetravail.io](https://francetravail.io) and subscribe it to *Offres d'emploi v2*. Covers France only. |
| AI | `AI_PROVIDER`, `AI_MODEL`, the matching `*_API_KEY`, `AI_INPUT_PRICE_PER_MILLION`, `AI_OUTPUT_PRICE_PER_MILLION`, `AI_FALLBACK_MODEL` | Optional. All of model, key and both prices are needed; prices are not hard-coded because they change. |
| Email | `EMAIL_FROM`, `DIGEST_TO`, and `RESEND_API_KEY` **or** `SMTP_URL` | Optional. |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Optional. |
| Ceilings | `MAX_AI_ANALYSES_PER_DAY` (30), `MAX_LLM_COST_PER_DAY` (2), `MAX_JOBS_PER_PROVIDER` (50), `MAX_TOTAL_JOBS_PER_RUN` (200), `AI_MATCH_THRESHOLD` (40), `NOTIFICATION_SCORE_THRESHOLD` (80), `SESSION_TTL_DAYS` (14), `TASK_LEASE_SECONDS` (300) | The owner can lower the AI and volume limits and set the notification threshold in **Settings**; stored values can never exceed these ceilings. |

See [.env.example](.env.example). Notification switches, the daily schedule (default 06:30 Europe/Paris), the notification threshold and spending limits live in **Settings**, not in environment variables.

## Job sources

- **France Travail**: official OAuth API; searches use your titles (French and English variants) and the départements of your preferred places (Nancy → 54, Metz → 57, Grand Est, …); pages through results; withdrawn offers are detected by direct look-ups. It does not cover Luxembourg.
- **Greenhouse, Lever, Ashby**: public job-board APIs, no credentials. You choose the employer boards. A suggested starter list of boards that were reachable on 2026-10-18 is offered in the UI; few companies in Nancy, Metz or Luxembourg publish public boards, so expect most of these to be Paris or remote-first employers.
- **Company career pages**: HTTPS pages you list explicitly, with a matching host allow-list, robots.txt respected, private addresses refused and size/time limits.
- **Restricted platforms** (LinkedIn, Indeed, HelloWork, Apec, Welcome to the Jungle, …): never fetched. Paste the posting with **Import a posting** and keep the original link as your application link.

Élan does not bypass CAPTCHAs, logins, rate limits or robots rules. A blocked or changed source records a classified failure and the other sources continue. Read the [provider matrix](docs/PROVIDER_MATRIX.md) before enabling or adding a source; terms and APIs change.

## Testing

```bash
npm run lint
npm run typecheck
npm test                       # unit tests (offline); add TEST_DATABASE_URL to include the PostgreSQL integration tests
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/elan_test npm test
npm run build
npm run e2e                    # Playwright against a production build + worker (empty database)
npm run smoke:live             # bounded live request to a few PUBLIC job boards (no credentials)
```

Unit and integration tests use synthetic fixtures that are kept clearly apart from production data. Browser tests use deterministic manual data, run axe-core accessibility scans on every page and check phone layouts. The live smoke test is manual by design (see `.github/workflows/live-smoke.yml`).

## Docker

```bash
docker build --target web -t elan-web .
docker build --target worker -t elan-worker .
```

Both images are non-root and need the same environment and database. The web image runs `prisma migrate deploy` before starting and exposes `/api/health`; the worker has no HTTP port.

## Deployment

Railway (web + worker + PostgreSQL) and the GitHub Actions backup trigger are described step by step, with the exact external accounts and credentials involved, in **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. This repository prepares and tests the deployable artifacts; it does not claim that a deployment already exists.

## Security and privacy

- Authorization is enforced on every private route; a test fails the build if a route handler stops calling `requireUser()` or `assertSameOrigin()`.
- Uploads are limited to 5 MB, checked by declared type and file signature, and parsed in a memory-capped, time-limited worker thread.
- Outbound requests to user-supplied URLs resolve DNS first, refuse private and reserved addresses, validate every redirect, cap bytes and time, and honour robots.txt.
- The Content-Security-Policy, `X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy` headers are set for every response.
- Secrets and CV contents are never logged. Never commit `.env`.
- Remaining dependency advisories: `npm audit --omit=dev` reports 3 *moderate* findings (a ReDoS-style issue in `sprintf-js` pulled in by `mammoth`). Mammoth only ever runs inside the sandboxed parsing thread, so the impact is a bounded, time-limited failure of one upload.

The operator is responsible for source terms, robots policies, rate limits and applicable French and EU law. Collect only public vacancy information needed for a personal search.

## Troubleshooting

- **A run stays queued**: the worker is not running or uses a different `DATABASE_URL`. Check its logs for `worker_started`.
- **A run fails with “No job source is enabled”** or **“Create and enable at least one search profile”**: finish the dashboard checklist; the message says exactly what is missing.
- **A source is degraded with no jobs**: use **Check connection** for the per-board result. A 404 means the board name is wrong; an empty board is reported as such rather than hidden.
- **France Travail shows an authentication error**: the client id/secret are missing or the application is not subscribed to *Offres d'emploi v2*.
- **AI stays off**: provide a model, its key and both token prices. Without them everything still works using rule-based scores.
- **Digest not arriving**: enable the channel in Settings, check the transport variables, use the test button, and remember each job is announced only once.
- **Daily search did not start**: the schedule needs a profile, an active search profile and an enabled source; see Settings.

## Known limitations

- France Travail, AI providers, email and Telegram cannot be exercised without your credentials; they are covered by stubbed-network tests and were not run live here.
- Luxembourg vacancies are only reachable through employers' public boards or manual import.
- Scanned (image-only) PDFs are not read; export a text-based PDF or DOCX.
- The in-process rate limiter assumes one web instance.
- The rule-based matcher is keyword and knowledge-base driven (FR/EN synonyms, geography, skill families); it does not use embeddings.

## License

Copyright 2026. Released under the MIT License; see `LICENSE`. Reference projects were studied as documented in `docs/REFERENCES.md`; no third-party source code was copied.
